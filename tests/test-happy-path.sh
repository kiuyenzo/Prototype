#!/bin/bash
#############################################################################
# Happy Path Test - DIDComm VP Authentication Flow (3 Phasen)
#############################################################################
#
# Phase 1: Service Request → VP Auth Initiation
# Phase 2: Mutual VP Authentication (VP Exchange)
# Phase 3: Authorized → Session authenticated
#
# Verwendung:
#   ./tests/test-happy-path.sh           # Normaler Test
#   ./tests/test-happy-path.sh --reset   # Mit Pod-Restart & DB-Reset
#   ./tests/test-happy-path.sh -r        # Kurzform
#
#############################################################################

set -e

# Reset Flag
RESET=false
if [ "$1" = "--reset" ] || [ "$1" = "-r" ]; then
    RESET=true
fi

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
BOLD='\033[1m'

# Konfiguration
NS_A="nf-a-namespace"
NS_B="nf-b-namespace"
CTX_A="kind-cluster-a"
CTX_B="kind-cluster-b"
DID_NF_B="did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"

PASSED=0
FAILED=0

pass() { PASSED=$((PASSED + 1)); echo -e "  ${GREEN}✅ $1${NC}"; }
fail() { FAILED=$((FAILED + 1)); echo -e "  ${RED}❌ $1${NC}"; }
info() { echo -e "  ${BLUE}► $1${NC}"; }
warn() { echo -e "  ${YELLOW}⚠ $1${NC}"; }

echo -e "${BOLD}${BLUE}"
echo "╔═══════════════════════════════════════════════════════════════════════╗"
echo "║        HAPPY PATH TEST - DIDComm VP Authentication (3 Phasen)         ║"
echo "╚═══════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

