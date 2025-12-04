# Phase 5 - DIDComm Flow Implementation Guide

## Übersicht

Dieser Guide zeigt, wie der vollständige DIDComm Mutual Authentication Flow mit **Veramo SDR** (Selective Disclosure Request) implementiert wird.

---

## Was wurde implementiert

✅ **[didcomm-flow-implementation.ts](didcomm-flow-implementation.ts)** - Vollständiger DIDComm Flow Handler

### Features:

1. **Session Management** - Tracking von authenticated sessions
2. **Phase 1: Initial Request** - NF_A sendet VP_Auth_Request + PD_A
3. **Phase 2: Mutual Authentication** - VP Exchange mit SDR
4. **Phase 3: Authorized Service** - Service Requests über authorized sessions
5. **Message Router** - Automatisches Routing basierend auf DIDComm Message Type

---

## Flow-Diagramm mit Code-Mapping

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1: Initial Request (NF_A → NF_B)                     │
└─────────────────────────────────────────────────────────────┘

NF_A App
  ↓ initiateServiceRequest()
Create SDR (PD_A)
  ↓ agent.createSelectiveDisclosureRequest()
Pack DIDComm (authcrypt)
  ↓ agent.packDIDCommMessage({ packing: 'authcrypt' })
Send to NF_B
  ↓ agent.sendDIDCommMessage()
───────────────── Istio mTLS Transport ─────────────────
Receive at NF_B
  ↓ handleIncomingDIDCommMessage(isNFA: false)
  ↓ handleInitialRequestFromNFA()
Extract SDR (PD_A)
  ↓ agent.unpackDIDCommMessage()
Find matching VCs
  ↓ agent.getVerifiableCredentialsForSdr({ sdr: PD_A })


┌─────────────────────────────────────────────────────────────┐
│ PHASE 2: Mutual Authentication (VP Exchange)               │
└─────────────────────────────────────────────────────────────┘

NF_B
  ↓
Create VP_B
  ↓ agent.createVerifiablePresentation()
Create SDR (PD_B) for NF_A
  ↓ agent.createSelectiveDisclosureRequest()
Pack DIDComm (VP_B + PD_B)
  ↓ agent.packDIDCommMessage({ packing: 'authcrypt' })
Send to NF_A
  ↓ agent.sendDIDCommMessage()
───────────────── Istio mTLS Transport ─────────────────
NF_A receives VP_B + PD_B
  ↓ handlePresentationFromNFB()
Validate VP_B against PD_A
  ↓ agent.validatePresentationAgainstSdr()
Resolve Issuer DID
  ↓ agent.resolveDid({ didUrl: issuerDID })
Verify VP_B signature
  ↓ agent.verifyPresentation()
Find VCs for PD_B
  ↓ agent.getVerifiableCredentialsForSdr({ sdr: PD_B })
Create VP_A
  ↓ agent.createVerifiablePresentation()
Send VP_A to NF_B
  ↓ agent.sendDIDCommMessage()
───────────────── Istio mTLS Transport ─────────────────
NF_B receives VP_A
  ↓ handlePresentationFromNFA()
Validate VP_A against PD_B
  ↓ agent.validatePresentationAgainstSdr()
Verify VP_A signature
  ↓ agent.verifyPresentation()
Mark session as AUTHORIZED
  ↓ session.status = 'authorized'
Send "Authorized" confirmation
  ↓ agent.sendDIDCommMessage()


┌─────────────────────────────────────────────────────────────┐
│ PHASE 3: Authorized Service Communication                  │
└─────────────────────────────────────────────────────────────┘

NF_A receives "Authorized"
  ↓ handleAuthorizedConfirmation()
  ↓ session.status = 'authorized'
NF_A sends Service Request
  ↓ sendServiceRequest(sessionId, request)
  ↓ Check: session.status === 'authorized'
  ↓ agent.packDIDCommMessage()
  ↓ agent.sendDIDCommMessage()
