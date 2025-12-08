#!/bin/bash
# DIDComm Test mit Veramo CLI

FROM_DID="did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a"
TO_DID="did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b"
POD_A="nf-a-76c7686b89-hv92b"
POD_B="nf-b-856fd58967-mlts4"

echo "=== 1. Verfügbare Methoden in NF-A prüfen ==="
kubectl config use-context kind-cluster-a
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
wget -qO- --header='Authorization: Bearer test123' http://localhost:7001/open-api.json 2>&1 | grep -o '\"sendDIDCommMessage\"\\|\"packDIDCommMessage\"\\|\"sendMessageDIDComm\"' | head -5
"

echo ""
echo "=== 2. Test: packDIDCommMessage ==="
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
wget -qO- --post-data='{
  \"jsonrpc\": \"2.0\",
  \"id\": 1,
  \"method\": \"packDIDCommMessage\",
  \"params\": {
    \"packing\": \"authcrypt\",
    \"message\": {
      \"type\": \"https://didcomm.org/basicmessage/2.0/message\",
      \"from\": \"$FROM_DID\",
      \"to\": [\"$TO_DID\"],
      \"id\": \"test-$(date +%s)\",
      \"body\": {
        \"content\": \"Hello from NF-A via DIDComm!\"
      }
    }
  }
}' --header='Content-Type: application/json' --header='Authorization: Bearer test123' http://localhost:7001/agent 2>&1
"

echo ""
echo "=== 3. Cluster-übergreifende Erreichbarkeit testen ==="
echo "Testing if NF-A can reach NF-B gateway..."
kubectl exec -n nf-a-namespace $POD_A -c istio-proxy -- sh -c "
wget -qO- --spider http://nf-b-didcomm-gateway.nf-b-namespace.svc.cluster.local:80 2>&1 | head -5
" || echo "❌ Gateway nicht erreichbar"

echo ""
echo "=== 4. Prüfe Service Entries ==="
kubectl config use-context kind-cluster-a
kubectl get serviceentry -n nf-a-namespace 2>&1 | head -10

echo ""
echo "=== Logs prüfen ==="
echo "NF-A (letzte 10 Zeilen ohne assert):"
kubectl logs -n nf-a-namespace $POD_A -c veramo-nf-a --tail=10 | grep -v assert

echo ""
echo "NF-B (letzte 10 Zeilen ohne assert):"
kubectl config use-context kind-cluster-b
kubectl logs -n nf-b-namespace $POD_B -c veramo-nf-b --tail=10 | grep -v assert
