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
import { createJWT } from 'did-jwt';
import { ISSUER, NFS } from './config.mjs';

const createAgent_ = async (c) => {
  const db = new DataSource({ type: 'better-sqlite3', database: c.db, synchronize: false, migrationsRun: true, migrations, entities: Entities, logging: false });
  await db.initialize();
  return {
    db,
    agent: createAgent({ plugins: [
      new KeyManager({ store: new KeyStore(db), kms: { local: new KeyManagementSystem(new PrivateKeyStore(db, new SecretBox(c.key))) }}),
      new DIDManager({ store: new DIDStore(db), defaultProvider: 'did:web', providers: { 'did:web': new WebDIDProvider({ defaultKms: 'local' }) }}),
      new DIDResolverPlugin({ resolver: new Resolver({ ...getResolver() }) }),
      new CredentialPlugin(), new DataStore(db), new DataStoreORM(db)
    ]})
  };
};

console.log('Create NetworkFunctionCredentials');
const { agent: issuer, db: issuerDb } = await createAgent_(ISSUER);

for (const [name, nf] of Object.entries(NFS)) {
  console.log(`  ${name.toUpperCase()}`);
  const { agent, db } = await createAgent_(nf);

  if ((await agent.dataStoreORMGetVerifiableCredentials({ where: [{ column: 'type', value: ['VerifiableCredential,NetworkFunctionCredential'] }] })).length) {
    console.log('Verifiable Credential exists'); await db.destroy(); continue;
  }

  const kid = `${ISSUER.did}#key-1`;
  const jwt = await createJWT(
    { sub: nf.did, vc: { '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential', 'NetworkFunctionCredential'], credentialSubject: { role: 'network-function', clusterId: nf.cluster }}},
    { issuer: ISSUER.did, signer: async (d) => issuer.keyManagerSign({ keyRef: kid, data: typeof d === 'string' ? d : Buffer.from(d).toString('utf8'), algorithm: 'ES256K' }) },
    { alg: 'ES256K', typ: 'JWT', kid }
  );

  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  await agent.dataStoreSaveVerifiableCredential({ verifiableCredential: {
    credentialSubject: { id: nf.did, role: 'network-function', clusterId: nf.cluster },
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential', 'NetworkFunctionCredential'],
    issuer: { id: ISSUER.did },
    issuanceDate: new Date().toISOString(),
    proof: { type: 'JwtProof2020', jwt }
  }});

  console.log('Verifiable Credential created');
  await db.destroy();
}

await issuerDb.destroy();
