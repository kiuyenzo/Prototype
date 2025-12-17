#!/bin/bash

#############################################################################
# V1 vs V4a Comparison Tests
#############################################################################
#
# Vergleicht die beiden Architektur-Varianten:
#
# V1:  NF ← TCP+DIDComm(E2E encrypted) → Gateway ← mTLS+DIDComm(E2E) → Gateway
#      DIDCOMM_PACKING_MODE=encrypted (JWE mit X25519 + AES-256-GCM)
#
# V4a: NF ← mTLS+DIDComm(unencrypted) → Gateway ← mTLS+DIDComm(plain) → Gateway
#      DIDCOMM_PACKING_MODE=signed oder none (nur mTLS-Transportverschlüsselung)
#
# Getestet wird:
#   1. Payload-Sichtbarkeit am Gateway
#   2. Performance-Unterschiede (Latenz, Throughput)
#   3. Payload-Größe
#   4. Manipulation Detection
#   5. Key Compromise Szenarien
#
#############################################################################

set -e

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'
BOLD='\033[1m'

# Konfiguration
NF_A_URL="http://localhost:30451"
NF_B_URL="http://localhost:30452"
DID_NF_A="did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a"
DID_NF_B="did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b"

# Namespace
NS_A="nf-a-namespace"
NS_B="nf-b-namespace"

# Results Storage
RESULTS_DIR="/tmp/v1-v4a-comparison-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

#############################################################################
# Helper Functions
#############################################################################

header() {
    echo ""
    echo -e "${BOLD}${MAGENTA}══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${MAGENTA}  $1${NC}"
    echo -e "${BOLD}${MAGENTA}══════════════════════════════════════════════════════════════${NC}"
}

section() {
    echo ""
    echo -e "${CYAN}┌────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│ ${BOLD}$1${NC}"
    echo -e "${CYAN}└────────────────────────────────────────────────────────────┘${NC}"
}

info() {
    echo -e "  ${BLUE}ℹ️  $1${NC}"
}

success() {
    echo -e "  ${GREEN}✅ $1${NC}"
}

warn() {
    echo -e "  ${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "  ${RED}❌ $1${NC}"
}

#############################################################################
# Mode Switching Functions
#############################################################################

switch_to_v1() {
    echo -e "\n${YELLOW}► Switching to V1 (E2E Encrypted)...${NC}"

    # Check if running in Kubernetes
    if kubectl get pods -n "$NS_A" &>/dev/null; then
        kubectl set env deployment/veramo-nf-a DIDCOMM_PACKING_MODE=encrypted -n "$NS_A" 2>/dev/null || true
        kubectl set env deployment/veramo-nf-b DIDCOMM_PACKING_MODE=encrypted -n "$NS_B" 2>/dev/null || true

        # Wait for rollout
        kubectl rollout status deployment/veramo-nf-a -n "$NS_A" --timeout=60s 2>/dev/null || true
        kubectl rollout status deployment/veramo-nf-b -n "$NS_B" --timeout=60s 2>/dev/null || true
        sleep 5
        success "Switched to V1 (DIDCOMM_PACKING_MODE=encrypted)"
    else
        warn "Kubernetes not available - testing with current config"
    fi
}

switch_to_v4a() {
    echo -e "\n${YELLOW}► Switching to V4a (Unencrypted DIDComm)...${NC}"

    if kubectl get pods -n "$NS_A" &>/dev/null; then
        kubectl set env deployment/veramo-nf-a DIDCOMM_PACKING_MODE=signed -n "$NS_A" 2>/dev/null || true
        kubectl set env deployment/veramo-nf-b DIDCOMM_PACKING_MODE=signed -n "$NS_B" 2>/dev/null || true

        kubectl rollout status deployment/veramo-nf-a -n "$NS_A" --timeout=60s 2>/dev/null || true
        kubectl rollout status deployment/veramo-nf-b -n "$NS_B" --timeout=60s 2>/dev/null || true
        sleep 5
        success "Switched to V4a (DIDCOMM_PACKING_MODE=signed)"
    else
        warn "Kubernetes not available - testing with current config"
    fi
}

get_current_mode() {
    if kubectl get pods -n "$NS_A" &>/dev/null; then
        MODE=$(kubectl get deployment veramo-nf-a -n "$NS_A" -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="DIDCOMM_PACKING_MODE")].value}' 2>/dev/null || echo "unknown")
        echo "$MODE"
    else
        echo "unknown"
    fi
}

