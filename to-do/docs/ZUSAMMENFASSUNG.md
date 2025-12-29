# Prototyp-Zusammenfassung: DIDComm v2 für 5G Network Functions


## Was macht dieser Prototyp?

Dieser Prototyp demonstriert **sichere Kommunikation zwischen zwei 5G Network Functions (NFs)**, die in verschiedenen Kubernetes-Clustern laufen. Statt klassischer Zertifikats-basierter Authentifizierung nutzt er **dezentrale Identitäten (DIDs)** und **Verifiable Credentials**.

## Die drei Hauptkomponenten

### 1. Zwei Kubernetes-Cluster
```
Cluster-A (172.23.0.2)          Cluster-B (172.23.0.3)
    ├── NF-A Pod                    ├── NF-B Pod
    ├── Istio Gateway               ├── Istio Gateway
    └── mTLS Zertifikate            └── mTLS Zertifikate
```

### 2. DIDComm v2 Messaging
- **End-to-End verschlüsselte Nachrichten** zwischen NF-A und NF-B
- Jede NF hat eine eigene **dezentrale Identität (DID)**
- Nachrichten werden mit **JWE (JSON Web Encryption)** verschlüsselt

### 3. Verifiable Credentials
- Jede NF besitzt ein **NetworkFunctionCredential**
- Bei jeder Kommunikation wird ein **Verifiable Presentation (VP)** ausgetauscht
- Damit beweist jede NF ihre Identität und Berechtigung

## Wie funktioniert die Kommunikation?

### Schritt-für-Schritt:

```
NF-A (Cluster-A)                                    NF-B (Cluster-B)
     │
     │ 1. Möchte mit NF-B kommunizieren
     │
     │ 2. Verschlüsselt Nachricht mit NF-B's Public Key
     │    (DIDComm JWE Encryption)
     │
     │ 3. Sendet über Istio Gateway mit mTLS
     ├──────────────────────────────────────────────►│
     │         Gateway-to-Gateway mTLS                │
     │         (Transport-Sicherheit)                 │
     │                                                │
     │                                                │ 4. Gateway empfängt
     │                                                │    (mTLS verifiziert)
     │                                                │
     │                                                │ 5. NF-B entschlüsselt
     │                                                │    mit privatem Key
     │                                                │
     │                                                │ 6. VP Request erhalten
     │                                                │    "Beweise deine Identität"
     │                                                │
     │                                                │ 7. NF-B erstellt VP
     │                                                │    mit Credential
     │                                                │
     │ 8. NF-A empfängt VP Response                   │
     │◄──────────────────────────────────────────────┤
     │                                                │
     │ 9. NF-A verifiziert VP                        │
     │    - Signature prüfen                         │
     │    - Credential validieren                    │
     │                                                │
     │ 10. Authentifizierung erfolgreich!            │
     │     Jetzt kann Business-Kommunikation starten │
     │                                                │
```

## Die Sicherheits-Schichten

Dein Prototyp hat **4 Sicherheitsschichten** (Defense in Depth):

### Layer 1: Network Security
- **Docker Network Isolation**
- Nur definierte Ports (30451, 30452) sind erreichbar

### Layer 2: Transport Security (Istio mTLS)
- **Gateway-to-Gateway mTLS**
- X.509 Zertifikate zwischen den Clustern
- Verhindert Man-in-the-Middle Angriffe

### Layer 3: Application Security (Credentials)
- **Verifiable Credentials** für Authentifizierung
- Jede NF muss sich mit VP ausweisen
- **Presentation Exchange** definiert was gezeigt werden muss

### Layer 4: End-to-End Security (DIDComm)
- **JWE Verschlüsselung** auf Nachrichtenebene
- Nur Empfänger kann Nachricht lesen
- Unabhängig vom Transportweg

## Wichtige Technologien

### 🔐 Veramo Framework
- Verwaltet DIDs und Credentials
- Erstellt und verifiziert VPs
- Speichert alles in SQLite-Datenbank

### 📡 DIDComm v2
- Protokoll für sichere Peer-to-Peer Kommunikation
- Nutzt JWE für Verschlüsselung
- Nutzt Ed25519/X25519 Kryptographie

