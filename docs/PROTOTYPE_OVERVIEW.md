# DIDComm v2 + Istio Service Mesh Prototype

## Überblick

Dieser Prototype demonstriert eine **Zero-Trust-Architektur** für 5G Network Functions (NF) mit:
- **DIDComm v2** für sichere Kommunikation zwischen NFs
- **Verifiable Presentations (VP)** für Autorisierung
- **Istio Service Mesh** für mTLS und Traffic Management
- **Sidecar Pattern** (3 Container pro Pod)

---

## Architektur Diagramm

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CLUSTER-A (Kind)                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                        nf-a-namespace                                    │    │
│  │  ┌─────────────────────────────────────────────────────────────────┐    │    │
│  │  │                         POD: nf-a                                │    │    │
│  │  │  ┌──────────────┐  localhost  ┌──────────────────┐              │    │    │
│  │  │  │  nf-service  │ ◄─────────► │  veramo-sidecar  │              │    │    │
│  │  │  │  (Port 3000) │   :3000     │   (Port 3001)    │              │    │    │
│  │  │  │              │             │                  │              │    │    │
│  │  │  │  Business    │             │  - DIDComm       │              │    │    │
│  │  │  │  Logic       │             │  - VP Auth       │              │    │    │
│  │  │  │              │             │  - Encryption    │              │    │    │
│  │  │  └──────────────┘             └────────┬─────────┘              │    │    │
│  │  │                                        │                         │    │    │
│  │  │                               ┌────────▼─────────┐              │    │    │
│  │  │                               │   istio-proxy    │              │    │    │
│  │  │                               │   (Envoy)        │              │    │    │
│  │  │                               │   - mTLS         │              │    │    │
│  │  │                               │   - Routing      │              │    │    │
│  │  │                               └────────┬─────────┘              │    │    │
│  │  └────────────────────────────────────────┼────────────────────────┘    │    │
│  └───────────────────────────────────────────┼─────────────────────────────┘    │
│                                              │                                   │
│  ┌───────────────────────────────────────────▼─────────────────────────────┐    │
│  │                    Istio Ingress Gateway                                 │    │
│  │                    (NodePort: 32514/32236)                              │    │
│  └───────────────────────────────────────────┬─────────────────────────────┘    │
└──────────────────────────────────────────────┼──────────────────────────────────┘
                                               │
                                          mTLS │ (Gateway ↔ Gateway)
                                               │
┌──────────────────────────────────────────────┼──────────────────────────────────┐
│                              CLUSTER-B (Kind)│                                   │
│  ┌───────────────────────────────────────────▼─────────────────────────────┐    │
│  │                    Istio Ingress Gateway                                 │    │
│  │                    (NodePort: 31696/30392)                              │    │
│  └───────────────────────────────────────────┬─────────────────────────────┘    │
│                                              │                                   │
│  ┌───────────────────────────────────────────┼─────────────────────────────┐    │
│  │                        nf-b-namespace     │                              │    │
│  │  ┌────────────────────────────────────────┼────────────────────────┐    │    │
│  │  │                         POD: nf-b      │                         │    │    │
│  │  │                               ┌────────▼─────────┐              │    │    │
│  │  │                               │   istio-proxy    │              │    │    │
│  │  │                               │   (Envoy)        │              │    │    │
│  │  │                               └────────┬─────────┘              │    │    │
│  │  │                                        │                         │    │    │
│  │  │  ┌──────────────┐  localhost  ┌────────▼─────────┐              │    │    │
│  │  │  │  nf-service  │ ◄─────────► │  veramo-sidecar  │              │    │    │
│  │  │  │  (Port 3000) │   :3000     │   (Port 3001)    │              │    │    │
│  │  │  └──────────────┘             └──────────────────┘              │    │    │
│  │  └─────────────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Security Modi: V1 vs V4a

### Vergleich

```
┌────────────────────┬─────────────────────────┬─────────────────────────┐
│     Segment        │          V1             │          V4a            │
├────────────────────┼─────────────────────────┼─────────────────────────┤
│ DIDComm Format     │ JWE (E2E encrypted)     │ JWS (signed only)       │
│                    │ authcrypt               │ jws                     │
├────────────────────┼─────────────────────────┼─────────────────────────┤
│ Pod ↔ Gateway      │ TCP (plain)             │ mTLS (STRICT)           │
│                    │ PERMISSIVE              │                         │
├────────────────────┼─────────────────────────┼─────────────────────────┤
│ Gateway ↔ Gateway  │ mTLS                    │ mTLS                    │
├────────────────────┼─────────────────────────┼─────────────────────────┤
│ Vertraulichkeit    │ DIDComm (E2E)           │ Istio mTLS              │
├────────────────────┼─────────────────────────┼─────────────────────────┤
│ Use Case           │ Zero-Trust              │ Trust Mesh              │
│                    │ (Mesh nicht vertraut)   │ (Mesh vertraut)         │
└────────────────────┴─────────────────────────┴─────────────────────────┘
```

