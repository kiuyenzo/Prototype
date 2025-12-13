#!/usr/bin/env ts-node
/**
 * Add X25519 encryption keys to existing DIDs
 *
 * This ensures both NF-A and NF-B have keyAgreement keys for DIDComm encryption
 */
import { createAgent } from '@veramo/core';
import { KeyManager } from '@veramo/key-manager';
import { DIDManager } from '@veramo/did-manager';
import { KeyStore, DIDStore, PrivateKeyStore, DataStore, DataStoreORM } from '@veramo/data-store';
import { KeyManagementSystem, SecretBox } from '@veramo/kms-local';
import { WebDIDProvider } from '@veramo/did-provider-web';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import { Resolver } from 'did-resolver';
import { getResolver as webDidResolver } from 'web-did-resolver';
import { DataSource } from 'typeorm';
import { Entities, migrations } from '@veramo/data-store';
import * as fs from 'fs';
import * as path from 'path';
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
            new DataStore(dbConnection),
            new DataStoreORM(dbConnection),
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