───────────────── Istio mTLS Transport ─────────────────
NF_B receives Service Request
  ↓ handleServiceRequest()
  ↓ Check: session.status === 'authorized'
Call NF_B business logic
  ↓ nfBusinessLogic(request)
Send Service Response
  ↓ agent.packDIDCommMessage()
  ↓ agent.sendDIDCommMessage()
───────────────── Istio mTLS Transport ─────────────────
NF_A receives Service Response
  ↓ handleIncomingDIDCommMessage()
  ↓ Forward to NF_A App
```

---

## Veramo SDR (Selective Disclosure Request) Usage

### 1. Create SDR (Presentation Definition)

```typescript
const sdr = await agent.createSelectiveDisclosureRequest({
  data: {
    issuer: myDID,
    subject: nfBDID,
    tag: 'nf-authentication-request',
    claims: [
      {
        claimType: 'VerifiableCredential',
        claimValue: 'NetworkFunctionCredential',
        issuers: [
          {
            did: 'did:web:issuer.example.com',
            url: 'https://issuer.example.com/.well-known/did.json'
          }
        ],
        reason: 'Network Function Authentication Required',
        essential: true
      },
      {
        claimType: 'role',
        reason: 'Verify NF role and permissions',
        essential: true
      }
    ]
  }
})
```

**Was passiert:**
- Definiert welche Claims vom Peer gefordert werden
- `essential: true` = zwingend erforderlich
- `issuers` = nur VCs von diesen Issuers akzeptiert

### 2. Get VCs matching SDR

```typescript
const credentials = await agent.getVerifiableCredentialsForSdr({
  sdr: sdrFromPeer
})
```

**Was passiert:**
- Durchsucht lokale DataStore
- Findet VCs die alle `essential` Claims erfüllen
- Prüft Issuer-Whitelist

### 3. Validate VP against SDR

```typescript
const result = await agent.validatePresentationAgainstSdr({
  presentation: vpFromPeer,
  sdr: mySdr
})

if (!result.valid) {
  throw new Error('VP does not satisfy SDR requirements')
}
```

**Was passiert:**
- Prüft ob VP alle geforderten Claims enthält
- Prüft ob Issuer erlaubt ist
- Prüft ob essential Claims vorhanden sind

---

## DIDComm Message Types

### 1. Request Presentation (mit SDR)

```typescript
{
  type: 'https://didcomm.org/present-proof/3.0/request-presentation',
  from: myDID,
  to: [peerDID],
  body: {
    goal_code: 'nf-authentication',
    will_confirm: true,
    attachments: [{
      id: 'sdr-request',
      format: 'dif/presentation-exchange/definitions@v1.0',
      data: { json: sdr }
    }]
  }
}
```

### 2. Presentation (VP Response)

```typescript
{
  type: 'https://didcomm.org/present-proof/3.0/presentation',
  from: myDID,
  to: [peerDID],
  thid: sessionId, // thread ID
  body: {
    attachments: [{
      id: 'presentation',
      format: 'dif/presentation-exchange/submission@v1.0',
      data: { json: vp }
    }]
  }
}
```

### 3. Acknowledgment (Authorized)

```typescript
{
  type: 'https://didcomm.org/present-proof/3.0/ack',
  from: myDID,
  to: [peerDID],
  thid: sessionId,
  body: {
    status: 'authorized',
    message: 'Mutual authentication successful'
  }
}
```

### 4. Service Request/Response

```typescript
// Request
{
  type: 'https://example.com/nf-service-request',
  from: myDID,
  to: [peerDID],
  thid: sessionId,
  body: { /* your service request */ }
}

