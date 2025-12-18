#!/bin/bash
# Build and Deploy Sidecar Architecture for Kind Clusters
#
# This script builds both container images and deploys them to Kubernetes.
#
# Architecture:
# Pod: [NF Service] + [Veramo Sidecar] + [Istio Envoy]
#       Port 3000      Port 3001         (auto-injected)

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║       Sidecar Architecture - Build & Deploy (Kind)             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

cd "$(dirname "$0")/.."

# Detect packing mode from deployment YAML
PACKING_MODE=$(grep "DIDCOMM_PACKING_MODE" -A1 cluster-a/deployment.yaml | grep "value:" | head -1 | sed 's/.*value: *"\([^"]*\)".*/\1/')
echo "🔐 Detected Mode: $PACKING_MODE"
if [ "$PACKING_MODE" = "encrypted" ]; then
  echo "   V1: E2E encrypted DIDComm, Pod↔Gateway: TCP (PERMISSIVE)"
else
  echo "   V4a: Signed DIDComm, Pod↔Gateway: mTLS (STRICT)"
fi
echo ""

# Step 1: Compile TypeScript
echo "📦 Step 1: Compiling TypeScript..."
npx tsc sidecar/veramo-sidecar.ts sidecar/nf-service.ts --esModuleInterop --resolveJsonModule --module commonjs --target ES2020 --outDir sidecar --skipLibCheck 2>/dev/null || true
echo "✅ TypeScript compiled"
echo ""

# Step 2: Build Docker images
echo "🐳 Step 2: Building Docker images..."

echo "   Building veramo-sidecar:sidecar..."
docker build -f sidecar/Dockerfile.veramo-sidecar -t veramo-sidecar:sidecar .

echo "   Building nf-service:sidecar..."
docker build -f sidecar/Dockerfile.nf-service -t nf-service:sidecar .

echo "✅ Docker images built"
echo ""

# Step 3: Load images into kind clusters
echo "🚀 Step 3: Loading images into kind clusters..."
kind load docker-image veramo-sidecar:sidecar --name cluster-a
kind load docker-image nf-service:sidecar --name cluster-a
kind load docker-image veramo-sidecar:sidecar --name cluster-b
kind load docker-image nf-service:sidecar --name cluster-b
echo "✅ Images loaded into kind clusters (cluster-a, cluster-b)"
echo ""

# Step 4: Deploy to Cluster-A
echo "═══════════════════════════════════════════════════════════════════"
echo "📋 Step 4: Deploying to Cluster-A"
echo "═══════════════════════════════════════════════════════════════════"
kubectl config use-context kind-cluster-a

echo "   Deleting existing deployment..."
kubectl delete deployment nf-a -n nf-a-namespace --ignore-not-found

echo "   Applying sidecar deployment..."
kubectl apply -f cluster-a/deployment.yaml

echo "   Applying Istio gateway configuration..."
kubectl apply -f cluster-a/gateway.yaml

echo "   Applying Istio mTLS configuration ($PACKING_MODE mode)..."
if [ "$PACKING_MODE" = "encrypted" ]; then
  kubectl apply -f sidecar/istio-mtls-v1.yaml --context kind-cluster-a 2>/dev/null || true
else
  kubectl apply -f sidecar/istio-mtls-v4a.yaml --context kind-cluster-a 2>/dev/null || true
fi

echo "   Waiting for pod to be ready..."
kubectl wait --for=condition=ready pod -l app=nf-a -n nf-a-namespace --timeout=120s || true

echo "   Creating credentials..."
NF_A_POD=$(kubectl get pods -n nf-a-namespace -l app=nf-a -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
if [ -n "$NF_A_POD" ]; then
  kubectl exec -n nf-a-namespace $NF_A_POD -c veramo-sidecar -- node /app/scripts/create-credentials.mjs 2>/dev/null || echo "   Credential creation may need retry"
fi

echo "✅ Cluster-A deployed"
echo ""

# Step 5: Deploy to Cluster-B
echo "═══════════════════════════════════════════════════════════════════"
echo "📋 Step 5: Deploying to Cluster-B"
echo "═══════════════════════════════════════════════════════════════════"
kubectl config use-context kind-cluster-b

echo "   Deleting existing deployment..."
kubectl delete deployment nf-b -n nf-b-namespace --ignore-not-found

echo "   Applying sidecar deployment..."
kubectl apply -f cluster-b/deployment.yaml

echo "   Applying Istio gateway configuration..."
kubectl apply -f cluster-b/gateway.yaml

echo "   Applying Istio mTLS configuration ($PACKING_MODE mode)..."
if [ "$PACKING_MODE" = "encrypted" ]; then
  kubectl apply -f sidecar/istio-mtls-v1.yaml --context kind-cluster-b 2>/dev/null || true
else
  kubectl apply -f sidecar/istio-mtls-v4a.yaml --context kind-cluster-b 2>/dev/null || true
fi

echo "   Waiting for pod to be ready..."
kubectl wait --for=condition=ready pod -l app=nf-b -n nf-b-namespace --timeout=120s || true

echo "   Creating credentials..."
NF_B_POD=$(kubectl get pods -n nf-b-namespace -l app=nf-b -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
if [ -n "$NF_B_POD" ]; then
  kubectl exec -n nf-b-namespace $NF_B_POD -c veramo-sidecar -- node /app/scripts/create-credentials.mjs 2>/dev/null || echo "   Credential creation may need retry"
fi

echo "✅ Cluster-B deployed"
echo ""

# Step 6: Show pod status
echo "═══════════════════════════════════════════════════════════════════"
echo "📊 Step 6: Pod Status"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

echo "Cluster-A (NF-A):"
kubectl config use-context kind-cluster-a
kubectl get pods -n nf-a-namespace -o wide
echo ""

echo "Cluster-B (NF-B):"
kubectl config use-context kind-cluster-b
kubectl get pods -n nf-b-namespace -o wide
echo ""

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    Deployment Complete!                        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Architecture per Pod:"
echo "  Container 1: nf-service (Port 3000) - Business Logic"
echo "  Container 2: veramo-sidecar (Port 3001) - DIDComm/VP Handler"
echo "  Container 3: istio-proxy (auto) - mTLS/Envoy"
echo ""
echo "Security Mode: $PACKING_MODE"
if [ "$PACKING_MODE" = "encrypted" ]; then
  echo "  V1: DIDComm = E2E encrypted (authcrypt/JWE)"
  echo "      Pod ↔ Gateway: TCP (PERMISSIVE)"
  echo "      Gateway ↔ Gateway: mTLS"
else
  echo "  V4a: DIDComm = Signed only (jws)"
  echo "       Pod ↔ Gateway: mTLS (STRICT)"
  echo "       Gateway ↔ Gateway: mTLS"
fi
echo ""
echo "To test the flow, run:"
echo "  ./sidecar/test-sidecar-flow.sh"
echo ""
