#!/usr/bin/env node
// Create NetworkFunctionCredentials with separate Issuer (ESM version)
import { createAgent } from '@veramo/core';
import { CredentialPlugin } from '@veramo/credential-w3c';
import { KeyManager } from '@veramo/key-manager';
import { DIDManager } from '@veramo/did-manager';
import { KeyStore, DIDStore, DataStore, DataStoreORM, PrivateKeyStore, migrations, Entities } from '@veramo/data-store';
import { KeyManagementSystem, SecretBox } from '@veramo/kms-local';
import { WebDIDProvider } from '@veramo/did-provider-web';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import { Resolver } from 'did-resolver';
import { getResolver } from 'web-did-resolver';
import { DataSource } from 'typeorm';

// Configuration
const ISSUER = {
  db: './did-issuer/database-issuer.sqlite',
  key: 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd',
  did: 'did:web:kiuyenzo.github.io:Prototype:did-issuer'
};

const NFS = {
  'nf-a': { db: './cluster-a/database-nf-a.sqlite', key: 'ed9733675a04a20b91c5beb2196a6c964dce7d520a77be577a8a605911232ba6', did: 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a', cluster: 'cluster-a' },
  'nf-b': { db: './cluster-b/database-nf-b.sqlite', key: '3859413b662c8fc7e632cda1fe9d5f07991c0b5d2bd2d8a69fa36e9e25cfef1d', did: 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b', cluster: 'cluster-b' }
};

// Create Issuer agent
async function createIssuerAgent() {
  const db = new DataSource({ type: 'sqlite', database: ISSUER.db, synchronize: false, migrationsRun: true, migrations, entities: Entities, logging: false });
  await db.initialize();

  const agent = createAgent({
    plugins: [
      new KeyManager({ store: new KeyStore(db), kms: { local: new KeyManagementSystem(new PrivateKeyStore(db, new SecretBox(ISSUER.key))) }}),
      new DIDManager({ store: new DIDStore(db), defaultProvider: 'did:web', providers: { 'did:web': new WebDIDProvider({ defaultKms: 'local' }) }}),
      new DIDResolverPlugin({ resolver: new Resolver({ ...getResolver() }) }),
      new CredentialPlugin(), new DataStore(db), new DataStoreORM(db)
    ]
  });

  return { agent, db };
}

// Create NF agent (for storing credential)
async function createNFAgent(nf) {
  const db = new DataSource({ type: 'sqlite', database: nf.db, synchronize: false, migrationsRun: true, migrations, entities: Entities, logging: false });
  await db.initialize();

  const agent = createAgent({
    plugins: [
      new KeyManager({ store: new KeyStore(db), kms: { local: new KeyManagementSystem(new PrivateKeyStore(db, new SecretBox(nf.key))) }}),
      new DIDManager({ store: new DIDStore(db), defaultProvider: 'did:web', providers: { 'did:web': new WebDIDProvider({ defaultKms: 'local' }) }}),
      new DIDResolverPlugin({ resolver: new Resolver({ ...getResolver() }) }),
      new CredentialPlugin(), new DataStore(db), new DataStoreORM(db)
    ]
  });

  return { agent, db };
}

async function createCredentialForNF(issuerAgent, nfName) {
  const nf = NFS[nfName];
  console.log(`\n=== ${nfName.toUpperCase()} ===`);
  console.log(`Subject: ${nf.did}`);
  console.log(`Issuer: ${ISSUER.did}`);

  // Create NF agent to check existing and store credential
  const { agent: nfAgent, db: nfDb } = await createNFAgent(nf);

  // Check if VC already exists in NF database
  const existing = await nfAgent.dataStoreORMGetVerifiableCredentials({ where: [{ column: 'type', value: ['VerifiableCredential,NetworkFunctionCredential'] }] });
  if (existing.length > 0) {
    console.log(`⏭️  VC already exists (${existing.length})`);
    await nfDb.destroy();
    return;
  }

  // Create credential using Issuer agent
  const vc = await issuerAgent.createVerifiableCredential({
    credential: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'NetworkFunctionCredential'],
      issuer: { id: ISSUER.did },
      credentialSubject: {
        id: nf.did,
        role: 'network-function',
        clusterId: nf.cluster,
        status: 'active',
        capabilities: ['messaging', 'verification']
      }
    },
    proofFormat: 'jwt',
    save: false // Don't save in issuer DB
  });

  // Save credential in NF database
  await nfAgent.dataStoreSaveVerifiableCredential({ verifiableCredential: vc });

  console.log(`✅ VC created and stored in ${nf.db}`);
  console.log(`   Issuer: ${ISSUER.did}`);
  await nfDb.destroy();
}

console.log('🎫 Create NetworkFunctionCredentials (with separate Issuer)\n');
console.log(`Issuer DID: ${ISSUER.did}`);
console.log(`Issuer DB: ${ISSUER.db}`);

// Create Issuer agent
const { agent: issuerAgent, db: issuerDb } = await createIssuerAgent();

// Create credentials for each NF
await createCredentialForNF(issuerAgent, 'nf-a');
await createCredentialForNF(issuerAgent, 'nf-b');

await issuerDb.destroy();
console.log('\n🎉 Done! VCs are now in NF DBs (signed by Issuer).\n');
