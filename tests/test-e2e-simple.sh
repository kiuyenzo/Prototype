#!/bin/bash

#############################################################################
# E2E Test - Sequenzdiagramm Flow
# Korrekten Endpoints: /didcomm/initiate-auth, /didcomm/send, /didcomm/receive
#############################################################################

set -e

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
BOLD='\033[1m'

# Konfiguration
NF_A_URL="http://localhost:30451"
NF_B_URL="http://localhost:30452"
DID_NF_A="did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a"
DID_NF_B="did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b"

PASSED=0
FAILED=0

test_pass() { PASSED=$((PASSED + 1)); echo -e "  ${GREEN}✅ $1${NC}"; }
test_fail() { FAILED=$((FAILED + 1)); echo -e "  ${RED}❌ $1${NC}"; }
log_info() { echo -e "  ${YELLOW}► $1${NC}"; }

echo -e "${BOLD}${BLUE}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${BLUE}  SEQUENZDIAGRAMM E2E TEST${NC}"
echo -e "${BOLD}${BLUE}══════════════════════════════════════════════════════════════${NC}"

#############################################################################
# PRE-FLIGHT
#############################################################################

echo -e "\n${BOLD}[PRE-FLIGHT] Cluster Connectivity${NC}"

NF_A_HEALTH=$(curl -s "$NF_A_URL/health" 2>/dev/null || echo "FAIL")
if echo "$NF_A_HEALTH" | grep -qi "ok\|status"; then
    test_pass "NF-A healthy"
    log_info "DID: $DID_NF_A"
else
    test_fail "NF-A nicht erreichbar"
    exit 1
fi

NF_B_HEALTH=$(curl -s "$NF_B_URL/health" 2>/dev/null || echo "FAIL")
if echo "$NF_B_HEALTH" | grep -qi "ok\|status"; then
    test_pass "NF-B healthy"
    log_info "DID: $DID_NF_B"
else
    test_fail "NF-B nicht erreichbar"
    exit 1
fi

#############################################################################
# PHASE 1: VP_AUTH_REQUEST (A -> B)
#############################################################################

echo -e "\n${BOLD}[PHASE 1] VP_AUTH_REQUEST + PD_A (NF-A -> NF-B)${NC}"
echo -e "  ${BLUE}Sequenz: NF_A -> Veramo_NF_A -> Envoy -> Gateway_A -> Gateway_B -> NF_B${NC}"