### 🌐 Istio Service Mesh
- Gateway-to-Gateway mTLS
- Traffic Management zwischen Clustern
- VirtualServices für Routing

### 🆔 did:web
- DID-Methode basierend auf Webdomains
- Deine DIDs liegen auf GitHub Pages
- Beispiel: `did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a`

## Projekt-Struktur

```
/Users/tanja/Desktop/Prototype/
├── cluster-a/                          # Cluster-A Konfiguration
│   ├── 01-namespace.yaml               # Namespace mit Istio-Injection
│   ├── 02-deployment.yaml              # NF-A Pod + Service
│   ├── 03-istio-gateway.yaml           # Gateway, VirtualService, mTLS
│   └── database-nf-a.sqlite            # Veramo Datenbank
│
├── cluster-b/                          # Cluster-B Konfiguration
│   ├── 01-namespace.yaml
│   ├── 02-deployment.yaml              # NF-B Pod + Service
│   ├── 03-istio-gateway.yaml
│   └── database-nf-b.sqlite
│
├── shared/                             # Gemeinsamer Code für beide NFs
│   ├── didcomm-http-server.ts          # HTTP Server für DIDComm
│   ├── didcomm-encryption.ts           # DIDComm Verschlüsselung
│   ├── veramo-agent.ts                 # Veramo Agent Setup
│   ├── did-resolver-cache.ts           # DID Resolution mit Cache
│   └── create-self-signed-credential.js # Credential-Erstellung
│
├── certs/                              # mTLS Zertifikate
│   ├── ca-cert.pem                     # Root CA
│   ├── cluster-a-server-cert-new.pem   # Server Cert A
│   ├── cluster-a-client-cert.pem       # Client Cert A
│   ├── cluster-b-server-cert-new.pem   # Server Cert B
│   └── cluster-b-client-cert.pem       # Client Cert B
│
├── Dockerfile                          # Container-Image Definition
├── entrypoint.sh                       # Startup-Script (auto-create credentials)
├── setup-clusters.sh                   # Vollautomatisches Setup
└── test-vp-flow-kubernetes.sh          # End-to-End Tests (42 Tests)
```

## Startup-Prozess (entrypoint.sh)

Wenn ein NF-Pod startet:

```bash
1. ✅ Erkenne Cluster (A oder B) anhand Environment Variable
2. ✅ Prüfe Datenbank-Pfad
3. ✅ Zähle vorhandene Credentials
4. ❓ Credentials vorhanden?
   ├─ JA  → Weiter zu Schritt 5
   └─ NEIN → Erstelle self-signed NetworkFunctionCredential
5. ✅ Starte DIDComm HTTP Server
```

**Vorteil**: Credentials werden automatisch erstellt, auch wenn Pod neu startet!

## Setup in einem Befehl

```bash
./setup-clusters.sh
```

Das Script macht automatisch:
1. Docker Network erstellen
2. 2 Kind Clusters erstellen
3. Istio in beiden Clusters installieren
4. Docker Image bauen (`veramo-nf:phase7`)
5. mTLS Zertifikate generieren
6. Kubernetes Secrets erstellen
7. Istio Gateways patchen
8. NF-A und NF-B deployen
9. Health Checks durchführen

**Dauer**: ~5-10 Minuten

## Testing

```bash
./test-vp-flow-kubernetes.sh
```

**42 Tests** in 5 Kategorien:
1. **Cluster Connectivity** (2 Tests)
2. **DIDComm Encryption** (2 Tests)
3. **DID Resolution** (2 Tests)
4. **Credential Management** (4 Tests)
5. **Bidirectional VP Flow** (32 Tests)

**Erwartetes Ergebnis**: 100% Pass-Rate (42/42)

## DIDs und Credentials

### DID-Struktur
```
NF-A: did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a
NF-B: did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b

DID Document URL:
https://kiuyenzo.github.io/Prototype/dids/did-nf-a/did.json
```

