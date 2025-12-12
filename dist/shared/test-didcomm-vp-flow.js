#!/usr/bin/env ts-node
/**
 * Test script for DIDComm VP Flow
 *
 * This demonstrates the complete mutual authentication flow using DIDComm messages:
 * Phase 1: NF-A → NF-B: DIDComm[VP_Auth_Request + PD_A]
 * Phase 2: NF-B → NF-A: DIDComm[VP_B + PD_B]
 *          NF-A → NF-B: DIDComm[VP_A]
 * Phase 3: NF-B → NF-A: DIDComm[Authorized]
 *
 * Architecture:
 * Veramo_NF_A ↔ Veramo_NF_B (DIDComm Messages)
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
import { performMutualAuthentication, DIDCommVPWrapper } from './didcomm-vp-wrapper.js';
import { PRESENTATION_DEFINITION_A, PRESENTATION_DEFINITION_B } from './presentation-definitions.js';
// DIDs
const DID_NF_A = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
const DID_NF_B = 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b';
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
    return { agent, dbConnection };
}
/**
 * Load credentials from database
 */
async function loadCredentials(agent, holderDid) {
    try {
        const credentials = await agent.dataStoreORMGetVerifiableCredentials({
            where: [
                { column: 'subject', value: [holderDid] }
            ]
        });
        // Filter for NetworkFunctionCredentials
        const nfCredentials = credentials.filter((cred) => cred.verifiableCredential.type.includes('NetworkFunctionCredential'));
        return nfCredentials.map((cred) => cred.verifiableCredential);
    }
    catch (error) {
        console.error(`Error loading credentials for ${holderDid}:`, error.message);
        return [];
    }
}
/**
 * Main test function
 */
async function testDIDCommVPFlow() {
    console.log('╔════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                  DIDComm VP Flow Test                                      ║');
    console.log('║                  Testing Mutual Authentication with DIDComm Messages       ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════╝');
    // Create agents for both NF-A and NF-B
    console.log('\n📦 Setting up Veramo agents...');
    const { agent: agentA, dbConnection: dbA } = await createAgentWithDatabase(DB_PATH_NF_A, DB_ENCRYPTION_KEY_A);
    console.log('   ✅ Agent NF-A created');
    const { agent: agentB, dbConnection: dbB } = await createAgentWithDatabase(DB_PATH_NF_B, DB_ENCRYPTION_KEY_B);
    console.log('   ✅ Agent NF-B created');
    try {
        // Load credentials
        console.log('\n📋 Loading credentials...');
        const credentialsA = await loadCredentials(agentA, DID_NF_A);
        console.log(`   ✅ Loaded ${credentialsA.length} credential(s) for NF-A`);
        const credentialsB = await loadCredentials(agentB, DID_NF_B);
        console.log(`   ✅ Loaded ${credentialsB.length} credential(s) for NF-B`);
        if (credentialsA.length === 0 || credentialsB.length === 0) {
            console.error('\n❌ No NetworkFunctionCredentials found!');
            console.log('   Run create-nf-credentials.ts first to create credentials.');
            process.exit(1);
        }
        // Perform mutual authentication
        const result = await performMutualAuthentication(agentA, agentB, DID_NF_A, DID_NF_B, credentialsA, credentialsB, PRESENTATION_DEFINITION_A, PRESENTATION_DEFINITION_B);
        // Print results
        console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
        console.log('║                  MUTUAL AUTHENTICATION SUMMARY                             ║');
        console.log('╚════════════════════════════════════════════════════════════════════════════╝');
        console.log(`\nNF-A authenticated: ${result.nfAAuthenticated ? '✅ YES' : '❌ NO'}`);
        console.log(`NF-B authenticated: ${result.nfBAuthenticated ? '✅ YES' : '❌ NO'}`);
        if (result.sessionToken) {
            console.log(`\nSession Token: ${result.sessionToken.substring(0, 40)}...`);
        }
        if (result.error) {
            console.log(`\n❌ Error: ${result.error}`);
        }
        if (result.nfAAuthenticated && result.nfBAuthenticated) {
            console.log('\n🎉 Mutual authentication successful!');
            console.log('   Both parties can now proceed with authorized communication\n');
            // Demonstrate Phase 3: Service Request
            console.log('\n📍 PHASE 3 DEMO: Sending Service Request');
            console.log('================================================================================');
            const wrapperA = new DIDCommVPWrapper(agentA);
            // Re-create context (in real app, this would be persisted)
            const mockContext = {
                ourDid: DID_NF_A,
                theirDid: DID_NF_B,
                ourPresentationDefinition: PRESENTATION_DEFINITION_A,
                theirPresentationDefinition: PRESENTATION_DEFINITION_B,
                authenticated: true,
                sessionToken: result.sessionToken,
                messageLog: []
            };
            // Manually set context (workaround for demo)
            wrapperA.contexts.set(DID_NF_B, mockContext);
            const serviceRequest = await wrapperA.sendServiceRequest(DID_NF_B, 'credential-issuance', 'issue-credential', { credentialType: 'VerifiableCredential', subject: 'test' });
            console.log('✅ Service Request created');
            console.log(`   Message Type: ${serviceRequest.type}`);
            console.log(`   Service: credential-issuance`);
            console.log(`   Action: issue-credential`);
            console.log(`   Session Token: ${serviceRequest.body.session_token?.substring(0, 20)}...`);
        }
        else {
            console.log('\n❌ Mutual authentication failed!\n');
            process.exit(1);
        }
    }
    finally {
        // Close database connections
        await dbA.destroy();
        await dbB.destroy();
    }
}
// Run the test
testDIDCommVPFlow().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
