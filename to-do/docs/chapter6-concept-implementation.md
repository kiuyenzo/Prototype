# 6. Concept and Implementation

This chapter presents the design and implementation of a prototype system for decentralized identity-based authentication in cloud-native 5G network function environments. The prototype demonstrates how Decentralized Identifiers (DIDs), Verifiable Credentials (VCs), and DIDComm messaging can replace traditional OAuth2/OIDC-based authentication mechanisms in multi-cluster Kubernetes deployments. The following sections detail the architectural decisions, component design, communication protocols, and security configurations that constitute the system's core contribution.

## 6.1 Design Requirements and Principles

The design of the prototype was guided by several key requirements derived from both the problem domain of 5G network function communication and the capabilities of decentralized identity technologies.

### 6.1.1 Functional Requirements

**FR1: Mutual Authentication.** Both communicating network functions must authenticate each other before any service invocation occurs. Unlike traditional client-server authentication where only the client proves its identity, 5G inter-NF communication requires bidirectional trust establishment.

**FR2: Decentralized Trust.** The system must not rely on a centralized identity provider or authentication server. Network functions should be able to verify each other's identities using cryptographic proofs without contacting a third-party service at runtime.

**FR3: Credential-Based Authorization.** Authentication decisions must be based on verifiable claims about the network function's properties (e.g., role, cluster membership, capabilities) rather than simple identity matching.

**FR4: Transport Flexibility.** The authentication mechanism must work across different transport security configurations, supporting both scenarios where the transport layer is trusted (mTLS) and where it is not (plain TCP).

**FR5: 5G Compatibility.** The prototype must demonstrate integration with 5G service interfaces, specifically the NRF Discovery (nnrf-disc) and UDM Subscriber Data Management (nudm-sdm) services as defined in 3GPP TS 29.510 and TS 29.503.

### 6.1.2 Non-Functional Requirements

**NFR1: Separation of Concerns.** Cryptographic operations and identity management must be separated from business logic to enable independent updates and reduce complexity in network function implementations.

**NFR2: Kubernetes-Native Deployment.** The solution must integrate naturally with Kubernetes orchestration patterns and Istio service mesh capabilities.

**NFR3: Configurable Security Levels.** The system must support different security configurations to accommodate varying threat models and performance requirements.

### 6.1.3 Design Decisions from Related Work

The prototype's design builds upon and diverges from existing solutions in several key ways:

| Aspect | Existing Approach | Prototype Approach | Rationale |
|--------|-------------------|-------------------|-----------|
| Identity Model | SPIFFE/SPIRE with X.509 SVIDs | DIDs with Verifiable Credentials | VCs enable attribute-based authorization beyond identity |
| Trust Establishment | Centralized OIDC Provider | Mutual VP Exchange | Eliminates runtime dependency on central authority |
| Message Security | TLS only | DIDComm + optional TLS | Application-layer security independent of transport |
| Credential Format | JWT with proprietary claims | W3C Verifiable Credentials | Interoperability with SSI ecosystem |

The decision to use **DIDs over SPIFFE** was motivated by the richer expressiveness of Verifiable Credentials. While SPIFFE provides workload identity through X.509 certificates, it lacks a standardized mechanism for conveying attributes or claims about the workload. Verifiable Credentials, combined with Presentation Exchange, enable fine-grained authorization policies based on credential contents.

The choice of **DIDComm over pure TLS** provides defense in depth. DIDComm's authenticated encryption (authcrypt) ensures message confidentiality and authenticity at the application layer, independent of transport security. This is particularly valuable in multi-cluster scenarios where traffic may traverse untrusted network segments.

## 6.2 System Architecture

### 6.2.1 High-Level Architecture

