# Final E2E Tests

Diese Tests validieren den kompletten VP-Authentifizierungsflow des Prototyps.

## Tests

### 1. test-functional-correctness.sh
Funktionale Korrektheitstests (F1-F5):
- **F1**: End-to-End Request (NF-A -> NF-B)
- **F2**: Credential Matching
- **F3**: Credential Mismatch (Negativtest)
- **F4**: Session Persistence
- **F5**: Cross-Domain Setup

```bash
./tests/final/test-functional-correctness.sh
```

### 2. test-sequence-e2e.sh
Visualisiert den VP-Flow entsprechend dem Sequenzdiagramm:
- **Phase 1**: VP_AUTH_REQUEST (NF-A -> NF-B)
- **Phase 2**: VP Exchange (VP_B + PD_B, VP_A)
- **Phase 3**: AUTH_CONFIRMATION + Service Request/Response

```bash
# Standard
./tests/final/test-sequence-e2e.sh

# Mit Pod-Logs (zeigt interne Phasen)
./tests/final/test-sequence-e2e.sh --with-logs
```

## Sequenzdiagramm -> Test Mapping

```
Sequenzdiagramm                          DIDComm Message Type
---------------------------------------------------------------------------
Phase 1: VP_AUTH_REQUEST + PD_A    ->    present-proof/3.0/request-presentation
Phase 2: VP_B + PD_B               ->    present-proof/3.0/presentation-with-definition
Phase 2: VP_A                      ->    present-proof/3.0/presentation
Phase 3: AUTH_CONFIRMATION         ->    present-proof/3.0/ack
Phase 3: SERVICE_REQUEST           ->    service/1.0/request
Phase 3: SERVICE_RESPONSE          ->    service/1.0/response
```

## Voraussetzungen

- Beide KinD Cluster laufen (`kind-cluster-a`, `kind-cluster-b`)
- Pods sind deployed und healthy
- Istio Gateways konfiguriert

```bash
# Cluster-Status pruefen
kubectl get pods -n nf-a-namespace --context kind-cluster-a
kubectl get pods -n nf-b-namespace --context kind-cluster-b
```

## Pod-Logs fuer Thesis-Screenshots

Die internen Phasen werden in den Veramo-Sidecar Logs angezeigt:

```bash
# NF-A Logs (zeigt ausgehende Requests)
kubectl logs -n nf-a-namespace -l app=nf-a -c veramo-sidecar --context kind-cluster-a

# NF-B Logs (zeigt eingehende Requests)
kubectl logs -n nf-b-namespace -l app=nf-b -c veramo-sidecar --context kind-cluster-b
```

Erwartete Log-Ausgaben:
```
Phase 1: VP Auth Request -> did-nf-b
Phase 2: VP Auth Request from did-nf-a
Phase 2: Handling VP_WITH_PD from did-nf-b
Phase 2 final: VP Response from did-nf-a
Phase 3: Auth Confirmation [OK]
Mutual authentication successful!
```