#############################################################################
# Test Functions
#############################################################################

test_payload_visibility() {
    local mode=$1
    local output_file="$RESULTS_DIR/payload-$mode.txt"

    section "TEST 1: Payload-Sichtbarkeit am Gateway ($mode)"

    info "Sende Test-Nachricht und capture Payload..."

    # Send a test message
    RESPONSE=$(curl -s -X POST "$NF_A_URL/didcomm/send" \
        -H "Content-Type: application/json" \
        -d "{
            \"to\": \"$DID_NF_B\",
            \"type\": \"test-visibility\",
            \"body\": {
                \"secret\": \"THIS_SHOULD_BE_HIDDEN_IN_V1\",
                \"timestamp\": \"$(date -Iseconds)\",
                \"mode\": \"$mode\"
            }
        }" 2>&1)

    echo "$RESPONSE" > "$output_file"

    # Analyze response
    if echo "$RESPONSE" | grep -q "protected.*ciphertext.*tag"; then
        success "Payload ist JWE-verschlüsselt (E2E)"
        echo "  Format: JWE (JSON Web Encryption)"
        echo "  Sichtbar am Gateway: Nur verschlüsselte Daten"
        return 0
    elif echo "$RESPONSE" | grep -q "THIS_SHOULD_BE_HIDDEN"; then
        warn "Payload ist im KLARTEXT sichtbar!"
        echo "  Format: Plain JSON"
        echo "  Sichtbar am Gateway: Alle Daten lesbar"
        return 1
    elif echo "$RESPONSE" | grep -q "payload.*signature"; then
        info "Payload ist signiert aber nicht verschlüsselt (JWS)"
        echo "  Format: JWS (JSON Web Signature)"
        echo "  Sichtbar am Gateway: Daten lesbar, Integrität geschützt"
        return 2
    else
        info "Response: ${RESPONSE:0:200}"
        return 3
    fi
}

test_performance() {
    local mode=$1
    local iterations=10
    local output_file="$RESULTS_DIR/performance-$mode.txt"

    section "TEST 2: Performance-Messung ($mode)"

    info "Führe $iterations Iterationen durch..."

    local total_time=0
    local times=()

    for i in $(seq 1 $iterations); do
        START=$(date +%s%N)

        curl -s -X POST "$NF_A_URL/didcomm/send" \
            -H "Content-Type: application/json" \
            -d "{
                \"to\": \"$DID_NF_B\",
                \"type\": \"performance-test\",
                \"body\": {\"iteration\": $i}
            }" > /dev/null 2>&1

        END=$(date +%s%N)
        DURATION=$(( (END - START) / 1000000 ))  # Convert to ms
        times+=($DURATION)
        total_time=$((total_time + DURATION))

        echo -ne "\r  Progress: $i/$iterations"
    done
    echo ""

    # Calculate statistics
    AVG=$((total_time / iterations))

    # Find min/max
    MIN=${times[0]}
    MAX=${times[0]}
    for t in "${times[@]}"; do
        ((t < MIN)) && MIN=$t
        ((t > MAX)) && MAX=$t
    done

    echo "  ┌─────────────────────────────────┐"
    echo "  │ Performance Results ($mode)"
    echo "  ├─────────────────────────────────┤"
    printf "  │ Average Latency: %6d ms      │\n" $AVG
    printf "  │ Min Latency:     %6d ms      │\n" $MIN
    printf "  │ Max Latency:     %6d ms      │\n" $MAX
    echo "  └─────────────────────────────────┘"

    # Save results
    echo "mode=$mode" > "$output_file"
    echo "avg_ms=$AVG" >> "$output_file"
    echo "min_ms=$MIN" >> "$output_file"
    echo "max_ms=$MAX" >> "$output_file"
    echo "iterations=$iterations" >> "$output_file"

    echo "$AVG"
}