#############################################################################
# OPTIONAL: Reset Pods (--reset flag)
#############################################################################
if [ "$RESET" = true ]; then
    echo -e "${BOLD}[RESET] Pod Restart & DB Reset${NC}"
    echo "─────────────────────────────────────────────────────────────────────────"
    info "Restarting pods (entrypoint.sh will reset DB)..."

    kubectl --context $CTX_A rollout restart deployment/nf-a -n $NS_A 2>/dev/null
    kubectl --context $CTX_B rollout restart deployment/nf-b -n $NS_B 2>/dev/null

    echo -e "  ${YELLOW}⏳ Warte auf Pod-Neustart (15s)...${NC}"
    sleep 15

    # Wait for pods to be ready
    NF_A_POD=$(kubectl --context $CTX_A get pods -n $NS_A -l app=nf-a -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    NF_B_POD=$(kubectl --context $CTX_B get pods -n $NS_B -l app=nf-b -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

    kubectl --context $CTX_A wait --for=condition=ready pod/$NF_A_POD -n $NS_A --timeout=60s 2>/dev/null && pass "NF-A neugestartet" || fail "NF-A Restart fehlgeschlagen"
    kubectl --context $CTX_B wait --for=condition=ready pod/$NF_B_POD -n $NS_B --timeout=60s 2>/dev/null && pass "NF-B neugestartet" || fail "NF-B Restart fehlgeschlagen"

    info "DB Reset: VPs, Messages, Peer-VCs geloescht"
    echo ""
fi

#############################################################################
# PRE-FLIGHT: Cluster & Pod Status
#############################################################################
echo -e "${BOLD}[PRE-FLIGHT] Cluster & Pod Status${NC}"
echo "─────────────────────────────────────────────────────────────────────────"

# Check contexts
kubectl config get-contexts 2>/dev/null | grep -q "kind-cluster-a" && pass "Cluster-A Context" || fail "Cluster-A Context"
kubectl config get-contexts 2>/dev/null | grep -q "kind-cluster-b" && pass "Cluster-B Context" || fail "Cluster-B Context"

# Get pods
NF_A_POD=$(kubectl --context $CTX_A get pods -n $NS_A -l app=nf-a -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
NF_B_POD=$(kubectl --context $CTX_B get pods -n $NS_B -l app=nf-b -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

[ -n "$NF_A_POD" ] && pass "NF-A Pod: $NF_A_POD" || fail "NF-A Pod nicht gefunden"
[ -n "$NF_B_POD" ] && pass "NF-B Pod: $NF_B_POD" || fail "NF-B Pod nicht gefunden"

if [ -z "$NF_A_POD" ] || [ -z "$NF_B_POD" ]; then
    echo -e "\n${RED}Abbruch: Pods nicht verfuegbar${NC}"
    exit 1
fi

# Check pod readiness
NF_A_READY=$(kubectl --context $CTX_A get pod $NF_A_POD -n $NS_A -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)
NF_B_READY=$(kubectl --context $CTX_B get pod $NF_B_POD -n $NS_B -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)

[ "$NF_A_READY" = "True" ] && pass "NF-A Ready (3/3 Container)" || fail "NF-A nicht Ready"
[ "$NF_B_READY" = "True" ] && pass "NF-B Ready (3/3 Container)" || fail "NF-B nicht Ready"

# Health checks
NF_A_HEALTH=$(kubectl --context $CTX_A exec -n $NS_A $NF_A_POD -c nf-service -- curl -s http://localhost:3000/health 2>/dev/null || echo "")
NF_B_HEALTH=$(kubectl --context $CTX_B exec -n $NS_B $NF_B_POD -c nf-service -- curl -s http://localhost:3000/health 2>/dev/null || echo "")

echo "$NF_A_HEALTH" | grep -qi "ok" && pass "NF-A Health OK" || fail "NF-A Health Failed"
echo "$NF_B_HEALTH" | grep -qi "ok" && pass "NF-B Health OK" || fail "NF-B Health Failed"

#############################################################################
# PHASE 1: Service Request & VP Auth Initiation
#############################################################################
echo -e "\n${BOLD}[PHASE 1] Service Request → VP Auth Initiation${NC}"
echo "─────────────────────────────────────────────────────────────────────────"
info "NF-A sendet Service Request an NF-B (via Veramo Sidecar)..."
info "Endpoint: POST /nf/service-request"

RESPONSE=$(kubectl --context $CTX_A exec -n $NS_A $NF_A_POD -c veramo-sidecar -- \
    curl -s -X POST http://localhost:3001/nf/service-request \
    -H "Content-Type: application/json" \
    -d "{\"targetDid\":\"$DID_NF_B\",\"service\":\"nf-info\",\"action\":\"get\"}" 2>/dev/null)

if echo "$RESPONSE" | grep -qi "authenticating\|sessionId\|success.*true\|messageId"; then
    pass "Service Request gesendet"
    if echo "$RESPONSE" | grep -qi "sessionId"; then
        SESSION_ID=$(echo "$RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
        info "Session ID: $SESSION_ID"
        info "Status: authenticating (VP Exchange startet)"
    else
        info "Session bereits authentifiziert (success: true)"
    fi
else
    fail "Service Request fehlgeschlagen"
    info "Response: $RESPONSE"
fi

echo -e "  ${YELLOW}⏳ Warte auf VP Exchange (5s)...${NC}"
sleep 5

#############################################################################
# PHASE 2: VP Exchange Verification (Logs)
#############################################################################
echo -e "\n${BOLD}[PHASE 2] Mutual VP Authentication (VP Exchange)${NC}"
echo "─────────────────────────────────────────────────────────────────────────"
info "Pruefe Veramo Sidecar Logs fuer VP Exchange..."

NF_A_LOGS=$(kubectl --context $CTX_A logs -n $NS_A $NF_A_POD -c veramo-sidecar --tail=100 2>/dev/null)
NF_B_LOGS=$(kubectl --context $CTX_B logs -n $NS_B $NF_B_POD -c veramo-sidecar --tail=100 2>/dev/null)

# Check for DIDComm message sending
if echo "$NF_A_LOGS" | grep -qi "Sending DIDComm\|DIDComm message\|Encrypting"; then
    pass "DIDComm Nachricht gesendet (A→B)"
else
    warn "DIDComm Senden nicht in Logs gefunden"
fi

# Check for VP creation
if echo "$NF_B_LOGS" | grep -qi "Creating VP\|VP created\|Presentation"; then
    pass "VP erstellt (NF-B)"
elif echo "$NF_A_LOGS" | grep -qi "Creating VP\|VP created\|Presentation"; then
    pass "VP erstellt (NF-A)"
else
    warn "VP Erstellung nicht in Logs gefunden"
fi

# Check for encryption (authcrypt)
if echo "$NF_A_LOGS$NF_B_LOGS" | grep -qi "authcrypt\|encrypted\|JWE\|anoncrypt"; then
    pass "Authcrypt Verschluesselung aktiv"
else
    warn "Verschluesselung nicht in Logs gefunden"
fi

#############################################################################
# PHASE 3: Authentication Status
#############################################################################
echo -e "\n${BOLD}[PHASE 3] Session Authentication Status${NC}"
echo "─────────────────────────────────────────────────────────────────────────"

# Check session status on both sides
SESSION_A=$(kubectl --context $CTX_A exec -n $NS_A $NF_A_POD -c veramo-sidecar -- \
    curl -s http://localhost:3001/session/status 2>/dev/null)

SESSION_B=$(kubectl --context $CTX_B exec -n $NS_B $NF_B_POD -c veramo-sidecar -- \
    curl -s http://localhost:3001/session/status 2>/dev/null)

# NF-A Session
if echo "$SESSION_A" | grep -qi '"authenticated"[[:space:]]*:[[:space:]]*true'; then
    pass "NF-A Session: authenticated"
else
    fail "NF-A Session: NOT authenticated"
    info "Response: $SESSION_A"
fi

# NF-B Session
if echo "$SESSION_B" | grep -qi '"authenticated"[[:space:]]*:[[:space:]]*true'; then
    pass "NF-B Session: authenticated"
else
    fail "NF-B Session: NOT authenticated"
    info "Response: $SESSION_B"
fi

#############################################################################
# BONUS: 5G NRF Discovery Test
#############################################################################
echo -e "\n${BOLD}[BONUS] 5G NRF Discovery (3GPP TS 29.510)${NC}"
echo "─────────────────────────────────────────────────────────────────────────"

NRF_RESPONSE=$(kubectl --context $CTX_A exec -n $NS_A $NF_A_POD -c nf-service -- \
    curl -s "http://localhost:3000/nnrf-disc/v1/nf-instances?nf-type=SMF" 2>/dev/null)

if echo "$NRF_RESPONSE" | grep -qi "nfInstances\|nfType\|REGISTERED"; then
    pass "5G NRF Discovery Endpoint funktioniert"
    NF_TYPE=$(echo "$NRF_RESPONSE" | grep -o '"nfType":"[^"]*"' | head -1 | cut -d'"' -f4)
    info "NF Type: $NF_TYPE"
else
    fail "5G NRF Discovery fehlgeschlagen"
fi

#############################################################################
# RESULTS
#############################################################################
TOTAL=$((PASSED + FAILED))

echo -e "\n${BOLD}${BLUE}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  TEST RESULTS${NC}"
echo -e "${BOLD}${BLUE}═══════════════════════════════════════════════════════════════════════${NC}"

echo -e "\n  Total Tests: $TOTAL"
echo -e "  ${GREEN}Passed: $PASSED${NC}"
echo -e "  ${RED}Failed: $FAILED${NC}"

echo -e "\n${BOLD}  Flow Summary:${NC}"
echo -e "  Phase 1: Service Request → VP Auth Initiation"
echo -e "  Phase 2: Mutual VP Exchange (Authcrypt E2E)"
echo -e "  Phase 3: Session authenticated: true"

if [ $FAILED -eq 0 ]; then
    echo -e "\n${GREEN}${BOLD}  ✅ ALL TESTS PASSED - VP Authentication Flow OK${NC}\n"
    exit 0
else
    echo -e "\n${YELLOW}${BOLD}  ⚠️  $PASSED/$TOTAL Tests passed${NC}\n"
    exit 1
fi
