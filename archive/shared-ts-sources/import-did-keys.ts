#!/usr/bin/env ts-node
/**
 * Import DID private keys into Veramo database
 *
 * This script creates new key pairs for NF-A and NF-B and imports them
 * into the Veramo database so that they can sign VPs.
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

// Configuration
const DB_PATH_NF_A = '../cluster-a/database-nf-a.sqlite';
const DB_ENCRYPTION_KEY_A = 'ed9733675a04a20b91c5beb2196a6c964dce7d520a77be577a8a605911232ba6';

const DB_PATH_NF_B = '../cluster-b/database-nf-b.sqlite';
const DB_ENCRYPTION_KEY_B = '3859413b662c8fc7e632cda1fe9d5f07991c0b5d2bd2d8a69fa36e9e25cfef1d';

const DID_NF_A = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
const DID_NF_B = 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b';

/**
 * Create a Veramo agent with database connection
 */
async function createAgentWithDatabase(dbPath: string, encryptionKey: string) {
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
          local: new KeyManagementSystem(
            new PrivateKeyStore(dbConnection, new SecretBox(encryptionKey))
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

/**
 * Import or create a DID with private keys
 */
async function importDidWithKeys(did: string, dbPath: string, encryptionKey: string, name: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Importing/Creating keys for ${name}`);
  console.log('='.repeat(80));

  try {
    const { agent, dbConnection } = await createAgentWithDatabase(dbPath, encryptionKey);

    // Check if DID already exists
    console.log(`\n1. Checking if ${did} exists...`);
    const identifiers = await agent.didManagerFind();
    const existingDid = identifiers.find((id: any) => id.did === did);

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
        } catch (error: any) {
          console.log(`   ❌ Cannot sign with key: ${key.kid.substring(0, 50)}...`);
        }
      }

      if (canSign) {
        console.log(`\n✅ ${name} already has working private keys!`);
        await dbConnection.destroy();
        return;
      }

      console.log(`\n⚠️  ${name} exists but has no working private keys. Creating new key...`);
    } else {
      console.log(`   ⚠️  DID not found. This is unexpected.`);
      console.log(`   💡 The DID should already exist from did:web setup`);
    }

    // Create a new key for the DID
    console.log(`\n2. Creating new Secp256k1 key for ${name}...`);
    const key = await agent.keyManagerCreate({
      kms: 'local',
      type: 'Secp256k1'
    });
    console.log(`   ✅ Key created: ${key.kid}`);

    // If the DID doesn't exist, import it
    if (!existingDid) {
      console.log(`\n3. Importing DID ${did}...`);
      await agent.didManagerImport({
        did: did,
        provider: 'did:web',
        keys: [{
          kid: key.kid,
          type: key.type,
          kms: 'local',
          publicKeyHex: key.publicKeyHex,
          privateKeyHex: key.privateKeyHex
        }],
        services: []
      });
      console.log('   ✅ DID imported');
    } else {
      // Add the key to the existing DID
      console.log(`\n3. Adding key to existing DID...`);
      await agent.didManagerAddKey({
        did: did,
        key: {
          kid: key.kid,
          type: key.type,
          kms: 'local',
          publicKeyHex: key.publicKeyHex
        }
      });
      console.log('   ✅ Key added to DID');
    }

    // Test signing
    console.log(`\n4. Testing signing capability...`);
    try {
      const signature = await agent.keyManagerSign({
        keyRef: key.kid,
        data: 'test message'
      });
      console.log('   ✅ Successfully signed test message!');
      console.log(`   Signature: ${signature.substring(0, 50)}...`);
    } catch (error: any) {
      console.log('   ❌ Failed to sign:', error.message);
      throw error;
    }

    await dbConnection.destroy();
    console.log(`\n✅ ${name} is ready to sign VPs!`);

  } catch (error: any) {
    console.error(`\n❌ Error importing keys for ${name}:`, error.message);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('🔑 DID Private Key Importer');
  console.log('='.repeat(80));
  console.log('\nThis script ensures that NF-A and NF-B have private keys');
  console.log('in their Veramo databases so they can sign VPs.');

  try {
    // Import/create keys for NF-A
    await importDidWithKeys(DID_NF_A, DB_PATH_NF_A, DB_ENCRYPTION_KEY_A, 'NF-A');

    // Import/create keys for NF-B
    await importDidWithKeys(DID_NF_B, DB_PATH_NF_B, DB_ENCRYPTION_KEY_B, 'NF-B');

    console.log('\n' + '='.repeat(80));
    console.log('🎉 All DIDs are ready!');
    console.log('='.repeat(80));
    console.log('\nYou can now run the VP flow test:');
    console.log('  npm run test:vp-flow');
    console.log('');
    console.log('⚠️  Note: The public keys in GitHub Pages (did.json) will NOT match');
    console.log('   the new private keys. You would need to update the did.json files');
    console.log('   and push to GitHub if you want external verification to work.');
    console.log('');

  } catch (error: any) {
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
