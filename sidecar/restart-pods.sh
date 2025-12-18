#!/bin/bash
# Restart pods and sync DBs to local Veramo Explorer

echo "🔄 Restarting pods..."
kubectl --context kind-cluster-a rollout restart deployment/nf-a -n nf-a-namespace
kubectl --context kind-cluster-b rollout restart deployment/nf-b -n nf-b-namespace

echo "⏳ Waiting for pods to be ready..."
sleep 10

NF_A_POD=$(kubectl --context kind-cluster-a get pods -n nf-a-namespace -l app=nf-a --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}')
NF_B_POD=$(kubectl --context kind-cluster-b get pods -n nf-b-namespace -l app=nf-b --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}')

kubectl --context kind-cluster-a wait --for=condition=ready pod/$NF_A_POD -n nf-a-namespace --timeout=60s
kubectl --context kind-cluster-b wait --for=condition=ready pod/$NF_B_POD -n nf-b-namespace --timeout=60s

echo "📦 Syncing DBs to local Veramo Explorer..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

rm -f "$PROJECT_DIR/cluster-a/database-nf-a.sqlite" "$PROJECT_DIR/cluster-b/database-nf-b.sqlite"
kubectl --context kind-cluster-a exec -n nf-a-namespace $NF_A_POD -c veramo-sidecar -- cat /app/cluster-a/database-nf-a.sqlite > "$PROJECT_DIR/cluster-a/database-nf-a.sqlite" 2>/dev/null
kubectl --context kind-cluster-b exec -n nf-b-namespace $NF_B_POD -c veramo-sidecar -- cat /app/cluster-b/database-nf-b.sqlite > "$PROJECT_DIR/cluster-b/database-nf-b.sqlite" 2>/dev/null

echo "✅ Done - Pods restarted & Veramo Explorer reset"
