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



Switch to Encrypted mode:

kubectl apply -f deploy/mtls-config/mtls-encrypted.yaml --context kind-cluster-a
kubectl apply -f deploy/mtls-config/mtls-encrypted.yaml --context kind-cluster-b
# DIDCOMM_PACKING_MODE="encrypted" in deployment.yaml

Switch to Signed mode:

kubectl apply -f deploy/mtls-config/mtls-signed.yaml --context kind-cluster-a
kubectl apply -f deploy/mtls-config/mtls-signed.yaml --context kind-cluster-b
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

Main Goal: Shows that VP-based authentication with DIDComm can work as an alternative to OAuth2 in 5G SBI (Service Based Interface) in cloud environments.
Implemented Security Variants
Variant	Internal (Pod)	Between Gateways	DIDComm	Zero Trust Level
V1	TCP	mTLS	authcrypt (E2E encrypted)	Up to NF
V4a	mTLS	mTLS	signed/JWS	Outside cluster
5G Integration (3GPP TS 29.503 - Nudm_SDM)
REST endpoints: /nudm-sdm/v2/{supi}/am-data, /nudm-sdm/v2/{supi}/nssai
Subscriber data: SUPI, GPSI, NSSAI, AMBR, DNN
Both direct REST and DIDComm-wrapped calls work
Architecture

Cluster-A                              Cluster-B
┌─────────────────┐                    ┌─────────────────┐
│ Pod (NF-A)      │                    │ Pod (NF-B/UDM)  │
│ ┌─────────────┐ │                    │ ┌─────────────┐ │
│ │ NF-Service  │ │                    │ │ NF-Service  │ │
│ │ (5G REST)   │ │                    │ │ (5G REST)   │ │
│ └──────┬──────┘ │                    │ └──────┬──────┘ │
│ ┌──────┴──────┐ │                    │ ┌──────┴──────┐ │
│ │ Veramo      │ │    DIDComm+VP      │ │ Veramo      │ │
│ │ (VP Auth)   │◄├────────────────────┤►│ (VP Verify) │ │
│ └──────┬──────┘ │                    │ └──────┬──────┘ │
│ ┌──────┴──────┐ │                    │ ┌──────┴──────┐ │
│ │ Istio Proxy │ │       mTLS         │ │ Istio Proxy │ │
│ └──────┬──────┘ │                    │ └──────┬──────┘ │
└────────┼────────┘                    └────────┼────────┘
         │                                      │
    Istio Gateway ◄────────mTLS────────► Istio Gateway
Your prototype successfully demonstrates that DIDComm with Verifiable Presentations can replace OAuth2 token-based authentication in 5G network function communication.


Not exactly "replace" - your goal is more nuanced: Your actual goal:
Zeigen, dass VP-basierte Authentifizierung mit DIDComm als Alternative zu OAuth2 in 5G SBI funktionieren kann.
Unterschied:
Formulierung	Bedeutung
"replace OAuth2"	OAuth2 ist schlecht, VP ist besser → muss bewiesen werden
"Alternative zu OAuth2"	VP ist eine weitere Option → Machbarkeit zeigen
Was dein Prototyp zeigt:
Machbarkeit (Feasibility) - DIDComm + VP funktioniert technisch in 5G-Umgebung
Verschiedene Security-Varianten - V1 (Zero Trust NF) und V4a (Zero Trust Cluster) sind möglich
Integration mit 5G APIs - UDM Subscriber Data (3GPP TS 29.503) funktioniert über DIDComm
Dezentrale Authentifizierung - Kein zentraler Authorization Server nötig (vs. OAuth2 NRF)
Bessere Formulierung für deine Thesis:
"Der Prototyp demonstriert, dass Verifiable Presentations über DIDComm v2 eine viable Alternative zu OAuth2-basierter Authentifizierung in 5G Service Based Interfaces darstellen können - insbesondere für Inter-PLMN und Multi-Cloud Szenarien, wo dezentrale Identitäten Vorteile bieten."
Das ist realistischer als "replace" und passt besser zu einem Proof-of-Concept.




###

Dein Betreuer erklärt die Architektur sehr präzise. Lass mich das als Diagramm darstellen:

Cluster-A                                              Cluster-B
┌────────────────────────────────────┐                ┌────────────────────────────────────┐
│                                    │                │                                    │
│  ┌─────────────────────────────┐   │                │   ┌─────────────────────────────┐  │
│  │ NF-A Pod                    │   │                │   │ NF-B Pod                    │  │
│  │ ┌─────────┐  ┌────────────┐ │   │                │   │ ┌────────────┐  ┌─────────┐ │  │
│  │ │ NF      │  │ Veramo     │ │   │   DIDComm E2E  │   │ │ Veramo     │  │ NF      │ │  │
│  │ │ Service │──│ Sidecar    │─┼───┼────────────────┼───┼─│ Sidecar    │──│ Service │ │  │
│  │ └─────────┘  └────────────┘ │   │   (authcrypt)  │   │ └────────────┘  └─────────┘ │  │
│  │         ┌────────────┐      │   │                │   │      ┌────────────┐         │  │
│  │         │ Envoy      │      │   │                │   │      │ Envoy      │         │  │
│  │         │ Sidecar    │      │   │                │   │      │ Sidecar    │         │  │
│  │         └─────┬──────┘      │   │                │   │      └─────┬──────┘         │  │
│  └───────────────┼─────────────┘   │                │   └────────────┼────────────────┘  │
│                  │                 │                │                │                   │
│           TCP oder mTLS            │                │          TCP oder mTLS             │
│           (konfigurierbar)         │                │          (konfigurierbar)          │
│                  │                 │                │                │                   │
│  ┌───────────────┼─────────────┐   │                │   ┌────────────┼────────────────┐  │
│  │ Gateway-Proxy │             │   │     mTLS       │   │            │ Gateway-Proxy  │  │
│  │ ┌─────────────┴───────────┐ │   │    (immer)     │   │ ┌──────────┴──────────────┐ │  │
│  │ │ Istio Gateway + Envoy   │◄├───┼────────────────┼───┤►│ Istio Gateway + Envoy   │ │  │
│  │ └─────────────────────────┘ │   │                │   │ └─────────────────────────┘ │  │
│  └─────────────────────────────┘   │                │   └─────────────────────────────┘  │
│                                    │                │                                    │
└────────────────────────────────────┘                └────────────────────────────────────┘
Was dein Betreuer sagt:
Strecke	Immer	Konfigurierbar
Gateway ↔ Gateway	mTLS ✅	-
NF ↔ Gateway (intern)	-	TCP / mTLS
NF ↔ NF (E2E)	-	DIDComm authcrypt / signed
Seine Schlüsselaussage:
"DIDComm E2E zum Gateway macht keinen Sinn - dann kann man gleich mTLS verwenden"
Das bedeutet:
mTLS: Terminiert beim Gateway → Hop-by-Hop Verschlüsselung
DIDComm E2E: NF-A ↔ NF-B direkt → Ende-zu-Ende über alle Hops
Dein Prototyp macht genau das:
Variante	NF ↔ Gateway	Gateway ↔ Gateway	NF ↔ NF (E2E)
V1	TCP	mTLS	DIDComm authcrypt
V4a	mTLS	mTLS	DIDComm signed
Der Prototyp ist korrekt implementiert.


Supervisor's Sicht:                    Dein Prototyp:
─────────────────────                  ──────────────────
C-PLMN                                 Cluster-A
  └─ NF (Consumer)                       └─ NF-A (AMF)
  └─ Envoy Sidecar                       └─ Veramo Sidecar + Envoy
  └─ SEPP                                └─ Istio Gateway
       │                                      │
       │ mTLS + DIDComm E2E                   │ mTLS + DIDComm E2E
       │                                      │
P-PLMN                                 Cluster-B
  └─ SEPP                                └─ Istio Gateway
  └─ Envoy Sidecar                       └─ Veramo Sidecar + Envoy
  └─ NF (Producer)                       └─ NF-B (UDM)




