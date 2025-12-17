1. Schlüssel-Generierung mit Veramo

// agent.didManagerCreate() erzeugt:
// - Secp256k1 Key (für Signing/Authentication)
// - X25519 Key (für Encryption/KeyAgreement)

const identifier = await agent.didManagerCreate({
    provider: 'did:web',
    options: { keyType: 'Secp256k1' }
});

// Zusätzlich X25519 für Verschlüsselung:
const encryptionKey = await agent.keyManagerCreate({
    kms: 'local',
    type: 'X25519'
});
2. DID Document manuell erstellt
Das did.json wurde dann manuell mit den Public Keys erstellt:

{
  "id": "did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a",
  "verificationMethod": [
    {
      "type": "EcdsaSecp256k1VerificationKey2019",  // Signing
      "publicKeyHex": "0481a5f2..."
    },
    {
      "type": "X25519KeyAgreementKey2019",          // Encryption
      "publicKeyHex": "f5efa08d..."
    }
  ],
  "authentication": [...],      // Kann signieren
  "assertionMethod": [...],     // Kann Credentials ausstellen
  "keyAgreement": [...],        // Kann verschlüsseln
  "service": [...]              // DIDComm Endpoint
}
3. Auf GitHub Pages hosten

did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a
           │                  │          │        │
           └──────────────────┴──────────┴────────┘
                              ↓
https://kiuyenzo.github.io/Prototype/cluster-a/did-nf-a/did.json