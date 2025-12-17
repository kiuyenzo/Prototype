#!/usr/bin/env node
// Usage: node generate-keys.mjs <nf-a|nf-b|issuer>
import { createAgent } from '@veramo/core';
import { KeyManager } from '@veramo/key-manager';
import { KeyStore, PrivateKeyStore } from '@veramo/data-store';
import { KeyManagementSystem, SecretBox } from '@veramo/kms-local';
import { DataSource } from 'typeorm';
import { migrations, Entities } from '@veramo/data-store';
import { resolve, dirname } from 'path';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const C = {
  'nf-a':   { db: '../cluster-a/database-nf-a.sqlite', key: 'ed9733675a04a20b91c5beb2196a6c964dce7d520a77be577a8a605911232ba6', did: 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a', enc: true },
  'nf-b':   { db: '../cluster-b/database-nf-b.sqlite', key: '3859413b662c8fc7e632cda1fe9d5f07991c0b5d2bd2d8a69fa36e9e25cfef1d', did: 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b', enc: true },
  'issuer': { db: '../did-issuer/database-issuer.sqlite', key: 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd', did: 'did:web:kiuyenzo.github.io:Prototype:did-issuer', enc: false }
};

const name = process.argv[2];
if (!name || !C[name]) { console.log('Usage: node generate-keys.mjs <nf-a|nf-b|issuer>'); process.exit(0); }

const c = C[name], dbPath = resolve(__dirname, c.db);
mkdirSync(dirname(dbPath), { recursive: true });
if (existsSync(dbPath)) { unlinkSync(dbPath); console.log('Alte DB gelöscht'); }

const db = new DataSource({ type: 'sqlite', database: dbPath, synchronize: false, migrationsRun: true, migrations, entities: Entities, logging: false });
await db.initialize();

const agent = createAgent({ plugins: [
  new KeyManager({ store: new KeyStore(db), kms: { local: new KeyManagementSystem(new PrivateKeyStore(db, new SecretBox(c.key))) } })
]});

console.log(`\n=== ${name.toUpperCase()} ===\nDID: ${c.did}\n`);

// Keys erstellen
const sk = await agent.keyManagerCreate({ kms: 'local', type: 'Secp256k1' });
const ek = c.enc ? await agent.keyManagerCreate({ kms: 'local', type: 'X25519' }) : null;

// Key IDs umbenennen auf #key-1 / #key-2
const sk_id = `${c.did}#key-1`, ek_id = `${c.did}#key-2`;
await db.query(`UPDATE key SET kid=?, identifierDid=? WHERE kid=?`, [sk_id, c.did, sk.kid]);
await db.query(`UPDATE "private-key" SET alias=? WHERE alias=?`, [sk_id, sk.kid]);
if (ek) {
  await db.query(`UPDATE key SET kid=?, identifierDid=? WHERE kid=?`, [ek_id, c.did, ek.kid]);
  await db.query(`UPDATE "private-key" SET alias=? WHERE alias=?`, [ek_id, ek.kid]);
}

// DID in DB speichern
const now = new Date().toISOString();
await db.query(`INSERT INTO identifier (did, provider, alias, controllerKeyId, saveDate, updateDate) VALUES (?,?,?,?,?,?)`, [c.did, 'did:web', name, sk_id, now, now]);

await db.destroy();

// Output
console.log(`Secp256k1 (key-1): "${sk.publicKeyHex}"`);
if (ek) console.log(`X25519 (key-2):    "${ek.publicKeyHex}"`);
console.log(`\n✅ ${dbPath}`);
