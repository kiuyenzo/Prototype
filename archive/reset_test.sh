#!/bin/bash

# Full reset: Restart pods, port-forward, create credentials
# Then run ./tests/test-live-filtered.sh to see the full VP Auth flow

echo "=== 1. Restarting pods (clearing sessions) ==="
kubectl rollout restart deployment/nf-a -n nf-a-namespace --context kind-cluster-a
kubectl rollout restart deployment/nf-b -n nf-b-namespace --context kind-cluster-b

echo "=== 2. Waiting for pods to be ready ==="
sleep 5
kubectl wait --for=condition=ready pod -l app=nf-a -n nf-a-namespace --context kind-cluster-a --timeout=60s
kubectl wait --for=condition=ready pod -l app=nf-b -n nf-b-namespace --context kind-cluster-b --timeout=60s

echo "=== 3. Restarting port-forwarding ==="
pkill -f "port-forward.*30451" 2>/dev/null || true
pkill -f "port-forward.*30452" 2>/dev/null || true
sleep 1
kubectl port-forward svc/veramo-nf-a 30451:3000 -n nf-a-namespace --context kind-cluster-a &
kubectl port-forward svc/veramo-nf-b 30452:3001 -n nf-b-namespace --context kind-cluster-b &
sleep 3

echo "=== 4. Creating credentials ==="
./credential_create.sh

echo ""
echo "=============================================="
echo "Ready! Run: ./tests/test-live-filtered.sh"
echo "=============================================="
