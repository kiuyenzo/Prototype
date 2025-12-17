#!/usr/bin/env node
/**
 * Fix NF-A X25519 key ID format in database
 */

import sqlite3 from 'sqlite3';

const DB_PATH = process.env.DB_PATH || '/app/prototype/cluster-a/database-nf-a.sqlite';

const db = new sqlite3.Database(DB_PATH);

console.log('='.repeat(80));
console.log('🔧 Fixing NF-A X25519 Key ID Format');
console.log('='.repeat(80));
console.log(`\nDB: ${DB_PATH}\n`);

// Get current X25519 keys
db.all("SELECT kid, type, publicKeyHex FROM key WHERE type = 'X25519'", (err, rows) => {
  if (err) {
    console.error('Error querying keys:', err);
    db.close();
    process.exit(1);
  }

  console.log(`Found ${rows.length} X25519 key(s):`);
  rows.forEach((row, i) => {
    console.log(`  ${i + 1}. kid: ${row.kid}`);
    console.log(`     publicKeyHex: ${row.publicKeyHex}`);
  });

  // Find the key without DID prefix (the new one with private key)
  const newKey = rows.find(row => !row.kid.startsWith('did:'));
  const oldKey = rows.find(row => row.kid.startsWith('did:') && row.kid.includes('bfb6712c'));

  if (!newKey) {
    console.log('\n✅ No key to fix - all keys have correct format');
    db.close();
    return;
  }

  console.log(`\n📝 Fixing key ID for: ${newKey.kid}`);

  const correctKid = `did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a#${newKey.kid}`;
  console.log(`   New kid: ${correctKid}`);

  db.serialize(() => {
    // Delete old key without private key if it exists
    if (oldKey) {
      console.log(`\n🗑️  Deleting old key: ${oldKey.kid}`);
      db.run("DELETE FROM key WHERE kid = ?", [oldKey.kid], (err) => {
        if (err) console.error('Error deleting old key:', err);
        else console.log('   ✅ Old key deleted');
      });
    }

    // Update new key with correct kid format
    console.log(`\n📝 Updating kid format...`);
    db.run(
      "UPDATE key SET kid = ? WHERE kid = ?",
      [correctKid, newKey.kid],
      (err) => {
        if (err) {
          console.error('❌ Error updating key:', err);
          db.close();
          process.exit(1);
        }

        console.log('   ✅ Key ID updated in key table');

        // Also update in identifier_keys table
        db.run(
          "UPDATE identifier_keys SET kid = ? WHERE kid = ?",
          [correctKid, newKey.kid],
          (err) => {
            if (err) {
              console.error('❌ Error updating identifier_keys:', err);
            } else {
              console.log('   ✅ Key ID updated in identifier_keys table');
            }

            // Verify
            db.all("SELECT kid, type FROM key WHERE type = 'X25519'", (err, rows) => {
              if (err) {
                console.error('Error verifying:', err);
              } else {
                console.log(`\n✅ Verification - ${rows.length} X25519 key(s):`);
                rows.forEach((row, i) => {
                  console.log(`  ${i + 1}. ${row.kid}`);
                });
              }

              db.close();
              console.log('\n' + '='.repeat(80));
              console.log('🎉 Key ID fixed successfully!');
              console.log('='.repeat(80));
              console.log('\nNext: Restart the container\n');
            });
          }
        );
      }
    );
  });
});
