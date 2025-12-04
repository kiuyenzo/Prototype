# Phase 5 - DIDComm v2 Flow - IMPLEMENTIERT ✅

## Zusammenfassung

**Phase 5 ist vollständig implementiert!** Der komplette DIDComm v2 Mutual Authentication Flow mit Veramo ist lauffähig.

## Was wurde implementiert?

### ✅ Kern-Implementierung

#### 1. **DIDComm Flow Logic** ([veramo-agents/src/didcomm-flow.ts](veramo-agents/src/didcomm-flow.ts))
- **Phase 1: Initial Request**
  - `nfaInitiateServiceRequest()`: NF_A sendet Auth-Request mit SDR
  - DID Resolution
  - Presentation Definition (PD_A) erstellen
  - DIDComm Message packen (authcrypt/jws)

- **Phase 2: Mutual Authentication**
  - `nfaHandlePresentationFromNFB()`: NF_A empfängt VP_B + PD_B
    - Validiert VP_B gegen eigenen SDR
    - Resolved Issuer DID
    - Verifiziert VP_B Signatur
    - Erstellt VP_A basierend auf PD_B
  - `nfbHandleInitialRequestFromNFA()`: NF_B empfängt Request
    - Erstellt VP_B für PD_A
    - Erstellt eigenen SDR (PD_B)
    - Sendet VP_B + PD_B zurück
  - `nfbHandlePresentationFromNFA()`: NF_B empfängt VP_A
    - Validiert VP_A
    - Verifiziert VP_A
    - Markiert Session als "authorized"

- **Phase 3: Service Communication**
  - `nfaSendServiceRequest()`: Sendet Service Request
  - `nfbHandleServiceRequest()`: Empfängt und verarbeitet Request
  - Session-basierte Authorization

#### 2. **Veramo Agent Setup** ([veramo-agents/src/agent-setup.ts](veramo-agents/src/agent-setup.ts))
- Vollständige Veramo Agent Konfiguration
- Plugins:
  - KeyManager (local KMS)
  - DIDManager (did:web, did:key, did:peer)
  - DIDResolver
  - MessageHandler
  - DIDComm
  - CredentialPlugin
  - CredentialIssuerLD
  - SelectiveDisclosure
  - DataStore (SQLite)
- DID Creation & Management
- Test Credential Generation

#### 3. **NF_A Server** ([veramo-agents/src/nf-a/server.ts](veramo-agents/src/nf-a/server.ts))
- Express Server mit REST API
- Endpoints:
  - `GET /.well-known/did.json` - DID Document
  - `POST /didcomm` - DIDComm Messages
  - `POST /api/initiate-service-request` - Start Flow
  - `POST /api/send-service-request` - Service Requests
  - `GET /api/sessions` - Session Management
  - `GET /health` - Health Check
- Automatisches DIDComm Message Routing
- Session Tracking

#### 4. **NF_B Server** ([veramo-agents/src/nf-b/server.ts](veramo-agents/src/nf-b/server.ts))
- Express Server (Responder)
- Endpoints:
  - `GET /.well-known/did.json` - DID Document
  - `POST /didcomm` - DIDComm Messages
  - `GET /api/sessions` - Session Management
  - `GET /health` - Health Check
- Business Logic Integration
- Automatisches Message Processing

#### 5. **Docker Integration**
- [Dockerfile.nf-a](veramo-agents/Dockerfile.nf-a) - NF_A Container
- [Dockerfile.nf-b](veramo-agents/Dockerfile.nf-b) - NF_B Container
- [build-images.sh](veramo-agents/build-images.sh) - Build Script
- Multi-stage Build (TypeScript → Node.js)

#### 6. **Kubernetes Integration**
- Aktualisierte Manifeste:
  - [cluster-a/nf-a.yaml](cluster-a/nf-a.yaml) - Real Veramo Container
  - [cluster-b/nf-b.yaml](cluster-b/nf-b.yaml) - Real Veramo Container
- Environment Variables
- Volume Mounts für Datenbank
- Health Probes (liveness & readiness)
- Alte Placeholder auskommentiert

#### 7. **Test Suite**
- [test-flow.sh](veramo-agents/test-flow.sh) - End-to-End Test
- Testet alle 3 Phasen
- Health Checks
- DID Document Verification
- Session Status Monitoring
- Service Request/Response

## Architektur-Details

### Message Flow

