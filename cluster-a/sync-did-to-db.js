#!/usr/bin/env node

/**
 * Script to sync DID document from did.json file to Veramo database
 * Usage: node sync-did-to-db.js <path-to-did.json> <path-to-database.sqlite>
 */

const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node sync-did-to-db.js <path-to-did.json> <path-to-database.sqlite>');
  console.error('Example: node sync-did-to-db.js ./did-nf-a/did.json ./database-nf-a.sqlite');
  process.exit(1);
}

const didJsonPath = args[0];
const dbPath = args[1];

// Check if files exist
if (!fs.existsSync(didJsonPath)) {
  console.error(`Error: DID document not found at ${didJsonPath}`);
  process.exit(1);
}

if (!fs.existsSync(dbPath)) {
  console.error(`Error: Database not found at ${dbPath}`);
  process.exit(1);
}

// Read DID document
console.log(`Reading DID document from: ${didJsonPath}`);
const didDocument = JSON.parse(fs.readFileSync(didJsonPath, 'utf8'));
const did = didDocument.id;

console.log(`DID: ${did}`);

// Open database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log(`Connected to database: ${dbPath}`);
});

// Helper function to run queries
function runQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// Main sync function
async function syncDidToDatabase() {
  try {
    // 1. Check if identifier exists
    console.log('\n1. Checking if DID exists in database...');
    const identifierExists = await new Promise((resolve, reject) => {
      db.get('SELECT did FROM identifier WHERE did = ?', [did], (err, row) => {
        if (err) reject(err);
        else resolve(!!row);
      });
    });

    if (!identifierExists) {
      console.log('   DID not found in database. Creating identifier entry...');
      await runQuery(
        `INSERT INTO identifier (did, provider, alias, saveDate, updateDate)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
        [did, 'did:web', null]
      );
      console.log('   ✓ Identifier created');
    } else {
      console.log('   ✓ DID already exists in database');
    }

    // 2. Delete existing services for this DID
    console.log('\n2. Removing old service endpoints...');
    await runQuery('DELETE FROM service WHERE identifierDid = ?', [did]);
    console.log('   ✓ Old services removed');

    // 3. Insert services from DID document
    if (didDocument.service && didDocument.service.length > 0) {
      console.log('\n3. Inserting service endpoints...');
      for (const service of didDocument.service) {
        const serviceId = service.id.startsWith('#') ? service.id : `#${service.id}`;
        const serviceEndpoint = typeof service.serviceEndpoint === 'string'
          ? service.serviceEndpoint
          : JSON.stringify(service.serviceEndpoint);

        await runQuery(
          `INSERT INTO service (id, type, serviceEndpoint, description, identifierDid)
           VALUES (?, ?, ?, ?, ?)`,
          [
            serviceId,
            service.type,
            serviceEndpoint,
            service.description || '',
            did
          ]
        );
        console.log(`   ✓ Added service: ${service.type} -> ${serviceEndpoint}`);
      }
    } else {
      console.log('\n3. No service endpoints found in DID document');
    }

    // 4. Delete existing keys for this DID
    console.log('\n4. Removing old keys...');
    await runQuery('DELETE FROM key WHERE identifierDid = ?', [did]);
    console.log('   ✓ Old keys removed');

    // 5. Insert verification methods as keys (read-only, for display purposes)
    if (didDocument.verificationMethod && didDocument.verificationMethod.length > 0) {
      console.log('\n5. Inserting verification methods...');
      for (const vm of didDocument.verificationMethod) {
        const kid = vm.id;
        const type = vm.type;
        const publicKeyHex = vm.publicKeyHex || vm.publicKeyBase58 || '';

        // Note: We're not inserting private keys, just the public key info
        await runQuery(
          `INSERT INTO key (kid, type, publicKeyHex, identifierDid)
           VALUES (?, ?, ?, ?)`,
          [kid, type, publicKeyHex, did]
        );
        console.log(`   ✓ Added key: ${type}`);
      }
    }

    // 6. Insert keyAgreement keys
    if (didDocument.keyAgreement && didDocument.keyAgreement.length > 0) {
      console.log('\n6. Inserting keyAgreement keys...');
      for (const ka of didDocument.keyAgreement) {
        // Handle both embedded and referenced key agreements
        if (typeof ka === 'string') {
          console.log(`   ✓ Referenced key: ${ka}`);
          continue;
        }

        const kid = ka.id;
        const type = ka.type;
        const publicKeyHex = ka.publicKeyHex || ka.publicKeyBase58 || '';

        await runQuery(
          `INSERT INTO key (kid, type, publicKeyHex, identifierDid)
           VALUES (?, ?, ?, ?)`,
          [kid, type, publicKeyHex, did]
        );
        console.log(`   ✓ Added keyAgreement: ${type}`);
      }
    }

    console.log('\n✅ DID document successfully synced to database!');

  } catch (error) {
    console.error('\n❌ Error syncing DID to database:', error.message);
    throw error;
  }
}

// Run the sync
syncDidToDatabase()
  .then(() => {
    db.close();
    console.log('\nDatabase connection closed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    db.close();
    process.exit(1);
  });
