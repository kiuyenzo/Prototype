
# neu machen


📋 Was fehlt für deinen Prototyp:
✅ VORHANDEN:
✅ DIDs (did:web) auf GitHub Pages
✅ Verifiable Credentials (VCs)
✅ VC Verification
✅ DIDComm Messaging (Basis vorhanden)
✅ Istio Gateway Configs
✅ mTLS Konfiguration

❌ FEHLT:
1. Verifiable Presentations (VP) + Presentation Exchange
❌ VP erstellen mit @veramo/selective-disclosure
❌ Presentation Definition (PD) definieren
❌ VP Verification implementieren

Presentations (VP):
✅ Werden on-demand erstellt
✅ NICHT dauerhaft gespeichert
✅ Jedes Mal neu wenn angefordert
📤 Wie "Ausweis vorzeigen" - passiert live

installieren: npm list @veramo/core @veramo/credential-w3c @veramo/selective-disclosure 2>&1 | head -20

npm install @sphereon/pex 2>&1 | tail -10


package.json auf ESM umstellen:


📦 Was erstellt wurde:

1. presentation-definitions.ts
✅ PD_A: Was NF-A von NF-B fordert
✅ PD_B: Was NF-B von NF-A fordert
✅ TypeScript Interfaces für Presentation Definitions

2. vp-creation.ts
✅ createVerifiablePresentation() - VP erstellen
✅ verifyVerifiablePresentation() - VP verifizieren
✅ selectCredentialsForPD() - Credentials für PD auswählen
✅ createVPFromPD() - Hauptfunktion für Presentation Exchange
✅ verifyVPAgainstPD() - VP gegen PD verifizieren

3. test-vp-flow.ts
✅ Kompletter Test des Mutual Authentication Flows
✅ Phase 1-5: Von Auth-Request bis zu beiden verifizierten VPs

🚀 Wie du es testest:
# TypeScript kompilieren und ausführen
npx ts-node test-vp-flow.ts
Oder wenn du ts-node installieren musst:
npm install -g ts-node typescript
ts-node test-vp-flow.ts

✅ Was jetzt funktioniert:
✅ Presentation Definitions sind definiert
✅ VP Creation basierend auf PDs
✅ VP Verification gegen PDs
✅ Credential Selection (Presentation Exchange)
✅ Mutual Authentication Flow implementiert
Sollen wir das jetzt testen? 🧪


test-vp-flow.ts
klappt nicht weil did b erstellt werden muss 
nutze pd package




2. Vollständiger Auth-Flow
❌ VP_Auth_Request senden (mit PD_A)
❌ VP_B basierend auf PD_A erstellen
❌ VP_A basierend auf PD_B erstellen
❌ Mutual Authentication Logik

3. Envoy Proxy Integration
❌ Envoy Proxy Container in NF Pods
❌ HTTP/2 Forwarding zu Envoy Gateway
❌ DIDComm über Envoy routen

4. NF Services (Mock)
❌ NF_A Service (kann einfacher HTTP Server sein)
❌ NF_B Service
❌ Integration: Veramo ↔ NF

5. End-to-End Flow
❌ Kompletter Ablauf von Phase 1 → Phase 3
❌ Session Management nach Auth
❌ Service Request/Response nach Authorization















# alt
# Phase 5 – Veramo Agent Integration

**Ziel:** Integration des echten Veramo Agents in die bestehende Istio-Infrastruktur mit DIDComm-Support.

## Überblick

Phase 5 ersetzt die Mock-Container durch einen vollständigen Veramo Agent, der:
- DIDComm-Nachrichten verarbeiten kann
- DIDs erstellen und verwalten kann
- Verifiable Credentials ausstellen und verifizieren kann
- Über Istio mTLS sicher kommuniziert

## Architektur

```
┌─────────────────────────────────────────────────────────┐
│ Cluster A                                               │
│                                                         │
│  ┌────────────────────────────────────────────────┐    │
│  │ Pod: nf-a                                      │    │
│  │  ┌──────────────┐  ┌──────────────────────┐   │    │
│  │  │ nf-a-app     │  │ veramo-nf-a          │   │    │
│  │  │ (nginx)      │──│ (Veramo Agent)       │   │    │
│  │  │              │  │ - Port 7001          │   │    │
│  │  │              │  │ - DIDComm endpoint   │   │    │
│  │  │              │  │ - SQLite DB          │   │    │
│  │  └──────────────┘  └──────────────────────┘   │    │
│  │         │                    │                 │    │
│  │         └────────────────────┴─────────────────│────│─── Istio-Proxy (mTLS)
│  └────────────────────────────────────────────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
                            │
                    Istio mTLS via
                    Gateway PASSTHROUGH
                            │
┌─────────────────────────────────────────────────────────┐
│ Cluster B                                               │
│                                                         │
│  ┌────────────────────────────────────────────────┐    │
│  │ Pod: nf-b                                      │    │
│  │  ┌──────────────┐  ┌──────────────────────┐   │    │
│  │  │ nf-b-app     │  │ veramo-nf-b          │   │    │
│  │  │ (nginx)      │──│ (Veramo Agent)       │   │    │
│  │  │              │  │ - Port 7001          │   │    │
│  │  │              │  │ - DIDComm endpoint   │   │    │
│  │  │              │  │ - SQLite DB          │   │    │
│  │  └──────────────┘  └──────────────────────┘   │    │
│  │         │                    │                 │    │
│  │         └────────────────────┴─────────────────│────│─── Istio-Proxy (mTLS)
│  └────────────────────────────────────────────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Komponenten

### 1. Veramo Agent Konfiguration

**Cluster A:** [agent-nf-a.yml](cluster-a/agent-nf-a.yml)
- baseUrl: `https://didcomm.nf-a.cluster-a.global`
- Port: 7001
- DIDComm Endpoint: `/didcomm`
- API Endpoint: `/agent`

