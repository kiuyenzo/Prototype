# Framkeworks

Deine Frameworks
Kategorie	Framework/Tool	Zweck
Identity	Veramo	DID/VC/VP Management
Messaging	DIDComm v2	Sichere Kommunikation
Presentation	Sphereon PEX	Presentation Exchange
Container	Docker	Container-Images
Orchestrierung	Kubernetes (Kind)	Cluster-Management
Service Mesh	Istio	mTLS, Gateway, Policies
Datenbank	SQLite + TypeORM	Persistenz
DID-Methode	did:web	Dezentrale Identität
Runtime	Node.js	JavaScript Runtime
Sprache	TypeScript/JavaScript	Code


V1:  [Pod]───TCP───►[Gateway]═══mTLS═══►[Gateway]───TCP───►[Pod]
            └─────────── DIDComm(authcrypt) E2E ───────────┘

V4a: [Pod]═══mTLS══►[Gateway]═══mTLS═══►[Gateway]═══mTLS══►[Pod]
            └─────────── DIDComm(JWS) signed ──────────────┘



Zu V1 wechseln:

kubectl apply -f deploy/mtls-config/mtls-v1.yaml --context kind-cluster-a
kubectl apply -f deploy/mtls-config/mtls-v1.yaml --context kind-cluster-b
# DIDCOMM_PACKING_MODE="encrypted" in deployment.yaml
Zu V4a wechseln:

kubectl apply -f deploy/mtls-config/mtls-v4a.yaml --context kind-cluster-a
kubectl apply -f deploy/mtls-config/mtls-v4a.yaml --context kind-cluster-b
# DIDCOMM_PACKING_MODE="signed" in deployment.yaml


Option 1 - 1: Ende-zu-Ende Confidentiality, Integrity und Authenticity auf Applikationsebene  (Annahme: Zero Trust Architektur bis zur NF)
Option 2 -4a: Ende-zu-Ende Integrity and Authenticity auf Applikationsebene + Confidentiality zwischen den Proxies mit mTLS auf Transportebene (Annahme: Zero Trust nur außerhalb des Clusters.)

V1:
(nf, agent ,proxy) <- TCP+DIDComm(encrypted end-to-end NF-NF)->Gateway<-mTLS+DIDComm (encrypted end-to-end NF-NF)-> Gateway…
V4a:
(nf, agent, proxy) <- mTLS+DIDComm(unencrypted)>Gateway<-mTLS+DIDComm (unencrypted)-> Gateway<…


Ja, genau! Das zeigt, dass dein Prototyp das 5G Service Based Interface (SBI) mit DIDComm-Authentifizierung kombinieren kann.

┌─────────────────────────────────────────────────────────────────────────────┐
│                         5G Core Network mit DIDComm                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   NF-A (AMF)                              NF-B (UDM)                        │
│   ┌─────────────┐                         ┌─────────────┐                   │
│   │ AMF Logic   │                         │ UDM Logic   │                   │
│   │             │  ══DIDComm+VP-Auth══►   │             │                   │
│   │ Request:    │                         │ Subscriber  │                   │
│   │ nudm-sdm    │  ◄══════════════════    │ Database    │                   │
│   └─────────────┘      5G Response        └─────────────┘                   │
│                                                                             │
│   Anfrage: GET /nudm-sdm/v2/{supi}/am-data (3GPP TS 29.503)                 │
└─────────────────────────────────────────────────────────────────────────────┘

Der Prototyp zeigt, dass VP-basierte Authentifizierung über DIDComm als Alternative oder Ergänzung zu OAuth2/TLS in 5G SBI funktioniert - mit echten 3GPP-konformen Endpunkten wie nudm-sdm.

Ja, das ist im Prototyp abgedeckt! Hier ist der Vergleich:
Anforderungen vs. Implementierung
Anforderung	Im Prototyp	Status
Netzelement mit REST-API	NF-A (AMF) + NF-B (UDM)	✅
REST nach außen anbieten	/nudm-sdm/v2/{supi}/am-data	✅
REST konsumieren (5G-Endpoint)	NF-A → DIDComm → NF-B	✅
Mapping + Mini-Logik	getSubscriberData()	✅
Echte 3GPP-Struktur	TS 29.503 (Nudm_SDM)	✅
Simpel (kein komplexes Auth)	VP statt OAuth2	✅
Dein Flow entspricht genau dem Storyboard

1. Client → NF-A:     POST /request {service:"nudm-sdm", supi:"imsi-..."}
                              ↓
2. NF-A → DIDComm → NF-B:    VP-Auth + Service-Request
                              ↓
3. NF-B intern:              GET /nudm-sdm/v2/imsi-.../am-data
                              ↓
4. NF-B → DIDComm → NF-A:    {gpsis:["msisdn-..."], subscribedUeAmbr:...}
                              ↓
5. NF-A → Client:            Vereinfachte Response
Was du MEHR hast als gefordert
"Ganz simpel" sagt	Dein Prototyp hat
Kein komplettes 3GPP-Security	VP-Auth (besser als OAuth2-Stub)
Höchstens Stub-Auth	Echte kryptographische Verifikation
Kein Service Mesh	Istio mit mTLS zwischen Clustern
Fazit: Dein Prototyp erfüllt die Anforderung "echten 5G-REST-Endpunkt simpel integrieren" - und geht sogar darüber hinaus mit VP-basierter Authentifizierung.