```
Phase 1: Initial Request
========================
NF_A → POST /api/initiate-service-request
  → nfaInitiateServiceRequest()
  → Resolve DID of NF_B
  → Create SDR (PD_A)
  → Pack DIDComm Message (authcrypt)
  → Send to NF_B /didcomm

NF_B → POST /didcomm
  → routeIncomingMessage()
  → nfbHandleInitialRequestFromNFA()
  → Extract PD_A
  → Get Credentials matching PD_A
  → Create VP_B
  → Create SDR (PD_B)
  → Pack DIDComm (VP_B + PD_B)
  → Send to NF_A /didcomm

Phase 2: Mutual Authentication
================================
NF_A → POST /didcomm (receives VP_B + PD_B)
  → nfaHandlePresentationFromNFB()
  → Validate VP_B against PD_A
  → Resolve Issuer DID
  → Verify VP_B signature
  → Get Credentials matching PD_B
  → Create VP_A
  → Pack DIDComm (VP_A)
  → Send to NF_B /didcomm

NF_B → POST /didcomm (receives VP_A)
  → nfbHandlePresentationFromNFA()
  → Validate VP_A against PD_B
  → Verify VP_A signature
  → Mark session as AUTHORIZED
  → Send ACK to NF_A /didcomm

NF_A → POST /didcomm (receives ACK)
  → nfaHandleAuthorizedConfirmation()
  → Mark session as AUTHORIZED
  → Ready for service communication

Phase 3: Service Communication
================================
NF_A → POST /api/send-service-request
  → nfaSendServiceRequest()
  → Check session authorized
  → Pack service request
  → Send to NF_B /didcomm

NF_B → POST /didcomm (service request)
  → nfbHandleServiceRequest()
  → Check session authorized
  → Call business logic
  → Pack service response
  → Send to NF_A /didcomm

NF_A → POST /didcomm (service response)
  → nfaHandleServiceResponse()
  → Process response
  → Return to caller
```

### Session Management

```typescript
interface SessionState {
  sessionId: string
  peerDID: string
  status: 'pending' | 'authenticating' | 'authorized' | 'expired'
  createdAt: Date
  lastActivity: Date
  vpReceived?: any
  sdrSent?: any
  sdrReceived?: any
}
```

Sessions werden in Memory gespeichert (Map).

### DID Structure

**NF_A:**
```
did:web:nf-a.example.com
```

**NF_B:**
```
did:web:nf-b.example.com
```

DID Documents werden automatisch erstellt und unter `/.well-known/did.json` gehostet.

### Verifiable Credentials

Test-Credentials werden beim Start automatisch erstellt:

```json
{
  "@context": ["https://www.w3.org/2018/credentials/v1"],
  "type": ["VerifiableCredential", "NetworkFunctionCredential"],
  "issuer": { "id": "did:web:nf-a.example.com" },
  "credentialSubject": {
    "id": "did:web:nf-a.example.com",
    "role": "network-function",
    "capabilities": ["message-routing", "secure-communication"],
    "name": "Network Function A"
  }
}
```

## Deployment-Optionen

### Option 1: Lokal (ohne Kubernetes)

```bash
cd veramo-agents
npm install
npm run build

# Terminal 1
npm run dev:nf-b

# Terminal 2
npm run dev:nf-a

# Terminal 3
./test-flow.sh
```

### Option 2: Docker (ohne Kubernetes)

```bash
cd veramo-agents
./build-images.sh

docker run -p 7002:7002 \
  -e DID_WEB=did:web:localhost:7002 \
  -e BASE_URL=http://localhost:7002 \
  veramo-nf-b:latest

docker run -p 7001:7001 \
  -e DID_WEB=did:web:localhost:7001 \
  -e BASE_URL=http://localhost:7001 \
  veramo-nf-a:latest
```

### Option 3: Kubernetes mit Istio

```bash
# Build Images
cd veramo-agents
./build-images.sh

# Load into kind clusters
kind load docker-image veramo-nf-a:latest --name cluster-a
kind load docker-image veramo-nf-b:latest --name cluster-b

# Deploy Cluster A
kubectl config use-context cluster-a
kubectl create namespace nf-a-namespace
kubectl label namespace nf-a-namespace istio-injection=enabled
kubectl apply -f ../cluster-a/nf-a.yaml
kubectl apply -f ../cluster-a/istio-*.yaml

# Deploy Cluster B
kubectl config use-context cluster-b
kubectl create namespace nf-b-namespace
kubectl label namespace nf-b-namespace istio-injection=enabled
kubectl apply -f ../cluster-b/nf-b.yaml
kubectl apply -f ../cluster-b/istio-*.yaml

# Verify
kubectl get pods -n nf-a-namespace
kubectl get pods -n nf-b-namespace
```

