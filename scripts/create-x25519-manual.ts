/**
 * Manual X25519 Key Creation Script
 *
 * This script creates X25519 keys manually and adds them to your DIDs
 * for DIDComm v2 authcrypt support.
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
// Configuration
// ============================================================================

interface ClusterConfig {
  name: string
  database: string
  secretKey: string
  dids: string[]
}

const CLUSTERS: ClusterConfig[] = [
  {
    name: 'Cluster A',
    database: './cluster-a/database-nf-a.sqlite',
    secretKey: 'ed9733675a04a20b91c5beb2196a6c964dce7d520a77be577a8a605911232ba6',
    dids: [
      'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a',
      'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-issuer-a'
    ]
  },
  {
    name: 'Cluster B',
    database: './cluster-b/database-nf-b.sqlite',
    secretKey: '3859413b662c8fc7e632cda1fe9d5f07991c0b5d2bd2d8a69fa36e9e25cfef1d',
    dids: [
      'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b',
      'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-issuer-b'
    ]
  }
]

// ============================================================================
// Helper Functions
// ============================================================================

async function createAgentForCluster(config: ClusterConfig) {
  const dbConnection = new DataSource({
    type: 'sqlite',
    database: config.database,
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
            new PrivateKeyStore(dbConnection, new SecretBox(config.secretKey))
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

  return { agent, dbConnection }
}

async function createX25519KeyForDID(agent: any, did: string) {
  console.log(`\n📝 Processing: ${did}`)
  console.log('─'.repeat(80))

  // 1. Create X25519 key
  console.log('1️⃣  Creating X25519 key...')
  const x25519Key = await agent.keyManagerCreate({
    kms: 'local',
    type: 'X25519'
  })

  console.log('   ✓ Key created successfully!')
  console.log(`   - KID: ${x25519Key.kid}`)
  console.log(`   - Type: ${x25519Key.type}`)
  console.log(`   - Public Key: ${x25519Key.publicKeyHex}`)

  // 2. Add key to DID
  console.log('\n2️⃣  Adding key to DID...')
  try {
    await agent.didManagerAddKey({
      did: did,
      key: x25519Key,
      options: {
        keyAgreement: true
      }
    })
    console.log('   ✓ Key added to keyAgreement section!')
  } catch (error: any) {
    console.log(`   ⚠️  ${error.message}`)
  }

  // 3. Verify the key was added
  console.log('\n3️⃣  Verifying DID document...')
  const didDoc = await agent.didManagerGet({ did })
  const keyAgreementKeys = didDoc.keys.filter((k: any) => k.type === 'X25519')
  console.log(`   ✓ Found ${keyAgreementKeys.length} X25519 key(s) in DID`)

  return {
    did,
    x25519Key,
    keyAgreementKeys
  }
}

function generateDIDDocumentJSON(did: string, publicKeyHex: string, kid: string) {
  const didPath = did.replace('did:web:kiuyenzo.github.io:Prototype:', '').replace(/:/g, '/')

  return {
    id: `${did}#${kid}`,
    type: 'X25519KeyAgreementKey2019',
    controller: did,
    publicKeyHex: publicKeyHex,
    filePath: `${didPath}/did.json`
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗')
  console.log('║     Manual X25519 Key Creation for DIDComm authcrypt          ║')
  console.log('╚════════════════════════════════════════════════════════════════╝\n')

  const allResults: any[] = []

  for (const cluster of CLUSTERS) {
    console.log(`\n🏢 ${cluster.name}`)
    console.log('═'.repeat(80))

    const { agent, dbConnection } = await createAgentForCluster(cluster)

    for (const did of cluster.dids) {
      const result = await createX25519KeyForDID(agent, did)
      allResults.push(result)
    }

    await dbConnection.destroy()
  }

  // Print summary
  console.log('\n\n╔════════════════════════════════════════════════════════════════╗')
  console.log('║                    UPDATE YOUR DID DOCUMENTS                   ║')
  console.log('╚════════════════════════════════════════════════════════════════╝\n')

  for (const result of allResults) {
    if (result.keyAgreementKeys.length > 0) {
      const latestKey = result.keyAgreementKeys[result.keyAgreementKeys.length - 1]
      const jsonEntry = generateDIDDocumentJSON(
        result.did,
        latestKey.publicKeyHex,
        latestKey.kid
      )

      console.log(`\n📄 ${jsonEntry.filePath}`)
      console.log('─'.repeat(80))
      console.log('Add this to the "keyAgreement" array:\n')
      console.log(JSON.stringify({
        id: jsonEntry.id,
        type: jsonEntry.type,
        controller: jsonEntry.controller,
        publicKeyHex: jsonEntry.publicKeyHex
      }, null, 2))
    }
  }

  console.log('\n\n✅ All X25519 keys have been created!')
  console.log('📝 Update your DID JSON files with the entries above.')
  console.log('🔐 Authcrypt will work after updating the DID documents.\n')
}

// Run the script
main().catch((error) => {
  console.error('\n❌ Error:', error)
  process.exit(1)
})