// Response
{
  type: 'https://example.com/nf-service-response',
  from: myDID,
  to: [peerDID],
  thid: sessionId,
  body: { /* your service response */ }
}
```

---

## Integration in Veramo Agent

### 1. Agent Config aktualisieren

Füge SelectiveDisclosure Plugin hinzu (bereits in agent.yml):

```yaml
agent:
  $require: '@veramo/core#Agent'
  $args:
    - plugins:
        # ... andere plugins
        - $require: '@veramo/selective-disclosure#SelectiveDisclosure'
```

### 2. Custom Message Handler registrieren

Erstelle `custom-didcomm-handler.ts`:

```typescript
import { handleIncomingDIDCommMessage } from './didcomm-flow-implementation'

export class CustomDIDCommHandler {
  async handle(message: any, agent: IAgent) {
    // Route to flow handler
    await handleIncomingDIDCommMessage(
      agent,
      message,
      isNFA, // true für NF_A, false für NF_B
      nfBusinessLogic // optional: Business Logic Funktion
    )
  }
}
```

### 3. Register Handler in agent.yml

```yaml
messageHandler:
  $require: '@veramo/message-handler#MessageHandler'
  $args:
    - messageHandlers:
        - $require: '@veramo/did-comm#DIDCommMessageHandler'
        - $require: './custom-didcomm-handler#CustomDIDCommHandler'
```

---

## Deployment

### 1. Build Custom Veramo Image

Erstelle `Dockerfile.custom`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install Veramo CLI
RUN npm install -g @veramo/cli typescript ts-node

# Install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy custom handlers
COPY didcomm-flow-implementation.ts ./
COPY custom-didcomm-handler.ts ./

# Copy agent config
COPY agent-nf-a.yml ./agent.yml

# Compile TypeScript
RUN tsc didcomm-flow-implementation.ts
RUN tsc custom-didcomm-handler.ts

EXPOSE 7001

CMD ["veramo", "server", "--config", "./agent.yml"]
```

### 2. Build und Push

```bash
# Build für NF-A
docker build -f Dockerfile.custom -t your-registry/veramo-nf-a:latest .
docker push your-registry/veramo-nf-a:latest

# Build für NF-B (mit anderem config)
docker build -f Dockerfile.custom \
  --build-arg CONFIG=agent-nf-b.yml \
  -t your-registry/veramo-nf-b:latest .
docker push your-registry/veramo-nf-b:latest
```

### 3. Update Kubernetes Deployment

In `nf-a-veramo.yaml`:

```yaml
- name: veramo-nf-a
  image: your-registry/veramo-nf-a:latest  # statt veramolabs/veramo-agent
  ports:
    - containerPort: 7001
```

### 4. Deploy

```bash
kubectl config use-context kind-cluster-a
kubectl apply -f cluster-a/nf-a-veramo.yaml

kubectl config use-context kind-cluster-b
kubectl apply -f cluster-b/nf-b-veramo.yaml
```

---

## Testing

### 1. Test Initial Request (NF_A → NF_B)

```bash
# Port-forward to NF_A
kubectl port-forward -n nf-a-namespace svc/veramo-nf-a 7001:7001

# In anderem Terminal: Call NF_A API
curl -X POST http://localhost:7001/agent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test123" \
  -d '{
    "method": "initiateServiceRequest",
    "params": {
      "nfBDID": "did:web:didcomm.nf-b.cluster-b.global",
      "serviceRequest": {
        "action": "getData",
        "resource": "user-profile"
      }
    }
  }'
```

### 2. Monitor Logs

```bash
# NF_A logs
kubectl logs -n nf-a-namespace -l app=nf-a -c veramo-nf-a -f

# NF_B logs
kubectl logs -n nf-b-namespace -l app=nf-b -c veramo-nf-b -f
```

**Expected Output:**

