/**
 * Einfaches Beispiel: did:web DID-Erstellung mit Veramo
 *
 * Dieses Beispiel zeigt, wie man einen minimalen Veramo-Agent
 * für did:web DIDs konfiguriert und verwendet.
 */

import { createAgent } from './packages/core/src'
import { IDIDManager, IKeyManager, IResolver } from './packages/core-types/src'
import { DIDManager } from './packages/did-manager/src'
import { KeyManager } from './packages/key-manager/src'
import { DIDResolverPlugin } from './packages/did-resolver/src'
import { KeyManagementSystem, SecretBox } from './packages/kms-local/src'
import { DIDStore, KeyStore, PrivateKeyStore, Entities, migrations } from './packages/data-store/src'
import { WebDIDProvider } from './packages/did-provider-web/src'
import { getResolver as webDidResolver } from 'web-did-resolver'
import { DataSource } from 'typeorm'

// =============================================================================
// Agent Setup für did:web
// =============================================================================

async function setupWebDidAgent() {
  // Secret Key für die Verschlüsselung privater Schlüssel
  const secretKey = '29739248cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa830c'

  // Datenbank-Verbindung
  const dbConnection = await new DataSource({
    type: 'sqlite',
    database: './did-web-database.sqlite', // oder ':memory:' für temporäre DB
    synchronize: false,
    migrations: migrations,
    migrationsRun: true,
    logging: false,
    entities: Entities,
  }).initialize()

  // Agent erstellen (nur mit did:web Support)
  const agent = createAgent<IDIDManager & IKeyManager & IResolver>({
    plugins: [
      // Key Manager
      new KeyManager({
        store: new KeyStore(dbConnection),
        kms: {
          local: new KeyManagementSystem(
            new PrivateKeyStore(dbConnection, new SecretBox(secretKey))
          ),
        },
      }),

      // DID Manager - nur did:web Provider
      new DIDManager({
        store: new DIDStore(dbConnection),
        defaultProvider: 'did:web',
        providers: {
          'did:web': new WebDIDProvider({
            defaultKms: 'local',
          }),
        },
      }),

      // DID Resolver - nur für did:web
      new DIDResolverPlugin({
        ...webDidResolver(),
      }),
    ],
  })

  return { agent, dbConnection }
}

// =============================================================================
// Beispiele für did:web Operationen
// =============================================================================

