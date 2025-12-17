#!/usr/bin/env ts-node
"use strict";
/**
 * Add X25519 encryption keys to existing DIDs
 *
 * This ensures both NF-A and NF-B have keyAgreement keys for DIDComm encryption
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Configuration
const DID_NF_A = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
const DID_NF_B = 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b';
const DB_PATH_NF_A = path.resolve(__dirname, '../cluster-a/database-nf-a.sqlite');
const DB_ENCRYPTION_KEY_A = 'ed9733675a04a20b91c5beb2196a6c964dce7d520a77be577a8a605911232ba6';
const DB_PATH_NF_B = path.resolve(__dirname, '../cluster-b/database-nf-b.sqlite');
const DB_ENCRYPTION_KEY_B = '3859413b662c8fc7e632cda1fe9d5f07991c0b5d2bd2d8a69fa36e9e25cfef1d';
const DID_DOC_PATH_NF_A = path.resolve(__dirname, '../cluster-a/did-nf-a/did.json');
const DID_DOC_PATH_NF_B = path.resolve(__dirname, '../cluster-b/did-nf-b/did.json');
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
            new data_store_1.DataStore(dbConnection),
            new data_store_1.DataStoreORM(dbConnection),
        ],
    });
    return { agent, dbConnection };
}
async function addX25519Key(did, dbPath, encryptionKey, didDocPath, name) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Adding X25519 encryption key for ${name}`);
    console.log('='.repeat(80));
    const { agent, dbConnection } = await createAgentWithDatabase(dbPath, encryptionKey);
    try {
        // Get the identifier
        const identifier = await agent.didManagerGet({ did });
        console.log(`✅ Found DID: ${did}`);
        // Check if X25519 key already exists
        const x25519Keys = identifier.keys.filter((k) => k.type === 'X25519');
        let x25519Key;
        if (x25519Keys.length > 0) {
            console.log(`✅ X25519 key already exists: ${x25519Keys[0].kid}`);
            x25519Key = x25519Keys[0];
        }
        else {
            // Create X25519 key
            console.log('Creating new X25519 key...');
            x25519Key = await agent.keyManagerCreate({
                kms: 'local',
                type: 'X25519'
            });
            console.log(`✅ Created X25519 key: ${x25519Key.kid}`);
            // Add key to DID
            await agent.didManagerAddKey({
                did,
                key: {
                    kid: x25519Key.kid,
                    type: x25519Key.type,
                    kms: 'local',
                    publicKeyHex: x25519Key.publicKeyHex
                }
            });
            console.log('✅ Added key to DID');
        }
        // Update DID document
        console.log('\nUpdating DID document...');
        const didDoc = JSON.parse(fs.readFileSync(didDocPath, 'utf-8'));
        // Add to verificationMethod if not already there
        const keyId = `${did}#${x25519Key.publicKeyHex}`;
        const existingVm = didDoc.verificationMethod.find((vm) => vm.id === keyId);
        if (!existingVm) {
            didDoc.verificationMethod.push({
                id: keyId,
                type: 'X25519KeyAgreementKey2019',
                controller: did,
                publicKeyHex: x25519Key.publicKeyHex
            });
            console.log('✅ Added to verificationMethod');
        }
        else {
            console.log('✅ Already in verificationMethod');
        }
        // Add to keyAgreement if not already there
        if (!didDoc.keyAgreement.includes(keyId)) {
            didDoc.keyAgreement.push(keyId);
            console.log('✅ Added to keyAgreement');
        }
        else {
            console.log('✅ Already in keyAgreement');
        }
        // Save updated DID document
        fs.writeFileSync(didDocPath, JSON.stringify(didDoc, null, 2));
        console.log(`✅ DID document updated: ${didDocPath}`);
        await dbConnection.destroy();
        console.log(`\n✅ ${name} is ready for authcrypt!`);
        return x25519Key.publicKeyHex;
    }
    catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
        await dbConnection.destroy();
        throw error;
    }
}
async function main() {
    console.log('='.repeat(80));
    console.log('🔑 Adding X25519 Encryption Keys for Authcrypt');
    console.log('='.repeat(80));
    try {
        // Add keys for both NFs
        await addX25519Key(DID_NF_A, DB_PATH_NF_A, DB_ENCRYPTION_KEY_A, DID_DOC_PATH_NF_A, 'NF-A');
        await addX25519Key(DID_NF_B, DB_PATH_NF_B, DB_ENCRYPTION_KEY_B, DID_DOC_PATH_NF_B, 'NF-B');
        console.log('\n' + '='.repeat(80));
        console.log('🎉 Both DIDs now have X25519 encryption keys!');
        console.log('='.repeat(80));
        console.log('\nNext steps:');
        console.log('1. Restart containers: docker-compose restart veramo-nf-a veramo-nf-b');
        console.log('2. Switch didcomm-encryption.ts back to authcrypt');
        console.log('3. Test E2E encrypted VP-Flow');
        console.log('');
    }
    catch (error) {
        console.error('\n❌ Failed:', error.message);
        process.exit(1);
    }
}
main()
    .then(() => process.exit(0))
    .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
