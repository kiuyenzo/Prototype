/**
 * Script to add X25519 keys for DIDComm authcrypt to existing DIDs
 *
 * X25519 is required for:
 * - DIDComm v2 authcrypt (encrypted messages)
 * - ECDH key agreement (Elliptic Curve Diffie-Hellman)
 *
 * Usage:
 * npm install @veramo/core @veramo/key-manager @veramo/kms-local @veramo/data-store
 * npx ts-node add-x25519-keys.ts
 */

import { createAgent } from '@veramo/core'
import { KeyManager } from '@veramo/key-manager'
import { KeyManagementSystem } from '@veramo/kms-local'
import { DIDManager } from '@veramo/did-manager'
import { WebDIDProvider } from '@veramo/did-provider-web'
import { DIDResolverPlugin } from '@veramo/did-resolver'
import { Resolver } from 'did-resolver'
import { getResolver as webDidResolver } from 'web-did-resolver'
import { KeyStore, DIDStore, PrivateKeyStore } from '@veramo/data-store'
import { DataSource } from 'typeorm'
import { SecretBox } from '@veramo/kms-local'
import { Entities, migrations } from '@veramo/data-store'

// ============================================================================
// Cluster A - NF-A Agent
// ============================================================================

async function addX25519KeysToNFA() {
  console.log('=== Adding X25519 keys to NF-A ===\n')

  // Database connection
  const dbConnection = new DataSource({
    type: 'sqlite',
    database: './cluster-a/database-nf-a.sqlite',
    synchronize: false,
    migrationsRun: true,
    migrations,
    logging: false,
    entities: Entities
  })

  await dbConnection.initialize()

  // Create agent
  const agent = createAgent({
    plugins: [
      new KeyManager({
        store: new KeyStore(dbConnection),
        kms: {
          local: new KeyManagementSystem(
            new PrivateKeyStore(
              dbConnection,
              new SecretBox('ed9733675a04a20b91c5beb2196a6c964dce7d520a77be577a8a605911232ba6')
            )
          )
        }
      }),
      new DIDManager({
        store: new DIDStore(dbConnection),
        defaultProvider: 'did:web',
        providers: {
          'did:web': new WebDIDProvider({
            defaultKms: 'local'
          })
        }
      }),
      new DIDResolverPlugin({
        resolver: new Resolver({
          ...webDidResolver()
        })
      })
    ]
  })

  // 1. Create X25519 key for NF-A DID
  console.log('Creating X25519 key for NF-A...')
  const x25519Key = await agent.keyManagerCreate({
    kms: 'local',
    type: 'X25519'
  })

  console.log('✓ X25519 Key created:')
  console.log(`  KID: ${x25519Key.kid}`)
  console.log(`  Type: ${x25519Key.type}`)
  console.log(`  Public Key (hex): ${x25519Key.publicKeyHex}\n`)

  // 2. Add key to NF-A DID
  const nfaDID = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a'

  console.log(`Adding X25519 key to ${nfaDID}...`)
  await agent.didManagerAddKey({
    did: nfaDID,
    key: x25519Key,
    options: {
      // This adds the key to the keyAgreement section
      keyAgreement: true
    }
  })

  console.log('✓ Key added to keyAgreement section\n')

  // 3. Export DID Document for manual update
  const didDoc = await agent.didManagerGet({ did: nfaDID })
  console.log('Updated DID Document keys:')
  console.log(JSON.stringify(didDoc.keys, null, 2))
  console.log('\n')

  // 4. Create X25519 key for Issuer-A DID
  console.log('Creating X25519 key for Issuer-A...')
  const issuerX25519Key = await agent.keyManagerCreate({
    kms: 'local',
    type: 'X25519'
  })

  console.log('✓ X25519 Key created:')
  console.log(`  KID: ${issuerX25519Key.kid}`)
  console.log(`  Public Key (hex): ${issuerX25519Key.publicKeyHex}\n`)

  const issuerDID = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-issuer-a'

  console.log(`Adding X25519 key to ${issuerDID}...`)
  await agent.didManagerAddKey({
    did: issuerDID,
    key: issuerX25519Key,
    options: {
      keyAgreement: true
    }
  })

  console.log('✓ Key added to keyAgreement section\n')

  await dbConnection.destroy()

  return {
    nfaKey: x25519Key,
    issuerKey: issuerX25519Key
  }
}

// ============================================================================
// Cluster B - NF-B Agent
// ============================================================================

