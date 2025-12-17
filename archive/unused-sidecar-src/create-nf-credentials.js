#!/usr/bin/env ts-node
"use strict";
/**
 * Script to create NetworkFunctionCredentials for NF-A and NF-B
 *
 * This creates credentials that match the Presentation Definitions:
 * - type: NetworkFunctionCredential
 * - credentialSubject with role, clusterId, status, capabilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@veramo/core");
const credential_w3c_1 = require("@veramo/credential-w3c");
const key_manager_1 = require("@veramo/key-manager");
const did_manager_1 = require("@veramo/did-manager");
const data_store_1 = require("@veramo/data-store");
const kms_local_1 = require("@veramo/kms-local");
const did_provider_web_1 = require("@veramo/did-provider-web");
const did_resolver_1 = require("@veramo/did-resolver");
const did_resolver_2 = require("did-resolver");
const web_did_resolver_1 = require("web-did-resolver");
const typeorm_1 = require("typeorm");
const data_store_2 = require("@veramo/data-store");
const NF_A_CONFIG = {
    dbPath: '/app/cluster-a/database-nf-a.sqlite',
    dbEncryptionKey: 'ed9733675a04a20b91c5beb2196a6c964dce7d520a77be577a8a605911232ba6',
    issuerDid: 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a',  // Self-issued
    subjectDid: 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a',
    clusterId: 'cluster-a',
    nfName: 'NF-A'
};
const NF_B_CONFIG = {
    dbPath: '/app/cluster-b/database-nf-b.sqlite',
    dbEncryptionKey: '3859413b662c8fc7e632cda1fe9d5f07991c0b5d2bd2d8a69fa36e9e25cfef1d',
    issuerDid: 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b',  // Self-issued
    subjectDid: 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b',
    clusterId: 'cluster-b',
    nfName: 'NF-B'
};
/**
 * Create a Veramo agent with database connection
 */
async function createAgentWithDatabase(dbPath, encryptionKey) {
    const dbConnection = new typeorm_1.DataSource({
        type: 'sqlite',
        database: dbPath,
        synchronize: false,
        migrationsRun: true,
        migrations: data_store_2.migrations,
        logging: false,
        entities: data_store_2.Entities,
    });
    await dbConnection.initialize();
    const agent = (0, core_1.createAgent)({
        plugins: [
            new key_manager_1.KeyManager({
                store: new data_store_1.KeyStore(dbConnection),
                kms: {
                    local: new kms_local_1.KeyManagementSystem(new data_store_1.PrivateKeyStore(dbConnection, new kms_local_1.SecretBox(encryptionKey))),
                },
            }),
            new did_manager_1.DIDManager({
                store: new data_store_1.DIDStore(dbConnection),
                defaultProvider: 'did:web',
                providers: {
                    'did:web': new did_provider_web_1.WebDIDProvider({
                        defaultKms: 'local',
                    }),
                },
            }),
            new did_resolver_1.DIDResolverPlugin({
                resolver: new did_resolver_2.Resolver({
                    ...(0, web_did_resolver_1.getResolver)(),
                }),
            }),
            new credential_w3c_1.CredentialPlugin(),
            new data_store_1.DataStore(dbConnection),
            new data_store_1.DataStoreORM(dbConnection),
        ],
    });
    return { agent, dbConnection };
}
/**
 * Create a NetworkFunctionCredential
 */
