# X25519 KeyAgreement für DID Documents

## Was ist X25519?

**X25519** ist ein Elliptic Curve Diffie-Hellman (ECDH) Key Agreement Protokoll:
- Wird für **DIDComm v2 authcrypt** (verschlüsselte Nachrichten) benötigt
- Ermöglicht sichere Schlüsselvereinbarung zwischen zwei Parteien
- Basiert auf Curve25519 (Daniel J. Bernstein)

## Format in DID Documents

### Struktur der keyAgreement Sektion:

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/v2",
    "https://w3id.org/security/suites/x25519-2019/v1"
  ],
  "id": "did:web:example.com",
  "verificationMethod": [
    {
      "id": "did:web:example.com#key-1",
      "type": "EcdsaSecp256k1VerificationKey2019",
      "controller": "did:web:example.com",
      "publicKeyHex": "04..."
    }
  ],
  "authentication": ["did:web:example.com#key-1"],
  "assertionMethod": ["did:web:example.com#key-1"],
  "keyAgreement": [
    {
      "id": "did:web:example.com#key-agreement-1",
      "type": "X25519KeyAgreementKey2019",
      "controller": "did:web:example.com",
      "publicKeyHex": "a7f4c9e2..."
    }
  ],
  "service": [
    {
      "id": "#messaging",
      "type": "DIDCommMessaging",
      "serviceEndpoint": "https://example.com/didcomm"
    }
  ]
}
```

## Key Types Vergleich

| Key Type | Verwendung | Sektion in DID |
|----------|-----------|----------------|
| **Secp256k1** | Signing (JWT, VC, VP) | `verificationMethod`, `authentication`, `assertionMethod` |
| **Ed25519** | Signing (EdDSA) | `verificationMethod`, `authentication`, `assertionMethod` |
| **X25519** | Key Agreement (ECDH) | `keyAgreement` |

## Beispiel: NF-A DID Document mit keyAgreement

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/v2",
    "https://w3id.org/security/suites/secp256k1recovery-2020/v2",
    "https://w3id.org/security/suites/x25519-2019/v1"
  ],
  "id": "did:web:nf-a.example.com",
  "verificationMethod": [
    {
      "id": "did:web:nf-a.example.com#signing-key",
      "type": "EcdsaSecp256k1VerificationKey2019",
      "controller": "did:web:nf-a.example.com",
      "publicKeyHex": "045261628a70d611fb0d148ddb15ec4ad4b81d8e16fae234a315d3ee8c645eebe5beb3ef84e053bbddc508fe77a1decdf136cb7ce661b7ab7b5c046cd7c1f9673a"
    }
  ],
  "authentication": [
    "did:web:nf-a.example.com#signing-key"
  ],
  "assertionMethod": [
    "did:web:nf-a.example.com#signing-key"
  ],
  "keyAgreement": [
    {
      "id": "did:web:nf-a.example.com#key-agreement",
      "type": "X25519KeyAgreementKey2019",
      "controller": "did:web:nf-a.example.com",
      "publicKeyHex": "HIER_KOMMT_DER_X25519_PUBLIC_KEY"
    }
  ],
  "service": [
    {
      "id": "#didcomm",
      "type": "DIDCommMessaging",
      "serviceEndpoint": "https://didcomm.nf-a.cluster-a.global/messaging"
    }
  ]
}
```

## Wie DIDComm authcrypt X25519 verwendet

### Verschlüsselungsprozess (Sender → Empfänger):

```
┌─────────────────────────────────────────────────────────────┐
│ Sender (NF_A)                                               │
├─────────────────────────────────────────────────────────────┤
│ 1. Erstelle ephemeral X25519 Keypair (einmalig)            │
│ 2. Hole Empfänger X25519 Public Key aus DID Document       │
│ 3. ECDH: ephemeral_private + recipient_public = shared_key │
│ 4. Verschlüssele Message mit shared_key (AEAD)             │
│ 5. Sende: {ciphertext, ephemeral_public_key}               │
└─────────────────────────────────────────────────────────────┘
                             │
                             │ authcrypt Message
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ Empfänger (NF_B)                                            │
├─────────────────────────────────────────────────────────────┤
│ 1. Empfange Message mit ephemeral_public_key               │
│ 2. ECDH: own_private + ephemeral_public = shared_key       │
│ 3. Entschlüssele ciphertext mit shared_key                 │
│ 4. Verifiziere Sender Signatur                             │
└─────────────────────────────────────────────────────────────┘
```