**Cluster B:** [agent-nf-b.yml](cluster-b/agent-nf-b.yml)
- baseUrl: `https://didcomm.nf-b.cluster-b.global`
- Port: 7001
- DIDComm Endpoint: `/didcomm`
- API Endpoint: `/agent`

### 2. Veramo Agent Features

**DID Support:**
- ✅ did:web (Standard für Web-basierte DIDs)
- ✅ did:key (Kryptografische Schlüssel als DIDs)
- ✅ did:peer (Peer-to-Peer DIDs für DIDComm)

**DIDComm Support:**
- ✅ DIDComm v2 Message Handler
- ✅ Pack/Unpack DIDComm Messages
- ✅ Send DIDComm Messages
- ✅ Encrypted Message Support (authcrypt)

**Credential Support:**
- ✅ Create Verifiable Credentials (W3C Standard)
- ✅ Verify Credentials
- ✅ Create Verifiable Presentations
- ✅ JSON-LD Signatures

**Data Storage:**
- ✅ SQLite Database (persistent via PVC)
- ✅ Encrypted Key Storage
- ✅ DID Storage
- ✅ Message Storage
- ✅ Credential Storage

### 3. Kubernetes Resources

**ConfigMaps:**
- `veramo-config`: Allgemeine Konfiguration (DIDCOMM_PACKING_MODE)
- `veramo-agent-config`: Veramo Agent YAML-Konfiguration

**PersistentVolumeClaim:**
- `veramo-data-nf-a`: 1Gi für Cluster A
- `veramo-data-nf-b`: 1Gi für Cluster B
- Speichert SQLite-Datenbank persistent

**Deployments:**
- [nf-a-veramo.yaml](cluster-a/nf-a-veramo.yaml)
- [nf-b-veramo.yaml](cluster-b/nf-b-veramo.yaml)

**Container:**
- `nf-a-app` / `nf-b-app`: nginx (Applikations-Layer)
- `veramo-nf-a` / `veramo-nf-b`: Veramo Agent (veramolabs/veramo-agent:latest)

### 4. Health Checks

**Liveness Probe:**
- HTTP GET auf Port 7001
- Initial Delay: 30s
- Period: 10s

**Readiness Probe:**
- HTTP GET auf Port 7001
- Initial Delay: 10s
- Period: 5s

### 5. Istio Integration

**Sidecar Injection:**
- ✅ Automatisch via `istio-injection=enabled` Label
- ✅ Istio-Proxy läuft neben Veramo Agent

**mTLS:**
- ✅ STRICT Mode (nur mTLS erlaubt)
- ✅ ISTIO_MUTUAL zwischen Services
- ✅ Zero Trust Policy aktiv

**Routing:**
- ✅ Gateway PASSTHROUGH für DIDComm
- ✅ SNI-basiertes Routing via Istio
- ✅ Cross-Cluster Routing via ServiceEntries

## Deployment

### Schritt 1: Deploy auf Cluster A

```bash
# Wechsel zu Cluster A
kubectl config use-context kind-cluster-a

# Deploy Veramo Agent
kubectl apply -f cluster-a/nf-a-veramo.yaml

# Überprüfen
kubectl get pods -n nf-a-namespace
kubectl logs -n nf-a-namespace <pod-name> -c veramo-nf-a
```

### Schritt 2: Deploy auf Cluster B

```bash
# Wechsel zu Cluster B
kubectl config use-context kind-cluster-b

# Deploy Veramo Agent
kubectl apply -f cluster-b/nf-b-veramo.yaml

# Überprüfen
kubectl get pods -n nf-b-namespace
kubectl logs -n nf-b-namespace <pod-name> -c veramo-nf-b
```

### Schritt 3: Verifikation

```bash
# Test Veramo Agent API (Cluster A)
kubectl config use-context kind-cluster-a
kubectl port-forward -n nf-a-namespace svc/veramo-nf-a 7001:7001

# In anderem Terminal:
curl http://localhost:7001/

# Test DIDComm Endpoint
curl http://localhost:7001/didcomm
```

## API Endpoints

### DIDComm Messaging

**Endpoint:** `POST /didcomm`
- Empfängt DIDComm-Nachrichten
- Verarbeitet via DIDCommMessageHandler
- Unterstützt encrypted/authcrypt Messages

### Agent API

