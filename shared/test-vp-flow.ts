#!/usr/bin/env ts-node
/**
 * Test script for VP Creation and Verification
 *
 * This demonstrates the full Presentation Exchange flow:
 * 1. Create credentials for NF-A and NF-B
 * 2. NF-A requests VP from NF-B using PD_A
 * 3. NF-B creates VP_B matching PD_A
 * 4. NF-A verifies VP_B
 */

import { createAgent } from '@veramo/core';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import { CredentialPlugin } from '@veramo/credential-w3c';
import { Resolver } from 'did-resolver';
import { getResolver as webDidResolver } from 'web-did-resolver';
import {
  createVPFromPD,
  verifyVPAgainstPD,
  createVerifiablePresentation,
  verifyVerifiablePresentation
} from './vp-creation_manuell.js';
import {
  PRESENTATION_DEFINITION_A,
  PRESENTATION_DEFINITION_B
} from './presentation-definitions.js';

// DIDs
const DID_NF_A = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
const DID_NF_B = 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b';
const DID_ISSUER_A = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-issuer-a';

// Create agent (read-only for testing)
const agent = createAgent({
  plugins: [
    new DIDResolverPlugin({
      resolver: new Resolver({
        ...webDidResolver()
      })
    }),
    new CredentialPlugin()
  ]
});

/**
 * Mock credential for NF-B
 * In reality, this would be retrieved from the database
 */
const mockCredentialNFB = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  type: ['VerifiableCredential', 'NetworkFunctionCredential'],
  issuer: { id: DID_ISSUER_A },
  issuanceDate: '2025-12-08T15:37:47.000Z',
  credentialSubject: {
    id: DID_NF_B,
    role: 'network-function',
    clusterId: 'cluster-b',
    status: 'active',
    capabilities: ['messaging', 'verification']
  },
  proof: {
    type: 'JwtProof2020',
    jwt: 'eyJhbGciOiJFUzI1NksiLCJ0eXAiOiJKV1QifQ.eyJ2YyI6eyJAY29udGV4dCI6WyJodHRwczovL3d3dy53My5vcmcvMjAxOC9jcmVkZW50aWFscy92MSJdLCJ0eXBlIjpbIlZlcmlmaWFibGVDcmVkZW50aWFsIiwiTmV0d29ya0Z1bmN0aW9uQ3JlZGVudGlhbCJdLCJjcmVkZW50aWFsU3ViamVjdCI6eyJyb2xlIjoibmV0d29yay1mdW5jdGlvbiIsImNsdXN0ZXJJZCI6ImNsdXN0ZXItYiIsInN0YXR1cyI6ImFjdGl2ZSJ9fSwic3ViIjoiZGlkOndlYjpraXV5ZW56by5naXRodWIuaW86UHJvdG90eXBlOmNsdXN0ZXItYjpkaWQtbmYtYiIsIm5iZiI6MTc2NTIwODI2NywiaXNzIjoiZGlkOndlYjpraXV5ZW56by5naXRodWIuaW86UHJvdG90eXBlOmNsdXN0ZXItYTpkaWQtaXNzdWVyLWEifQ.mock-signature'
  }
};

/**
 * Mock credential for NF-A
 */
const mockCredentialNFA = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  type: ['VerifiableCredential', 'NetworkFunctionCredential'],
  issuer: { id: DID_ISSUER_A },
  issuanceDate: '2025-12-08T15:37:47.000Z',
  credentialSubject: {
    id: DID_NF_A,
    role: 'network-function',
    clusterId: 'cluster-a',
    status: 'active',
    capabilities: ['messaging', 'verification']
  },
  proof: {
    type: 'JwtProof2020',
    jwt: 'eyJhbGciOiJFUzI1NksiLCJ0eXAiOiJKV1QifQ.eyJ2YyI6eyJAY29udGV4dCI6WyJodHRwczovL3d3dy53My5vcmcvMjAxOC9jcmVkZW50aWFscy92MSJdLCJ0eXBlIjpbIlZlcmlmaWFibGVDcmVkZW50aWFsIiwiTmV0d29ya0Z1bmN0aW9uQ3JlZGVudGlhbCJdLCJjcmVkZW50aWFsU3ViamVjdCI6eyJyb2xlIjoibmV0d29yay1mdW5jdGlvbiIsImNsdXN0ZXJJZCI6ImNsdXN0ZXItYSIsInN0YXR1cyI6ImFjdGl2ZSJ9fSwic3ViIjoiZGlkOndlYjpraXV5ZW56by5naXRodWIuaW86UHJvdG90eXBlOmNsdXN0ZXItYTpkaWQtbmYtYSIsIm5iZiI6MTc2NTIwODI2NywiaXNzIjoiZGlkOndlYjpraXV5ZW56by5naXRodWIuaW86UHJvdG90eXBlOmNsdXN0ZXItYTpkaWQtaXNzdWVyLWEifQ.mock-signature'
  }
};

