/**
 * Vollständiges Beispiel: DID-Erstellung mit Veramo
 *
 * Dieses Beispiel zeigt, wie man einen Veramo-Agent konfiguriert
 * und verschiedene Arten von DIDs erstellt.
 */

import { createAgent } from './packages/core/src'
import { IDIDManager, IKeyManager, IResolver } from './packages/core-types/src'
import { DIDManager } from './packages/did-manager/src'
import { KeyManager } from './packages/key-manager/src'
import { DIDResolverPlugin } from './packages/did-resolver/src'
import { KeyManagementSystem, SecretBox } from './packages/kms-local/src'
import { DIDStore, KeyStore, PrivateKeyStore, Entities, migrations } from './packages/data-store/src'

// DID Provider Imports
import { WebDIDProvider } from './packages/did-provider-web/src'
import { KeyDIDProvider, getDidKeyResolver } from './packages/did-provider-key/src'
import { JwkDIDProvider, getDidJwkResolver } from './packages/did-provider-jwk/src'
import { PkhDIDProvider, getDidPkhResolver } from './packages/did-provider-pkh/src'
import { EthrDIDProvider } from './packages/did-provider-ethr/src'

// Resolver Imports
import { getResolver as ethrDidResolver } from 'ethr-did-resolver'
import { getResolver as webDidResolver } from 'web-did-resolver'

import { DataSource } from 'typeorm'

// =============================================================================
// SCHRITT 1: Agent Setup
// =============================================================================

async function setupAgent() {
  // Secret Key für die Verschlüsselung privater Schlüssel
  const secretKey = '29739248cad1bd1a0fc4d9b75cd4d2990de535baf5caadfdf8d8f86664aa830c'

  // Datenbank-Verbindung (SQLite)
  const dbConnection = await new DataSource({
    type: 'sqlite',
    database: './veramo-database.sqlite', // oder ':memory:' für In-Memory-DB
    synchronize: false,
    migrations: migrations,
    migrationsRun: true,
    logging: false,
    entities: Entities,
  }).initialize()

  // Agent erstellen
  const agent = createAgent<IDIDManager & IKeyManager & IResolver>({
    plugins: [
      // Key Manager Plugin
      new KeyManager({
        store: new KeyStore(dbConnection),
        kms: {
          local: new KeyManagementSystem(
            new PrivateKeyStore(dbConnection, new SecretBox(secretKey))
          ),
        },
      }),

      // DID Manager Plugin mit verschiedenen Providern
      new DIDManager({
        store: new DIDStore(dbConnection),
        defaultProvider: 'did:key', // Standard-Provider
        providers: {
          'did:web': new WebDIDProvider({
            defaultKms: 'local',
          }),
          'did:key': new KeyDIDProvider({
            defaultKms: 'local',
          }),
          'did:jwk': new JwkDIDProvider({
            defaultKms: 'local',
          }),
          'did:pkh': new PkhDIDProvider({
            defaultKms: 'local',
          }),
          // Optional: did:ethr (benötigt Ethereum-Provider)
          // 'did:ethr': new EthrDIDProvider({
          //   defaultKms: 'local',
          //   networks: [...]
          // }),
        },
      }),

      // DID Resolver Plugin
      new DIDResolverPlugin({
        ...webDidResolver(),
        ...getDidKeyResolver(),
        ...getDidJwkResolver(),
        ...getDidPkhResolver(),
        // ...ethrDidResolver({ networks: [...] }),
      }),
    ],
  })

  return { agent, dbConnection }
}

// =============================================================================
// SCHRITT 2: DID-Erstellung Beispiele
// =============================================================================

