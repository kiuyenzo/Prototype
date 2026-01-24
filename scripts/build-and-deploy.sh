#!/bin/bash
set -e

cd "$(dirname "$0")/.."

PACKING_MODE=$(grep "DIDCOMM_PACKING_MODE" -A1 deploy/cluster-a/deployment.yaml | grep "value:" | head -1 | sed 's/.*value: *"\([^"]*\)".*/\1/')
echo "Mode: $PACKING_MODE"
if [ "$PACKING_MODE" = "encrypted" ]; then
  echo "  Encrypted: E2E encrypted DIDComm, Pod-Gateway: TCP (PERMISSIVE)"
else
  echo "  Signed: Signed DIDComm, Pod-Gateway: mTLS (STRICT)"
fi
echo ""

echo "[1/5] Building Docker images..."
docker build -q -f deploy/docker/Dockerfile.veramo-sidecar -t veramo-sidecar:sidecar . >/dev/null
docker build -q -f deploy/docker/Dockerfile.nf-service -t nf-service:sidecar . >/dev/null
echo "  Images built: veramo-sidecar:sidecar, nf-service:sidecar"

echo "[2/5] Loading images into kind clusters..."
kind load docker-image veramo-sidecar:sidecar --name cluster-a >/dev/null
kind load docker-image nf-service:sidecar --name cluster-a >/dev/null
kind load docker-image veramo-sidecar:sidecar --name cluster-b >/dev/null
kind load docker-image nf-service:sidecar --name cluster-b >/dev/null

echo "[3/5] Deploying to Cluster-A..."
kubectl config use-context kind-cluster-a >/dev/null
kubectl delete deployment nf-a -n nf-a-namespace --ignore-not-found >/dev/null
kubectl apply -f deploy/cluster-a/infrastructure.yaml >/dev/null 2>&1
kubectl apply -f deploy/cluster-a/deployment.yaml >/dev/null 2>&1
kubectl apply -f deploy/cluster-a/gateway.yaml >/dev/null 2>&1
kubectl apply -f deploy/cluster-a/security.yaml >/dev/null 2>&1

if [ "$PACKING_MODE" = "encrypted" ]; then
  kubectl apply -f deploy/mtls-config/mtls-encrypted.yaml --context kind-cluster-a 2>/dev/null || true
else
  kubectl apply -f deploy/mtls-config/mtls-signed.yaml --context kind-cluster-a 2>/dev/null || true
fi

kubectl wait --for=condition=ready pod -l app=nf-a -n nf-a-namespace --timeout=120s 2>/dev/null || true
NF_A_POD=$(kubectl get pods -n nf-a-namespace -l app=nf-a -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
[ -n "$NF_A_POD" ] && kubectl exec -n nf-a-namespace $NF_A_POD -c veramo-sidecar -- node /app/scripts/create-credentials.mjs 2>/dev/null || true

echo "[4/5] Deploying to Cluster-B..."
kubectl config use-context kind-cluster-b >/dev/null
kubectl delete deployment nf-b -n nf-b-namespace --ignore-not-found >/dev/null
kubectl apply -f deploy/cluster-b/infrastructure.yaml >/dev/null 2>&1
kubectl apply -f deploy/cluster-b/deployment.yaml >/dev/null 2>&1
kubectl apply -f deploy/cluster-b/gateway.yaml >/dev/null 2>&1
kubectl apply -f deploy/cluster-b/security.yaml >/dev/null 2>&1

if [ "$PACKING_MODE" = "encrypted" ]; then
  kubectl apply -f deploy/mtls-config/mtls-encrypted.yaml --context kind-cluster-b 2>/dev/null || true
else
  kubectl apply -f deploy/mtls-config/mtls-signed.yaml --context kind-cluster-b 2>/dev/null || true
fi

kubectl wait --for=condition=ready pod -l app=nf-b -n nf-b-namespace --timeout=120s 2>/dev/null || true
NF_B_POD=$(kubectl get pods -n nf-b-namespace -l app=nf-b -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
[ -n "$NF_B_POD" ] && kubectl exec -n nf-b-namespace $NF_B_POD -c veramo-sidecar -- node /app/scripts/create-credentials.mjs 2>/dev/null || true

echo "[5/5] Pod Status"
echo ""

echo "Deployment Complete"
echo "Mode: $PACKING_MODE"
echo ""
echo "Test: ./tests/prototype-functional.sh"
