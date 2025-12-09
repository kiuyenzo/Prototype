#!/usr/bin/env ts-node
/**
 * Export updated DID documents with new public keys
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

const DB_PATH_NF_A = '../cluster-a/database-nf-a.sqlite';
const DB_ENCRYPTION_KEY_A = 'ed9733675a04a20b91c5beb2196a6c964dce7d520a77be577a8a605911232ba6';

const DB_PATH_NF_B = '../cluster-b/database-nf-b.sqlite';
const DB_ENCRYPTION_KEY_B = '3859413b662c8fc7e632cda1fe9d5f07991c0b5d2bd2d8a69fa36e9e25cfef1d';

const DID_NF_A = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
const DID_NF_B = 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b';

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

async function exportDid(did: string, dbPath: string, encryptionKey: string, outputPath: string) {
  console.log(`\nExporting ${did}...`);

  const { agent, dbConnection } = await createAgentWithDatabase(dbPath, encryptionKey);

  const identifier = await agent.didManagerGet({ did });

  // Build DID document
  const didDocument: any = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/v2',
      'https://w3id.org/security/suites/secp256k1recovery-2020/v2'
    ],
    id: did,
    verificationMethod: [],
    authentication: [],
    assertionMethod: [],
    keyAgreement: [],
    service: identifier.services || []
  };

  // Add keys
  for (const key of identifier.keys) {
    const vm = {
      id: key.kid,
      type: key.type === 'Secp256k1' ? 'EcdsaSecp256k1VerificationKey2019' : 'X25519KeyAgreementKey2019',
      controller: did,
      publicKeyHex: key.publicKeyHex
    };

    didDocument.verificationMethod.push(vm);
    didDocument.authentication.push(key.kid);
    didDocument.assertionMethod.push(key.kid);
  }

  // Write to file
  fs.writeFileSync(outputPath, JSON.stringify(didDocument, null, 2));
  console.log(`✅ Exported to: ${outputPath}`);
  console.log(`   Keys: ${identifier.keys.length}`);
  console.log(`   Services: ${identifier.services.length}`);

  await dbConnection.destroy();
}

async function main() {
  console.log('='.repeat(80));
  console.log('📄 DID Document Exporter');
  console.log('='.repeat(80));

  await exportDid(DID_NF_A, DB_PATH_NF_A, DB_ENCRYPTION_KEY_A, '../cluster-a/did-nf-a/did-new.json');
  await exportDid(DID_NF_B, DB_PATH_NF_B, DB_ENCRYPTION_KEY_B, '../cluster-b/did-nf-b/did-new.json');

  console.log('\n' + '='.repeat(80));
  console.log('✅ DID documents exported!');
  console.log('='.repeat(80));
  console.log('\nNext steps:');
  console.log('1. Review the did-new.json files');
  console.log('2. Replace did.json with did-new.json if correct');
  console.log('3. Push to GitHub Pages');
  console.log('');
}

main();