## Wichtige Hinweise

### ✅ DO:
- **Einen X25519 Key pro DID** (kann mehrere haben, aber einer reicht)
- **Key muss in `keyAgreement` Sektion** sein
- **Public Key im DID Document veröffentlichen**
- **Private Key sicher in DataStore speichern**

### ❌ DON'T:
- **Nicht** denselben Key für Signing und KeyAgreement verwenden
- **Nicht** Secp256k1 für KeyAgreement (falsche Curve)
- **Nicht** Private Keys im DID Document speichern

## Veramo Key Management

### Keys in Veramo DataStore:

```sql
-- key Tabelle
kid                 | type    | publicKeyHex
--------------------+---------+------------------
04526162...         | Secp256k1 | 04526162...     ← Signing
57ace401...         | Ed25519   | 57ace401...     ← Signing
a7f4c9e2...         | X25519    | a7f4c9e2...     ← KeyAgreement

-- private-key Tabelle (verschlüsselt mit SecretBox)
alias               | privateKeyHex (encrypted)
--------------------+---------------------------
<kid>               | <encrypted_data>
```

### Key Zuordnung in identifier Tabelle:

```sql
-- identifier Tabelle
did                                    | controllerKeyId
---------------------------------------+------------------
did:web:nf-a.example.com              | 04526162...
```

### Keys Tabelle mit Relations:

```sql
-- Keys werden über identifier_keys Junction Table verbunden
-- Dies erlaubt mehrere Keys pro DID
```

## Context URLs für DID Documents

Wenn du X25519 nutzt, füge diesen Context hinzu:

```json
"@context": [
  "https://www.w3.org/ns/did/v1",
  "https://w3id.org/security/v2",
  "https://w3id.org/security/suites/x25519-2019/v1"  ← Für X25519
]
```

## Unterschied: Multibase vs Hex

X25519 Public Keys können in verschiedenen Formaten dargestellt werden:

### Hex (was Veramo nutzt):
```json
"publicKeyHex": "a7f4c9e2d8b1f3c4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8"
```

### Multibase (z.B. base58btc):
```json
"publicKeyMultibase": "z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH"
```

**Veramo verwendet `publicKeyHex`**, was einfacher zu handhaben ist.

## Testing KeyAgreement

### Mit Veramo CLI:

```bash
# Test ECDH key agreement
veramo execute -m keyManagerSharedSecret --argsJSON '{
  "secretKeyRef": "did:web:nf-a.example.com#key-agreement",
  "publicKey": {
    "kid": "did:web:nf-b.example.com#key-agreement",
    "type": "X25519",
    "publicKeyHex": "..."
  }
}'
```

### Mit DIDComm:

```typescript
// authcrypt nutzt automatisch keyAgreement Keys
const message = await agent.packDIDCommMessage({
  packing: 'authcrypt',  // ← verwendet X25519
  message: {
    type: 'test',
    from: 'did:web:nf-a.example.com',
    to: ['did:web:nf-b.example.com'],
    body: { test: 'data' }
  }
})
```

## Fehlersuche

### Error: "No keyAgreement keys found"
→ X25519 Key fehlt in DID Document oder nicht in keyAgreement Sektion

### Error: "Unable to decrypt message"
→ Falscher Key, oder Private Key fehlt im DataStore

### Error: "Invalid key type for keyAgreement"
→ Secp256k1/Ed25519 kann nicht für KeyAgreement verwendet werden

## Weitere Ressourcen

- DIDComm v2 Spec: https://identity.foundation/didcomm-messaging/spec/
- X25519 RFC: https://tools.ietf.org/html/rfc7748
- DID Spec Registries: https://www.w3.org/TR/did-spec-registries/
- Veramo Docs: https://veramo.io/docs/basics/identifiers
