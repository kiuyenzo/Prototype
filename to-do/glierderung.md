Ja! Hier der direkte Abgleich Gliederung ↔ Prototyp:
Gliederung	Prototyp-Komponente	Datei/Ordner
5.1 Architecture Overview	Sidecar Pattern	deploy/cluster-*/deployment.yaml
└─ NF-Service	Business Logic Container	src/nf-service.js
└─ Veramo-Sidecar	DIDComm Handler	src/veramo-sidecar.js
└─ Istio-Proxy	Envoy (auto-injected)	Istio injection
5.2 Security Variants		
└─ Encrypted: E2E	DIDCOMM_PACKING_MODE=encrypted	deploy/mtls-config/mtls-encrypted.yaml
└─ Signed: +mTLS	DIDCOMM_PACKING_MODE=signed	deploy/mtls-config/mtls-signed.yaml
5.3 Authentication Flow	3-Phasen-Protokoll	src/lib/didcomm/vp-wrapper.js
└─ Sequenzdiagramm	Dein Diagramm	tests/test-full-flow.sh
5.4 Cross-Cluster	Gateway-to-Gateway	deploy/cluster-*/gateway.yaml
6.1 Technology Stack		
└─ Kubernetes	Kind Clusters	deploy/cluster-*/kind-cluster-*.yaml
└─ Istio	Service Mesh	deploy/cluster-*/security.yaml
└─ Veramo	Agent Framework	src/lib/agent/veramo-agent.js
6.2 DID & Credential		
└─ did:web	GitHub Pages	dids/did-nf-*/did.json
└─ NetworkFunctionCredential	VC Schema	src/lib/credentials/vc-*.js
6.3 DIDComm Messages	Present Proof v3	src/lib/didcomm/messages.js
6.4 PEX Integration	Sphereon PEX	src/lib/credentials/vp-pex.js
7.1 Functional Validation	E2E Test	tests/tests/test-full-flow.sh
7.3 V1 vs V4a	Mode Switch	scripts/deploy/build-and-deploy.sh


1. Introduction (5 Seiten)
   1.1 Motivation and Problem Statement
   1.2 Objectives and Research Questions
   1.3 Contributions
   1.4 Structure of the Thesis

2. Cloud-Native Networking and Security (10 Seiten)
   2.1 Network Functions in 5G and 6G Systems
   2.2 Cloud-Native Architectures and Kubernetes
   2.3 Service Mesh, Proxies and Communication Model
       - Istio, Envoy, Sidecar Pattern
   2.4 Transport Layer Security and PKI
   2.5 Zero-Trust Principles

3. Decentralized Identity and Trust Technologies (10 Seiten)
   3.1 Decentralized Identifiers and DID Methods
       - Konzept, Aufbau, DID Document
       - did:web vs. did:peer
   3.2 Verifiable Credentials and Selective Disclosure
       - VC Data Model, JWT-VC, SD-JWT VC
   3.3 Secure Messaging with DIDComm
       - Protokollschichten, signed vs. encrypted
       - Veramo Agent Framework
   3.4 Presentation Exchange (DIF)
       - Presentation Definition, Trust Establishment

4. Related Work (6 Seiten)
   4.1 Existing Solutions for Secure Cloud Communication
       - Service Meshes, SPIFFE/SPIRE, OIDC, OAuth2
   4.2 DID-based Approaches and Multi-Cloud Challenges
       - Cross-Domain Trust, Interoperability
    4.2 DID-based Approaches and Cross-domain Challenges 
   4.3 Emerging Standards and Frameworks
       - DIDComm v2, SD-JWT, DIF Specifications

5. System Design (10 Seiten) / Metholody 5 pages!
5.1 Research Approach and Design Principles
5.2 Technology Selection
5.3 Evaluation Strategy and Metrics
   5.1 Architecture Overview
       - Sidecar Pattern: NF-Service + Veramo-Sidecar + Istio-Proxy
   5.2 Security Variants
       - V1: E2E Encrypted DIDComm + TCP (PERMISSIVE)
       - V4a: Signed DIDComm + mTLS (STRICT)
       - und andere Varianten s. Kommi vom Betreuer
   5.3 Authentication Flow
       - Mutual VP Exchange Protocol (3 Phasen)
       - Sequenzdiagramm
   5.4 Cross-Cluster Communication
       - ServiceEntry, Gateway-to-Gateway mTLS

6. Concept and Implementation (12 pages)
6.1 System Architecture and Components
6.2 Trust and Communication Model
6.3 Credential Exchange Workflow
6.4 Kubernetes-based Setup and Integration
6.5 Technical Implementation Details
6. Implementation (10 Seiten)
   6.1 Technology Stack
       - Kubernetes (Kind), Istio, Veramo, Node.js
   6.2 DID Document and Credential Design
       - did:web auf GitHub Pages
       - NetworkFunctionCredential Schema
   6.3 DIDComm Message Types
       - Present Proof Protocol v3
       - VP_AUTH_REQUEST → VP_WITH_PD → VP_RESPONSE → AUTH_CONFIRMATION
   6.4 Presentation Exchange Integration
       - PEX Library, Credential Selection, VP Verification

7. Evaluation (8 pages)
7.1 Evaluation Setup and Scenarios
7.2 Security and Performance Analysis
7.3 Limitations and Discussion
7. Evaluation (8 Seiten)
   7.1 Functional Validation
       - E2E Test, Authentication Flow
   7.2 Security Analysis
       - Threat Model, Attack Vectors
   7.3 Comparison: V1 vs. V4a
       - Trade-offs, Use Cases
   7.4 Limitations and Future Work

8. Conclusion (4 pages)
8.1 Summary of Key Findings
8.2 Outlook and Implications for Future Systems
8. Conclusion (3 Seiten)
   8.1 Summary
   8.2 Contributions
   8.3 Outlook

Anhang
   A. Code-Struktur und Repository
   B. Deployment-Anleitung
   C. DID Document Beispiele