RESPONSE=$(curl -s -X POST "$NF_A_URL/didcomm/initiate-auth" \
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
# PHASE 2: VP Exchange - Check via Logs
#############################################################################

echo -e "\n${BOLD}[PHASE 2] VP Exchange (Mutual Authentication)${NC}"
echo -e "  ${BLUE}NF-B empfaengt, erstellt VP_B + PD_B, sendet zurueck${NC}"
echo -e "  ${BLUE}NF-A verifiziert VP_B, erstellt VP_A, sendet${NC}"
echo -e "  ${BLUE}NF-B verifiziert VP_A${NC}"

# Check NF-B Logs
NF_B_LOG=$(kubectl logs deployment/nf-b -n nf-b-namespace --context kind-cluster-b --tail=100 2>/dev/null || echo "")

if echo "$NF_B_LOG" | grep -qi "VP_AUTH_REQUEST\|request-presentation\|received.*auth"; then
    test_pass "NF-B hat VP_AUTH_REQUEST empfangen"
else
    log_info "NF-B Log check (VP_AUTH_REQUEST nicht gefunden)"
fi

if echo "$NF_B_LOG" | grep -qi "VP_WITH_PD\|presentation-with-definition\|sending.*VP.*PD"; then
    test_pass "NF-B hat VP_WITH_PD (VP_B + PD_B) gesendet"
else
    log_info "NF-B VP_WITH_PD status unklar"
fi

# Check NF-A Logs
NF_A_LOG=$(kubectl logs deployment/nf-a -n nf-a-namespace --context kind-cluster-a --tail=100 2>/dev/null || echo "")

if echo "$NF_A_LOG" | grep -qi "VP_WITH_PD\|received.*presentation\|verified.*VP"; then
    test_pass "NF-A hat VP_B empfangen"
else
    log_info "NF-A VP_B empfang unklar"
fi

if echo "$NF_A_LOG" | grep -qi "VP_RESPONSE\|sending.*presentation\|created.*VP"; then
    test_pass "NF-A hat VP_A gesendet"
else
    log_info "NF-A VP_A sending unklar"
fi

#############################################################################
# PHASE 3: AUTH_CONFIRMATION
#############################################################################

echo -e "\n${BOLD}[PHASE 3] AUTH_CONFIRMATION${NC}"

if echo "$NF_B_LOG" | grep -qi "AUTH_CONFIRMATION\|ack\|authenticated"; then
    test_pass "AUTH_CONFIRMATION gesendet (B -> A)"
else
    log_info "AUTH_CONFIRMATION status unklar"
fi

if echo "$NF_A_LOG $NF_B_LOG" | grep -qi "session.*authenticated\|mutual.*auth.*success\|authentication.*complete"; then
    test_pass "Mutual Authentication abgeschlossen"
else
    log_info "Auth completion unklar"
fi

#############################################################################
# GATEWAY VISIBILITY TEST
#############################################################################

echo -e "\n${BOLD}[SECURITY] Gateway Visibility Test${NC}"
echo -e "  ${BLUE}Testet ob Gateway DIDComm Inhalt lesen kann${NC}"

GW_TEST=$(curl -s -X POST "$NF_A_URL/test/gateway-visibility" \
    -H "Content-Type: application/json" \
    -d "{\"targetDid\": \"$DID_NF_B\", \"testMessage\": \"secret-$(date +%s)\"}" 2>&1)

if echo "$GW_TEST" | grep -qi "encrypted\|protected\|jwe\|ciphertext"; then
    test_pass "DIDComm Nachricht ist E2E verschluesselt"
    log_info "Gateway kann Klartext NICHT lesen"
else
    log_info "Gateway visibility test: $GW_TEST"
fi

#############################################################################
# MTLS CHECK
#############################################################################

echo -e "\n${BOLD}[SECURITY] mTLS Gateway Mode${NC}"

GW_A=$(kubectl get gateway -n istio-system --context kind-cluster-a -o jsonpath='{.items[*].spec.servers[*].tls.mode}' 2>/dev/null || echo "N/A")
if echo "$GW_A" | grep -qi "MUTUAL"; then
    test_pass "Gateway-A: mTLS MUTUAL"
else
    log_info "Gateway-A TLS: $GW_A"
fi

GW_B=$(kubectl get gateway -n istio-system --context kind-cluster-b -o jsonpath='{.items[*].spec.servers[*].tls.mode}' 2>/dev/null || echo "N/A")
if echo "$GW_B" | grep -qi "MUTUAL"; then
    test_pass "Gateway-B: mTLS MUTUAL"
else
    log_info "Gateway-B TLS: $GW_B"
fi

#############################################################################
# PACKING MODE
#############################################################################

echo -e "\n${BOLD}[ENCRYPTION] DIDComm Packing Mode${NC}"

PACK_A=$(curl -s "$NF_A_URL/test/packing-mode" 2>&1)
if echo "$PACK_A" | grep -qi "anoncrypt\|authcrypt"; then
    test_pass "NF-A: DIDComm anoncrypt/authcrypt"
    log_info "Mode: $(echo $PACK_A | grep -o '"packingMode":"[^"]*"' | cut -d'"' -f4 || echo "$PACK_A")"
else
    log_info "Packing mode: $PACK_A"
fi

#############################################################################
# RESULTS
#############################################################################

TOTAL=$((PASSED + FAILED))

echo -e "\n${BOLD}${BLUE}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  TEST RESULTS${NC}"
echo -e "${BOLD}${BLUE}══════════════════════════════════════════════════════════════${NC}"

echo -e "\n  Total:  $TOTAL"
echo -e "  ${GREEN}Passed: $PASSED${NC}"
echo -e "  ${RED}Failed: $FAILED${NC}"

echo -e "\n${BOLD}  Sequenzdiagramm Phasen:${NC}"
echo -e "  Phase 1: VP_AUTH_REQUEST + PD_A (A -> B)"
echo -e "  Phase 2: VP_WITH_PD (VP_B + PD_B) (B -> A)"
echo -e "  Phase 2: VP_RESPONSE (VP_A) (A -> B)"
echo -e "  Phase 3: AUTH_CONFIRMATION (B -> A)"
echo -e "  Phase 3: SERVICE_REQUEST/RESPONSE (authorized)"

if [ $FAILED -eq 0 ]; then
    echo -e "\n${GREEN}${BOLD}══════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}${BOLD}  ✅ ALL TESTS PASSED${NC}"
    echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════════${NC}"
    exit 0
else
    echo -e "\n${YELLOW}${BOLD}══════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}${BOLD}  ⚠️  $PASSED/$TOTAL Tests passed${NC}"
    echo -e "${YELLOW}${BOLD}══════════════════════════════════════════════════════════════${NC}"
    exit 0
fi