**Endpoint:** `POST /agent`
- Vollständige Veramo Agent API
- Authentifizierung: API Key (test123)
- Methoden:
  - `didManagerCreate`: DID erstellen
  - `keyManagerCreate`: Kryptografische Schlüssel erstellen
  - `packDIDCommMessage`: DIDComm Message packen
  - `sendDIDCommMessage`: DIDComm Message senden
  - `createVerifiableCredential`: VC ausstellen
  - `verifyCredential`: VC verifizieren

### DID Document

**Endpoint:** `GET /.well-known/did.json`
- Stellt DID Document bereit
- Automatisch generiert via WebDidDocRouter
- Enthält DIDComm ServiceEndpoint

## DIDComm Flow

### 1. Message Creation (NF-A)

```javascript
// In NF-A Pod
const message = await agent.packDIDCommMessage({
  packing: 'authcrypt',
  message: {
    type: 'https://example.com/protocols/hello/1.0/message',
    to: ['did:web:didcomm.nf-b.cluster-b.global'],
    from: 'did:web:didcomm.nf-a.cluster-a.global',
    body: { greeting: 'Hello from NF-A!' }
  }
});
```

### 2. Message Transmission

```
NF-A (veramo-nf-a:7001)
  → Istio-Sidecar (mTLS)
    → Istio Egress Gateway
      → [Network via Gateway PASSTHROUGH]
        → Istio Ingress Gateway
          → Istio-Sidecar (mTLS)
            → NF-B (veramo-nf-b:7001/didcomm)
```

### 3. Message Handling (NF-B)

```javascript
// In NF-B Pod - automatisch via MessagingRouter
// DIDCommMessageHandler empfängt und entpackt Message
const unpacked = await agent.unpackDIDCommMessage({ message });
// Message wird verarbeitet
```

## Security Features

### Transport Layer Security

- ✅ Istio mTLS (STRICT Mode)
- ✅ TLS 1.3
- ✅ Gateway PASSTHROUGH (keine TLS-Terminierung)
- ✅ Zero Trust AuthorizationPolicy

### Application Layer Security

- ✅ DIDComm authcrypt (End-to-End Encryption)
- ✅ Encrypted Key Storage (SecretBox)
- ✅ API Key Authentication
- ✅ DID-basierte Authentifizierung

### Combined Security Model

```
┌─────────────────────────────────────────────┐
│ DIDComm Layer (E2E Encrypted)               │
│  - authcrypt via sender/receiver DID keys   │
│  - Application-level encryption             │
└─────────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────────┐
│ Istio mTLS Layer (Transport Security)       │
│  - STRICT mTLS between all services         │
│  - TLS 1.3 with ISTIO_MUTUAL               │
│  - Zero Trust policies                      │
└─────────────────────────────────────────────┘
```

**Doppelte Verschlüsselung:**
1. DIDComm authcrypt auf Anwendungsebene
2. Istio mTLS auf Transportebene

## Nächste Schritte

### Option 1: Lokales Testen
- Port-Forward zu Veramo Agents
- Test DIDComm Message Exchange
- Test VC Issuance und Verification

### Option 2: GCP Deployment
- Cluster zu GKE migrieren
- DNS für `didcomm.nf-*.cluster-*.global` konfigurieren
- Load Balancer für Ingress Gateway
- Externe TLS-Zertifikate (Let's Encrypt)

### Option 3: Advanced Features
- Multi-Cluster Service Mesh (Istio)
- DIDComm Mediator implementieren
- Credential Revocation implementieren
- DID Registry Service

## Status

✅ **Phase 5 - Vorbereitung abgeschlossen:**

- [x] Dockerfile für Veramo Agent erstellt
- [x] Agent-Konfiguration für NF-A
- [x] Agent-Konfiguration für NF-B
- [x] Kubernetes Deployments erstellt
- [x] ConfigMaps konfiguriert
- [x] PersistentVolumeClaims definiert
- [x] Health Checks implementiert
- [x] Istio Integration vorbereitet

**Bereit für Deployment und Testing!**

## Troubleshooting

### Pod startet nicht
```bash
kubectl describe pod -n nf-a-namespace <pod-name>
kubectl logs -n nf-a-namespace <pod-name> -c veramo-nf-a
```

### Veramo Agent nicht erreichbar
```bash
# Check Service
kubectl get svc -n nf-a-namespace veramo-nf-a

# Check Endpoints
kubectl get endpoints -n nf-a-namespace veramo-nf-a

# Port-Forward Test
kubectl port-forward -n nf-a-namespace svc/veramo-nf-a 7001:7001
curl http://localhost:7001/
```

### Database Probleme
```bash
# Check PVC
kubectl get pvc -n nf-a-namespace

# Check Volume Mount
kubectl describe pod -n nf-a-namespace <pod-name> | grep -A 5 "Mounts:"
```

### Istio Integration Probleme
```bash
# Check Sidecar Injection
kubectl get pod -n nf-a-namespace <pod-name> -o jsonpath='{.spec.containers[*].name}'
# Should include: istio-proxy

# Check mTLS
kubectl exec -n nf-a-namespace <pod-name> -c istio-proxy -- curl -s localhost:15000/clusters | grep "veramo"
```