The prototype implements a multi-cluster architecture with two Kubernetes clusters, each hosting a network function. Figure 6.1 illustrates the high-level system topology.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Docker Network (172.23.0.0/16)                 │
│                                                                             │
│  ┌─────────────────────────────────┐   ┌─────────────────────────────────┐  │
│  │         Cluster-A               │   │         Cluster-B               │  │
│  │      (172.23.0.2)               │   │      (172.23.0.3)               │  │
│  │                                 │   │                                 │  │
│  │  ┌───────────────────────────┐  │   │  ┌───────────────────────────┐  │  │
│  │  │    nf-a-namespace         │  │   │  │    nf-b-namespace         │  │  │
│  │  │                           │  │   │  │                           │  │  │
│  │  │  ┌─────────────────────┐  │  │   │  │  ┌─────────────────────┐  │  │  │
│  │  │  │      Pod: NF-A      │  │  │   │  │  │      Pod: NF-B      │  │  │  │
│  │  │  │  ┌───────────────┐  │  │  │   │  │  │  ┌───────────────┐  │  │  │  │
│  │  │  │  │  nf-service   │  │  │  │   │  │  │  │  nf-service   │  │  │  │  │
│  │  │  │  │  (Port 3000)  │  │  │  │   │  │  │  │  (Port 3000)  │  │  │  │  │
│  │  │  │  └───────────────┘  │  │  │   │  │  │  └───────────────┘  │  │  │  │
│  │  │  │  ┌───────────────┐  │  │  │   │  │  │  ┌───────────────┐  │  │  │  │
│  │  │  │  │veramo-sidecar │  │  │  │   │  │  │  │veramo-sidecar │  │  │  │  │
│  │  │  │  │  (Port 3001)  │  │  │  │   │  │  │  │  (Port 3001)  │  │  │  │  │
│  │  │  │  └───────────────┘  │  │  │   │  │  │  └───────────────┘  │  │  │  │
│  │  │  │  ┌───────────────┐  │  │  │   │  │  │  ┌───────────────┐  │  │  │  │
│  │  │  │  │ istio-proxy   │  │  │  │   │  │  │  │ istio-proxy   │  │  │  │  │
│  │  │  │  └───────────────┘  │  │  │   │  │  │  └───────────────┘  │  │  │  │
│  │  │  └─────────────────────┘  │  │   │  │  └─────────────────────┘  │  │  │
│  │  └───────────────────────────┘  │   │  └───────────────────────────┘  │  │
│  │                                 │   │                                 │  │
│  │  ┌───────────────────────────┐  │   │  ┌───────────────────────────┐  │  │
│  │  │    istio-system           │  │   │  │    istio-system           │  │  │
│  │  │  ┌─────────────────────┐  │  │   │  │  ┌─────────────────────┐  │  │  │
│  │  │  │ Istio Gateway       │◄─┼──┼───┼──┼─►│ Istio Gateway       │  │  │  │
│  │  │  │ (NodePort: 32514)   │  │  │   │  │  │ (NodePort: 31696)   │  │  │  │
│  │  │  └─────────────────────┘  │  │   │  │  └─────────────────────┘  │  │  │
│  │  └───────────────────────────┘  │   │  └───────────────────────────┘  │  │
│  └─────────────────────────────────┘   └─────────────────────────────────┘  │
│                                                                             │
│                              mTLS Connection                                │
└─────────────────────────────────────────────────────────────────────────────┘

                    Figure 6.1: Multi-Cluster System Topology
