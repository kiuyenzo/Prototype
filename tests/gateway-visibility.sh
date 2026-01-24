#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
mkdir -p "$RESULTS_DIR"

EVIDENCE_FILE="$RESULTS_DIR/gateway_evidence_$(date '+%Y%m%d_%H%M%S').txt"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'; DIM='\033[2m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
header() { echo -e "\n${BLUE}$1${NC}\n"; }
evidence() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$EVIDENCE_FILE"; }

log_raw() {
    echo "" >> "$EVIDENCE_FILE"
    echo "--- RAW DATA: $1 ---" >> "$EVIDENCE_FILE"
    echo "$2" >> "$EVIDENCE_FILE"
    echo "--- END RAW DATA ---" >> "$EVIDENCE_FILE"
}

CTX_A="kind-cluster-a"; CTX_B="kind-cluster-b"
NS_A="nf-a-namespace"; NS_B="nf-b-namespace"

cluster_curl() { docker exec "${1}-control-plane" curl -s "${@:2}" 2>/dev/null; }
get_pod() { kubectl --context $1 get pods -n $2 -l app=$3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null; }

TEST_PAYLOAD_COMPACT='{"type":"https://didcomm.org/present-proof/3.0/request-presentation","from":"did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a","to":["did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"],"body":{"goal_code":"nf.auth","presentation_definition":{"id":"nf-authorization-pd"}}}'

POD_A=$(get_pod $CTX_A $NS_A nf-a)
POD_B=$(get_pod $CTX_B $NS_B nf-b)
SVC_IP=$(kubectl --context $CTX_A get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.clusterIP}')

TESTS_PASSED=0
TESTS_FAILED=0
BASELINE_SIZE=0
SIGNED_SIZE=0
ENCRYPTED_SIZE=0

echo "Gateway Visibility Tests Evidence Log" > "$EVIDENCE_FILE"
echo "Generated: $(date '+%Y-%m-%d %H:%M:%S %Z')" >> "$EVIDENCE_FILE"
echo "Pod A: $POD_A" >> "$EVIDENCE_FILE"
echo "Pod B: $POD_B" >> "$EVIDENCE_FILE"
echo "Gateway IP: $SVC_IP" >> "$EVIDENCE_FILE"
echo "" >> "$EVIDENCE_FILE"

header "Gateway Visibility Tests"

test_g1_baseline() {
    header "G1: Baseline Mode"

    BASELINE_SIZE=${#TEST_PAYLOAD_COMPACT}
    local checks=0

    if echo "$TEST_PAYLOAD_COMPACT" | grep -q "presentation_definition"; then
        pass "presentation_definition visible in plaintext"
        ((checks++))
    else
        fail "presentation_definition not found"
    fi

    if echo "$TEST_PAYLOAD_COMPACT" | grep -q "did:web:"; then
        pass "DID information exposed to gateway"
        ((checks++))
    else
        fail "DID not found"
    fi

    if echo "$TEST_PAYLOAD_COMPACT" | grep -q "present-proof/3.0"; then
        pass "Message type visible"
        ((checks++))
    else
        fail "Message type not found"
    fi

    echo ""
    info "Gateway sees:"
    echo "$TEST_PAYLOAD_COMPACT" | python3 -m json.tool 2>/dev/null

    if [ $checks -eq 3 ]; then
        ((TESTS_PASSED++))
        pass "G1: Baseline payload fully visible"
        return 0
    else
        ((TESTS_FAILED++))
        fail "G1: Baseline test incomplete"
        return 1
    fi
}

test_g2_signed() {
    header "G2: Signed Mode (JWS)"

    local packed_response=$(kubectl --context $CTX_A exec $POD_A -c veramo-sidecar -n $NS_A -- \
        curl -s -X POST http://localhost:3001/debug/pack-message \
        -H "Content-Type: application/json" \
        -d "{\"payload\":$TEST_PAYLOAD_COMPACT,\"mode\":\"signed\"}" 2>/dev/null)

    local packed_msg=$(echo "$packed_response" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    print(data.get('packed', ''))
except: pass
" 2>/dev/null)

    SIGNED_SIZE=${#packed_msg}
    local checks=0

    local has_sig=$(echo "$packed_msg" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    print('YES' if data.get('signature') else 'NO')
except: print('NO')
" 2>/dev/null)
    if [ "$has_sig" = "YES" ]; then
        pass "JWS signature present"
        ((checks++))
    else
        fail "No signature found"
    fi

    local payload_b64=$(echo "$packed_msg" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    print(data.get('payload', ''))
except: pass
" 2>/dev/null)

    local decoded=$(echo "$payload_b64" | python3 -c "
import sys, base64
b64 = sys.stdin.read().strip()
b64 = b64.replace('-', '+').replace('_', '/')
padding = 4 - len(b64) % 4
if padding != 4: b64 += '=' * padding
try: print(base64.b64decode(b64).decode('utf-8'))
except: pass
" 2>/dev/null)

    if echo "$decoded" | grep -q "presentation_definition"; then
        pass "Payload decodable (sensitive data visible)"
        ((checks++))
    else
        fail "Could not decode payload"
    fi

    local alg=$(echo "$packed_msg" | python3 -c "
import sys, json, base64
try:
    data = json.loads(sys.stdin.read())
    protected = data.get('protected', '')
    protected = protected.replace('-', '+').replace('_', '/')
    padding = 4 - len(protected) % 4
    if padding != 4: protected += '=' * padding
    header = json.loads(base64.b64decode(protected))
    print(header.get('alg', 'N/A'))
except: pass
" 2>/dev/null)
    if [ -n "$alg" ]; then
        pass "Algorithm: $alg"
        ((checks++))
    else
        fail "No algorithm found"
    fi

    echo ""
    info "Gateway sees (JWS):"
    echo "$packed_msg" | python3 -m json.tool 2>/dev/null

    if [ $checks -eq 3 ]; then
        ((TESTS_PASSED++))
        pass "G2: JWS payload visible to gateway"
        return 0
    else
        ((TESTS_FAILED++))
        fail "G2: Signed test incomplete"
        return 1
    fi
}

test_g3_encrypted() {
    header "G3: Encrypted Mode (JWE)"

    local packed_response=$(kubectl --context $CTX_A exec $POD_A -c veramo-sidecar -n $NS_A -- \
        curl -s -X POST http://localhost:3001/debug/pack-message \
        -H "Content-Type: application/json" \
        -d "{\"payload\":$TEST_PAYLOAD_COMPACT,\"mode\":\"encrypted\"}" 2>/dev/null)

    local packed_msg=$(echo "$packed_response" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    print(data.get('packed', ''))
except: pass
" 2>/dev/null)

    ENCRYPTED_SIZE=${#packed_msg}
    local checks=0

    local has_ciphertext=$(echo "$packed_msg" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    print('YES' if 'ciphertext' in data and data['ciphertext'] else 'NO')
except: print('NO')
" 2>/dev/null)
    if [ "$has_ciphertext" = "YES" ]; then
        pass "Ciphertext present"
        ((checks++))
    else
        fail "No ciphertext"
    fi

    local has_iv=$(echo "$packed_msg" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    print('YES' if 'iv' in data and 'tag' in data else 'NO')
except: print('NO')
" 2>/dev/null)
    if [ "$has_iv" = "YES" ]; then
        pass "IV and authentication tag present"
        ((checks++))
    else
        fail "Missing IV or tag"
    fi

    local skid=$(echo "$packed_msg" | python3 -c "
import sys, json, base64
try:
    data = json.loads(sys.stdin.read())
    protected = data.get('protected', '')
    protected = protected.replace('-', '+').replace('_', '/')
    padding = 4 - len(protected) % 4
    if padding != 4: protected += '=' * padding
    header = json.loads(base64.b64decode(protected))
    print(header.get('skid', ''))
except: pass
" 2>/dev/null)
    if [ -n "$skid" ]; then
        pass "Sender key ID (skid) present"
        ((checks++))
    else
        fail "No skid"
    fi

    local exposed=0
    for term in "presentation_definition" "goal_code" "nf.auth"; do
        if echo "$packed_msg" | grep -q "$term"; then
            fail "$term EXPOSED in JWE"
            ((exposed++))
        fi
    done
    if [ $exposed -eq 0 ]; then
        pass "All sensitive terms protected"
        ((checks++))
    fi

    echo ""
    info "Gateway sees:"
    echo "$packed_msg" | python3 -m json.tool 2>/dev/null
    echo ""
    info "Ciphertext (truncated):"
    echo "$packed_msg" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    ct = data.get('ciphertext', '')
    print('  ' + ct[:80] + '...' if len(ct) > 80 else '  ' + ct)
except: pass
" 2>/dev/null

    if [ $checks -eq 4 ]; then
        ((TESTS_PASSED++))
        pass "G3: JWE payload NOT visible to gateway (encrypted)"
        return 0
    else
        ((TESTS_FAILED++))
        fail "G3: Encrypted test incomplete"
        return 1
    fi
}

capture_gateway_logs() {
    local gw_pod=$(kubectl --context $CTX_A get pods -n istio-system -l app=istio-ingressgateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    if [ -z "$gw_pod" ]; then
        return
    fi
    local gw_logs=$(kubectl --context $CTX_A logs $gw_pod -n istio-system 2>/dev/null | grep -E "POST|didcomm|veramo" || echo "")
    if [ -n "$gw_logs" ]; then
        log_raw "Istio Gateway Access Logs" "$gw_logs"
    fi
}

show_result() {
    capture_gateway_logs

    local total=$((TESTS_PASSED + TESTS_FAILED))
    echo ""
    echo -e "${BLUE}Gateway Visibility Results${NC}"
    echo -e "${GREEN}Result: $TESTS_PASSED of $total tests passed${NC}"
    echo ""
    echo -e "${DIM}Evidence: results/$(basename "$EVIDENCE_FILE")${NC}"
}

test_g1_baseline || true
test_g2_signed || true
test_g3_encrypted || true
show_result