async function examples() {
  const { agent, dbConnection } = await setupAgent()

  console.log('🚀 Veramo Agent erfolgreich konfiguriert!\n')

  try {
    // -------------------------------------------------------------------------
    // Beispiel 1: did:key DID erstellen (am einfachsten)
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 1: did:key erstellen')
    const didKey = await agent.didManagerCreate({
      provider: 'did:key',
      alias: 'meine-erste-did',
      options: {
        keyType: 'Ed25519', // oder 'Secp256k1', 'X25519'
      },
    })
    console.log('✅ DID erstellt:', didKey.did)
    console.log('   Keys:', didKey.keys.length)
    console.log('   Controller:', didKey.controllerKeyId)
    console.log()

    // -------------------------------------------------------------------------
    // Beispiel 2: did:jwk DID erstellen
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 2: did:jwk erstellen')
    const didJwk = await agent.didManagerCreate({
      provider: 'did:jwk',
      alias: 'jwk-identity',
      options: {
        keyType: 'Secp256k1', // oder 'Secp256r1', 'Ed25519', 'X25519'
      },
    })
    console.log('✅ DID erstellt:', didJwk.did)
    console.log()

    // -------------------------------------------------------------------------
    // Beispiel 3: did:web DID erstellen
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 3: did:web erstellen')
    const didWeb = await agent.didManagerCreate({
      provider: 'did:web',
      alias: 'example.com',
    })
    console.log('✅ DID erstellt:', didWeb.did)
    console.log()

    // -------------------------------------------------------------------------
    // Beispiel 4: did:pkh DID erstellen (Public Key Hash)
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 4: did:pkh erstellen')
    const didPkh = await agent.didManagerCreate({
      provider: 'did:pkh',
      alias: 'meine-pkh-did',
      options: {
        chainId: '1', // Ethereum Mainnet
      },
    })
    console.log('✅ DID erstellt:', didPkh.did)
    console.log()

    // -------------------------------------------------------------------------
    // Beispiel 5: DID mit importiertem Private Key
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 5: did:jwk mit importiertem Key')
    const didImported = await agent.didManagerCreate({
      provider: 'did:jwk',
      alias: 'importierte-did',
      options: {
        keyType: 'Ed25519',
        privateKeyHex:
          'f3157fbbb356a0d56a84a1a9752f81d0638cce4153168bd1b46f68a6e62b82b0f3157fbbb356a0d56a84a1a9752f81d0638cce4153168bd1b46f68a6e62b82b0',
      },
    })
    console.log('✅ DID mit importiertem Key erstellt:', didImported.did)
    console.log()

    // -------------------------------------------------------------------------
    // Beispiel 6: DID abrufen
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 6: DID abrufen')
    const retrievedDid = await agent.didManagerGet({ did: didKey.did })
    console.log('✅ DID abgerufen:', retrievedDid.did)
    console.log('   Alias:', retrievedDid.alias)
    console.log()

    // -------------------------------------------------------------------------
    // Beispiel 7: DID über Alias abrufen
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 7: DID über Alias abrufen')
    const didByAlias = await agent.didManagerGetByAlias({ alias: 'meine-erste-did' })
    console.log('✅ DID gefunden:', didByAlias.did)
    console.log()

    // -------------------------------------------------------------------------
    // Beispiel 8: Alle DIDs auflisten
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 8: Alle DIDs auflisten')
    const allDids = await agent.didManagerFind()
    console.log('✅ Anzahl aller DIDs:', allDids.length)
    allDids.forEach((did, index) => {
      console.log(`   ${index + 1}. ${did.did} (${did.provider})${did.alias ? ' - Alias: ' + did.alias : ''}`)
    })
    console.log()

    // -------------------------------------------------------------------------
    // Beispiel 9: DIDs nach Provider filtern
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 9: DIDs nach Provider filtern')
    const jwkDids = await agent.didManagerFind({ provider: 'did:jwk' })
    console.log('✅ Anzahl did:jwk DIDs:', jwkDids.length)
    console.log()

    // -------------------------------------------------------------------------
    // Beispiel 10: DID auflösen (resolve)
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 10: DID auflösen')
    const resolvedDid = await agent.resolveDid({ didUrl: didKey.did })
    console.log('✅ DID Document aufgelöst:')
    console.log('   ID:', resolvedDid.didDocument?.id)
    console.log('   Verification Methods:', resolvedDid.didDocument?.verificationMethod?.length)
    console.log()

    // -------------------------------------------------------------------------
    // Beispiel 11: Service zu DID hinzufügen (nur für did:web)
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 11: Service zu did:web hinzufügen')
    await agent.didManagerAddService({
      did: didWeb.did,
      service: {
        id: `${didWeb.did}#messaging`,
        type: 'Messaging',
        serviceEndpoint: 'https://example.com/messaging',
        description: 'Messaging Service',
      },
    })
    const updatedDidWeb = await agent.didManagerGet({ did: didWeb.did })
    console.log('✅ Services:', updatedDidWeb.services.length)
    console.log()

    // -------------------------------------------------------------------------
    // Beispiel 12: Zusätzlichen Key zur DID hinzufügen
    // -------------------------------------------------------------------------
    console.log('📝 Beispiel 12: Zusätzlichen Key hinzufügen')
    const newKey = await agent.keyManagerCreate({
      kms: 'local',
      type: 'Secp256k1',
    })
    await agent.didManagerAddKey({
      did: didWeb.did,
      key: newKey,
    })
    const didWithNewKey = await agent.didManagerGet({ did: didWeb.did })
    console.log('✅ Anzahl Keys:', didWithNewKey.keys.length)
    console.log()

    // -------------------------------------------------------------------------
    // Zusammenfassung
    // -------------------------------------------------------------------------
    console.log('🎉 Alle Beispiele erfolgreich ausgeführt!')
    console.log('\n📊 Zusammenfassung:')
    console.log('   - Erstellte DIDs:', allDids.length)
    console.log('   - Verwendete Provider: did:key, did:jwk, did:web, did:pkh')
    console.log('   - Datenbankdatei: ./veramo-database.sqlite')

  } catch (error) {
    console.error('❌ Fehler:', error)
  } finally {
    // Aufräumen
    await dbConnection.close()
    console.log('\n✅ Datenbankverbindung geschlossen')
  }
}

// =============================================================================
// Ausführen
// =============================================================================

examples().catch(console.error)
