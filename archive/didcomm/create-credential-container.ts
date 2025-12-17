#!/usr/bin/env ts-node
/**
 * Create NetworkFunctionCredential (Container Version)
 *
 * This script creates a credential for the current NF.
 */

import { createAgent } from '@veramo/core';
import { CredentialPlugin } from '@veramo/credential-w3c';
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
      new CredentialPlugin(),
      new DataStore(dbConnection),
      new DataStoreORM(dbConnection),
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

  } catch (error: any) {
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

  } catch (error: any) {
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
