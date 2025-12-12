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
import { KeyManager } from '@veramo/key-manager';
import { DIDManager } from '@veramo/did-manager';
import { KeyStore, DIDStore, PrivateKeyStore, DataStore, DataStoreORM } from '@veramo/data-store';
import { KeyManagementSystem, SecretBox } from '@veramo/kms-local';
import { WebDIDProvider } from '@veramo/did-provider-web';
import { Resolver } from 'did-resolver';
import { getResolver as webDidResolver } from 'web-did-resolver';
import { DataSource } from 'typeorm';
import { Entities, migrations } from '@veramo/data-store';
import { createVPFromPD, verifyVPAgainstPD } from './vp-creation_manuell.js';
import { PRESENTATION_DEFINITION_A, PRESENTATION_DEFINITION_B } from './presentation-definitions.js';
// DIDs
const DID_NF_A = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
const DID_NF_B = 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b';
const DID_ISSUER_A = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-issuer-a';
// Database paths and encryption keys (from agent.yml)
const DB_PATH_NF_A = '../cluster-a/database-nf-a.sqlite';
const DB_ENCRYPTION_KEY_A = 'ed9733675a04a20b91c5beb2196a6c964dce7d520a77be577a8a605911232ba6';
const DB_PATH_NF_B = '../cluster-b/database-nf-b.sqlite';
const DB_ENCRYPTION_KEY_B = '3859413b662c8fc7e632cda1fe9d5f07991c0b5d2bd2d8a69fa36e9e25cfef1d';
/**
 * Create a Veramo agent with database connection
 * This agent has access to private keys and can sign VPs
 */
