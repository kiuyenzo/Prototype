# 🔑 X25519 KeyAgreement für DIDComm authcrypt

## ⚠️ Problem

Deine aktuellen DID Documents haben **leere `keyAgreement` Sektionen**:

```json
"keyAgreement": []  // ← LEER!
```

**Ohne X25519 Keys kann DIDComm authcrypt NICHT funktionieren!**

## ✅ Lösung

Du hast 2 Optionen:

### **Option A: X25519 Keys hinzufügen (für authcrypt)**

Vollständiger Zero-Trust mit E2E-Verschlüsselung.

### **Option B: Mit `jws` (signed) starten**

Schnellerer Start, nur Transport-Security (Istio mTLS).

---

## 📋 Option A: X25519 Keys hinzufügen

### Schritt 1: Check aktuelle Keys

```bash
./scripts/check-keys.sh
```

**Erwartetes Ergebnis:**
```
❌ NO X25519 keys found in NF-A database!
❌ NO X25519 keys found in NF-B database!
```

### Schritt 2: X25519 Keys generieren

```bash
# Stelle sicher, dass du im Prototype-Verzeichnis bist
cd /Users/tanja/Desktop/Prototype

# Installiere Dependencies (falls noch nicht geschehen)
npm install @veramo/core @veramo/key-manager @veramo/kms-local \
  @veramo/did-manager @veramo/did-provider-web @veramo/did-resolver \
  @veramo/data-store typeorm sqlite3 web-did-resolver did-resolver

# Führe das Skript aus
npx ts-node scripts/add-x25519-keys.ts
```

**Das Skript wird:**
1. X25519 Keys für NF-A und NF-B in den Datenbanken erstellen
2. X25519 Keys für Issuer-A und Issuer-B erstellen
3. Die Keys zu den DIDs hinzufügen
4. Die Public Keys ausgeben zum Eintragen in die DID Documents

**Erwartete Ausgabe:**
```
╔══════════════════════════════════════════════════════════╗
║  Adding X25519 Keys for DIDComm authcrypt               ║
╚══════════════════════════════════════════════════════════╝

=== Adding X25519 keys to NF-A ===

Creating X25519 key for NF-A...
✓ X25519 Key created:
  KID: a7f4c9e2d8b1f3c4...
  Type: X25519
  Public Key (hex): a7f4c9e2d8b1f3c4e5a6b7c8d9e0f1a2...

Adding X25519 key to did:web:...:did-nf-a...
✓ Key added to keyAgreement section

...
```

### Schritt 3: DID Documents aktualisieren

Das Skript gibt dir die exakten JSON-Snippets aus. Kopiere sie in deine DID Documents:

#### cluster-a/did-nf-a/did.json

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/v2",
    "https://w3id.org/security/suites/secp256k1recovery-2020/v2",
    "https://w3id.org/security/suites/x25519-2019/v1"
  ],
  "id": "did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a",
  "verificationMethod": [
    {
      "id": "did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a#signing-key",
      "type": "EcdsaSecp256k1VerificationKey2019",
      "controller": "did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a",
      "publicKeyHex": "045261628a70d611fb0d148ddb15ec4ad4b81d8e16fae234a315d3ee8c645eebe5beb3ef84e053bbddc508fe77a1decdf136cb7ce661b7ab7b5c046cd7c1f9673a"
    }
  ],
  "authentication": [
    "did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a#signing-key"
  ],
  "assertionMethod": [
    "did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a#signing-key"
  ],
  "keyAgreement": [
    {
      "id": "did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a#key-agreement",
      "type": "X25519KeyAgreementKey2019",
      "controller": "did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a",
      "publicKeyHex": "REPLACE_WITH_OUTPUT_FROM_SCRIPT"
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

Wiederhole für:
- `cluster-a/did-issuer-a/did.json`
- `cluster-b/did-nf-b/did.json`
- `cluster-b/did-issuer-b/did.json`

### Schritt 4: Verifiziere

```bash
# Check ob Keys jetzt in DB sind
./scripts/check-keys.sh

# Sollte zeigen:
# ✅ X25519 keys found: 2 (für Cluster A)
# ✅ X25519 keys found: 2 (für Cluster B)
```

### Schritt 5: Test authcrypt

```typescript
// In deinem Veramo Agent:
const message = await agent.packDIDCommMessage({
  packing: 'authcrypt',  // ← Sollte jetzt funktionieren!
  message: {
    type: 'test',
    from: 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a',
    to: ['did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b'],
    body: { test: 'Hello encrypted world!' }
  }
})
```

---

## 📋 Option B: Mit `jws` (signed) starten

Falls du **erstmal ohne X25519** testen willst:

### Schritt 1: Ändere DIDCOMM_PACKING_MODE

**cluster-a/nf-a.yaml:**
```yaml
data:
  DIDCOMM_PACKING_MODE: "signed"  # ← Ändern von "encrypted" zu "signed"
```

**cluster-b/nf-b.yaml:**
```yaml
data:
  DIDCOMM_PACKING_MODE: "signed"  # ← Ändern von "encrypted" zu "signed"
```

### Schritt 2: Code anpassen

**didcomm-flow-implementation.ts:**

```typescript
// Zeile 104: Ändere von hardcoded 'authcrypt' zu dynamisch
const packingMode = process.env.DIDCOMM_PACKING_MODE === 'encrypted'
  ? 'authcrypt'
  : 'jws'

const message = await agent.packDIDCommMessage({
  packing: packingMode,  // ← Dynamisch
  message: {
    type: 'https://didcomm.org/present-proof/3.0/request-presentation',
    from: myDID,
    to: [nfBDID],
    // ...
  }
})
```

Wiederhole für alle `packDIDCommMessage` Aufrufe in:
- Zeile 104
- Zeile 249
- Zeile 332
- Zeile 456
- Zeile 575
- Zeile 642

### Schritt 3: Deployen

```bash
# Rebuild Container mit neuem Code
docker build -t veramo-nf-a:latest -f cluster-a/Dockerfile .

# Apply configs
kubectl apply -f cluster-a/nf-a.yaml
kubectl apply -f cluster-b/nf-b.yaml
```

### Was du mit `jws` bekommst:

✅ **Funktioniert sofort** mit vorhandenen Secp256k1 Keys
✅ **Integrität**: Nachrichten sind signiert
✅ **Authentizität**: Sender ist verifizierbar
✅ **Istio mTLS**: Transport ist verschlüsselt (TLS 1.3)
⚠️ **Keine App-Ebene Verschlüsselung**: Istio/Sidecars könnten Payload sehen

---

## 🔄 Wechsel zwischen Modi

### Von `jws` → `authcrypt`:

1. X25519 Keys hinzufügen (siehe Option A)
2. DID Documents aktualisieren
3. `DIDCOMM_PACKING_MODE: "encrypted"` setzen
4. Pods neu deployen

### Von `authcrypt` → `jws`:

1. `DIDCOMM_PACKING_MODE: "signed"` setzen
2. Pods neu deployen
3. (X25519 Keys können in DB bleiben, werden nur nicht genutzt)

---

## 🛠️ Troubleshooting

### Error: "No keyAgreement keys found"

**Problem:** X25519 Key fehlt in DID Document

**Lösung:**
```bash
# 1. Check ob Key in DB ist
./scripts/check-keys.sh

# 2. Check DID Document
cat cluster-a/did-nf-a/did.json | grep -A5 keyAgreement

# 3. Wenn leer, füge hinzu (siehe Schritt 3 oben)
```

### Error: "Unable to decrypt message"

**Problem:** Falscher Key oder Private Key fehlt

**Lösung:**
```bash
# Check ob Private Key in DB ist
sqlite3 cluster-a/database-nf-a.sqlite \
  "SELECT COUNT(*) FROM 'private-key' WHERE alias IN (SELECT kid FROM key WHERE type='X25519');"

# Sollte > 0 sein
```

### Error: "Invalid key type for keyAgreement"

**Problem:** Versuchst Secp256k1 für KeyAgreement zu nutzen

**Lösung:** Nutze X25519 Keys (siehe Option A)

---

## 📚 Weitere Infos

- **Detailed Guide:** `scripts/generate-x25519-example.md`
- **DID Template:** `scripts/did-document-template.json`
- **Key Check:** `scripts/check-keys.sh`
- **Key Generator:** `scripts/add-x25519-keys.ts`

---

## ✅ Zusammenfassung

| Feature | authcrypt (mit X25519) | jws (nur Signing) |
|---------|------------------------|-------------------|
| **E2E Verschlüsselung** | ✅ Ja | ❌ Nein |
| **Signiert** | ✅ Ja | ✅ Ja |
| **Transport Security** | ✅ Istio mTLS | ✅ Istio mTLS |
| **Payload Inspection** | ❌ Unmöglich | ✅ Möglich (am Sidecar) |
| **Setup Komplexität** | 🔶 Mittel (X25519 Keys) | ✅ Einfach |
| **Zero Trust** | ✅ Vollständig | 🔶 Transport-Layer |
| **Dein Bauplan** | ✅ Variante 1 | ✅ Variante 4a |

**Empfehlung für Production:** authcrypt (mit X25519)
**Empfehlung für Testing:** jws (schneller Start)