```

Each cluster operates independently with its own Istio control plane. Cross-cluster communication is facilitated through Istio Ingress Gateways, which terminate external mTLS connections and route traffic to internal services.

### 6.2.2 Sidecar Pattern Architecture

The core architectural pattern employed is the **sidecar pattern**, which separates identity and messaging concerns from business logic. Each network function pod contains three containers:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              Kubernetes Pod                                 │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     Container 1: nf-service                          │  │
│  │                         (Port 3000)                                  │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │  • Business Logic (5G Network Function)                        │  │  │
│  │  │  • REST API: /nnrf-disc/v1/nf-instances (NRF Discovery)       │  │  │
│  │  │  • REST API: /nudm-sdm/v2/{supi}/am-data (Subscriber Data)    │  │  │
│  │  │  • No cryptographic operations                                 │  │  │
│  │  │  • No identity management                                      │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                              │ localhost                                   │
│                              ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                   Container 2: veramo-sidecar                        │  │
│  │                         (Port 3001)                                  │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │  • DIDComm Message Handling (pack/unpack)                      │  │  │
│  │  │  • Verifiable Presentation Creation & Verification             │  │  │
│  │  │  • Session Management                                          │  │  │
│  │  │  • Key Management (Secp256k1, X25519)                          │  │  │
│  │  │  • SQLite Database for Credentials                             │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                              │ TCP or mTLS                                 │
│                              ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Container 3: istio-proxy                          │  │
│  │                    (Envoy - auto-injected)                           │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │  • mTLS Termination (configurable)                             │  │  │
│  │  │  • Traffic Routing                                             │  │  │
│  │  │  • Authorization Policy Enforcement                            │  │  │
│  │  │  • Telemetry Collection                                        │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                              │                                             │
└──────────────────────────────┼─────────────────────────────────────────────┘
                               ▼
                        To Istio Gateway

                Figure 6.2: Three-Container Sidecar Architecture
```

**Design Rationale:** The three-container architecture provides several benefits:

1. **Separation of Concerns:** The nf-service container contains only business logic and has no knowledge of DIDComm or cryptographic operations. This simplifies development and reduces the attack surface of the business logic container.

2. **Independent Scaling:** The Veramo sidecar can be updated independently of the business logic, enabling security patches without redeploying the network function.

3. **Reusability:** The same veramo-sidecar image can be deployed alongside any network function, providing a consistent authentication layer.

4. **Defense in Depth:** The Istio proxy provides transport-layer security, while the Veramo sidecar provides application-layer security. This layered approach ensures that compromise of one layer does not completely compromise the system.

### 6.2.3 Component Responsibilities

**NF-Service (Port 3000):**
- Implements 5G network function business logic
- Exposes 3GPP-compliant REST APIs
- Delegates all authentication to the Veramo sidecar
- Receives authenticated service requests via localhost

**Veramo-Sidecar (Port 3001):**
- Manages the network function's DID and private keys
- Handles DIDComm message packing and unpacking
- Creates and verifies Verifiable Presentations
- Maintains authentication session state
- Stores credentials in a local SQLite database

**Istio-Proxy (Envoy):**
- Automatically injected by Istio
- Handles mTLS termination based on PeerAuthentication policy
- Enforces AuthorizationPolicy rules
- Routes traffic according to VirtualService rules

## 6.3 Security Variants

A key design decision was to support multiple security configurations to accommodate different threat models. The prototype implements two primary variants:

### 6.3.1 Variant V1: End-to-End Encrypted DIDComm

In Variant V1, the DIDComm messages are encrypted end-to-end between the network functions using authenticated encryption (authcrypt). The internal cluster communication uses plain TCP, with security provided entirely at the application layer.

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   NF-A      │         │   Gateway   │         │   Gateway   │         │   NF-B      │
│   Pod       │         │   Cluster-A │         │   Cluster-B │         │   Pod       │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │                       │
       │  DIDComm(JWE)         │                       │                       │
       │  ══════════════════════════════════════════════════════════════════►  │
       │                       │                       │                       │
       │◄─────TCP─────────────►│◄────────mTLS─────────►│◄─────TCP─────────────►│
       │   (PERMISSIVE)        │                       │   (PERMISSIVE)        │
       │                       │                       │                       │

                        Figure 6.3: V1 Security Model
```

**Configuration:**
```yaml
# PeerAuthentication: Accept both TCP and mTLS
spec:
  mtls:
    mode: PERMISSIVE

# DestinationRule: Force TCP internally
spec:
  trafficPolicy:
    tls:
      mode: DISABLE

