#!/bin/bash
# DIDComm Smoke Test: A → B (Direct /messaging endpoint)

POD_A="nf-a-76c7686b89-hv92b"
POD_B="nf-b-856fd58967-mlts4"

echo "🚀 Testing /messaging endpoint on NF-A..."
kubectl config use-context kind-cluster-a

# Test messaging endpoint
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
wget -O- --post-data='test message' --header='Content-Type: text/plain' http://localhost:7001/messaging 2>&1
"

echo ""
echo "=== Checking NF-A Logs ==="
kubectl logs -n nf-a-namespace $POD_A -c veramo-nf-a --tail=30 | grep -v "assert"

echo ""
echo "=== Checking NF-B Logs ==="
kubectl config use-context kind-cluster-b
kubectl logs -n nf-b-namespace $POD_B -c veramo-nf-b --tail=30 | grep -v "assert"