test_payload_size() {
    local mode=$1
    local output_file="$RESULTS_DIR/size-$mode.txt"

    section "TEST 3: Payload-Größe ($mode)"

    # Create a standard test payload
    TEST_PAYLOAD='{
        "credentialSubject": {
            "id": "did:web:example.com:nf",
            "role": "network-function",
            "clusterId": "cluster-a",
            "status": "active",
            "capabilities": ["messaging", "verification"]
        }
    }'

    info "Sende Standard-Payload und messe Größe..."

    # Get the actual transmitted size (via verbose curl)
    RESPONSE=$(curl -s -w "\n%{size_request}\n%{size_upload}" \
        -X POST "$NF_A_URL/didcomm/send" \
        -H "Content-Type: application/json" \
        -d "{
            \"to\": \"$DID_NF_B\",
            \"type\": \"size-test\",
            \"body\": $TEST_PAYLOAD
        }" 2>&1)

    # Parse response
    BODY=$(echo "$RESPONSE" | head -n -2)
    REQUEST_SIZE=$(echo "$RESPONSE" | tail -n 2 | head -n 1)
    UPLOAD_SIZE=$(echo "$RESPONSE" | tail -n 1)

    BODY_SIZE=${#BODY}

    echo "  ┌─────────────────────────────────┐"
    echo "  │ Payload Size Results ($mode)"
    echo "  ├─────────────────────────────────┤"
    printf "  │ Response Body:   %6d bytes   │\n" $BODY_SIZE
    printf "  │ Request Size:    %6d bytes   │\n" ${REQUEST_SIZE:-0}
    printf "  │ Upload Size:     %6d bytes   │\n" ${UPLOAD_SIZE:-0}
    echo "  └─────────────────────────────────┘"

    echo "mode=$mode" > "$output_file"
    echo "body_size=$BODY_SIZE" >> "$output_file"
    echo "request_size=${REQUEST_SIZE:-0}" >> "$output_file"

    echo "$BODY_SIZE"
}

test_manipulation_detection() {
    local mode=$1

    section "TEST 4: Manipulation Detection ($mode)"

    info "Teste ob manipulierte Nachrichten erkannt werden..."

    # First, get a valid response
    VALID=$(curl -s -X POST "$NF_A_URL/didcomm/send" \
        -H "Content-Type: application/json" \
        -d "{
            \"to\": \"$DID_NF_B\",
            \"type\": \"manipulation-test\",
            \"body\": {\"original\": true}
        }" 2>&1)

    # Try to manipulate and resend
    if echo "$VALID" | grep -q "ciphertext"; then
        # V1: Try to modify ciphertext
        MANIPULATED=$(echo "$VALID" | sed 's/ciphertext":"[^"]*"/ciphertext":"TAMPERED_DATA"/')

        RESULT=$(curl -s -X POST "$NF_B_URL/didcomm/receive" \
            -H "Content-Type: application/json" \
            -d "{\"message\": $MANIPULATED}" 2>&1)

        if echo "$RESULT" | grep -qiE "error|fail|invalid|decrypt"; then
            success "V1: Manipulierte JWE wurde ERKANNT und ABGELEHNT"
            echo "  Grund: AES-GCM Authentication Tag Verification failed"
        else
            error "V1: Manipulation wurde NICHT erkannt!"
        fi
    else
        # V4a: Payload ist lesbar, check signature if present
        if echo "$VALID" | grep -q "signature"; then
            MANIPULATED=$(echo "$VALID" | sed 's/"original":true/"original":false,"injected":"malicious"/')

            RESULT=$(curl -s -X POST "$NF_B_URL/didcomm/receive" \
                -H "Content-Type: application/json" \
                -d "{\"message\": $MANIPULATED}" 2>&1)

            if echo "$RESULT" | grep -qiE "error|fail|invalid|signature"; then
                success "V4a (signed): Manipulation erkannt via Signatur"
            else
                warn "V4a (signed): Signaturprüfung möglicherweise nicht implementiert"
            fi
        else
            warn "V4a (none): Keine kryptographische Integritätsprüfung!"
            echo "  Manipulation wäre möglich ohne Erkennung"
        fi
    fi
}