async function createAgentWithDatabase(dbPath, encryptionKey) {
    // Create database connection
    const dbConnection = new DataSource({
        type: 'sqlite',
        database: dbPath,
        synchronize: false,
        migrationsRun: true,
        migrations,
        logging: false,
        entities: Entities,
    });
    await dbConnection.initialize();
    // Create agent with full configuration
    const agent = createAgent({
        plugins: [
            new KeyManager({
                store: new KeyStore(dbConnection),
                kms: {
                    local: new KeyManagementSystem(new PrivateKeyStore(dbConnection, new SecretBox(encryptionKey))),
                },
            }),
            new DIDManager({
                store: new DIDStore(dbConnection),
                defaultProvider: 'did:web',
                providers: {
                    'did:web': new WebDIDProvider({
                        defaultKms: 'local',
                    }),
                },
            }),
            new DIDResolverPlugin({
                resolver: new Resolver({
                    ...webDidResolver(),
                }),
            }),
            new CredentialPlugin(),
            new DataStore(dbConnection),
            new DataStoreORM(dbConnection),
        ],
    });
    return agent;
}
// Agents will be initialized in runTest()
let agentNFA;
let agentNFB;
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
    console.log('🧪 VP Creation and Verification Test (with Real Database)');
    console.log('='.repeat(80));
    try {
        // ========================================================================
        // SETUP: Initialize agents with database connections
        // ========================================================================
        console.log('\n🔧 SETUP: Initializing agents with database connections...');
        console.log('-'.repeat(80));
        agentNFA = await createAgentWithDatabase(DB_PATH_NF_A, DB_ENCRYPTION_KEY_A);
        console.log('✅ Agent NF-A initialized');
        agentNFB = await createAgentWithDatabase(DB_PATH_NF_B, DB_ENCRYPTION_KEY_B);
        console.log('✅ Agent NF-B initialized');
        // Load credentials from database
        console.log('\n📂 Loading credentials from database...');
        const credentialsNFA = await agentNFA.dataStoreORMGetVerifiableCredentials({
            where: [{ column: 'subject', value: [DID_NF_A] }]
        });
        console.log(`   Found ${credentialsNFA.length} credential(s) for NF-A`);
        if (credentialsNFA.length > 0) {
            console.log('   Credential NF-A:', JSON.stringify(credentialsNFA[0], null, 2));
        }
        const credentialsNFB = await agentNFB.dataStoreORMGetVerifiableCredentials({
            where: [{ column: 'subject', value: [DID_NF_B] }]
        });
        console.log(`   Found ${credentialsNFB.length} credential(s) for NF-B`);
        // Filter for NetworkFunctionCredentials
        const nfCredentialsNFA = credentialsNFA.filter((cred) => cred.verifiableCredential.type.includes('NetworkFunctionCredential'));
        const nfCredentialsNFB = credentialsNFB.filter((cred) => cred.verifiableCredential.type.includes('NetworkFunctionCredential'));
        console.log(`   Found ${nfCredentialsNFA.length} NetworkFunctionCredential(s) for NF-A`);
        console.log(`   Found ${nfCredentialsNFB.length} NetworkFunctionCredential(s) for NF-B`);
        if (nfCredentialsNFA.length > 0) {
            console.log('   NF-A Credential:', JSON.stringify(nfCredentialsNFA[0].verifiableCredential, null, 2));
        }
        if (nfCredentialsNFB.length > 0) {
            console.log('   NF-B Credential:', JSON.stringify(nfCredentialsNFB[0].verifiableCredential, null, 2));
        }
        if (nfCredentialsNFA.length === 0) {
            console.log('⚠️  Warning: No NetworkFunctionCredentials found for NF-A. Using mock credential.');
        }
        if (nfCredentialsNFB.length === 0) {
            console.log('⚠️  Warning: No NetworkFunctionCredentials found for NF-B. Using mock credential.');
        }
        // Use NetworkFunctionCredentials if available, otherwise fall back to mock
        const credentialNFA = nfCredentialsNFA.length > 0
            ? nfCredentialsNFA[0].verifiableCredential
            : mockCredentialNFA;
        const credentialNFB = nfCredentialsNFB.length > 0
            ? nfCredentialsNFB[0].verifiableCredential
            : mockCredentialNFB;
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
        const vpB = await createVPFromPD(agentNFB, DID_NF_B, [credentialNFB], PRESENTATION_DEFINITION_A);
        console.log('✅ VP_B created');
        console.log(`   Holder: ${vpB.holder}`);
        console.log(`   Credentials included: ${vpB.verifiableCredential?.length || 0}`);
        // ========================================================================
        // PHASE 3: NF-A verifies VP_B
        // ========================================================================
        console.log('\n🔍 PHASE 3: NF-A verifies VP_B');
        console.log('-'.repeat(80));
        const verificationResult = await verifyVPAgainstPD(agentNFA, vpB, PRESENTATION_DEFINITION_A);
        if (verificationResult.verified) {
            console.log('✅ VP_B verified successfully!');
            console.log('   NF-B is authenticated');
        }
        else {
            console.log('❌ VP_B verification failed');
            console.log('   Error:', verificationResult.error);
        }
        // ========================================================================
        // PHASE 4: NF-B sends PD_B, NF-A creates VP_A
        // ========================================================================
        console.log('\n📝 PHASE 4: NF-A creates VP_A to satisfy PD_B');
        console.log('-'.repeat(80));
        const vpA = await createVPFromPD(agentNFA, DID_NF_A, [credentialNFA], PRESENTATION_DEFINITION_B);
        console.log('✅ VP_A created');
        console.log(`   Holder: ${vpA.holder}`);
        console.log(`   Credentials included: ${vpA.verifiableCredential?.length || 0}`);
        // ========================================================================
        // PHASE 5: NF-B verifies VP_A
        // ========================================================================
        console.log('\n🔍 PHASE 5: NF-B verifies VP_A');
        console.log('-'.repeat(80));
        const verificationResultA = await verifyVPAgainstPD(agentNFB, vpA, PRESENTATION_DEFINITION_B);
        if (verificationResultA.verified) {
            console.log('✅ VP_A verified successfully!');
            console.log('   NF-A is authenticated');
        }
        else {
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
        }
        else {
            console.log('\n❌ Mutual authentication failed');
        }
        console.log('='.repeat(80));
    }
    catch (error) {
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