async function didWebExamples() {
  const { agent, dbConnection } = await setupWebDidAgent()

  console.log('🚀 Veramo Agent für did:web gestartet!\n')

  try {
    // -------------------------------------------------------------------------
    // 1. Einfache did:web DID erstellen
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 1: Einfache did:web DID erstellen')
    const did1 = await agent.didManagerCreate({
      provider: 'did:web',
      alias: 'example.com',
    })
    console.log('✅ DID erstellt:', did1.did)
    console.log('   Alias:', did1.alias)
    console.log('   Keys:', did1.keys.length)
    console.log()

    // -------------------------------------------------------------------------
    // 2. did:web DID mit Subdomain
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 2: did:web mit Subdomain')
    const did2 = await agent.didManagerCreate({
      provider: 'did:web',
      alias: 'identity.example.com',
    })
    console.log('✅ DID erstellt:', did2.did)
    console.log()

    // -------------------------------------------------------------------------
    // 3. did:web DID mit Pfad
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 3: did:web mit Pfad')
    const did3 = await agent.didManagerCreate({
      provider: 'did:web',
      alias: 'example.com:user:alice',
    })
    console.log('✅ DID erstellt:', did3.did)
    console.log()

    // -------------------------------------------------------------------------
    // 4. Service zur DID hinzufügen
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 4: Service hinzufügen')
    await agent.didManagerAddService({
      did: did1.did,
      service: {
        id: `${did1.did}#messaging`,
        type: 'Messaging',
        serviceEndpoint: 'https://example.com/messaging',
        description: 'DIDComm Messaging Service',
      },
    })
    console.log('✅ Messaging Service hinzugefügt')
    console.log()

    // -------------------------------------------------------------------------
    // 5. Weitere Services hinzufügen
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 5: Weitere Services hinzufügen')
    await agent.didManagerAddService({
      did: did1.did,
      service: {
        id: `${did1.did}#linked-domain`,
        type: 'LinkedDomains',
        serviceEndpoint: 'https://example.com',
      },
    })
    await agent.didManagerAddService({
      did: did1.did,
      service: {
        id: `${did1.did}#hub`,
        type: 'IdentityHub',
        serviceEndpoint: 'https://hub.example.com',
      },
    })
    console.log('✅ Weitere Services hinzugefügt')
    console.log()

    // -------------------------------------------------------------------------
    // 6. DID mit allen Services abrufen
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 6: DID mit Services abrufen')
    const updatedDid = await agent.didManagerGet({ did: did1.did })
    console.log('✅ DID:', updatedDid.did)
    console.log('   Anzahl Services:', updatedDid.services.length)
    updatedDid.services.forEach((service, index) => {
      console.log(`   ${index + 1}. ${service.type}: ${service.serviceEndpoint}`)
    })
    console.log()

    // -------------------------------------------------------------------------
    // 7. Zusätzlichen Key hinzufügen
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 7: Zusätzlichen Key hinzufügen')
    const newKey = await agent.keyManagerCreate({
      kms: 'local',
      type: 'Secp256k1',
    })
    await agent.didManagerAddKey({
      did: did1.did,
      key: newKey,
    })
    const didWithKeys = await agent.didManagerGet({ did: did1.did })
    console.log('✅ Anzahl Keys:', didWithKeys.keys.length)
    didWithKeys.keys.forEach((key, index) => {
      console.log(`   ${index + 1}. Type: ${key.type}, KID: ${key.kid.substring(0, 20)}...`)
    })
    console.log()

    // -------------------------------------------------------------------------
    // 8. Service entfernen
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 8: Service entfernen')
    await agent.didManagerRemoveService({
      did: did1.did,
      id: `${did1.did}#hub`,
    })
    const didAfterRemoval = await agent.didManagerGet({ did: did1.did })
    console.log('✅ Services nach Entfernung:', didAfterRemoval.services.length)
    console.log()

    // -------------------------------------------------------------------------
    // 9. Alle did:web DIDs auflisten
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 9: Alle did:web DIDs auflisten')
    const allDids = await agent.didManagerFind({ provider: 'did:web' })
    console.log('✅ Anzahl did:web DIDs:', allDids.length)
    allDids.forEach((did, index) => {
      console.log(`   ${index + 1}. ${did.did}${did.alias ? ' (Alias: ' + did.alias + ')' : ''}`)
    })
    console.log()

    // -------------------------------------------------------------------------
    // 10. DID über Alias finden
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 10: DID über Alias finden')
    const foundDid = await agent.didManagerGetByAlias({
      alias: 'example.com',
      provider: 'did:web',
    })
    console.log('✅ Gefundene DID:', foundDid.did)
    console.log()

    // -------------------------------------------------------------------------
    // 11. DID auflösen (DID Document)
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 11: DID Document auflösen')
    const resolved = await agent.resolveDid({ didUrl: did1.did })
    console.log('✅ DID Document aufgelöst:')
    console.log('   ID:', resolved.didDocument?.id)
    console.log('   Verification Methods:', resolved.didDocument?.verificationMethod?.length)
    console.log('   Services:', resolved.didDocument?.service?.length)
    console.log()

    // -------------------------------------------------------------------------
    // 12. DID exportieren (für Backup)
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 12: DID-Informationen exportieren')
    const exportedDid = await agent.didManagerGet({ did: did1.did })
    const exportData = {
      did: exportedDid.did,
      alias: exportedDid.alias,
      provider: exportedDid.provider,
      keys: exportedDid.keys.map(k => ({
        kid: k.kid,
        type: k.type,
        publicKeyHex: k.publicKeyHex,
      })),
      services: exportedDid.services,
    }
    console.log('✅ Export-Daten (JSON):')
    console.log(JSON.stringify(exportData, null, 2))
    console.log()

    // -------------------------------------------------------------------------
    // Zusammenfassung
    // -------------------------------------------------------------------------
    console.log('🎉 Alle did:web Beispiele erfolgreich!')
    console.log('\n📊 Zusammenfassung:')
    console.log('   - Erstellte DIDs:', allDids.length)
    console.log('   - Services pro DID: 2-3')
    console.log('   - Keys pro DID: 1-2')
    console.log('   - Datenbankdatei: ./did-web-database.sqlite')

    // -------------------------------------------------------------------------
    // Hinweis: DID Document veröffentlichen
    // -------------------------------------------------------------------------
    console.log('\n💡 Wichtiger Hinweis:')
    console.log('   Um did:web DIDs zu verwenden, musst du das DID Document')
    console.log('   unter folgender URL veröffentlichen:')
    console.log(`   https://example.com/.well-known/did.json`)
    console.log('\n   Beispiel DID Document Struktur:')
    console.log(JSON.stringify(resolved.didDocument, null, 2).substring(0, 500) + '...')

  } catch (error) {
    console.error('❌ Fehler:', error)
  } finally {
    await dbConnection.close()
    console.log('\n✅ Datenbankverbindung geschlossen')
  }
}

// =============================================================================
// Ausführen
// =============================================================================

didWebExamples().catch(console.error)
