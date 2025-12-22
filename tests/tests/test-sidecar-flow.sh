#!/bin/bash
# Test Script for Sidecar Architecture (Kind Clusters)
#
# Tests the complete flow:
# NF_A → Veramo_NF_A → Envoy → Gateway → ... → Veramo_NF_B → NF_B

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║       Sidecar Architecture - E2E Test                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Get pod names from both clusters
echo "📋 Getting pod information..."
kubectl config use-context kind-cluster-a > /dev/null
NF_A_POD=$(kubectl get pods -n nf-a-namespace -l app=nf-a -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

kubectl config use-context kind-cluster-b > /dev/null
NF_B_POD=$(kubectl get pods -n nf-b-namespace -l app=nf-b -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

echo "   NF-A Pod: $NF_A_POD (cluster-a)"
echo "   NF-B Pod: $NF_B_POD (cluster-b)"
echo ""

# Step 1: Check container status
echo "═══════════════════════════════════════════════════════════════════"
echo "Step 1: Checking container status (should see 3/3 containers)"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo "Cluster-A:"
kubectl config use-context kind-cluster-a > /dev/null
kubectl get pods -n nf-a-namespace -o wide
echo ""
echo "Cluster-B:"
kubectl config use-context kind-cluster-b > /dev/null
kubectl get pods -n nf-b-namespace -o wide
echo ""

# Step 2: Test health endpoints
echo "═══════════════════════════════════════════════════════════════════"
echo "Step 2: Testing health endpoints"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

kubectl config use-context kind-cluster-a > /dev/null
echo "🔍 NF-A NF Service health (Port 3000):"
kubectl exec -n nf-a-namespace $NF_A_POD -c nf-service -- curl -s http://localhost:3000/health 2>/dev/null | jq . || echo "   Failed"
echo ""

echo "🔍 NF-A Veramo Sidecar health (Port 3001):"
kubectl exec -n nf-a-namespace $NF_A_POD -c veramo-sidecar -- curl -s http://localhost:3001/health 2>/dev/null | jq . || echo "   Failed"
echo ""

kubectl config use-context kind-cluster-b > /dev/null
echo "🔍 NF-B NF Service health (Port 3000):"
kubectl exec -n nf-b-namespace $NF_B_POD -c nf-service -- curl -s http://localhost:3000/health 2>/dev/null | jq . || echo "   Failed"
echo ""

echo "🔍 NF-B Veramo Sidecar health (Port 3001):"
kubectl exec -n nf-b-namespace $NF_B_POD -c veramo-sidecar -- curl -s http://localhost:3001/health 2>/dev/null | jq . || echo "   Failed"
echo ""

# Step 3: Test internal communication (NF → Veramo via localhost)
echo "═══════════════════════════════════════════════════════════════════"
echo "Step 3: Testing internal communication (NF ↔ Veramo via localhost)"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

kubectl config use-context kind-cluster-a > /dev/null
echo "🔍 NF-A: NF Service calling Veramo session status..."
kubectl exec -n nf-a-namespace $NF_A_POD -c nf-service -- curl -s http://localhost:3001/session/status 2>/dev/null | jq . || echo "   Failed"
echo ""

# Step 4: Initiate E2E flow from NF-A
echo "═══════════════════════════════════════════════════════════════════"
echo "Step 4: Initiating E2E flow (NF_A → Veramo_NF_A → ... → NF_B)"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

echo "🚀 Sending service request from NF-A to NF-B..."
echo "   Flow: NF_A(:3000) → Veramo_NF_A(:3001) → Envoy → Gateway → Veramo_NF_B → NF_B"
echo ""

kubectl config use-context kind-cluster-a > /dev/null
RESPONSE=$(kubectl exec -n nf-a-namespace $NF_A_POD -c nf-service -- curl -s -X POST \
  http://localhost:3000/request \
  -H "Content-Type: application/json" \
  -d '{
    "targetDid": "did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b",
    "service": "nf-info",
    "action": "get"
  }' 2>/dev/null)

echo "Response:"
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
echo ""

# Wait for async flow
echo "⏳ Waiting for VP authentication flow to complete..."
sleep 8

# Step 5: Check session status after flow
echo "═══════════════════════════════════════════════════════════════════"
echo "Step 5: Checking session status after flow"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

kubectl config use-context kind-cluster-a > /dev/null
echo "🔍 NF-A Veramo session status:"
kubectl exec -n nf-a-namespace $NF_A_POD -c veramo-sidecar -- curl -s http://localhost:3001/session/status 2>/dev/null | jq . || echo "   Failed"
echo ""

kubectl config use-context kind-cluster-b > /dev/null
echo "🔍 NF-B Veramo session status:"
kubectl exec -n nf-b-namespace $NF_B_POD -c veramo-sidecar -- curl -s http://localhost:3001/session/status 2>/dev/null | jq . || echo "   Failed"
echo ""

# Step 6: Show logs
echo "═══════════════════════════════════════════════════════════════════"
echo "Step 6: Container Logs (last 30 lines)"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

kubectl config use-context kind-cluster-a > /dev/null
echo "📜 NF-A Veramo Sidecar logs:"
kubectl logs -n nf-a-namespace $NF_A_POD -c veramo-sidecar --tail=30 2>/dev/null || echo "   No logs"
echo ""

kubectl config use-context kind-cluster-b > /dev/null
echo "📜 NF-B Veramo Sidecar logs:"
kubectl logs -n nf-b-namespace $NF_B_POD -c veramo-sidecar --tail=30 2>/dev/null || echo "   No logs"
echo ""

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                      Test Complete!                            ║"
echo "╚════════════════════════════════════════════════════════════════╝"
