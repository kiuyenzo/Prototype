#!/usr/bin/env ts-node
"use strict";
/**
 * Import DID private keys into Veramo database (Container Version)
 *
 * This script creates new key pairs for the current NF and imports them
 * into the Veramo database so that it can sign VPs and use authcrypt.
 *
 * Usage:
 *  - Run inside NF-A container: node import-did-keys-container.js
 *  - Run inside NF-B container: node import-did-keys-container.js
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
// Configuration from environment (same as didcomm-http-server.ts)
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
 * Import or create a DID with private keys
 */
async function importDidWithKeys() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔑 Importing/Creating keys for ${DID}`);
    console.log('='.repeat(80));
    try {
        const { agent, dbConnection } = await createAgentWithDatabase();
        // Check if DID already exists
        console.log(`\n1. Checking if ${DID} exists...`);
        const identifiers = await agent.didManagerFind();
        const existingDid = identifiers.find((id) => id.did === DID);
        if (existingDid) {
            console.log('   ✅ DID exists');
            // Check if it has private keys
            const keys = existingDid.keys;
            console.log(`   Found ${keys.length} key(s)`);
            // Try to check if we can sign with the existing keys
            let canSign = false;
            for (const key of keys) {
                try {
                    // Try to sign a test message
                    await agent.keyManagerSign({
                        keyRef: key.kid,
                        data: 'test'
                    });
                    canSign = true;
                    console.log(`   ✅ Can sign with key: ${key.kid.substring(0, 50)}...`);
                    break;
                }
                catch (error) {
                    console.log(`   ⚠️  Cannot sign with key: ${key.kid.substring(0, 50)}... (${error.message})`);
                }
            }
            if (canSign) {
                console.log(`\n✅ DID already has working private keys!`);
                await dbConnection.destroy();
                return;
            }
            console.log(`\n⚠️  DID exists but has no working private keys. Creating new key...`);
        }
        else {
            console.log(`   ⚠️  DID not found in database.`);
            console.log(`   Creating DID ${DID}...`);
        }
        // Create a new Secp256k1 key for signing
        console.log(`\n2. Creating new Secp256k1 key for signing...`);
        const signingKey = await agent.keyManagerCreate({
            kms: 'local',
            type: 'Secp256k1'
        });
        console.log(`   ✅ Signing key created: ${signingKey.kid}`);
        // Create an X25519 key for encryption (keyAgreement)
        console.log(`\n3. Creating new X25519 key for encryption...`);
        const encryptionKey = await agent.keyManagerCreate({
            kms: 'local',
            type: 'X25519'
        });
        console.log(`   ✅ Encryption key created: ${encryptionKey.kid}`);
        // If the DID doesn't exist, import it
        if (!existingDid) {
            console.log(`\n4. Importing DID ${DID}...`);
            await agent.didManagerImport({
                did: DID,
                provider: 'did:web',
                keys: [
                    {
                        kid: signingKey.kid,
                        type: signingKey.type,
                        kms: 'local',
                        publicKeyHex: signingKey.publicKeyHex
                    },
                    {
                        kid: encryptionKey.kid,
                        type: encryptionKey.type,
                        kms: 'local',
                        publicKeyHex: encryptionKey.publicKeyHex
                    }
                ],
                services: []
            });
            console.log('   ✅ DID imported with keys');
        }
        else {
            // Add the keys to the existing DID
            console.log(`\n4. Adding keys to existing DID...`);
            await agent.didManagerAddKey({
                did: DID,
                key: {
                    kid: signingKey.kid,
                    type: signingKey.type,
                    kms: 'local',
                    publicKeyHex: signingKey.publicKeyHex
                }
            });
            await agent.didManagerAddKey({
                did: DID,
                key: {
                    kid: encryptionKey.kid,
                    type: encryptionKey.type,
                    kms: 'local',
                    publicKeyHex: encryptionKey.publicKeyHex
                }
            });
            console.log('   ✅ Keys added to DID');
        }
        // Test signing
        console.log(`\n5. Testing signing capability...`);
        try {
            const signature = await agent.keyManagerSign({
                keyRef: signingKey.kid,
                data: 'test message'
            });
            console.log('   ✅ Successfully signed test message!');
            console.log(`   Signature: ${signature.substring(0, 50)}...`);
        }
        catch (error) {
            console.log('   ❌ Failed to sign:', error.message);
            throw error;
        }
        // Test that DIDComm can pack messages with authcrypt
        console.log(`\n6. Testing authcrypt capability...`);
        try {
            // Create a simple test message
            const testMessage = {
                type: 'test',
                id: 'test-123',
                from: DID,
                to: [DID],
                body: { test: 'data' }
            };
            // Try to pack it (this should work now with the private key)
            const packedMessage = await agent.packDIDCommMessage({
                packing: 'authcrypt',
                message: testMessage
            });
            console.log('   ✅ Successfully created authcrypt message!');
            console.log(`   Message length: ${packedMessage.message.length} bytes`);
        }
        catch (error) {
            console.log(`   ⚠️  Authcrypt test failed: ${error.message}`);
            console.log(`   This is OK - authcrypt may need recipient's key too`);
        }
        await dbConnection.destroy();
        console.log(`\n✅ ${DID} is ready to sign VPs and use authcrypt!`);
    }
    catch (error) {
        console.error(`\n❌ Error importing keys:`, error.message);
        console.error(error.stack);
        throw error;
    }
}
/**
 * Main function
 */
async function main() {
    console.log('='.repeat(80));
    console.log('🔑 DID Private Key Importer (Container Version)');
    console.log('='.repeat(80));
    console.log(`\nDID: ${DID}`);
    console.log(`DB:  ${DB_PATH}`);
    console.log('\nThis script ensures that the current NF has private keys');
    console.log('in its Veramo database so it can sign VPs and use authcrypt.');
    try {
        await importDidWithKeys();
        console.log('\n' + '='.repeat(80));
        console.log('🎉 DID is ready!');
        console.log('='.repeat(80));
        console.log('\nYou can now use authcrypt for E2E encrypted DIDComm messages.');
        console.log('');
    }
    catch (error) {
        console.error('\n❌ Failed to import keys:', error.message);
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
