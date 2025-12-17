#!/bin/bash

# Creates credentials only (no test)
# Run ./tests/test-live-filtered.sh afterwards to see the full VP Auth flow

echo "=== 1. Creating credentials on NF-A ==="
POD_A=$(kubectl get pod -n nf-a-namespace -l app=nf-a --context kind-cluster-a -o jsonpath='{.items[0].metadata.name}')
kubectl cp shared/create-nf-credentials.js nf-a-namespace/$POD_A:/app/shared/ -c veramo-nf-a --context kind-cluster-a
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a --context kind-cluster-a -- node /app/shared/create-nf-credentials.js cluster-a 2>&1 | grep -E "✅|🎉|Found|Error"

echo ""
echo "=== 2. Creating credentials on NF-B ==="
POD_B=$(kubectl get pod -n nf-b-namespace -l app=nf-b --context kind-cluster-b -o jsonpath='{.items[0].metadata.name}')
kubectl cp shared/create-nf-credentials.js nf-b-namespace/$POD_B:/app/shared/ -c veramo-nf-b --context kind-cluster-b
kubectl exec -n nf-b-namespace $POD_B -c veramo-nf-b --context kind-cluster-b -- node /app/shared/create-nf-credentials.js cluster-b 2>&1 | grep -E "✅|🎉|Found|Error"

echo ""
echo "=== Done! ==="
echo "Run: ./tests/test-live-filtered.sh"
