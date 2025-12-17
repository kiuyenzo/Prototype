# Kompakte Zusammenfassung: DIDComm + Istio Prototype

## Was macht dieser Prototype?

**Ziel:** Sichere Kommunikation zwischen 5G Network Functions (NFs) über Cluster-Grenzen hinweg.

**Kernkonzept:** Kombination von:
- **DIDComm v2** → Anwendungsschicht-Sicherheit (Authentifizierung, Autorisierung)
- **Istio mTLS** → Transportschicht-Sicherheit (Verschlüsselung im Mesh)

---

## Die 3 Container pro Pod

```
┌────────────────────────────────────────────────────┐
│  POD                                               │
│  ┌──────────────┐    ┌──────────────────────────┐  │
│  │ nf-service   │◄──►│ veramo-sidecar           │  │
│  │ (Port 3000)  │    │ (Port 3001)              │  │
│  │              │    │                          │  │
│  │ Business     │    │ DIDComm + VP + Crypto    │  │
│  └──────────────┘    └───────────┬──────────────┘  │
│                                  │                 │
│                      ┌───────────▼──────────────┐  │
│                      │ istio-proxy (Envoy)      │  │
│                      │ mTLS + Routing           │  │
│                      └──────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

| Container | Aufgabe |
|-----------|---------|
| **nf-service** | Business Logic, keine Security |
| **veramo-sidecar** | DIDComm, VP-Auth, Encryption |
| **istio-proxy** | mTLS, Routing (auto-injected) |

---

## Zwei Security Modi

### V1: E2E Encrypted (Zero-Trust)
- **DIDComm:** JWE verschlüsselt (authcrypt)
- **Pod ↔ Gateway:** TCP (plain) - PERMISSIVE
- **Gateway ↔ Gateway:** mTLS
- **Vertrauen:** Mesh wird NICHT vertraut

### V4a: Signed Only (Trust Mesh)
- **DIDComm:** JWS signiert (nicht verschlüsselt)
- **Pod ↔ Gateway:** mTLS - STRICT
- **Gateway ↔ Gateway:** mTLS
- **Vertrauen:** Mesh wird vertraut

```
         V1 (encrypted)              V4a (signed)
         ──────────────              ─────────────
NF-A ──TCP──► Envoy ──mTLS──►   NF-A ──mTLS──► Envoy ──mTLS──►
         │                              │
         └── JWE (E2E) ──────────►      └── JWS (signed) ──────►
```

---

## Der Flow (vereinfacht)

```
1. NF-A will Service von NF-B
   │
   ▼
2. Veramo-A: Erstellt VP-Request + verschlüsselt (JWE)
   │
   ▼
3. DIDComm Message → Envoy-A → Gateway-A → Gateway-B → Envoy-B → Veramo-B
   │
   ▼
4. Veramo-B: Entschlüsselt, prüft VP, autorisiert
   │
   ▼
5. NF-B: Führt Business Logic aus
   │
   ▼
6. Response zurück über gleichen Weg
```

---

## Dateien die genutzt werden

```
Prototype/
├── cluster-a/
│   ├── deployment.yaml      # Pod Definition
│   ├── gateway.yaml         # Istio Routing
│   └── did-nf-a/           # DID Document
│
├── cluster-b/
│   └── (gleich wie cluster-a)
│
├── sidecar/
│   ├── veramo-sidecar.ts   # Haupt-Sidecar Code
│   ├── nf-service.ts       # NF Business Logic
│   ├── build-and-deploy.sh # Deploy Script
│   ├── istio-mtls-v1.yaml  # PERMISSIVE Mode
│   ├── istio-mtls-v4a.yaml # STRICT Mode
│   └── src/                # Module
│       ├── didcomm-encryption.js
│       ├── didcomm-vp-wrapper.js
│       └── ...
│
└── setup-clusters.sh       # Cluster Setup
```

---

## Befehle

```bash
# 1. Cluster erstellen
./setup-clusters.sh

# 2. Deployen
./sidecar/build-and-deploy.sh

# 3. Testen
./sidecar/test-sidecar-flow.sh

# 4. Mode wechseln
# V1 → V4a:
sed -i '' 's/"encrypted"/"signed"/' cluster-a/deployment.yaml cluster-b/deployment.yaml
./sidecar/build-and-deploy.sh
```

---

## Kernaussagen

1. **Sidecar Pattern:** NF-Service braucht keine Security-Logik - alles im Veramo-Sidecar

2. **VP-Authentifizierung:** Jeder Request wird mit Verifiable Presentation autorisiert

3. **Flexible Security:** V1 für Zero-Trust (E2E), V4a für Trust-Mesh (mTLS only)

4. **DID Resolution:** did:web über GitHub Pages - dezentrale Identität

5. **Istio Integration:** Nutzt Service Mesh für Routing und Transport-Security
