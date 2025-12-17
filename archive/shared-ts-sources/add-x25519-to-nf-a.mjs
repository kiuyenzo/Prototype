#!/usr/bin/env node
/**
 * Add X25519 encryption key to NF-A's existing DID
 * This will generate BOTH public and private keys
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

const DID = process.env.DID_NF_A || 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
const DB_PATH = process.env.DB_PATH || '/Users/tanja/Desktop/Prototype/cluster-a/database-nf-a.sqlite';
const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || '29739248cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa830c';

async function createAgentWithDatabase() {
  const dbConnection = new DataSource({
    type: 'sqlite',
    database: DB_PATH,
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
          local: new KeyManagementSystem(
            new PrivateKeyStore(dbConnection, new SecretBox(DB_ENCRYPTION_KEY))
          ),
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

async function main() {
  console.log('='.repeat(80));
  console.log('🔑 Adding X25519 Encryption Key to NF-A');
  console.log('='.repeat(80));
  console.log(`\nDID: ${DID}`);
  console.log(`DB:  ${DB_PATH}\n`);

  try {
    const { agent, dbConnection } = await createAgentWithDatabase();

    // Get the existing DID
    console.log('1. Getting existing DID...');
    const identifier = await agent.didManagerGet({ did: DID });
    console.log(`   ✅ Found DID with ${identifier.keys.length} keys`);

    // Check current X25519 keys
    const x25519Keys = identifier.keys.filter(k => k.type === 'X25519');
    console.log(`   Current X25519 keys: ${x25519Keys.length}`);

    if (x25519Keys.length > 0) {
      console.log(`\n⚠️  X25519 key already exists in key table:`);
      x25519Keys.forEach(k => {
        console.log(`   - ${k.kid}`);
      });
      console.log(`\n   Checking if private key exists...`);

      // Check private key directly in database
      const privateKeys = await dbConnection.query(
        `SELECT alias, type FROM "private-key" WHERE type = 'X25519'`
      );

      if (privateKeys.length > 0) {
        console.log(`   ✅ Private key exists: ${privateKeys[0].alias}`);
        console.log('\n   Nothing to do - key pair already complete!');
        await dbConnection.destroy();
        return;
      } else {
        console.log(`   ❌ Private key MISSING! Need to regenerate key pair.`);
        console.log(`\n2. Removing incomplete X25519 key...`);

        // Remove the incomplete key from DID
        for (const key of x25519Keys) {
          await agent.didManagerRemoveKey({
            did: DID,
            kid: key.kid
          });
          console.log(`   ✅ Removed: ${key.kid}`);
        }
      }
    }

    // Create new X25519 key (this creates BOTH public and private keys)
    console.log('\n3. Creating NEW X25519 key pair...');
    const x25519Key = await agent.keyManagerCreate({
      kms: 'local',
      type: 'X25519'
    });
    console.log(`   ✅ Created key pair:`);
    console.log(`      Public:  ${x25519Key.publicKeyHex}`);
    console.log(`      Key ID:  ${x25519Key.kid}`);

    // Add key to DID
    console.log('\n4. Adding key to DID...');
    await agent.didManagerAddKey({
      did: DID,
      key: {
        kid: x25519Key.kid,
        type: x25519Key.type,
        kms: 'local',
        publicKeyHex: x25519Key.publicKeyHex
      }
    });
    console.log('   ✅ Key added to DID');

    // Verify both public and private keys exist
    console.log('\n5. Verifying...');
    const updatedIdentifier = await agent.didManagerGet({ did: DID });
    const updatedX25519Keys = updatedIdentifier.keys.filter(k => k.type === 'X25519');
    console.log(`   ✅ DID now has ${updatedX25519Keys.length} X25519 key(s)`);

    const privateKeys = await dbConnection.query(
      `SELECT alias, type FROM "private-key" WHERE type = 'X25519'`
    );
    console.log(`   ✅ Private key table has ${privateKeys.length} X25519 key(s)`);

    await dbConnection.destroy();

    console.log('\n' + '='.repeat(80));
    console.log('🎉 X25519 key pair added successfully!');
    console.log('='.repeat(80));
    console.log(`\nPublic Key: ${x25519Key.publicKeyHex}`);
    console.log(`Key ID:     ${x25519Key.kid}`);
    console.log('\nNext: Update did.json with this key in keyAgreement section\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