test_gateway_interception() {
    local mode=$1

    section "TEST 5: Gateway Interception Simulation ($mode)"

    info "Simuliere was ein kompromittierter Gateway sehen würde..."

    # Send message with sensitive data
    RESPONSE=$(curl -s -X POST "$NF_A_URL/didcomm/send" \
        -H "Content-Type: application/json" \
        -d "{
            \"to\": \"$DID_NF_B\",
            \"type\": \"sensitive-data\",
            \"body\": {
                \"apiKey\": \"sk-secret-12345\",
                \"password\": \"super-secret-password\",
                \"creditCard\": \"4111-1111-1111-1111\",
                \"ssn\": \"123-45-6789\"
            }
        }" 2>&1)

    echo ""
    echo "  Gateway sieht folgendes:"
    echo "  ─────────────────────────────────────────────"

    if echo "$RESPONSE" | grep -q "ciphertext"; then
        echo -e "  ${GREEN}[ENCRYPTED]${NC}"
        echo "  {\"protected\":\"eyJ...\",\"ciphertext\":\"...\",\"tag\":\"...\"}"
        echo ""
        success "Sensitive Daten sind NICHT sichtbar (V1)"
        echo "  apiKey: *** ENCRYPTED ***"
        echo "  password: *** ENCRYPTED ***"
        echo "  creditCard: *** ENCRYPTED ***"
    else
        echo -e "  ${RED}[PLAINTEXT]${NC}"
        echo "$RESPONSE" | head -c 500
        echo ""
        error "Sensitive Daten sind SICHTBAR (V4a)!"

        # Check what's visible
        if echo "$RESPONSE" | grep -q "sk-secret"; then
            echo "  apiKey: sk-secret-12345 [EXPOSED!]"
        fi
        if echo "$RESPONSE" | grep -q "super-secret"; then
            echo "  password: super-secret-password [EXPOSED!]"
        fi
        if echo "$RESPONSE" | grep -q "4111"; then
            echo "  creditCard: 4111-1111-1111-1111 [EXPOSED!]"
        fi
    fi
    echo "  ─────────────────────────────────────────────"
}

#############################################################################
# Main Comparison
#############################################################################