### NetworkFunctionCredential
```json
{
  "type": ["VerifiableCredential", "NetworkFunctionCredential"],
  "issuer": "did:web:...:did-nf-a",  // Self-signed!
  "credentialSubject": {
    "id": "did:web:...:did-nf-a",
    "role": "network-function",
    "clusterId": "cluster-a",
    "status": "active",
    "capabilities": ["messaging", "verification"]
  }
}
```

**Self-signed**: Die NF signiert ihr eigenes Credential (Issuer = Subject)

## Warum ist das besser als klassische Ansätze?

### ✅ Dezentral
- Keine zentrale Certificate Authority (CA) für DIDs
- Jede NF kontrolliert ihre eigene Identität

### ✅ Zero Trust
- Jede Nachricht erfordert VP-Authentifizierung
- Keine implizite Trust innerhalb des Clusters

### ✅ End-to-End Sicherheit
- DIDComm-Verschlüsselung unabhängig vom Transportweg
- Auch wenn Gateway kompromittiert wird, sind Nachrichten sicher

### ✅ Flexible Credentials
- Presentation Exchange ermöglicht selektive Disclosure
- Nur notwendige Attribute werden gezeigt

### ✅ Roaming-Ready
- V1/V4a Interface mit mTLS (3GPP konform)
- Funktioniert über Netzwerk-Grenzen hinweg

## Limitierungen (Prototyp)

⚠️ **Keine PersistentVolumes**: Datenbank im Container
   - **Lösung**: Startup-Script erstellt Credentials automatisch neu

⚠️ **Self-signed Credentials**: Keine separate Issuer-Authority
   - **Für Prototyp OK**: Vereinfacht Setup

⚠️ **Manuelle Zertifikate**: Keine automatische Rotation
   - **Produktions-Ansatz**: cert-manager Integration

⚠️ **Single Replica**: Keine High Availability
   - **Produktions-Ansatz**: StatefulSets mit 3+ Replicas

## Nächste Schritte (Produktions-Ready)

1. **PersistentVolumeClaims** für Datenbanken
2. **cert-manager** für automatische Zertifikatsverwaltung
3. **Multi-Replica Deployments** mit StatefulSets
4. **Prometheus/Grafana** Monitoring
5. **Jaeger** Distributed Tracing
6. **Network Policies** für zusätzliche Isolation
7. **Credential Revocation** (Status List 2021)
8. **Separate Issuer-DIDs** statt self-signed

## Zusammenfassung in einem Satz

**Dieser Prototyp zeigt, wie 5G Network Functions über Cluster-Grenzen hinweg sicher mit DIDComm v2, Verifiable Credentials und Istio mTLS kommunizieren können - mit automatischer Credential-Erstellung und 100% Test-Coverage.**

---

## Schnellstart

```bash
# 1. Setup (einmalig)
./setup-clusters.sh

# 2. Tests ausführen
./test-vp-flow-kubernetes.sh

# 3. Logs anschauen
kubectl logs -f deployment/nf-a -n nf-a-namespace --context kind-cluster-a
kubectl logs -f deployment/nf-b -n nf-b-namespace --context kind-cluster-b

# 4. Cleanup
kind delete cluster --name cluster-a
kind delete cluster --name cluster-b
docker network rm kind
```

## Wichtige Konzepte visualisiert

### DIDComm Message Flow
```
1. NF-A erstellt Nachricht
2. NF-A resolved NF-B's DID → holt Public Key
3. NF-A verschlüsselt mit NF-B's X25519 Key (JWE)
4. NF-A sendet über Istio Gateway (mTLS)
5. NF-B empfängt über Istio Gateway (mTLS)
6. NF-B entschlüsselt mit privatem X25519 Key
7. NF-B verarbeitet Nachricht
```

### VP Exchange Flow
```
1. NF-A sendet VP Request mit Presentation Definition
   "Zeig mir dein NetworkFunctionCredential"

2. NF-B sucht matching Credentials in Datenbank

3. NF-B erstellt Verifiable Presentation
   - Wählt Credentials aus
   - Signiert mit Ed25519 Key

4. NF-B sendet VP Response

5. NF-A verifiziert VP
   - Signature Check (Ed25519)
   - Presentation Definition Match
   - Credential Status Check

6. Authentifizierung ✅
```

Das ist dein Prototyp in Kürze! 🚀
