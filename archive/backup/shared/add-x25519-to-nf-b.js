#!/usr/bin/env node
/**
 * Add X25519 encryption key to NF-B's existing DID
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

const DID = process.env.DID_NF_B || 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b';
const DB_PATH = process.env.DB_PATH || '/app/database-nf-b.sqlite';
const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || '3859413b662c8fc7e632cda1fe9d5f07991c0b5d2bd2d8a69fa36e9e25cfef1d';

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
  console.log('🔑 Adding X25519 Encryption Key to NF-B');
  console.log('='.repeat(80));
  console.log(`\nDID: ${DID}`);
  console.log(`DB:  ${DB_PATH}\n`);

  try {
    const { agent, dbConnection } = await createAgentWithDatabase();

    // Get the existing DID
    console.log('1. Getting existing DID...');
    const identifier = await agent.didManagerGet({ did: DID });
    console.log(`   ✅ Found DID with ${identifier.keys.length} keys`);

    // Check if X25519 key already exists
    const x25519Keys = identifier.keys.filter(k => k.type === 'X25519');
    if (x25519Keys.length > 0) {
      console.log(`   ✅ X25519 key already exists: ${x25519Keys[0].kid.substring(0, 50)}...`);
      await dbConnection.destroy();
      return;
    }

    // Create new X25519 key
    console.log('\n2. Creating X25519 key...');
    const x25519Key = await agent.keyManagerCreate({
      kms: 'local',
      type: 'X25519'
    });
    console.log(`   ✅ Created: ${x25519Key.kid}`);

    // Add key to DID
    console.log('\n3. Adding key to DID...');
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

    // Verify
    console.log('\n4. Verifying...');
    const updatedIdentifier = await agent.didManagerGet({ did: DID });
    const updatedX25519Keys = updatedIdentifier.keys.filter(k => k.type === 'X25519');
    console.log(`   ✅ DID now has ${updatedX25519Keys.length} X25519 key(s)`);

    await dbConnection.destroy();

    console.log('\n' + '='.repeat(80));
    console.log('🎉 X25519 key added successfully!');
    console.log('='.repeat(80));
    console.log(`\nPublic Key: ${x25519Key.publicKeyHex}`);
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
