#!/usr/bin/env ts-node
"use strict";
/**
 * Create DID with keys (Simple Container Version)
 *
 * This script creates a new DID:web identifier with keys for encryption and signing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@veramo/core");
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
            new data_store_1.DataStore(dbConnection),
            new data_store_1.DataStoreORM(dbConnection),
        ],
    });
    return { agent, dbConnection };
}
/**
 * Create DID with keys
 */
async function createDIDWithKeys() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔑 Creating DID with keys: ${DID}`);
    console.log('='.repeat(80));
    try {
        const { agent, dbConnection } = await createAgentWithDatabase();
        // Check if DID already exists
        console.log(`\n1. Checking if ${DID} exists...`);
        const identifiers = await agent.didManagerFind();
        const existingDid = identifiers.find((id) => id.did === DID);
        if (existingDid && existingDid.keys && existingDid.keys.length > 0) {
            console.log('   ✅ DID already exists with keys');
            console.log(`   Found ${existingDid.keys.length} key(s)`);
            // Test signing with existing keys
            for (const key of existingDid.keys) {
                try {
                    await agent.keyManagerSign({
                        keyRef: key.kid,
                        data: 'test'
                    });
                    console.log(`   ✅ Can sign with key: ${key.kid.substring(0, 50)}...`);
                }
                catch (error) {
                    console.log(`   ⚠️  Cannot sign with key: ${key.kid.substring(0, 50)}...`);
                }
            }
            await dbConnection.destroy();
            return;
        }
        // Delete existing DID if it exists but has no keys
        if (existingDid) {
            console.log('   ⚠️  DID exists but has no keys, deleting...');
            await agent.didManagerDelete({ did: DID });
        }
        // Create new DID using didManagerCreate which handles key generation
        console.log(`\n2. Creating new DID...`);
        const identifier = await agent.didManagerCreate({
            provider: 'did:web',
            options: {
                keyType: 'Secp256k1'
            }
        });
        console.log(`   ✅ DID created: ${identifier.did}`);
        console.log(`   Keys: ${identifier.keys.length}`);
        // Create encryption key
        console.log(`\n3. Creating X25519 key for encryption...`);
        const encryptionKey = await agent.keyManagerCreate({
            kms: 'local',
            type: 'X25519'
        });
        console.log(`   ✅ Encryption key created: ${encryptionKey.kid.substring(0, 50)}...`);
        // Add encryption key to DID
        console.log(`\n4. Adding encryption key to DID...`);
        await agent.didManagerAddKey({
            did: identifier.did,
            key: {
                kid: encryptionKey.kid,
                type: encryptionKey.type,
                kms: 'local',
                publicKeyHex: encryptionKey.publicKeyHex
            }
        });
        console.log('   ✅ Encryption key added');
        // Verify the keys
        console.log(`\n5. Verifying DID keys...`);
        const verifiedDid = await agent.didManagerGet({ did: identifier.did });
        console.log(`   ✅ DID has ${verifiedDid.keys.length} keys`);
        for (const key of verifiedDid.keys) {
            console.log(`   - ${key.type}: ${key.kid.substring(0, 50)}...`);
        }
        // Test signing
        console.log(`\n6. Testing signing capability...`);
        const testKey = verifiedDid.keys.find((k) => k.type === 'Secp256k1');
        if (testKey) {
            const signature = await agent.keyManagerSign({
                keyRef: testKey.kid,
                data: 'test message'
            });
            console.log('   ✅ Successfully signed test message!');
            console.log(`   Signature: ${signature.substring(0, 50)}...`);
        }
        await dbConnection.destroy();
        console.log(`\n✅ ${DID} is ready!`);
    }
    catch (error) {
        console.error(`\n❌ Error creating DID:`, error.message);
        console.error(error.stack);
        throw error;
    }
}
/**
 * Main function
 */
async function main() {
    console.log('='.repeat(80));
    console.log('🔑 DID Creator (Simple Version)');
    console.log('='.repeat(80));
    console.log(`\nDID: ${DID}`);
    console.log(`DB:  ${DB_PATH}`);
    console.log('\nThis script creates a DID with keys for signing and encryption.');
    try {
        await createDIDWithKeys();
        console.log('\n' + '='.repeat(80));
        console.log('🎉 DID is ready!');
        console.log('='.repeat(80));
    }
    catch (error) {
        console.error('\n❌ Failed to create DID:', error.message);
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
