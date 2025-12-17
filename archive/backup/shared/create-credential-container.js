#!/usr/bin/env ts-node
"use strict";
/**
 * Create NetworkFunctionCredential (Container Version)
 *
 * This script creates a credential for the current NF.
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
// Configuration from environment
const DID = process.env.DID_NF_A || process.env.DID_NF_B || '';
const DB_PATH = process.env.DB_PATH || './database.sqlite';
const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || '';
if (!DID) {
    console.error('❌ Error: DID environment variable not set (DID_NF_A or DID_NF_B)');
    process.exit(1);
}
if (!DB_ENCRYPTION_KEY) {
    console.error('❌ Error: DB_ENCRYPTION_KEY environment variable not set');
    process.exit(1);
}
// Determine which NF this is
const isNFA = DID.includes('nf-a');
/**
 * Create a Veramo agent with database connection
 */
async function createAgentWithDatabase() {
    const dbConnection = new typeorm_1.DataSource({
        type: 'sqlite',
        database: DB_PATH,
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
                    local: new kms_local_1.KeyManagementSystem(new data_store_1.PrivateKeyStore(dbConnection, new kms_local_1.SecretBox(DB_ENCRYPTION_KEY))),
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
 * Create NetworkFunctionCredential
 */
async function createCredential() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🎫 Creating NetworkFunctionCredential`);
    console.log('='.repeat(80));
    try {
        const { agent, dbConnection } = await createAgentWithDatabase();
        console.log(`\n1. Checking existing credentials...`);
        const existingCreds = await agent.dataStoreORMGetVerifiableCredentials({
            where: [
                { column: 'subject', value: [DID] }
            ]
        });
        console.log(`   Found ${existingCreds.length} existing credential(s)`);
        if (existingCreds.length > 0) {
            console.log('   ⚠️  Deleting existing credentials...');
            for (const cred of existingCreds) {
                await agent.dataStoreDeleteVerifiableCredential({ hash: cred.hash });
            }
            console.log('   ✅ Old credentials deleted');
        }
        console.log(`\n2. Creating NetworkFunctionCredential...`);
        const credential = await agent.createVerifiableCredential({
            credential: {
                '@context': ['https://www.w3.org/2018/credentials/v1'],
                type: ['VerifiableCredential', 'NetworkFunctionCredential'],
                issuer: DID,
                issuanceDate: new Date().toISOString(),
                credentialSubject: {
                    id: DID,
                    role: 'network-function',
                    clusterId: isNFA ? 'cluster-a' : 'cluster-b',
                    status: 'active',
                    capabilities: isNFA ? ['authentication', 'authorization'] : ['session-management', 'handover']
                }
            },
            proofFormat: 'jwt',
            save: true
        });
        console.log('   ✅ Credential created successfully');
        // Verify it was saved
        const savedCreds = await agent.dataStoreORMGetVerifiableCredentials({
            where: [
                { column: 'subject', value: [DID] }
            ]
        });
        console.log(`\n3. Verification: ${savedCreds.length} credential(s) in database`);
        await dbConnection.destroy();
        console.log(`\n✅ Credential ready!`);
    }
    catch (error) {
        console.error(`\n❌ Error creating credential:`, error.message);
        console.error(error.stack);
        throw error;
    }
}
/**
 * Main function
 */
async function main() {
    console.log('='.repeat(80));
    console.log('🎫 NetworkFunctionCredential Creator');
    console.log('='.repeat(80));
    console.log(`\nDID: ${DID}`);
    console.log(`DB:  ${DB_PATH}`);
    try {
        await createCredential();
        console.log('\n' + '='.repeat(80));
        console.log('🎉 Done!');
        console.log('='.repeat(80));
    }
    catch (error) {
        console.error('\n❌ Failed to create credential:', error.message);
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
