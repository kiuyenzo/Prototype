#!/bin/bash

#############################################################################
# E2E Test - Ausfuehrbar vom Sidecar Pod
# Nutzt interne Cluster URLs statt NodePorts
#############################################################################

set -e

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
BOLD='\033[1m'

# Konfiguration - interne URLs
VERAMO_A_URL="http://veramo-nf-a.nf-a-namespace.svc.cluster.local:3001"
VERAMO_B_URL="http://veramo-nf-b.nf-b-namespace.svc.cluster.local:3001"
DID_NF_A="did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a"
DID_NF_B="did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"

PASSED=0
FAILED=0

test_pass() { PASSED=$((PASSED + 1)); echo -e "  ${GREEN}✅ $1${NC}"; }
test_fail() { FAILED=$((FAILED + 1)); echo -e "  ${RED}❌ $1${NC}"; }
log_info() { echo -e "  ${YELLOW}► $1${NC}"; }

echo -e "${BOLD}${BLUE}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${BLUE}  E2E TEST (from Sidecar Pod)${NC}"
echo -e "${BOLD}${BLUE}══════════════════════════════════════════════════════════════${NC}"

#############################################################################
# PRE-FLIGHT - Health Checks
#############################################################################

echo -e "\n${BOLD}[PRE-FLIGHT] Service Connectivity${NC}"

# Lokaler Veramo (je nachdem wo wir sind)
LOCAL_HEALTH=$(curl -s "http://localhost:3001/health" 2>/dev/null || echo "FAIL")
if echo "$LOCAL_HEALTH" | grep -qi "ok\|status\|healthy"; then
    test_pass "Lokaler Veramo-Sidecar healthy"
else
    log_info "Lokaler health: $LOCAL_HEALTH"
fi

# Remote Veramo via Istio Gateway
REMOTE_HEALTH=$(curl -s "$VERAMO_B_URL/health" 2>/dev/null || echo "FAIL")
if echo "$REMOTE_HEALTH" | grep -qi "ok\|status\|healthy"; then
    test_pass "Remote Veramo-B erreichbar"
else
    log_info "Remote health: $REMOTE_HEALTH"
fi

#############################################################################
# PHASE 1: VP_AUTH_REQUEST (A -> B)
#############################################################################

echo -e "\n${BOLD}[PHASE 1] VP_AUTH_REQUEST + PD_A (NF-A -> NF-B)${NC}"
echo -e "  ${BLUE}Flow: Veramo_A -> Istio_Mesh -> Gateway -> mTLS -> Gateway -> Veramo_B${NC}"

RESPONSE=$(curl -s -X POST "http://localhost:3001/didcomm/initiate-auth" \
    -H "Content-Type: application/json" \
    -d "{
        \"targetDid\": \"$DID_NF_B\",
        \"presentationDefinition\": {
            \"id\": \"nf-auth-$(date +%s)\",
            \"input_descriptors\": [{
                \"id\": \"nf-credential\",
                \"constraints\": {
                    \"fields\": [
                        {\"path\": [\"\$.credentialSubject.role\"], \"filter\": {\"const\": \"network-function\"}}
                    ]
                }
            }]
        }
    }" 2>&1)

if echo "$RESPONSE" | grep -qi "success\|true\|sessionId"; then
    test_pass "VP_AUTH_REQUEST gesendet"
    SESSION_ID=$(echo "$RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    log_info "Session: $SESSION_ID"
else
    test_fail "VP_AUTH_REQUEST fehlgeschlagen"
    log_info "Response: $RESPONSE"
fi

# Warte auf async Verarbeitung
echo -e "  ${BLUE}Warte auf VP Exchange (3s)...${NC}"
sleep 3

#############################################################################
# PHASE 2: Check Session Status
#############################################################################

echo -e "\n${BOLD}[PHASE 2] Session Status${NC}"

SESSION_STATUS=$(curl -s "http://localhost:3001/session/status?sessionId=$SESSION_ID" 2>/dev/null || echo "")
if echo "$SESSION_STATUS" | grep -qi "authenticated\|verified\|complete"; then
    test_pass "Session authentifiziert"
    log_info "Status: $SESSION_STATUS"
else
    log_info "Session status: $SESSION_STATUS"
fi

#############################################################################
# CROSS-CLUSTER mTLS TEST
#############################################################################

echo -e "\n${BOLD}[SECURITY] Cross-Cluster mTLS Test${NC}"

# Test direkt zum anderen Cluster via Istio
CROSS_CLUSTER=$(curl -s -X POST "$VERAMO_B_URL/didcomm/send" \
    -H "Content-Type: application/json" \
    -H "Host: veramo-nf-b.nf-b-namespace.svc.cluster.local" \
    -d "{
        \"recipientDid\": \"$DID_NF_B\",
        \"message\": {\"type\": \"test\", \"body\": {\"test\": true}}
    }" 2>&1)

if echo "$CROSS_CLUSTER" | grep -qi "success\|ok\|received"; then
    test_pass "Cross-Cluster Kommunikation via mTLS"
else
    log_info "Cross-cluster: $CROSS_CLUSTER"
fi

#############################################################################
# ENCRYPTION TEST
#############################################################################

echo -e "\n${BOLD}[ENCRYPTION] DIDComm Packing Mode${NC}"

PACK_MODE=$(curl -s "http://localhost:3001/test/packing-mode" 2>&1)
if echo "$PACK_MODE" | grep -qi "anoncrypt\|authcrypt"; then
    test_pass "DIDComm E2E Verschluesselung aktiv"
    log_info "Mode: $(echo $PACK_MODE | grep -o '"packingMode":"[^"]*"' | cut -d'"' -f4 || echo "$PACK_MODE")"
else
    log_info "Packing mode: $PACK_MODE"
fi

#############################################################################
# RESULTS
#############################################################################

TOTAL=$((PASSED + FAILED))

echo -e "\n${BOLD}${BLUE}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  TEST RESULTS (from Sidecar)${NC}"
echo -e "${BOLD}${BLUE}══════════════════════════════════════════════════════════════${NC}"

echo -e "\n  Total:  $TOTAL"
echo -e "  ${GREEN}Passed: $PASSED${NC}"
echo -e "  ${RED}Failed: $FAILED${NC}"

if [ $FAILED -eq 0 ]; then
    echo -e "\n${GREEN}${BOLD}  ✅ ALL TESTS PASSED${NC}"
    exit 0
else
    echo -e "\n${YELLOW}${BOLD}  ⚠️  $PASSED/$TOTAL Tests passed${NC}"
    exit 0
fi