async function createNetworkFunctionCredential(config) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Creating NetworkFunctionCredential for ${config.nfName}`);
    console.log('='.repeat(80));
    try {
        // Initialize agent
        console.log(`\n1. Connecting to database: ${config.dbPath}`);
        const { agent, dbConnection } = await createAgentWithDatabase(config.dbPath, config.dbEncryptionKey);
        console.log('   ✅ Connected');
        // Check if issuer DID exists
        console.log(`\n2. Checking if issuer DID exists: ${config.issuerDid}`);
        const identifiers = await agent.didManagerFind();
        const issuerExists = identifiers.some(id => id.did === config.issuerDid);
        if (!issuerExists) {
            console.log('   ⚠️  Issuer DID not found in database');
            console.log('   💡 Using issuer DID anyway (it should be resolvable via did:web)');
        }
        else {
            console.log('   ✅ Issuer DID found');
        }
        // Create credential
        console.log(`\n3. Creating credential...`);
        const credential = {
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            type: ['VerifiableCredential', 'NetworkFunctionCredential'],
            issuer: { id: config.issuerDid },
            issuanceDate: new Date().toISOString(),
            credentialSubject: {
                id: config.subjectDid,
                role: 'network-function',
                clusterId: config.clusterId,
                status: 'active',
                capabilities: ['messaging', 'verification'],
                issuedAt: new Date().toISOString()
            }
        };
        console.log('   Credential structure:');
        console.log(`     Type: ${credential.type.join(', ')}`);
        console.log(`     Issuer: ${credential.issuer.id}`);
        console.log(`     Subject: ${credential.credentialSubject.id}`);
        console.log(`     Role: ${credential.credentialSubject.role}`);
        console.log(`     Cluster: ${credential.credentialSubject.clusterId}`);
        console.log(`     Status: ${credential.credentialSubject.status}`);
        // Sign and save credential
        console.log(`\n4. Signing credential with issuer's private key...`);
        const verifiableCredential = await agent.createVerifiableCredential({
            credential,
            proofFormat: 'jwt',
            save: true
        });
        console.log('   ✅ Credential created and saved to database');
        console.log(`\n5. Credential JWT (first 100 chars):`);
        console.log(`   ${verifiableCredential.proof.jwt.substring(0, 100)}...`);
        // Verify it was saved
        console.log(`\n6. Verifying credential was saved...`);
        const savedCredentials = await agent.dataStoreORMGetVerifiableCredentials({
            where: [{ column: 'subject', value: [config.subjectDid] }]
        });
        const nfCredentials = savedCredentials.filter((cred) => cred.verifiableCredential.type.includes('NetworkFunctionCredential'));
        console.log(`   ✅ Found ${nfCredentials.length} NetworkFunctionCredential(s) for ${config.subjectDid}`);
        // Close database
        await dbConnection.destroy();
        console.log(`\n✅ ${config.nfName} NetworkFunctionCredential created successfully!`);
        return verifiableCredential;
    }
    catch (error) {
        console.error(`\n❌ Error creating credential for ${config.nfName}:`, error.message);
        throw error;
    }
}
/**
 * Main function
 */
async function main() {
    const clusterArg = process.argv[2]; // 'cluster-a' or 'cluster-b'

    console.log('='.repeat(80));
    console.log('🎫 NetworkFunctionCredential Creator');
    console.log('='.repeat(80));
    console.log('\nThis script creates NetworkFunctionCredentials that match the');
    console.log('Presentation Definitions used in the VP flow test.');

    try {
        if (clusterArg === 'cluster-a') {
            // Only create credential for NF-A
            await createNetworkFunctionCredential(NF_A_CONFIG);
        } else if (clusterArg === 'cluster-b') {
            // Only create credential for NF-B
            await createNetworkFunctionCredential(NF_B_CONFIG);
        } else {
            // No argument - create both (for local development)
            await createNetworkFunctionCredential(NF_A_CONFIG);
            await createNetworkFunctionCredential(NF_B_CONFIG);
        }
        console.log('\n' + '='.repeat(80));
        console.log('🎉 Credentials created successfully!');
        console.log('='.repeat(80));
        console.log('\nYou can now run the VP flow test:');
        console.log('  npm run test:vp-flow');
        console.log('');
    }
    catch (error) {
        console.error('\n❌ Failed to create credentials:', error.message);
        process.exit(1);
    }
}
// Run the script
main()
    .then(() => process.exit(0))
    .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