Dein Betreuer meint, dass du in der Thesis (nicht im Prototyp) alle Varianten theoretisch diskutieren sollst: Was er will:
Alle Varianten auflisten (wie er es getan hat)
Pro/Contra für jede (kurzer Absatz)
Trust-Modell erklären (welche Annahmen stecken dahinter?)
Beispiel für die Thesis:
Variante	Trust-Grenze	Pro	Contra
V1	NF-zu-NF	Höchste Sicherheit, E2E	Mehr Overhead
V2a/b	NF-Gateway	Flexibel, Gateway kann inspizieren	Komplexer Key-Management
V3a	Cluster-Grenze (TCP intern)	Einfach, wenig Overhead	Kein Schutz im Cluster
V4a	Cluster-Grenze (mTLS intern)	Gute Balance	Vertraut Cluster-Infrastruktur
V5	Direkt (ohne Gateway)	Am einfachsten	Praktisch nie möglich
"Zero Trust ist nicht gleich Zero Trust":

Organisation A:  "Zero Trust = Wir vertrauen nichts außerhalb des Clusters"
                 → V4a reicht

Organisation B:  "Zero Trust = Wir vertrauen nicht mal unserem eigenen Cluster"
                 → V1 nötig

Organisation C:  "Zero Trust = Gateway muss Traffic inspizieren können"
                 → V2a/V3b
Für deine Thesis:
Prototyp: Implementiert V1 und V4a (als Beispiele)
Thesis: Diskutiert alle Varianten theoretisch mit Trust-Modellen
Argument: DIDComm v2 ermöglicht alle Varianten durch flexible Packing-Modi
Der Prototyp muss nicht alle implementieren - er zeigt nur, dass DIDComm flexibel genug ist.


Option 1 (Betreuer):
├── E2E Confidentiality    → DIDComm authcrypt ✅
├── E2E Integrity          → DIDComm authcrypt ✅
├── E2E Authenticity       → DIDComm authcrypt ✅
└── Zero Trust bis NF      → TCP intern (kein Vertrauen in Cluster) ✅

V1 (Dein Prototyp):
├── DIDCOMM_PACKING_MODE=encrypted (authcrypt)
├── PeerAuthentication: PERMISSIVE
└── DestinationRule: tls.mode=DISABLE (TCP)

Option 2/4a (Betreuer):
├── E2E Integrity          → DIDComm signed ✅
├── E2E Authenticity       → DIDComm signed ✅
├── Confidentiality        → mTLS (Transport) ✅
└── Zero Trust außerhalb   → mTLS intern (vertraut Cluster) ✅

V4a (Dein Prototyp):
├── DIDCOMM_PACKING_MODE=signed (JWS)
├── PeerAuthentication: STRICT (mTLS)
└── Keine DestinationRule (mTLS aktiv)



Ja, das Sequenzdiagramm entspricht deiner Implementierung. Hier das Mapping: Diagramm → Dein Prototyp:
Diagramm	Dein Prototyp	Datei
NF_A	nf-service Container	nf-service.js
Veramo_NF_A	veramo-sidecar Container	veramo-sidecar.js
Envoy_Proxy_NF_A	Istio auto-injected sidecar	(automatisch)
Envoy_Gateway_A	Istio Ingress Gateway	infrastructure.yaml
Phasen-Vergleich:

Diagramm Phase 1:              Dein Code:
─────────────────              ──────────
NF_A → Veramo_NF_A             POST /request → sendServiceRequestToVeramo()
Veramo_NF_A: Resolve DID       resolveDid(targetDid)
Veramo_NF_A → VP_Auth_Request  handleServiceRequest() → sendVpAuthRequest()

Diagramm Phase 2:              Dein Code:
─────────────────              ──────────
VP_Auth_Request empfangen      handleDIDCommMessage() case 'vp-auth-request'
Create VP_B based on PD_A      createPresentationFromPD()
Send VP_B + PD_B               sendDIDCommMessage() mit VP + eigene PD
Verify VP_B                    verifyPresentation()
Create VP_A based on PD_B      createPresentationFromPD()
Verify VP_A                    verifyPresentation()

Diagramm Phase 3:              Dein Code:
─────────────────              ──────────
Authorized                     case 'authorized' → pendingRequests
Service_Request                case 'service-request' → callNFService()
NF_B: Service Response         POST /service → handleServiceRequest()
Service_Response               case 'service-response' → resolve()
Einziger Unterschied: Das Diagramm zeigt mTLS überall - dein Prototyp kann zwischen TCP (V1) und mTLS (V4a) wechseln. Das Diagramm ist korrekt für deine Implementierung.