# Environment Variable
DIDCOMM_PACKING_MODE: encrypted  # JWE authcrypt
```

**Security Properties:**
- **Confidentiality:** Provided by DIDComm JWE encryption (X25519 key agreement + XChaCha20-Poly1305)
- **Authenticity:** Provided by authcrypt mode (sender authenticated)
- **Integrity:** Provided by AEAD cipher in JWE
- **Gateway Visibility:** Gateways cannot read message contents

**Use Case:** High-security environments where the cluster infrastructure is not fully trusted, or when messages traverse untrusted network segments.

### 6.3.2 Variant V4a: mTLS with Signed DIDComm

In Variant V4a, the transport layer provides confidentiality through mTLS, while DIDComm provides only message signing (JWS) for integrity and non-repudiation.

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   NF-A      │         │   Gateway   │         │   Gateway   │         │   NF-B      │
│   Pod       │         │   Cluster-A │         │   Cluster-B │         │   Pod       │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │                       │
       │  DIDComm(JWS)         │                       │                       │
       │  ─────────────────────────────────────────────────────────────────►   │
       │                       │                       │                       │
       │◄─────mTLS────────────►│◄────────mTLS─────────►│◄─────mTLS────────────►│
       │   (STRICT)            │                       │   (STRICT)            │
       │                       │                       │                       │

                        Figure 6.4: V4a Security Model
```

**Configuration:**
```yaml
# PeerAuthentication: Require mTLS everywhere
spec:
  mtls:
    mode: STRICT

# Environment Variable
DIDCOMM_PACKING_MODE: signed  # JWS only
```

**Security Properties:**
- **Confidentiality:** Provided by mTLS (TLS 1.3)
- **Authenticity:** Provided by DIDComm JWS signature
- **Integrity:** Provided by both TLS and JWS
- **Gateway Visibility:** Gateways can read decrypted content (after TLS termination)

**Use Case:** Trusted cluster environments where mTLS is sufficient for confidentiality, and additional JWS signing provides non-repudiation and application-layer integrity.

### 6.3.3 Security Comparison

| Property | V1 (E2E Encrypted) | V4a (mTLS + Signed) |
|----------|-------------------|---------------------|
| Message Confidentiality | Application layer (JWE) | Transport layer (mTLS) |
| Message Integrity | Application layer (AEAD) | Both layers |
| Sender Authentication | DIDComm authcrypt | DIDComm JWS |
| Gateway Compromise Impact | Messages remain confidential | Messages exposed |
| Performance Overhead | Higher (double encryption) | Lower |
| Message Size | ~1096 bytes | ~847 bytes |
| Key Management | Requires X25519 keys | Only Secp256k1 |

The choice between variants depends on the threat model. V1 is recommended when:
- The cluster infrastructure is shared or multi-tenant
- Traffic crosses trust boundaries
- Regulatory requirements mandate end-to-end encryption

V4a is recommended when:
- The cluster infrastructure is fully controlled
- Performance is critical
- Gateway-level inspection is required for compliance

## 6.4 Authentication Protocol

### 6.4.1 Protocol Overview

The prototype implements a three-phase mutual authentication protocol using Verifiable Presentations exchanged over DIDComm. The protocol is based on the DIF Present Proof Protocol v3.0 with extensions for mutual authentication.

