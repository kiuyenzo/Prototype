Die 3 Modi werden über zwei Einstellungen gesteuert:
1. Encrypted Mode (E2E verschlüsselt)

# In deploy/cluster-a/deployment.yaml:
- name: DIDCOMM_PACKING_MODE
  value: "encrypted"

# Dann deployen:
./scripts/deploy/build-and-deploy.sh
# → wendet automatisch mtls-encrypted.yaml an (PERMISSIVE)
Sicherheit: DIDComm E2E verschlüsselt (authcrypt/JWE), Pod↔Gateway: TCP
2. Signed Mode (mTLS + signiert)

# In deploy/cluster-a/deployment.yaml:
- name: DIDCOMM_PACKING_MODE
  value: "signed"

# Dann deployen:
./scripts/deploy/build-and-deploy.sh
# → wendet automatisch mtls-signed.yaml an (STRICT)
Sicherheit: DIDComm signiert (JWS), Pod↔Gateway: mTLS
3. Baseline Mode (nur mTLS, kein DIDComm)

# Manuell anwenden (für Performance-Vergleich):
kubectl apply -f deploy/mtls-config/mtls-baseline.yaml --context kind-cluster-a
kubectl apply -f deploy/mtls-config/mtls-baseline.yaml --context kind-cluster-b

# Test-Endpoint (umgeht Veramo):
curl -X POST http://<gateway>/baseline/request \
  -H "Content-Type: application/json" \
  -d '{"service":"nudm-sdm","action":"am-data"}'
Sicherheit: Nur mTLS, keine VPs, kein DIDComm - reine Baseline
Übersicht
Modus	DIDComm	Pod↔Gateway	Gateway↔Gateway	Anwendung
Encrypted	authcrypt (E2E)	TCP	mTLS	Zero Trust bis NF
Signed	JWS	mTLS	mTLS	Zero Trust außerhalb Cluster
Baseline	-	mTLS	mTLS	Performance-Vergleich


Ja, die Modi entsprechen exakt diesen Optionen:
Option	Modus	Implementierung
Option 1	encrypted	mtls-encrypted.yaml
Option 2	signed	mtls-signed.yaml
Mapping
Option 1 = Encrypted Mode:

(NF, Veramo, Envoy) ←─TCP─→ Gateway ←═mTLS═→ Gateway ←─TCP─→ (Envoy, Veramo, NF)
         └────────────── DIDComm authcrypt (E2E) ──────────────┘
Confidentiality: DIDComm E2E (JWE)
Integrity + Authenticity: DIDComm E2E
Zero Trust: Bis zur NF (auch Cluster-intern nicht vertraut)
Option 2 = Signed Mode:

(NF, Veramo, Envoy) ═mTLS═► Gateway ═══mTLS═══► Gateway ═mTLS═► (Envoy, Veramo, NF)
         └────────────── DIDComm signed (JWS) ──────────────┘
Confidentiality: mTLS (Transport)
Integrity + Authenticity: DIDComm E2E (JWS)
Zero Trust: Nur außerhalb des Clusters
Sicherheitsgarantien
Eigenschaft	Option 1 (Encrypted)	Option 2 (Signed)
E2E Confidentiality	DIDComm (App)	mTLS (Transport)
E2E Integrity	DIDComm (App)	DIDComm (App)
E2E Authenticity	DIDComm (App)	DIDComm (App)
Gateway kann lesen	Nein	Ja (nur Payload)
Die Implementierung entspricht 1:1 den Betreuer-Vorgaben.