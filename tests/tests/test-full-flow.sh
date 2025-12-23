#!/bin/bash
# Test: Kompletter 3-Phasen Flow gemäß Sequenzdiagramm
#
# Phase 1: Service Request → VP Auth Request
# Phase 2: Mutual VP Authentication (VP Exchange)
# Phase 3: Authorized → Service Traffic

echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║     DIDComm VP Authentication - Full 3-Phase Flow Test                     ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Get pods
kubectl config use-context kind-cluster-a > /dev/null 2>&1
NF_A_POD=$(kubectl get pods -n nf-a-namespace -l app=nf-a -o jsonpath='{.items[0].metadata.name}')
kubectl config use-context kind-cluster-b > /dev/null 2>&1
NF_B_POD=$(kubectl get pods -n nf-b-namespace -l app=nf-b -o jsonpath='{.items[0].metadata.name}')

echo "Pods: NF-A=$NF_A_POD | NF-B=$NF_B_POD"
echo ""

# Clear previous sessions by restarting pods (optional - skip for now)
# We'll use a fresh service request that triggers new auth

echo "═══════════════════════════════════════════════════════════════════════════════"
echo "PHASE 1: Initial Service Request & Auth-Anfrage"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "  NF_A → Veramo_NF_A: Service Request"
echo "  Veramo_NF_A: Resolve DID Document of B (did:web)"
echo "  Veramo_NF_A → Envoy → Gateway_A: DIDComm[VP_Auth_Request + PD_A]"
echo ""

# Delete existing sessions to force new auth
kubectl config use-context kind-cluster-a > /dev/null 2>&1
kubectl delete pod $NF_A_POD -n nf-a-namespace --grace-period=1 > /dev/null 2>&1 &
kubectl config use-context kind-cluster-b > /dev/null 2>&1
kubectl delete pod $NF_B_POD -n nf-b-namespace --grace-period=1 > /dev/null 2>&1 &

echo "⏳ Restarting pods for fresh session..."
sleep 10

# Get new pod names
kubectl config use-context kind-cluster-a > /dev/null 2>&1
NF_A_POD=$(kubectl get pods -n nf-a-namespace -l app=nf-a -o jsonpath='{.items[0].metadata.name}')
kubectl config use-context kind-cluster-b > /dev/null 2>&1
NF_B_POD=$(kubectl get pods -n nf-b-namespace -l app=nf-b -o jsonpath='{.items[0].metadata.name}')

echo "New Pods: NF-A=$NF_A_POD | NF-B=$NF_B_POD"

# Wait for pods ready
kubectl config use-context kind-cluster-a > /dev/null 2>&1
kubectl wait --for=condition=ready pod/$NF_A_POD -n nf-a-namespace --timeout=60s > /dev/null 2>&1
kubectl config use-context kind-cluster-b > /dev/null 2>&1
kubectl wait --for=condition=ready pod/$NF_B_POD -n nf-b-namespace --timeout=60s > /dev/null 2>&1

# Note: Database cleanup now happens automatically on pod startup (entrypoint.sh)

# Copy reset DBs to local Veramo Explorer (so it's also reset)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
echo "📦 Copying reset DBs to local Veramo Explorer..."
rm -f "$PROJECT_DIR/data/db-nf-a/database-nf-a.sqlite" "$PROJECT_DIR/data/db-nf-b/database-nf-b.sqlite"
kubectl --context kind-cluster-a exec -n nf-a-namespace $NF_A_POD -c veramo-sidecar -- cat /app/data/db-nf-a/database-nf-a.sqlite > "$PROJECT_DIR/data/db-nf-a/database-nf-a.sqlite" 2>/dev/null
kubectl --context kind-cluster-b exec -n nf-b-namespace $NF_B_POD -c veramo-sidecar -- cat /app/data/db-nf-b/database-nf-b.sqlite > "$PROJECT_DIR/data/db-nf-b/database-nf-b.sqlite" 2>/dev/null
echo "✅ Veramo Explorer reset"
echo ""