```
┌─────────────────┐                                      ┌─────────────────┐
│     NF-A        │                                      │     NF-B        │
│   (Initiator)   │                                      │   (Responder)   │
└────────┬────────┘                                      └────────┬────────┘
         │                                                        │
         │  ╔═══════════════════════════════════════════════════╗ │
         │  ║           PHASE 1: Initiation                     ║ │
         │  ╚═══════════════════════════════════════════════════╝ │
         │                                                        │
         │  1. VP_AUTH_REQUEST                                    │
         │     type: present-proof/3.0/request-presentation       │
         │     body: { presentation_definition: PD_A }            │
         ├───────────────────────────────────────────────────────►│
         │                                                        │
         │  ╔═══════════════════════════════════════════════════╗ │
         │  ║           PHASE 2: Mutual Exchange                ║ │
         │  ╚═══════════════════════════════════════════════════╝ │
         │                                                        │
         │                                    2. Verify request   │
         │                                    3. Select creds     │
         │                                    4. Create VP_B      │
         │                                                        │
         │  5. VP_WITH_PD                                         │
         │     type: present-proof/3.0/presentation-with-def      │
         │     body: { vp: VP_B, presentation_definition: PD_B }  │
         │◄───────────────────────────────────────────────────────┤
         │                                                        │
         │  6. Verify VP_B                                        │
         │  7. Select creds                                       │
         │  8. Create VP_A                                        │
         │                                                        │
         │  9. VP_RESPONSE                                        │
         │     type: present-proof/3.0/presentation               │
         │     body: { vp: VP_A }                                 │
         ├───────────────────────────────────────────────────────►│
         │                                                        │
         │  ╔═══════════════════════════════════════════════════╗ │
         │  ║           PHASE 3: Confirmation                   ║ │
         │  ╚═══════════════════════════════════════════════════╝ │
         │                                                        │
         │                                   10. Verify VP_A      │
         │                                   11. Generate token   │
         │                                                        │
         │  12. AUTH_CONFIRMATION                                 │
         │      type: present-proof/3.0/ack                       │
         │      body: { status: "OK", session_token: "..." }      │
         │◄───────────────────────────────────────────────────────┤
         │                                                        │
         │  13. Store session                                     │
         │                                                        │
         │  ════════════════════════════════════════════════════  │
         │              AUTHENTICATED SESSION                     │
         │  ════════════════════════════════════════════════════  │
         │                                                        │
         │  14. SERVICE_REQUEST                                   │
         │      body: { service, action, params, token }          │
         ├───────────────────────────────────────────────────────►│
         │                                                        │
         │  15. SERVICE_RESPONSE                                  │
         │      body: { status, data }                            │
         │◄───────────────────────────────────────────────────────┤
         │                                                        │

              Figure 6.5: Three-Phase Mutual Authentication Protocol
```

### 6.4.2 Message Type Definitions

The protocol uses the following DIDComm message types, based on the Aries Present Proof Protocol 3.0:

```javascript
const DIDCOMM_MESSAGE_TYPES = {
    VP_AUTH_REQUEST:    'https://didcomm.org/present-proof/3.0/request-presentation',
    VP_WITH_PD:         'https://didcomm.org/present-proof/3.0/presentation-with-definition',
    VP_RESPONSE:        'https://didcomm.org/present-proof/3.0/presentation',
    AUTH_CONFIRMATION:  'https://didcomm.org/present-proof/3.0/ack',
    SERVICE_REQUEST:    'https://didcomm.org/service/1.0/request',
    SERVICE_RESPONSE:   'https://didcomm.org/service/1.0/response',
    ERROR:              'https://didcomm.org/present-proof/3.0/problem-report'
};
```

**Design Decision:** The `VP_WITH_PD` message type is a custom extension that combines the presentation response with a counter-request. This optimization reduces the number of round trips from four to three by piggybacking NF-B's presentation definition on its presentation response.

### 6.4.3 Message Structures

**VP_AUTH_REQUEST:**
```json
{
    "type": "https://didcomm.org/present-proof/3.0/request-presentation",
    "id": "1703424000000-abc123def",
    "from": "did:web:example.com:nf-a",
    "to": ["did:web:example.com:nf-b"],
    "created_time": 1703424000000,
    "body": {
        "presentation_definition": {
            "id": "pd-nf-auth-request-a",
            "input_descriptors": [...]
        },
        "comment": "Please provide VP"
    }
}
```

**VP_WITH_PD:**
```json
{
    "type": "https://didcomm.org/present-proof/3.0/presentation-with-definition",
    "id": "1703424001000-xyz789ghi",
    "from": "did:web:example.com:nf-b",
    "to": ["did:web:example.com:nf-a"],
    "created_time": 1703424001000,
    "body": {
        "verifiable_presentation": {
            "@context": ["https://www.w3.org/2018/credentials/v1"],
            "type": ["VerifiablePresentation"],
            "holder": "did:web:example.com:nf-b",
            "verifiableCredential": [...],
            "proof": {...}
        },
        "presentation_definition": {
            "id": "pd-nf-auth-request-b",
            "input_descriptors": [...]
        },
        "comment": "VP + PD"
    }
}
```