async function addX25519KeysToNFB() {
  console.log('=== Adding X25519 keys to NF-B ===\n')

  const dbConnection = new DataSource({
    type: 'sqlite',
    database: './cluster-b/database-nf-b.sqlite',
    synchronize: false,
    migrationsRun: true,
    migrations,
    logging: false,
    entities: Entities
  })

  await dbConnection.initialize()

  const agent = createAgent({
    plugins: [
      new KeyManager({
        store: new KeyStore(dbConnection),
        kms: {
          local: new KeyManagementSystem(
            new PrivateKeyStore(
              dbConnection,
              new SecretBox('3859413b662c8fc7e632cda1fe9d5f07991c0b5d2bd2d8a69fa36e9e25cfef1d')
            )
          )
        }
      }),
      new DIDManager({
        store: new DIDStore(dbConnection),
        defaultProvider: 'did:web',
        providers: {
          'did:web': new WebDIDProvider({
            defaultKms: 'local'
          })
        }
      }),
      new DIDResolverPlugin({
        resolver: new Resolver({
          ...webDidResolver()
        })
      })
    ]
  })

  // 1. Create X25519 key for NF-B DID
  console.log('Creating X25519 key for NF-B...')
  const x25519Key = await agent.keyManagerCreate({
    kms: 'local',
    type: 'X25519'
  })

  console.log('✓ X25519 Key created:')
  console.log(`  KID: ${x25519Key.kid}`)
  console.log(`  Type: ${x25519Key.type}`)
  console.log(`  Public Key (hex): ${x25519Key.publicKeyHex}\n`)

  // 2. Add key to NF-B DID
  const nfbDID = 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b'

  console.log(`Adding X25519 key to ${nfbDID}...`)
  await agent.didManagerAddKey({
    did: nfbDID,
    key: x25519Key,
    options: {
      keyAgreement: true
    }
  })

  console.log('✓ Key added to keyAgreement section\n')

  // 3. Create X25519 key for Issuer-B DID
  console.log('Creating X25519 key for Issuer-B...')
  const issuerX25519Key = await agent.keyManagerCreate({
    kms: 'local',
    type: 'X25519'
  })

  console.log('✓ X25519 Key created:')
  console.log(`  KID: ${issuerX25519Key.kid}`)
  console.log(`  Public Key (hex): ${issuerX25519Key.publicKeyHex}\n`)

  const issuerDID = 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-issuer-b'

  console.log(`Adding X25519 key to ${issuerDID}...`)
  await agent.didManagerAddKey({
    did: issuerDID,
    key: issuerX25519Key,
    options: {
      keyAgreement: true
    }
  })

  console.log('✓ Key added to keyAgreement section\n')

  await dbConnection.destroy()

  return {
    nfbKey: x25519Key,
    issuerKey: issuerX25519Key
  }
}

// ============================================================================
// Generate DID Document updates
// ============================================================================

function generateDIDDocumentUpdate(did: string, x25519PublicKeyHex: string) {
  // Convert hex to base58 for did:key format (optional, can also use hex)
  // For simplicity, we use hex directly

  const keyId = `${did}#${x25519PublicKeyHex.substring(0, 20)}`

  return {
    id: keyId,
    type: 'X25519KeyAgreementKey2019',
    controller: did,
    publicKeyHex: x25519PublicKeyHex
  }
}

// ============================================================================
// Main execution
// ============================================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  Adding X25519 Keys for DIDComm authcrypt               ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  try {
    // Add keys to NF-A
    const nfaKeys = await addX25519KeysToNFA()

    // Add keys to NF-B
    const nfbKeys = await addX25519KeysToNFB()

    console.log('\n╔══════════════════════════════════════════════════════════╗')
    console.log('║  Summary - Update your DID Documents                    ║')
    console.log('╚══════════════════════════════════════════════════════════╝\n')

    console.log('Add the following to cluster-a/did-nf-a/did.json:\n')
    console.log('"keyAgreement": [')
    console.log('  {')
    console.log(`    "id": "did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a#${nfaKeys.nfaKey.kid}",`)
    console.log('    "type": "X25519KeyAgreementKey2019",')
    console.log('    "controller": "did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a",')
    console.log(`    "publicKeyHex": "${nfaKeys.nfaKey.publicKeyHex}"`)
    console.log('  }')
    console.log(']\n')

    console.log('Add the following to cluster-a/did-issuer-a/did.json:\n')
    console.log('"keyAgreement": [')
    console.log('  {')
    console.log(`    "id": "did:web:kiuyenzo.github.io:Prototype:cluster-a:did-issuer-a#${nfaKeys.issuerKey.kid}",`)
    console.log('    "type": "X25519KeyAgreementKey2019",')
    console.log('    "controller": "did:web:kiuyenzo.github.io:Prototype:cluster-a:did-issuer-a",')
    console.log(`    "publicKeyHex": "${nfaKeys.issuerKey.publicKeyHex}"`)
    console.log('  }')
    console.log(']\n')

    console.log('Add the following to cluster-b/did-nf-b/did.json:\n')
    console.log('"keyAgreement": [')
    console.log('  {')
    console.log(`    "id": "did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b#${nfbKeys.nfbKey.kid}",`)
    console.log('    "type": "X25519KeyAgreementKey2019",')
    console.log('    "controller": "did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b",')
    console.log(`    "publicKeyHex": "${nfbKeys.nfbKey.publicKeyHex}"`)
    console.log('  }')
    console.log(']\n')

    console.log('Add the following to cluster-b/did-issuer-b/did.json:\n')
    console.log('"keyAgreement": [')
    console.log('  {')
    console.log(`    "id": "did:web:kiuyenzo.github.io:Prototype:cluster-b:did-issuer-b#${nfbKeys.issuerKey.kid}",`)
    console.log('    "type": "X25519KeyAgreementKey2019",')
    console.log('    "controller": "did:web:kiuyenzo.github.io:Prototype:cluster-b:did-issuer-b",')
    console.log(`    "publicKeyHex": "${nfbKeys.issuerKey.publicKeyHex}"`)
    console.log('  }')
    console.log(']\n')

    console.log('✅ All X25519 keys have been generated and added to the databases!')
    console.log('✅ Now update your DID Document JSON files with the keyAgreement sections above.')

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error)
}

export { addX25519KeysToNFA, addX25519KeysToNFB, generateDIDDocumentUpdate }