async function runTest() {
  console.log('='.repeat(80));
  console.log('🧪 VP Creation and Verification Test');
  console.log('='.repeat(80));

  try {
    // ========================================================================
    // PHASE 1: NF-A sends VP_Auth_Request with PD_A
    // ========================================================================
    console.log('\n📤 PHASE 1: NF-A sends auth request with PD_A');
    console.log('-'.repeat(80));
    console.log('PD_A requires:');
    console.log('  - NetworkFunctionCredential');
    console.log('  - role: network-function');
    console.log('  - status: active');

    // ========================================================================
    // PHASE 2: NF-B creates VP_B based on PD_A
    // ========================================================================
    console.log('\n📝 PHASE 2: NF-B creates VP_B to satisfy PD_A');
    console.log('-'.repeat(80));

    const vpB = await createVPFromPD(
      agent as any,
      DID_NF_B,
      [mockCredentialNFB],
      PRESENTATION_DEFINITION_A
    );

    console.log('✅ VP_B created');
    console.log(`   Holder: ${vpB.holder}`);
    console.log(`   Credentials included: ${vpB.verifiableCredential?.length || 0}`);

    // ========================================================================
    // PHASE 3: NF-A verifies VP_B
    // ========================================================================
    console.log('\n🔍 PHASE 3: NF-A verifies VP_B');
    console.log('-'.repeat(80));

    // Note: In a real scenario, this would use the actual JWT and verify the signature
    // For this test, we're demonstrating the PD matching logic
    console.log('⚠️  Note: Using mock credentials (signature verification skipped)');

    const verificationResult = await verifyVPAgainstPD(
      agent as any,
      vpB,
      PRESENTATION_DEFINITION_A
    );

    if (verificationResult.verified) {
      console.log('✅ VP_B verified successfully!');
      console.log('   NF-B is authenticated');
    } else {
      console.log('❌ VP_B verification failed');
      console.log('   Error:', verificationResult.error);
    }

    // ========================================================================
    // PHASE 4: NF-B sends PD_B, NF-A creates VP_A
    // ========================================================================
    console.log('\n📝 PHASE 4: NF-A creates VP_A to satisfy PD_B');
    console.log('-'.repeat(80));

    const vpA = await createVPFromPD(
      agent as any,
      DID_NF_A,
      [mockCredentialNFA],
      PRESENTATION_DEFINITION_B
    );

    console.log('✅ VP_A created');
    console.log(`   Holder: ${vpA.holder}`);
    console.log(`   Credentials included: ${vpA.verifiableCredential?.length || 0}`);

    // ========================================================================
    // PHASE 5: NF-B verifies VP_A
    // ========================================================================
    console.log('\n🔍 PHASE 5: NF-B verifies VP_A');
    console.log('-'.repeat(80));

    const verificationResultA = await verifyVPAgainstPD(
      agent as any,
      vpA,
      PRESENTATION_DEFINITION_B
    );

    if (verificationResultA.verified) {
      console.log('✅ VP_A verified successfully!');
      console.log('   NF-A is authenticated');
    } else {
      console.log('❌ VP_A verification failed');
      console.log('   Error:', verificationResultA.error);
    }

    // ========================================================================
    // SUMMARY
    // ========================================================================
    console.log('\n' + '='.repeat(80));
    console.log('📊 MUTUAL AUTHENTICATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`NF-B authenticated: ${verificationResult.verified ? '✅ YES' : '❌ NO'}`);
    console.log(`NF-A authenticated: ${verificationResultA.verified ? '✅ YES' : '❌ NO'}`);

    if (verificationResult.verified && verificationResultA.verified) {
      console.log('\n🎉 Mutual authentication successful!');
      console.log('   Both parties can now proceed with authorized communication');
    } else {
      console.log('\n❌ Mutual authentication failed');
    }

    console.log('='.repeat(80));

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
runTest()
  .then(() => {
    console.log('\n✅ Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
