#!/usr/bin/env ts-node
/**
 * HTTP Integration Test for DIDComm VP Flow
 *
 * This test validates the HTTP transport layer without Docker/Envoy.
 *
 * Prerequisites:
 * 1. Start NF-A server: PORT=3000 DID_NF_A=... DB_PATH=... node didcomm-http-server.ts
 * 2. Start NF-B server: PORT=3001 DID_NF_B=... DB_PATH=... node didcomm-http-server.ts
 * 3. Run this test: node test-http-vp-flow.ts
 */

import http from 'http';
import { createAgent } from '@veramo/core';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import { CredentialPlugin } from '@veramo/credential-w3c';
import { KeyManager } from '@veramo/key-manager';
import { DIDManager } from '@veramo/did-manager';
import { KeyStore, DIDStore, PrivateKeyStore, DataStore, DataStoreORM } from '@veramo/data-store';
import { KeyManagementSystem, SecretBox } from '@veramo/kms-local';
import { WebDIDProvider } from '@veramo/did-provider-web';
import { Resolver } from 'did-resolver';
import { getResolver as webDidResolver } from 'web-did-resolver';
import { DataSource } from 'typeorm';
import { Entities, migrations } from '@veramo/data-store';
import {
  DIDCommVPMessage,
  DIDCOMM_MESSAGE_TYPES,
  createVPAuthRequest
} from './didcomm-messages.js';
import {
  PRESENTATION_DEFINITION_A,
  PRESENTATION_DEFINITION_B
} from './presentation-definitions.js';

// DIDs
const DID_NF_A = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
const DID_NF_B = 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b';

// HTTP Server URLs
const URL_NF_A = 'http://localhost:3000';
const URL_NF_B = 'http://localhost:3001';

/**
 * Send HTTP POST request
 */
function httpPost(url: string, data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(responseData));
          } catch {
            resolve(responseData);
          }
        } else if (res.statusCode === 204) {
          resolve(null);  // No content
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Send HTTP GET request
 */
function httpGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Wait for a duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main test function
 */
async function testHTTPVPFlow() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              HTTP Integration Test for DIDComm VP Flow                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    // Step 1: Health checks
    console.log('📋 Step 1: Checking if servers are running...');

    let healthA, healthB;
    try {
      healthA = await httpGet(`${URL_NF_A}/health`);
      console.log(`   ✅ NF-A is running: ${healthA.did}`);
    } catch (error) {
      console.error('   ❌ NF-A server is not running!');
      console.error('   Start it with:');
      console.error('   PORT=3000 DID_NF_A=did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a DB_PATH=../cluster-a/database-nf-a.sqlite DB_ENCRYPTION_KEY=ed9733675a04a20b91c5beb2196a6c964dce7d520a77be577a8a605911232ba6 node --loader ts-node/esm didcomm-http-server.ts');
      process.exit(1);
    }

    try {
      healthB = await httpGet(`${URL_NF_B}/health`);
      console.log(`   ✅ NF-B is running: ${healthB.did}`);
    } catch (error) {
      console.error('   ❌ NF-B server is not running!');
      console.error('   Start it with:');
      console.error('   PORT=3001 DID_NF_B=did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b DB_PATH=../cluster-b/database-nf-b.sqlite DB_ENCRYPTION_KEY=3859413b662c8fc7e632cda1fe9d5f07991c0b5d2bd2d8a69fa36e9e25cfef1d node --loader ts-node/esm didcomm-http-server.ts');
      process.exit(1);
    }

    console.log('');

    // Step 2: Phase 1 - NF-A sends VP Auth Request to NF-B
    console.log('📍 PHASE 1: Initial Service Request & Auth-Anfrage');
    console.log('================================================================================');
    console.log('   NF-A → NF-B: VP_AUTH_REQUEST + PD_A');

    const vpAuthRequest = createVPAuthRequest(
      DID_NF_A,
      DID_NF_B,
      PRESENTATION_DEFINITION_A,
      'Please authenticate yourself'
    );

    console.log(`   Sending message to ${URL_NF_B}/didcomm/receive...`);
    const vpWithPDResponse = await httpPost(`${URL_NF_B}/didcomm/receive`, vpAuthRequest);

    if (!vpWithPDResponse) {
      throw new Error('No response from NF-B');
    }

    console.log(`   ✅ Received response: ${vpWithPDResponse.type}`);
    console.log('');

    // Step 3: Phase 2 - NF-A processes VP_B and sends VP_A
    console.log('📍 PHASE 2: Mutual Authentication / VP Austausch');
    console.log('================================================================================');
    console.log('   NF-B → NF-A: VP_WITH_PD (VP_B + PD_B)');
    console.log('   Processing VP_B and creating VP_A...');

    const vpResponseMessage = await httpPost(`${URL_NF_A}/didcomm/receive`, vpWithPDResponse);

    if (!vpResponseMessage) {
      throw new Error('No response from NF-A');
    }

    console.log(`   ✅ Received response: ${vpResponseMessage.type}`);
    console.log('');

    // Step 4: Phase 2 (final) - NF-B verifies VP_A and confirms
    console.log('   NF-A → NF-B: VP_RESPONSE (VP_A)');
    console.log('   NF-B verifying VP_A...');

    const authConfirmation = await httpPost(`${URL_NF_B}/didcomm/receive`, vpResponseMessage);

    if (!authConfirmation) {
      throw new Error('No confirmation from NF-B');
    }

    console.log(`   ✅ Received confirmation: ${authConfirmation.type}`);
    console.log(`   Status: ${authConfirmation.body.status}`);
    console.log('');

    // Step 5: Phase 3 - NF-A receives confirmation
    console.log('📍 PHASE 3: Authorized Communication');
    console.log('================================================================================');
    console.log('   NF-B → NF-A: AUTH_CONFIRMATION');

    await httpPost(`${URL_NF_A}/didcomm/receive`, authConfirmation);
    console.log('   ✅ NF-A received confirmation');
    console.log('');

    // Success!
    console.log('╔════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                         TEST SUMMARY                                       ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('🎉 HTTP Integration Test: PASSED');
    console.log('');
    console.log('✅ Phase 1: VP Auth Request successful');
    console.log('✅ Phase 2: Mutual VP exchange successful');
    console.log('✅ Phase 3: Authentication confirmed');
    console.log('');
    console.log('📊 Message Flow Validated:');
    console.log('   1. NF-A → NF-B: VP_AUTH_REQUEST');
    console.log('   2. NF-B → NF-A: VP_WITH_PD');
    console.log('   3. NF-A → NF-B: VP_RESPONSE');
    console.log('   4. NF-B → NF-A: AUTH_CONFIRMATION');
    console.log('');
    console.log('🚀 HTTP Transport Layer is working!');
    console.log('   Ready for Docker + Envoy integration');
    console.log('');

  } catch (error: any) {
    console.error('');
    console.error('╔════════════════════════════════════════════════════════════════════════════╗');
    console.error('║                         TEST FAILED                                        ║');
    console.error('╚════════════════════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error('❌ Error:', error.message);
    console.error('');
    if (error.stack) {
      console.error('Stack trace:');
      console.error(error.stack);
    }
    console.error('');
    process.exit(1);
  }
}

// Run the test
testHTTPVPFlow().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