### V1: E2E Encrypted (Zero-Trust)

```
NF-A                    Envoy-A        Gateway-A      Gateway-B        Envoy-B                    NF-B
  │                        │              │              │                │                        │
  │  ┌─────────────────┐   │              │              │                │   ┌─────────────────┐  │
  │  │ JWE Encrypted   │   │              │              │                │   │ JWE Encrypted   │  │
  │  │ (1096 bytes)    │   │              │              │                │   │ (1096 bytes)    │  │
  │  └─────────────────┘   │              │              │                │   └─────────────────┘  │
  │                        │              │              │                │                        │
  ├───────TCP (plain)──────►              │              │                ◄────────TCP (plain)─────┤
  │                        ├─────mTLS─────►              ◄──────mTLS──────┤                        │
  │                        │              ├─────mTLS─────┤                │                        │
  │                        │              │              │                │                        │
  │                     PERMISSIVE     mTLS           mTLS            PERMISSIVE                   │
  │                                                                                                │
  └────────────────────────────────── E2E Encrypted ──────────────────────────────────────────────►
```

### V4a: Signed Only (Trust Mesh)

```
NF-A                    Envoy-A        Gateway-A      Gateway-B        Envoy-B                    NF-B
  │                        │              │              │                │                        │
  │  ┌─────────────────┐   │              │              │                │   ┌─────────────────┐  │
  │  │ JWS Signed      │   │              │              │                │   │ JWS Signed      │  │
  │  │ (847 bytes)     │   │              │              │                │   │ (847 bytes)     │  │
  │  └─────────────────┘   │              │              │                │   └─────────────────┘  │
  │                        │              │              │                │                        │
  ├────────mTLS────────────►              │              │                ◄─────────mTLS──────────┤
  │                        ├─────mTLS─────►              ◄──────mTLS──────┤                        │
  │                        │              ├─────mTLS─────┤                │                        │
  │                        │              │              │                │                        │
  │                      STRICT        mTLS           mTLS             STRICT                      │
  │                                                                                                │
  └────────────────────────────────── mTLS Encrypted ─────────────────────────────────────────────►
```

---

## Sequenzdiagramm: VP-Authentifizierter Service Request

```
┌───────┐     ┌────────────┐     ┌─────────┐     ┌─────────┐     ┌────────────┐     ┌───────┐
│ NF-A  │     │ Veramo-A   │     │ Envoy-A │     │ Envoy-B │     │ Veramo-B   │     │ NF-B  │
└───┬───┘     └─────┬──────┘     └────┬────┘     └────┬────┘     └─────┬──────┘     └───┬───┘
    │               │                 │               │                │               │
    │ 1. Service    │                 │               │                │               │
    │    Request    │                 │               │                │               │
    ├──────────────►│                 │               │                │               │
    │               │                 │               │                │               │
    │               │ 2. Resolve DID  │               │                │               │
    │               │    (did:web)    │               │                │               │
    │               ├────────────────►│ GitHub Pages  │                │               │
    │               │◄────────────────┤               │                │               │
    │               │                 │               │                │               │
    │               │ 3. Create VP    │               │                │               │
    │               │    Request      │               │                │               │
    │               │    + Pack JWE   │               │                │               │
    │               │                 │               │                │               │
    │               │ 4. DIDComm      │               │                │               │
    │               ├────────────────►│               │                │               │
    │               │                 ├──────────────►│                │               │
    │               │                 │               ├───────────────►│               │
    │               │                 │               │                │               │
    │               │                 │               │                │ 5. Unpack JWE │
    │               │                 │               │                │    Verify VP  │
    │               │                 │               │                │    Request    │
    │               │                 │               │                │               │
    │               │                 │               │                │ 6. Create VP  │
    │               │                 │               │                │    Response   │
    │               │                 │               │                ├──────────────►│
    │               │                 │               │                │               │
    │               │                 │               │                │ 7. Forward    │
    │               │                 │               │                │    Service Req│
    │               │                 │               │                │◄──────────────┤
    │               │                 │               │                │               │
    │               │                 │               │                │ 8. Service    │
    │               │                 │               │                │    Response   │
    │               │                 │               │◄───────────────┤               │
    │               │                 │◄──────────────┤                │               │
    │               │◄────────────────┤               │                │               │
    │               │                 │               │                │               │
    │ 9. Response   │                 │               │                │               │
    │◄──────────────┤                 │               │                │               │
    │               │                 │               │                │               │
```