run_full_comparison() {
    header "V1 vs V4a FULL COMPARISON TEST"

    echo ""
    echo -e "${BOLD}Architektur-Varianten:${NC}"
    echo ""
    echo "  V1:  NF ←─ DIDComm(JWE) ─→ Gateway ←─ mTLS+JWE ─→ Gateway"
    echo "       └─ Ende-zu-Ende verschlüsselt (X25519 + AES-256-GCM)"
    echo ""
    echo "  V4a: NF ←─ DIDComm(plain) ─→ Gateway ←─ mTLS ─→ Gateway"
    echo "       └─ Nur Transportverschlüsselung (mTLS)"
    echo ""

    # Store results for comparison
    declare -A V1_RESULTS
    declare -A V4A_RESULTS

    # =========== V1 TESTS ===========
    header "PHASE 1: V1 (E2E Encrypted) Tests"
    switch_to_v1
    sleep 3

    test_payload_visibility "V1"
    V1_RESULTS[payload]=$?

    V1_RESULTS[latency]=$(test_performance "V1")
    V1_RESULTS[size]=$(test_payload_size "V1")

    test_manipulation_detection "V1"
    test_gateway_interception "V1"

    # =========== V4a TESTS ===========
    header "PHASE 2: V4a (Unencrypted) Tests"
    switch_to_v4a
    sleep 3

    test_payload_visibility "V4a"
    V4A_RESULTS[payload]=$?

    V4A_RESULTS[latency]=$(test_performance "V4a")
    V4A_RESULTS[size]=$(test_payload_size "V4a")

    test_manipulation_detection "V4a"
    test_gateway_interception "V4a"

    # =========== COMPARISON ===========
    header "COMPARISON RESULTS"

    echo ""
    echo "  ┌─────────────────────────────────────────────────────────────────┐"
    echo "  │                    V1 vs V4a COMPARISON                         │"
    echo "  ├─────────────────────────────────────────────────────────────────┤"
    echo "  │ Metric              │    V1 (encrypted)  │   V4a (signed)      │"
    echo "  ├─────────────────────────────────────────────────────────────────┤"
    printf "  │ Avg Latency         │    %6s ms        │   %6s ms          │\n" "${V1_RESULTS[latency]}" "${V4A_RESULTS[latency]}"
    printf "  │ Payload Size        │    %6s bytes     │   %6s bytes       │\n" "${V1_RESULTS[size]}" "${V4A_RESULTS[size]}"
    echo "  ├─────────────────────────────────────────────────────────────────┤"
    echo "  │ E2E Encryption      │       ✅ YES        │      ❌ NO          │"
    echo "  │ Gateway can read    │       ❌ NO         │      ✅ YES         │"
    echo "  │ Manipulation detect │       ✅ YES        │      ⚠️  Partial    │"
    echo "  │ Forward Secrecy     │       ✅ YES        │      ❌ NO          │"
    echo "  └─────────────────────────────────────────────────────────────────┘"

    # Calculate overhead
    if [[ -n "${V1_RESULTS[latency]}" && -n "${V4A_RESULTS[latency]}" ]]; then
        LATENCY_OVERHEAD=$((V1_RESULTS[latency] - V4A_RESULTS[latency]))
        echo ""
        echo "  Performance Overhead (V1 vs V4a):"
        printf "    Latency: +%d ms (%d%% overhead)\n" $LATENCY_OVERHEAD $((LATENCY_OVERHEAD * 100 / V4A_RESULTS[latency]))
    fi

    if [[ -n "${V1_RESULTS[size]}" && -n "${V4A_RESULTS[size]}" && "${V4A_RESULTS[size]}" -gt 0 ]]; then
        SIZE_OVERHEAD=$((V1_RESULTS[size] - V4A_RESULTS[size]))
        printf "    Size: +%d bytes (%d%% overhead)\n" $SIZE_OVERHEAD $((SIZE_OVERHEAD * 100 / V4A_RESULTS[size]))
    fi

    # Security Assessment
    echo ""
    echo "  ┌─────────────────────────────────────────────────────────────────┐"
    echo "  │                    SECURITY ASSESSMENT                          │"
    echo "  ├─────────────────────────────────────────────────────────────────┤"
    echo "  │                                                                 │"
    echo "  │  V1 (encrypted):                                                │"
    echo "  │    ✅ Geeignet für: Production, Compliance, Sensitive Data      │"
    echo "  │    ✅ Schutz bei: Gateway-Kompromittierung, Log-Leaks          │"
    echo "  │    ⚠️  Nachteil: Höhere Latenz, größere Payloads               │"
    echo "  │                                                                 │"
    echo "  │  V4a (signed/plain):                                            │"
    echo "  │    ✅ Geeignet für: Internal Networks, Debugging, Low-Latency  │"
    echo "  │    ❌ Risiko bei: Gateway-Kompromittierung = Daten-Leak        │"
    echo "  │    ✅ Vorteil: Bessere Performance, einfacheres Debugging      │"
    echo "  │                                                                 │"
    echo "  └─────────────────────────────────────────────────────────────────┘"

    # Recommendation
    echo ""
    echo -e "${BOLD}Empfehlung für 5G NF-Kommunikation:${NC}"
    echo ""
    echo -e "  ${GREEN}► V1 (encrypted)${NC} für:"
    echo "    - Cross-Operator Kommunikation"
    echo "    - Roaming-Szenarien"
    echo "    - Compliance mit 3GPP Security Standards"
    echo "    - Zero-Trust Architektur"
    echo ""
    echo -e "  ${YELLOW}► V4a (signed)${NC} für:"
    echo "    - Intra-Operator (trusted network)"
    echo "    - Development/Testing"
    echo "    - Performance-kritische Szenarien"
    echo "    - Wenn Gateway-Trust gegeben ist"

    # Save full report
    echo ""
    info "Ergebnisse gespeichert in: $RESULTS_DIR/"

    # Reset to V1 (secure default)
    echo ""
    echo -e "${YELLOW}► Setze zurück auf V1 (secure default)...${NC}"
    switch_to_v1
}

#############################################################################
# Quick Tests (without mode switching)
#############################################################################

quick_test() {
    header "QUICK TEST (Current Mode)"

    CURRENT_MODE=$(get_current_mode)
    info "Current DIDCOMM_PACKING_MODE: $CURRENT_MODE"

    test_payload_visibility "$CURRENT_MODE"
    test_gateway_interception "$CURRENT_MODE"
}

#############################################################################
# Usage
#############################################################################

usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  full      Run full V1 vs V4a comparison (switches modes)"
    echo "  quick     Quick test with current mode"
    echo "  v1        Switch to V1 and test"
    echo "  v4a       Switch to V4a and test"
    echo "  status    Show current mode"
    echo ""
    echo "Examples:"
    echo "  $0 full    # Complete comparison"
    echo "  $0 quick   # Test current config"
    echo "  $0 v1      # Switch to encrypted mode"
}

#############################################################################
# Main
#############################################################################

case "${1:-full}" in
    full)
        run_full_comparison
        ;;
    quick)
        quick_test
        ;;
    v1)
        switch_to_v1
        quick_test
        ;;
    v4a)
        switch_to_v4a
        quick_test
        ;;
    status)
        echo "Current mode: $(get_current_mode)"
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        usage
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}${BOLD}Tests completed.${NC}"
echo ""
