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
import { CONFIG } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const name = process.argv[2];
if (!name || !CONFIG[name]) { console.log('Usage: node generate-keys.mjs <nf-a|nf-b|issuer>'); process.exit(0); }

const c = CONFIG[name], dbPath = resolve(__dirname, c.db);
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
