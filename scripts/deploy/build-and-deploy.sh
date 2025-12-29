#!/bin/bash
# Build and Deploy Sidecar Architecture for Kind Clusters
#
# This script builds both container images and deploys them to Kubernetes.
#
# Architecture:
# Pod: [NF Service] + [Veramo Sidecar] + [Istio Envoy]
#       Port 3000      Port 3001         (auto-injected)

set -e

echo "=== Sidecar Architecture - Build & Deploy ==="
echo ""

# Navigate to project root (from scripts/deploy/)
cd "$(dirname "$0")/../.."

# Detect packing mode from deployment YAML
PACKING_MODE=$(grep "DIDCOMM_PACKING_MODE" -A1 deploy/cluster-a/deployment.yaml | grep "value:" | head -1 | sed 's/.*value: *"\([^"]*\)".*/\1/')
echo "Mode: $PACKING_MODE"
if [ "$PACKING_MODE" = "encrypted" ]; then
  echo "  Encrypted: E2E encrypted DIDComm, Pod-Gateway: TCP (PERMISSIVE)"
else
  echo "  Signed: Signed DIDComm, Pod-Gateway: mTLS (STRICT)"
fi
echo ""

# Step 1: Compile TypeScript
echo "[1/6] Compiling TypeScript..."
npx tsc src/veramo-sidecar.ts src/nf-service.ts --esModuleInterop --resolveJsonModule --module commonjs --target ES2020 --outDir src --skipLibCheck 2>/dev/null || true

# Step 2: Build Docker images
echo "[2/6] Building Docker images..."
docker build -f deploy/docker/Dockerfile.veramo-sidecar -t veramo-sidecar:sidecar . >/dev/null
docker build -f deploy/docker/Dockerfile.nf-service -t nf-service:sidecar . >/dev/null
echo "  Images built: veramo-sidecar:sidecar, nf-service:sidecar"

# Step 3: Load images into kind clusters
echo "[3/6] Loading images into kind clusters..."
kind load docker-image veramo-sidecar:sidecar --name cluster-a >/dev/null
kind load docker-image nf-service:sidecar --name cluster-a >/dev/null
kind load docker-image veramo-sidecar:sidecar --name cluster-b >/dev/null
kind load docker-image nf-service:sidecar --name cluster-b >/dev/null

# Step 4: Deploy to Cluster-A
echo "[4/6] Deploying to Cluster-A..."
kubectl config use-context kind-cluster-a >/dev/null
kubectl delete deployment nf-a -n nf-a-namespace --ignore-not-found >/dev/null
kubectl apply -f deploy/cluster-a/infrastructure.yaml >/dev/null
kubectl apply -f deploy/cluster-a/deployment.yaml >/dev/null
kubectl apply -f deploy/cluster-a/gateway.yaml >/dev/null
kubectl apply -f deploy/cluster-a/security.yaml >/dev/null

if [ "$PACKING_MODE" = "encrypted" ]; then
  kubectl apply -f deploy/mtls-config/mtls-encrypted.yaml --context kind-cluster-a 2>/dev/null || true
else
  kubectl apply -f deploy/mtls-config/mtls-signed.yaml --context kind-cluster-a 2>/dev/null || true
fi

kubectl wait --for=condition=ready pod -l app=nf-a -n nf-a-namespace --timeout=120s 2>/dev/null || true
NF_A_POD=$(kubectl get pods -n nf-a-namespace -l app=nf-a -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
[ -n "$NF_A_POD" ] && kubectl exec -n nf-a-namespace $NF_A_POD -c veramo-sidecar -- node /app/scripts/setup/create-credentials.mjs 2>/dev/null || true

# Step 5: Deploy to Cluster-B
echo "[5/6] Deploying to Cluster-B..."
kubectl config use-context kind-cluster-b >/dev/null
kubectl delete deployment nf-b -n nf-b-namespace --ignore-not-found >/dev/null
kubectl apply -f deploy/cluster-b/infrastructure.yaml >/dev/null
kubectl apply -f deploy/cluster-b/deployment.yaml >/dev/null
kubectl apply -f deploy/cluster-b/gateway.yaml >/dev/null
kubectl apply -f deploy/cluster-b/security.yaml >/dev/null

if [ "$PACKING_MODE" = "encrypted" ]; then
  kubectl apply -f deploy/mtls-config/mtls-encrypted.yaml --context kind-cluster-b 2>/dev/null || true
else
  kubectl apply -f deploy/mtls-config/mtls-signed.yaml --context kind-cluster-b 2>/dev/null || true
fi

kubectl wait --for=condition=ready pod -l app=nf-b -n nf-b-namespace --timeout=120s 2>/dev/null || true
NF_B_POD=$(kubectl get pods -n nf-b-namespace -l app=nf-b -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
[ -n "$NF_B_POD" ] && kubectl exec -n nf-b-namespace $NF_B_POD -c veramo-sidecar -- node /app/scripts/setup/create-credentials.mjs 2>/dev/null || true

# Step 6: Show status
echo "[6/6] Pod Status"
echo ""
echo "Cluster-A:"
kubectl config use-context kind-cluster-a >/dev/null
kubectl get pods -n nf-a-namespace -o wide
echo ""
echo "Cluster-B:"
kubectl config use-context kind-cluster-b >/dev/null
kubectl get pods -n nf-b-namespace -o wide
echo ""

echo "=== Deployment Complete ==="
echo "Mode: $PACKING_MODE"
echo ""
echo "Test: ./tests/test-functional-correctness.sh"
