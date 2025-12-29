Dein Prototyp demonstriert VP-basierte (Verifiable Presentation) Authentifizierung mit DIDComm als Alternative zu OAuth2 in der 5G Network Function Kommunikation. Das Setup ist für deine Masterarbeit über Zero-Trust Security mit dezentralen Identitäten konzipiert.
Architektur
Drei-Container Sidecar-Pattern pro Pod:

┌─────────────────────────────────────┐
│ NF-Service (Port 3000)              │ ← 5G Business Logic (nudm-sdm)
│ Veramo Sidecar (Port 3001)          │ ← DIDComm & VP Exchange
│ Istio Envoy (auto-injected)         │ ← mTLS Proxy
└─────────────────────────────────────┘
Zwei KinD Kubernetes Cluster:
Cluster-A mit NF-A (simuliert AMF)
Cluster-B mit NF-B (simuliert UDM)
Sicherheitsvarianten
Variante	DIDComm	Transport	Zweck
V1	End-to-End encrypted (authcrypt)	TCP + mTLS Gateway	Zero-Trust bis zum NF
V4a	Signed/JWS	mTLS durchgängig	Vereinfacht, mTLS-basiert
Wichtige Verzeichnisse
Pfad	Inhalt
src/	Quellcode (nf-service.js, veramo-sidecar.js, lib/)
deploy/	Kubernetes Manifeste, Dockerfiles, mTLS Configs
dids/	DID Dokumente (did:web auf GitHub Pages)
data/	SQLite Datenbanken mit Credentials & Keys
tests/	F1-F5, G1-G4, S1-S5, P1-P4 Test-Suiten
certs/	Cross-Cluster mTLS Zertifikate
Technologie-Stack
Identity: Veramo v6, DIDComm v2, @sphereon/pex
Credentials: W3C Verifiable Credentials, did:web
Infrastructure: Kubernetes (KinD), Istio Service Mesh
Runtime: Node.js 20, SQLite + TypeORM
VP-Authentifizierungsflow (3 Phasen)

NF-A                                    NF-B
  │ ──── VP_AUTH_REQUEST (PD-A) ────►    │
  │ ◄─── VP_WITH_PD (VP-B + PD-B) ────   │
  │ ──── VP_RESPONSE (VP-A) ──────────►  │
  │ ◄─── AUTH_CONFIRMATION ───────────   │
  │ ──── SERVICE_REQUEST ─────────────►  │
  │ ◄─── SERVICE_RESPONSE ────────────   │
Möchtest du Details zu einem bestimmten Bereich sehen (z.B. VP-Flow, Istio-Config, Tests, Performance-Ergebnisse)?