## Konfiguration

### Packing Modes

**Mode 1: authcrypt (E2E Encrypted)**
```yaml
DIDCOMM_PACKING_MODE: "authcrypt"
```
- App-Ebene: E2E verschlüsselt
- Transport: Istio mTLS
- Gateway: sieht nur Ciphertext

**Mode 2: jws (Signed Only)**
```yaml
DIDCOMM_PACKING_MODE: "jws"
```
- App-Ebene: signiert, nicht verschlüsselt
- Transport: Istio mTLS (Vertraulichkeit)
- Gateway: könnte Payload inspizieren

### Umschalten zur Laufzeit

ConfigMap editieren:
```bash
kubectl edit configmap veramo-config -n nf-a-namespace
```

```yaml
data:
  DIDCOMM_PACKING_MODE: "jws"  # ändern von "authcrypt"
```

Pods neu starten:
```bash
kubectl rollout restart deployment nf-a -n nf-a-namespace
kubectl rollout restart deployment nf-b -n nf-b-namespace
```

## Testing

### Quick Test

```bash
cd veramo-agents

# Start Services
npm run dev:nf-b &
npm run dev:nf-a &

# Wait 5 seconds
sleep 5

# Run Test
./test-flow.sh

# Cleanup
killall node
```

### Detailed Test

```bash
# 1. Health Check
curl http://localhost:7001/health | jq .
curl http://localhost:7002/health | jq .

# 2. Get DID Documents
curl http://localhost:7001/.well-known/did.json | jq .
curl http://localhost:7002/.well-known/did.json | jq .

# 3. Initiate Flow
SESSION=$(curl -s -X POST http://localhost:7001/api/initiate-service-request \
  -H "Content-Type: application/json" \
  -d '{
    "nfBDID": "did:web:localhost:7002",
    "serviceRequest": {"action": "test", "data": "Hello"}
  }' | jq -r '.sessionId')

echo "Session ID: $SESSION"

# 4. Wait for mutual auth
sleep 5

# 5. Check session status
curl http://localhost:7001/api/sessions/$SESSION | jq .
curl http://localhost:7002/api/sessions/$SESSION | jq .

# 6. Send service request
curl -X POST http://localhost:7001/api/send-service-request \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\": \"$SESSION\",
    \"serviceRequest\": {\"action\": \"query\", \"data\": \"Production data\"}
  }" | jq .

# 7. View all sessions
curl http://localhost:7001/api/sessions | jq .
curl http://localhost:7002/api/sessions | jq .
```

## Logs & Monitoring

### Struktur der Logs

```
[NF_A] Phase 1: Initiating service request to did:web:nf-b.example.com
[NF_A] Resolved DID Document: did:web:nf-b.example.com
[NF_A] Created SDR
[NF_A] Packed DIDComm message with mode: authcrypt
[NF_A] Sent DIDComm message to NF_B

[NF_B] Phase 1: Received initial request from NF_A
[NF_B] Received SDR from NF_A: did:web:nf-a.example.com
[NF_B] Found 1 credentials matching PD_A
[NF_B] Created VP_B
[NF_B] Created SDR for NF_A
[NF_B] Sent VP_B + PD_B to NF_A

[NF_A] Phase 2a: Received presentation from NF_B
[NF_A] VP_B validation successful
[NF_A] Resolved Issuer DID: did:web:nf-b.example.com
[NF_A] VP_B verified successfully
[NF_A] Found 1 credentials matching PD_B
[NF_A] Created VP_A
[NF_A] Sent VP_A to NF_B

[NF_B] Phase 2b: Received VP_A from NF_A
[NF_B] VP_A validation successful
[NF_B] Resolved Issuer DID: did:web:nf-a.example.com
[NF_B] VP_A verified successfully
[NF_B] MUTUAL AUTHENTICATION COMPLETE
[NF_B] Sent authorized confirmation to NF_A

[NF_A] Phase 3: Received authorized confirmation
[NF_A] Session session-xxx is now AUTHORIZED
[NF_A] Ready to send service requests to did:web:nf-b.example.com
```

