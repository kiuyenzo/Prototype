#!/bin/bash
# E2E VP-Flow Test für Kubernetes mit korrekten Endpoints

echo "=== 🚀 E2E VP-Flow Test (Kubernetes Multi-Cluster) ==="
echo ""

# Get pod names
kubectl config use-context kind-cluster-a > /dev/null 2>&1
POD_A=$(kubectl get pods -n nf-a-namespace -o jsonpath='{.items[0].metadata.name}')
kubectl config use-context kind-cluster-b > /dev/null 2>&1
POD_B=$(kubectl get pods -n nf-b-namespace -o jsonpath='{.items[0].metadata.name}')

echo "Pod A: $POD_A (Cluster-A)"
echo "Pod B: $POD_B (Cluster-B)"
echo ""

# Test 1: Health Checks
echo "=== ✅ Test 1: Health Checks ==="
kubectl config use-context kind-cluster-a > /dev/null 2>&1
HEALTH_A=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- wget -q -O- http://172.23.0.2:32147/health 2>&1)
echo "Cluster-A Health: $HEALTH_A"

kubectl config use-context kind-cluster-b > /dev/null 2>&1
HEALTH_B=$(kubectl exec -n nf-b-namespace $POD_B -c veramo-nf-b -- wget -q -O- http://172.23.0.3:31058/health 2>&1)
echo "Cluster-B Health: $HEALTH_B"
echo ""

# Test 2: Initiate Auth from A to B
echo "=== 🔐 Test 2: Initiate Auth (A → B) ==="
kubectl config use-context kind-cluster-a > /dev/null 2>&1

TARGET_DID_B="did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b"
echo "Initiating VP-Flow to: $TARGET_DID_B"

RESPONSE=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
wget -q -O- --post-data='{\"targetDid\":\"$TARGET_DID_B\"}' \
  --header='Content-Type: application/json' \
  http://localhost:3000/didcomm/initiate-auth 2>&1
" | head -20)

echo "Response:"
echo "$RESPONSE"
echo ""

# Test 3: Check logs
echo "=== 📋 Test 3: Check Logs ==="
echo "NF-A logs (last 10 lines):"
kubectl config use-context kind-cluster-a > /dev/null 2>&1
kubectl logs -n nf-a-namespace $POD_A -c veramo-nf-a --tail=10 2>&1 | tail -5

echo ""
echo "NF-B logs (last 10 lines):"
kubectl config use-context kind-cluster-b > /dev/null 2>&1
kubectl logs -n nf-b-namespace $POD_B -c veramo-nf-b --tail=10 2>&1 | tail -5

echo ""
echo "=== ✅ E2E VP-Flow Test Complete! ==="