---

## Container Architektur (Sidecar Pattern)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              POD                                         │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                     Container 1: nf-service                        │ │
│  │                        (Port 3000)                                 │ │
│  │  ┌──────────────────────────────────────────────────────────────┐  │ │
│  │  │  - Business Logic                                             │  │ │
│  │  │  - Initiiert Service Requests                                 │  │ │
│  │  │  - Empfängt Service Responses                                 │  │ │
│  │  │  - KEINE Crypto/Auth Logik                                    │  │ │
│  │  └──────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                          localhost:3000                                  │
│                                    │                                     │
│  ┌────────────────────────────────▼───────────────────────────────────┐ │
│  │                     Container 2: veramo-sidecar                    │ │
│  │                        (Port 3001)                                 │ │
│  │  ┌──────────────────────────────────────────────────────────────┐  │ │
│  │  │  - DIDComm v2 Messaging                                       │  │ │
│  │  │  - VP Authentication                                          │  │ │
│  │  │  - DID Resolution (did:web)                                   │  │ │
│  │  │  - JWE Encryption / JWS Signing                               │  │ │
│  │  │  - Session Management                                         │  │ │
│  │  │  - Credential Storage (SQLite)                                │  │ │
│  │  └──────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                              Port 3001                                   │
│                                    │                                     │
│  ┌────────────────────────────────▼───────────────────────────────────┐ │
│  │                     Container 3: istio-proxy                       │ │
│  │                        (Envoy - auto-injected)                     │ │
│  │  ┌──────────────────────────────────────────────────────────────┐  │ │
│  │  │  - mTLS Termination                                           │  │ │
│  │  │  - Traffic Routing                                            │  │ │
│  │  │  - Load Balancing                                             │  │ │
│  │  │  - Observability (Metrics, Tracing)                           │  │ │
│  │  └──────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## DID & Credential Struktur

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DID Documents (GitHub Pages)                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a                │
│  ├── verificationMethod                                                  │
│  │   ├── Ed25519VerificationKey2020  (Signing)                          │
│  │   └── X25519KeyAgreementKey2020   (Encryption)                       │
│  ├── authentication                                                      │
│  ├── keyAgreement                                                        │
│  └── service                                                             │
│      └── DIDCommMessaging → endpoint                                     │
│                                                                          │
│  did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b                │
│  └── (gleiche Struktur)                                                  │
│                                                                          │
│  did:web:kiuyenzo.github.io:Prototype:dids:did-issuer            │
│  └── Issuer für Cluster-A Credentials                                    │
│                                                                          │
│  did:web:kiuyenzo.github.io:Prototype:dids:did-issuer            │
│  └── Issuer für Cluster-B Credentials                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                      Verifiable Credential                               │
├─────────────────────────────────────────────────────────────────────────┤
│  {                                                                       │
│    "@context": ["https://www.w3.org/2018/credentials/v1"],              │
│    "type": ["VerifiableCredential", "NetworkFunctionCredential"],       │
│    "issuer": "did:web:...did-issuer-a",                                 │
│    "credentialSubject": {                                                │
│      "id": "did:web:...did-nf-a",                                       │
│      "networkFunction": {                                                │
│        "type": "5G-NF",                                                  │
│        "name": "NF-A",                                                   │
│        "cluster": "cluster-a"                                            │
│      }                                                                   │
│    },                                                                    │
│    "proof": { ... }                                                      │
│  }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Istio Konfiguration

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Istio Resources                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Gateway (cluster-a/gateway.yaml)                                        │
│  ├── Akzeptiert eingehenden Traffic auf Port 80/443                     │
│  └── Leitet zu VirtualService weiter                                     │
│                                                                          │
│  VirtualService                                                          │
│  ├── Route: /didcomm/* → veramo-nf-a:3001                               │
│  └── Route: Cross-Cluster → cluster-b.external                          │
│                                                                          │
│  ServiceEntry                                                            │
│  ├── Definiert externe Services (andere Cluster)                        │
│  ├── cluster-b.external → 172.23.0.3:31696/30392                        │
│  └── Ermöglicht Mesh-übergreifende Kommunikation                        │
│                                                                          │
│  DestinationRule                                                         │
│  ├── mTLS Mode für ausgehenden Traffic                                  │
│  └── TLS Settings für externe Services                                  │
│                                                                          │
│  PeerAuthentication (sidecar/istio-mtls-v1.yaml oder v4a.yaml)          │
│  ├── V1: mode: PERMISSIVE (Plain + mTLS akzeptiert)                     │
│  └── V4a: mode: STRICT (Nur mTLS akzeptiert)                            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Projekt Struktur

```
Prototype/
├── cluster-a/                      # Cluster A Konfiguration
│   ├── 01-namespace.yaml           # Kubernetes Namespace
│   ├── deployment.yaml             # Pod Definition (NF + Veramo)
│   ├── gateway.yaml                # Istio Gateway/VirtualService/ServiceEntry
│   ├── kind-cluster-a.yaml         # Kind Cluster Config
│   ├── did-nf-a/did.json           # DID Document für NF-A
│   ├── did-issuer-a/did.json       # DID Document für Issuer-A
│   └── database-nf-a.sqlite        # Veramo Credential Store
│
├── cluster-b/                      # Cluster B Konfiguration
│   └── (gleiche Struktur wie cluster-a)
│
├── sidecar/                        # Sidecar Container Code
│   ├── veramo-sidecar.ts           # Haupt-Sidecar (DIDComm, VP, Crypto)
│   ├── nf-service.ts               # NF Business Logic
│   ├── Dockerfile.veramo-sidecar   # Docker Build für Veramo
│   ├── Dockerfile.nf-service       # Docker Build für NF
│   ├── build-and-deploy.sh         # Build & Deploy Script
│   ├── istio-mtls-v1.yaml          # PeerAuth: PERMISSIVE (V1)
│   ├── istio-mtls-v4a.yaml         # PeerAuth: STRICT (V4a)
│   ├── test-sidecar-flow.sh        # Test Script
│   └── src/                        # Core Module
│       ├── didcomm-encryption.js   # JWE/JWS Pack/Unpack
│       ├── did-resolver-cache.js   # DID Resolution + Cache
│       ├── didcomm-vp-wrapper.js   # VP Request/Response Flow
│       ├── didcomm-messages.js     # DIDComm Message Types
│       ├── presentation-definitions.js  # Presentation Definitions
│       ├── session-manager.js      # Nonce/Session Tracking
│       ├── vp-creation_manuell.js  # VP Erstellung
│       └── create-nf-credentials.js    # Credential Setup
│
├── tests/                          # Test Scripts
├── docs/                           # Dokumentation
├── certs/                          # TLS Zertifikate
├── setup-clusters.sh               # Kind Cluster Setup
└── package.json                    # Node.js Dependencies
```

---

## Quick Start

### 1. Cluster Setup
```bash
./setup-clusters.sh
```

### 2. Build & Deploy
```bash
./sidecar/build-and-deploy.sh
```

### 3. Test
```bash
./sidecar/test-sidecar-flow.sh
```

### 4. Mode Switch (V1 ↔ V4a)
```bash
# Zu V1 (encrypted) wechseln:
sed -i '' 's/value: "signed"/value: "encrypted"/' cluster-a/deployment.yaml cluster-b/deployment.yaml

# Zu V4a (signed) wechseln:
sed -i '' 's/value: "encrypted"/value: "signed"/' cluster-a/deployment.yaml cluster-b/deployment.yaml

# Dann neu deployen:
./sidecar/build-and-deploy.sh
```

---

## Debugging

### Pod Status
```bash
kubectl get pods -n nf-a-namespace -o wide
kubectl get pods -n nf-b-namespace -o wide
```

### Logs
```bash
# Veramo Sidecar Logs
kubectl logs -n nf-a-namespace -l app=nf-a -c veramo-sidecar -f

# NF Service Logs
kubectl logs -n nf-a-namespace -l app=nf-a -c nf-service -f

# Istio Proxy Logs
kubectl logs -n nf-a-namespace -l app=nf-a -c istio-proxy -f
```

### Istio Status
```bash
# mTLS Mode prüfen
kubectl get peerauthentication -A

# Gateway Status
kubectl get gateway,virtualservice,serviceentry -n nf-a-namespace
```

---

## Technologie Stack

| Komponente | Technologie |
|------------|-------------|
| Container Orchestration | Kubernetes (Kind) |
| Service Mesh | Istio 1.24.1 |
| DID Method | did:web (GitHub Pages) |
| DIDComm | Veramo Framework |
| Encryption | JWE (X25519 + XChaCha20-Poly1305) |
| Signing | JWS (Ed25519) |
| Credentials | W3C Verifiable Credentials |
| Database | SQLite (encrypted) |
| Runtime | Node.js 20 |