### Kubernetes Logs

```bash
# Live logs
kubectl logs -n nf-a-namespace -l app=nf-a -c veramo-nf-a -f
kubectl logs -n nf-b-namespace -l app=nf-b -c veramo-nf-b -f

# Previous logs (if pod crashed)
kubectl logs -n nf-a-namespace -l app=nf-a -c veramo-nf-a --previous
```

## Dateien-Übersicht

### Neu erstellt:

```
veramo-agents/
├── src/
│   ├── agent-setup.ts              ✅ Veramo Agent Config
│   ├── didcomm-flow.ts             ✅ DIDComm Flow Implementation
│   ├── nf-a/
│   │   └── server.ts               ✅ NF_A Server
│   └── nf-b/
│       └── server.ts               ✅ NF_B Server
├── package.json                    ✅ Dependencies
├── tsconfig.json                   ✅ TypeScript Config
├── Dockerfile.nf-a                 ✅ Docker Image für NF_A
├── Dockerfile.nf-b                 ✅ Docker Image für NF_B
├── build-images.sh                 ✅ Build Script
├── test-flow.sh                    ✅ Test Script
├── README.md                       ✅ Dokumentation
└── .gitignore                      ✅ Git Ignore

```

### Aktualisiert:

```
cluster-a/
└── nf-a.yaml                       ✅ Real Veramo Container

cluster-b/
└── nf-b.yaml                       ✅ Real Veramo Container
```

## Nächste Schritte

### ✅ Phase 5 - KOMPLETT

Was jetzt noch fehlt (andere Phasen):

### 🔴 Kritisch (Phase 2):
1. **Issuer-Agent implementieren**
   - Separater Service für VC-Ausstellung
   - did:web:issuer.example.com
   - Issuer DID Document hosten
   - VC-Ausstellung für NF_A und NF_B

2. **DID Web Hosting (Phase 2)**
   - Ingress/VirtualService für `.well-known/did.json`
   - DNS/Hosts Konfiguration
   - HTTPS Setup

### ⚠️ Nice-to-Have (Phase 3):
3. **SD-JWT Integration**
   - Sphereon Plugin
   - Selective Disclosure in VPs
   - SD-JWT-VC statt JWT-VC

4. **Presentation Exchange 2.0**
   - DIF PE 2.0 statt Veramo SDR
   - Input Descriptors
   - Submission Requirements

5. **Production-Ready Features**
   - Persistent Sessions (Redis)
   - Better Error Handling
   - Retry Logic
   - Metrics & Monitoring

## Status-Matrix

| Feature | Status | Notes |
|---------|--------|-------|
| DIDComm v2 Flow | ✅ | Alle 3 Phasen implementiert |
| Veramo Integration | ✅ | Vollständig konfiguriert |
| did:web Support | ✅ | DID Documents werden gehostet |
| Mutual Authentication | ✅ | VP Exchange funktioniert |
| Session Management | ✅ | In-Memory Sessions |
| JWT-VC | ✅ | Test-Credentials werden erstellt |
| Veramo SDR | ✅ | Presentation Exchange (Veramo-Style) |
| Istio Ready | ✅ | Kubernetes Manifeste aktualisiert |
| Docker Images | ✅ | Build Scripts vorhanden |
| Test Suite | ✅ | End-to-End Test funktioniert |
| Documentation | ✅ | README erstellt |
| **Issuer-Agent** | ❌ | Noch nicht implementiert |
| **DID Web Hosting** | ⚠️ | Nur lokal, nicht mit Ingress |
| **SD-JWT** | ❌ | Nicht integriert |
| **PE 2.0** | ❌ | Nutzt Veramo SDR |
| **Persistent Sessions** | ❌ | Nur Memory |

## Zusammenfassung

**Phase 5 ist produktionsreif für lokale Tests und Kubernetes-Deployments!**

Du kannst jetzt:
1. ✅ Den kompletten DIDComm Flow lokal testen
2. ✅ Docker Images bauen
3. ✅ In Kubernetes deployen
4. ✅ Mit Istio mTLS nutzen
5. ✅ Zwischen authcrypt/jws umschalten

**Nächster kritischer Schritt:** Issuer-Agent implementieren (Phase 2) für echte VC-Ausstellung.

---

**Implementiert am:** 2025-12-04
**Version:** 1.0.0
**Status:** ✅ COMPLETE