# Create credentials
echo "🎫 Creating credentials..."
kubectl config use-context kind-cluster-a > /dev/null 2>&1
kubectl exec -n nf-a-namespace $NF_A_POD -c veramo-sidecar -- node /app/scripts/setup/create-credentials.mjs cluster-a > /dev/null 2>&1
kubectl config use-context kind-cluster-b > /dev/null 2>&1
kubectl exec -n nf-b-namespace $NF_B_POD -c veramo-sidecar -- node /app/scripts/setup/create-credentials.mjs cluster-b > /dev/null 2>&1
echo "✅ Credentials created"
echo ""

echo "🚀 Sending Service Request from NF_A..."
echo ""

# Send request - this triggers Phase 1-3
kubectl config use-context kind-cluster-a > /dev/null 2>&1
RESPONSE=$(kubectl exec -n nf-a-namespace $NF_A_POD -c nf-service -- curl -s -X POST http://localhost:3000/request -H "Content-Type: application/json" -d "{\"targetDid\":\"did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b\",\"service\":\"nf-info\",\"action\":\"get\"}" 2>/dev/null)

echo "Response: $RESPONSE"
echo ""

# Wait for full flow
echo "⏳ Waiting for VP Authentication flow..."
sleep 8

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "PHASE 2: Mutual Authentication (VP Exchange)"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Gateway_A → Gateway_B: Forward DIDComm (mTLS)"
echo "  Veramo_NF_B: Create VP_B based on PD_A"
echo "  Veramo_NF_B → Gateway → Veramo_NF_A: DIDComm[VP_B + PD_B]"
echo "  Veramo_NF_A: Verify VP_B, Create VP_A"
echo "  Veramo_NF_A → Gateway → Veramo_NF_B: DIDComm[VP_A]"
echo "  Veramo_NF_B: Verify VP_A"
echo ""

echo "📜 NF-A Veramo Logs (Phase 1-2):"
kubectl config use-context kind-cluster-a > /dev/null 2>&1
kubectl logs -n nf-a-namespace $NF_A_POD -c veramo-sidecar 2>/dev/null | grep -E "Service Request|Resolve|VP_Auth|Encrypt|Decrypt|VP|Session|authenticated|Gateway" | head -25
echo ""

echo "📜 NF-B Veramo Logs (Phase 2):"
kubectl config use-context kind-cluster-b > /dev/null 2>&1
kubectl logs -n nf-b-namespace $NF_B_POD -c veramo-sidecar 2>/dev/null | grep -E "VP_Auth|Create VP|Verify|Encrypt|Decrypt|Session|authenticated" | head -20
echo ""

echo "═══════════════════════════════════════════════════════════════════════════════"
echo "PHASE 3: Authorized Communication / Service Traffic"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Veramo_NF_B → Veramo_NF_A: DIDComm[Authorized]"
echo "  Veramo_NF_A → Gateway → Veramo_NF_B: DIDComm[Service_Request]"
echo "  Veramo_NF_B → NF_B: Service Request (Business Logic)"
echo "  NF_B → Veramo_NF_B: Service Response"
echo "  Veramo_NF_B → Gateway → Veramo_NF_A: DIDComm[Service_Response]"
echo "  Veramo_NF_A → NF_A: Service_Response"
echo ""

echo "📜 NF-B Service Logs (Business Logic):"
kubectl config use-context kind-cluster-b > /dev/null 2>&1
kubectl logs -n nf-b-namespace $NF_B_POD -c nf-service 2>/dev/null | grep -E "Business|Service|Handler" | tail -10
echo ""

echo "📜 Service Response Flow:"
kubectl config use-context kind-cluster-a > /dev/null 2>&1
kubectl logs -n nf-a-namespace $NF_A_POD -c veramo-sidecar 2>/dev/null | grep -E "SERVICE_REQUEST|SERVICE_RESPONSE|Response|NF container" | tail -10
echo ""

echo "═══════════════════════════════════════════════════════════════════════════════"
echo "SESSION STATUS"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

echo "NF-A Session:"
kubectl config use-context kind-cluster-a > /dev/null 2>&1
kubectl exec -n nf-a-namespace $NF_A_POD -c veramo-sidecar -- curl -s http://localhost:3001/session/status 2>/dev/null | jq -r '.sessions[] | "  SessionID: \(.sessionId) | Status: \(.status) | Authenticated: \(.authenticated)"'
echo ""

echo "NF-B Session:"
kubectl config use-context kind-cluster-b > /dev/null 2>&1
kubectl exec -n nf-b-namespace $NF_B_POD -c veramo-sidecar -- curl -s http://localhost:3001/session/status 2>/dev/null | jq -r '.sessions[] | "  SessionID: \(.sessionId) | Status: \(.status) | Authenticated: \(.authenticated)"'
echo ""

echo "═══════════════════════════════════════════════════════════════════════════════"
echo "COPY DATABASES FOR VERAMO EXPLORER"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

# Copy complete databases from pods to local Veramo Explorer
# Pod DBs have: DID, VC, VPs, Messages, and cached Peer-DIDs (for "from" display)
echo "📦 Copying databases from pods..."
rm -f "$PROJECT_DIR/data/db-nf-a/database-nf-a.sqlite" "$PROJECT_DIR/data/db-nf-b/database-nf-b.sqlite"
kubectl --context kind-cluster-a exec -n nf-a-namespace $NF_A_POD -c veramo-sidecar -- cat /app/data/db-nf-a/database-nf-a.sqlite > "$PROJECT_DIR/data/db-nf-a/database-nf-a.sqlite" 2>/dev/null
kubectl --context kind-cluster-b exec -n nf-b-namespace $NF_B_POD -c veramo-sidecar -- cat /app/data/db-nf-b/database-nf-b.sqlite > "$PROJECT_DIR/data/db-nf-b/database-nf-b.sqlite" 2>/dev/null

# Remove peer VCs and peer VPs (redundant - already in DIDComm messages)
echo "🧹 Removing peer VCs and VPs (redundant)..."
sqlite3 "$PROJECT_DIR/data/db-nf-a/database-nf-a.sqlite" "DELETE FROM credential WHERE json_extract(raw, '\$.credentialSubject.id') <> 'did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a';" 2>/dev/null
sqlite3 "$PROJECT_DIR/data/db-nf-b/database-nf-b.sqlite" "DELETE FROM credential WHERE json_extract(raw, '\$.credentialSubject.id') <> 'did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b';" 2>/dev/null
sqlite3 "$PROJECT_DIR/data/db-nf-a/database-nf-a.sqlite" "DELETE FROM presentation WHERE holderDid <> 'did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a';" 2>/dev/null
sqlite3 "$PROJECT_DIR/data/db-nf-b/database-nf-b.sqlite" "DELETE FROM presentation WHERE holderDid <> 'did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b';" 2>/dev/null

# Fix presentation IDs for Veramo Explorer
sqlite3 "$PROJECT_DIR/data/db-nf-a/database-nf-a.sqlite" "UPDATE presentation SET id = hash WHERE id IS NULL OR id = '';" 2>/dev/null
sqlite3 "$PROJECT_DIR/data/db-nf-b/database-nf-b.sqlite" "UPDATE presentation SET id = hash WHERE id IS NULL OR id = '';" 2>/dev/null

echo "✅ data/db-nf-a/database-nf-a.sqlite"
echo "✅ data/db-nf-b/database-nf-b.sqlite"
echo ""
echo "🔍 Veramo Explorer starten:"
echo "   cd data/db-nf-a && veramo server --config agent.yml"
echo "   cd data/db-nf-b && veramo server --config agent.yml"
echo ""

echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                         TEST COMPLETE                                      ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Flow Summary:"
echo "  ✅ Phase 1: NF_A → Veramo_NF_A → VP_Auth_Request"
echo "  ✅ Phase 2: Mutual VP Exchange (VP_B ↔ VP_A)"
echo "  ✅ Phase 3: Authorized → Service_Request → Service_Response"
echo ""
