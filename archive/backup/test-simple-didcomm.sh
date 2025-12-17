#!/bin/bash
# Simplified DIDComm Test: Direct messaging endpoint

POD_A="nf-a-76c7686b89-hv92b"
POD_B="nf-b-856fd58967-mlts4"

echo "=== Test 1: Veramo NF-A reachable? ==="
kubectl config use-context kind-cluster-a
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
wget -qO- --spider http://localhost:7001/open-api.json 2>&1 | head -3
"

echo ""
echo "=== Test 2: Veramo NF-B reachable? ==="
kubectl config use-context kind-cluster-b
kubectl exec -n nf-b-namespace $POD_B -c veramo-nf-b -- sh -c "
wget -qO- --spider http://localhost:7002/open-api.json 2>&1 | head -3
"

echo ""
echo "=== Test 3: Can NF-A reach NF-B gateway? ==="
kubectl config use-context kind-cluster-a
kubectl exec -n nf-a-namespace $POD_A -c istio-proxy -- sh -c "
wget -qO- --spider http://nf-b-didcomm-gateway.nf-b-namespace.svc.cluster.local:80/open-api.json 2>&1 | head -5
"

echo ""
echo "=== Test 4: Send simple message to NF-B /messaging endpoint ==="
kubectl exec -n nf-a-namespace $POD_A -c istio-proxy -- sh -c "
wget -O- --post-data='{\"type\":\"test\",\"from\":\"did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a\",\"to\":\"did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b\",\"body\":{\"message\":\"Hello from A\"}}' --header='Content-Type: application/json' http://nf-b-didcomm-gateway.nf-b-namespace.svc.cluster.local:80/messaging 2>&1
"

echo ""
echo "=== Checking NF-B Logs for received message ==="
kubectl config use-context kind-cluster-b
kubectl logs -n nf-b-namespace $POD_B -c veramo-nf-b --tail=20 | grep -v assert