**AUTH_CONFIRMATION:**
```json
{
    "type": "https://didcomm.org/present-proof/3.0/ack",
    "id": "1703424003000-jkl456mno",
    "from": "did:web:example.com:nf-b",
    "to": ["did:web:example.com:nf-a"],
    "created_time": 1703424003000,
    "body": {
        "status": "OK",
        "session_token": "eyJvdXJEaWQiOiJkaWQ6d2ViOi4uLiIsInRpbWVzdGFtcCI6....",
        "comment": "Authenticated"
    }
}
```

### 6.4.4 Session Token Design

Upon successful mutual authentication, the responder generates a session token that the initiator must include in subsequent service requests:

```javascript
generateSessionToken(context) {
    const tokenData = {
        ourDid: context.ourDid,
        theirDid: context.theirDid,
        timestamp: Date.now(),
        random: Math.random().toString(36).substring(2)
    };
    return Buffer.from(JSON.stringify(tokenData)).toString('base64');
}
```

**Design Rationale:** The session token serves as proof that the holder has completed the authentication protocol. It contains:
- The DIDs of both parties (binding the session to specific identities)
- A timestamp (for session expiry validation)
- Random entropy (preventing token prediction)

The token is Base64-encoded for transport but is not cryptographically signed. This is intentional: the token is only valid within the DIDComm channel, which already provides message authenticity. An attacker cannot forge a SERVICE_REQUEST because they cannot produce a valid DIDComm signature.

## 6.5 Credential and Presentation Design

### 6.5.1 NetworkFunctionCredential Schema

The prototype uses a custom credential type called `NetworkFunctionCredential` to represent the identity and attributes of a 5G network function:

```json
{
    "@context": [
        "https://www.w3.org/2018/credentials/v1"
    ],
    "type": ["VerifiableCredential", "NetworkFunctionCredential"],
    "issuer": "did:web:kiuyenzo.github.io:Prototype:dids:did-issuer",
    "issuanceDate": "2024-01-15T12:00:00Z",
    "credentialSubject": {
        "id": "did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a",
        "role": "network-function",
        "clusterId": "cluster-a",
        "nfType": "AMF",
        "capabilities": ["nudm-sdm", "nnrf-disc"]
    },
    "proof": {
        "type": "JwtProof2020",
        "jwt": "eyJhbGciOiJFUzI1NksiLC..."
    }
}
```

**Credential Subject Attributes:**
- `role`: Fixed value "network-function" for authorization matching
- `clusterId`: Identifies the cluster where the NF is deployed
- `nfType`: The 3GPP network function type (AMF, UDM, SMF, etc.)
- `capabilities`: List of service interfaces the NF provides

### 6.5.2 Presentation Definitions

Presentation Definitions specify what credentials a verifier requires. The prototype defines two complementary definitions:

**PD_A (NF-A's requirements for NF-B):**
```javascript
{
    id: 'pd-nf-auth-request-a',
    input_descriptors: [{
        id: 'network-function-credential',
        name: 'Network Function Credential',
        purpose: 'Verify that the holder is an authorized network function',
        constraints: {
            fields: [
                {
                    path: ['$.type'],
                    filter: {
                        type: 'string',
                        pattern: 'NetworkFunctionCredential|VerifiableCredential'
                    }
                },
                {
                    path: ['$.credentialSubject.role'],
                    filter: {
                        type: 'string',
                        const: 'network-function'
                    }
                }
            ]
        }
    }]
}
```

**PD_B (NF-B's requirements for NF-A):**
```javascript
{
    id: 'pd-nf-auth-request-b',
    input_descriptors: [{
        id: 'network-function-credential',
        constraints: {
            fields: [
                { path: ['$.type'], filter: {...} },
                { path: ['$.credentialSubject.role'], filter: {...} },
                {
                    path: ['$.credentialSubject.clusterId'],
                    filter: {
                        type: 'string',
                        pattern: 'cluster-.*'
                    }
                }
            ]
        }
    }]
}
```

**Design Decision:** PD_B includes an additional constraint on `clusterId` to demonstrate asymmetric authorization requirements. NF-B requires proof of cluster membership, while NF-A only requires proof of network function role. This models a realistic scenario where different services have different trust requirements.

### 6.5.3 DID Document Structure

Each network function has a DID Document hosted on GitHub Pages using the `did:web` method:

```json
{
    "@context": [
        "https://www.w3.org/ns/did/v1",
        "https://w3id.org/security/suites/jws-2020/v1",
        "https://w3id.org/security/suites/x25519-2020/v1"
    ],
    "id": "did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a",
    "verificationMethod": [
        {
            "id": "did:web:...#key-1",
            "type": "EcdsaSecp256k1VerificationKey2019",
            "controller": "did:web:...",
            "publicKeyHex": "042ac10aa2be6b0e..."
        },
        {
            "id": "did:web:...#key-2",
            "type": "X25519KeyAgreementKey2019",
            "publicKeyHex": "0edd35c82d30913d..."
        }
    ],
    "authentication": ["did:web:...#key-1"],
    "assertionMethod": ["did:web:...#key-1"],
    "keyAgreement": ["did:web:...#key-2"],
    "service": [{
        "id": "did:web:...#didcomm-1",
        "type": "DIDCommMessaging",
        "serviceEndpoint": "http://172.23.0.3:32514/didcomm/receive"
    }]
}
```

**Key Types and Purposes:**
- **Secp256k1 (key-1):** Used for authentication, assertion (signing VCs/VPs), and JWS message signing
- **X25519 (key-2):** Used for key agreement in JWE authenticated encryption

**Design Decision:** The choice of `did:web` over `did:peer` was motivated by:
1. **Discoverability:** `did:web` allows any party to resolve the DID Document via HTTPS
2. **Simplicity:** No complex peer exchange protocol required
3. **GitHub Pages Hosting:** Free, reliable hosting for DID Documents

The trade-off is that `did:web` requires trust in the DNS and web infrastructure, while `did:peer` would be self-certifying. For a prototype demonstrating the concept, `did:web` provides a simpler setup.

## 6.6 Cross-Cluster Communication

### 6.6.1 ServiceEntry Configuration

To enable cross-cluster communication, each cluster contains a ServiceEntry that maps the remote service to a virtual IP address:

```yaml
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: veramo-nf-b-external
  namespace: nf-a-namespace
spec:
  hosts:
  - veramo-nf-b.nf-b-namespace.svc.cluster.local
  addresses:
  - 240.0.0.3
  ports:
  - number: 3001
    name: http-veramo
    protocol: HTTP
  endpoints:
  - address: 172.23.0.3
    ports:
      http-veramo: 31696
  resolution: STATIC
  location: MESH_EXTERNAL
```

**Design Explanation:**
- `hosts`: The internal service name that applications use
- `addresses`: A virtual IP (from the 240.0.0.0/4 range) that Istio intercepts
- `endpoints`: The actual IP and port of the remote cluster's gateway
- `resolution: STATIC`: Use the provided endpoint addresses directly
- `location: MESH_EXTERNAL`: Treat this as an external service

### 6.6.2 Gateway Configuration

The Istio Ingress Gateway accepts incoming DIDComm traffic and routes it to the internal Veramo sidecar:

```yaml
apiVersion: networking.istio.io/v1
kind: Gateway
metadata:
  name: nf-a-gateway
  namespace: istio-system
spec:
  selector:
    istio: ingressgateway
  servers:
  - port:
      number: 80
      name: http-didcomm
      protocol: HTTP
    hosts:
    - "*"
---
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: veramo-routing
spec:
  hosts:
  - "*"
  gateways:
  - nf-a-gateway
  http:
  - match:
    - uri:
        prefix: /didcomm
    route:
    - destination:
        host: veramo-nf-a.nf-a-namespace.svc.cluster.local
        port:
          number: 3001
```

### 6.6.3 Network Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Cross-Cluster Communication Path                     │
│                                                                             │
│  Cluster-A                                              Cluster-B           │
│  ┌─────────────────────────┐            ┌─────────────────────────┐         │
│  │  Pod: NF-A              │            │  Pod: NF-B              │         │
│  │  ┌─────────────────┐    │            │    ┌─────────────────┐  │         │
│  │  │ veramo-sidecar  │    │            │    │ veramo-sidecar  │  │         │
│  │  │ (3001)          │    │            │    │ (3001)          │  │         │
│  │  └────────┬────────┘    │            │    └────────▲────────┘  │         │
│  │           │             │            │             │           │         │
│  │  ┌────────▼────────┐    │            │    ┌────────┴────────┐  │         │
│  │  │  istio-proxy    │    │            │    │  istio-proxy    │  │         │
│  │  └────────┬────────┘    │            │    └────────▲────────┘  │         │
│  └───────────┼─────────────┘            └─────────────┼───────────┘         │
│              │                                        │                      │
│              ▼                                        │                      │
│  ┌───────────────────────┐              ┌─────────────┴─────────┐           │
│  │  Istio Gateway        │              │  Istio Gateway        │           │
│  │  172.23.0.2:32514     │─────mTLS─────│  172.23.0.3:31696     │           │
│  └───────────────────────┘              └───────────────────────┘           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

                Figure 6.6: Cross-Cluster Network Path
```

## 6.7 Technology Stack

The following table summarizes the technologies used and the rationale for each choice:

| Component | Technology | Version | Rationale |
|-----------|-----------|---------|-----------|
| Container Orchestration | Kubernetes (Kind) | 1.28 | Local development, multi-cluster support |
| Service Mesh | Istio | 1.24.1 | mTLS automation, traffic management, AuthzPolicy |
| Identity Framework | Veramo | 6.0.0 | Comprehensive DID/VC/DIDComm support |
| DID Method | did:web | - | Simple resolution via HTTPS, GitHub Pages hosting |
| Credential Format | JWT-VC | - | Compact representation, wide library support |
| Presentation Exchange | Sphereon PEX | 4.0.1 | DIF-compliant, TypeScript support |
| Message Protocol | DIDComm v2 | - | Standardized secure messaging |
| Runtime | Node.js | 20 LTS | Veramo compatibility, async I/O |
| Database | SQLite | 3.x | Embedded, per-pod storage |

**Why Veramo over other SSI frameworks:**
- Native TypeScript implementation
- Modular plugin architecture
- Built-in DIDComm v2 support
- Active maintenance and community

**Why Istio over Linkerd or Consul:**
- Mature mTLS automation
- Fine-grained AuthorizationPolicy
- ServiceEntry for multi-cluster routing
- Wide industry adoption

## 6.8 Implementation Summary

The prototype successfully demonstrates that Verifiable Presentations over DIDComm can provide mutual authentication for cloud-native 5G network functions. The key implementation artifacts are:

1. **DIDCommVPWrapper** ([vp-wrapper.js](src/lib/didcomm/vp-wrapper.js)): Orchestrates the three-phase authentication protocol
2. **Message Definitions** ([messages.js](src/lib/didcomm/messages.js)): DIDComm message type factories
3. **PEX Integration** ([vp-pex.js](src/lib/credentials/vp-pex.js)): Credential selection and VP verification
4. **Security Configurations** ([mtls-encrypted.yaml](deploy/mtls-config/mtls-encrypted.yaml), [mtls-signed.yaml](deploy/mtls-config/mtls-signed.yaml)): Variant-specific Istio policies
5. **Deployment Manifests** ([deployment.yaml](deploy/cluster-a/deployment.yaml)): Kubernetes pod specifications

The design enables flexible security configurations while maintaining a consistent authentication protocol, providing a foundation for further research into decentralized identity in telecommunications infrastructure.