```
[NF_A] Phase 1: Initiating service request to did:web:didcomm.nf-b.cluster-b.global
[NF_A] Resolved DID Document: did:web:didcomm.nf-b.cluster-b.global
[NF_A] Created SDR
[NF_A] Packed DIDComm message (authcrypt)
[NF_A] Sent DIDComm message to NF_B

[NF_B] Phase 1: Received initial request from NF_A
[NF_B] Received SDR from NF_A: did:web:didcomm.nf-a.cluster-a.global
[NF_B] Found 1 credentials matching PD_A
[NF_B] Created VP_B
[NF_B] Created SDR for NF_A
[NF_B] Sent VP_B + PD_B to NF_A

[NF_A] Phase 2a: Received presentation from NF_B
[NF_A] VP_B validation successful
[NF_A] Resolved Issuer DID: did:web:issuer.example.com
[NF_A] VP_B verified successfully
[NF_A] Found 1 credentials matching PD_B
[NF_A] Created VP_A
[NF_A] Sent VP_A to NF_B

[NF_B] Phase 2b: Received VP_A from NF_A
[NF_B] VP_A validation successful
[NF_B] VP_A verified successfully
[NF_B] MUTUAL AUTHENTICATION COMPLETE
[NF_B] Sent authorized confirmation to NF_A

[NF_A] Phase 3: Received authorized confirmation
[NF_A] Session session-xxx is now AUTHORIZED
```

### 3. Test Service Request

```bash
curl -X POST http://localhost:7001/agent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test123" \
  -d '{
    "method": "sendServiceRequest",
    "params": {
      "sessionId": "session-xxx",
      "serviceRequest": {
        "query": "SELECT * FROM data"
      }
    }
  }'
```

---

## Fehlerbehebung

### Problem: "Session not found"

**Ursache:** Session ist abgelaufen oder wurde nicht erstellt

**Lösung:**
```typescript
// Check session status
const status = getSessionStatus(sessionId)
console.log('Session status:', status)

// Cleanup alte sessions
cleanupExpiredSessions(3600000) // 1 hour
```

### Problem: "No credentials available to satisfy PD_A"

**Ursache:** Keine passenden VCs in DataStore

**Lösung:**
```bash
# Check VCs in DataStore
curl -X POST http://localhost:7001/agent \
  -H "Content-Type: application/json" \
  -d '{
    "method": "dataStoreORMGetVerifiableCredentials"
  }'

# Import VC wenn nötig
curl -X POST http://localhost:7001/agent \
  -d '{
    "method": "dataStoreSaveVerifiableCredential",
    "params": {
      "verifiableCredential": { /* VC object */ }
    }
  }'
```

### Problem: "VP validation failed"

**Ursache:** VP erfüllt nicht alle SDR Requirements

**Lösung:**
```typescript
// Debug: Print SDR requirements
console.log('SDR requires:', JSON.stringify(sdr.claims, null, 2))

// Debug: Print VP contents
console.log('VP contains:', JSON.stringify(vp.verifiableCredential, null, 2))

// Validate manually
const result = await agent.validatePresentationAgainstSdr({
  presentation: vp,
  sdr: sdr
})
console.log('Validation result:', result)
```

---

## Nächste Schritte

1. ✅ **Flow Implementation** - FERTIG
2. ⚠️ **Issuer Agent** - Muss deployed werden um initiale VCs zu erstellen
3. ⚠️ **DID Document Hosting** - did:web Services deployen
4. ⚠️ **Custom Image Build** - Mit didcomm-flow-implementation.ts
5. ⚠️ **End-to-End Test** - Vollständiger Flow-Test

---

## Zusammenfassung

**Was jetzt möglich ist:**

✅ Vollständiger DIDComm Mutual Authentication Flow
✅ SDR-basierte Presentation Exchange
✅ Session Management
✅ Authorized Service Requests
✅ E2E Encryption (authcrypt) auf DIDComm Layer
✅ mTLS auf Istio Transport Layer

**Was noch fehlt:**

❌ Issuer Agent für initiale VCs
❌ DID Document Hosting Services
❌ Custom Docker Image mit Flow Handler
❌ Echte NF Business Logic

**Der Code ist bereit zum Deployen!** 🚀
