#!/usr/bin/env node
// Create NetworkFunctionCredentials locally (ESM version)
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

const C = {
  'nf-a': { db: './cluster-a/database-nf-a.sqlite', key: 'ed9733675a04a20b91c5beb2196a6c964dce7d520a77be577a8a605911232ba6', did: 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a', cluster: 'cluster-a' },
  'nf-b': { db: './cluster-b/database-nf-b.sqlite', key: '3859413b662c8fc7e632cda1fe9d5f07991c0b5d2bd2d8a69fa36e9e25cfef1d', did: 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b', cluster: 'cluster-b' }
};

async function createVC(name) {
  const c = C[name];
  console.log(`\n=== ${name.toUpperCase()} ===`);
  console.log(`DB: ${c.db}`);

  const db = new DataSource({ type: 'sqlite', database: c.db, synchronize: false, migrationsRun: true, migrations, entities: Entities, logging: false });
  await db.initialize();

  const agent = createAgent({
    plugins: [
      new KeyManager({ store: new KeyStore(db), kms: { local: new KeyManagementSystem(new PrivateKeyStore(db, new SecretBox(c.key))) }}),
      new DIDManager({ store: new DIDStore(db), defaultProvider: 'did:web', providers: { 'did:web': new WebDIDProvider({ defaultKms: 'local' }) }}),
      new DIDResolverPlugin({ resolver: new Resolver({ ...getResolver() }) }),
      new CredentialPlugin(), new DataStore(db), new DataStoreORM(db)
    ]
  });

  // Check if VC already exists
  const existing = await agent.dataStoreORMGetVerifiableCredentials({ where: [{ column: 'type', value: ['VerifiableCredential,NetworkFunctionCredential'] }] });
  if (existing.length > 0) {
    console.log(`⏭️  VC already exists (${existing.length})`);
    await db.destroy();
    return;
  }

  const vc = await agent.createVerifiableCredential({
    credential: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'NetworkFunctionCredential'],
      issuer: { id: c.did },
      credentialSubject: { id: c.did, role: 'network-function', clusterId: c.cluster, status: 'active', capabilities: ['messaging', 'verification'] }
    },
    proofFormat: 'jwt',
    save: true
  });

  console.log(`✅ VC created!`);
  await db.destroy();
}

console.log('🎫 Create NetworkFunctionCredentials\n');
await createVC('nf-a');
await createVC('nf-b');
console.log('\n🎉 Done! VCs are now in local DBs.\n');
