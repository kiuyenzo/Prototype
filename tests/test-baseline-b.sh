#!/bin/bash
# =============================================================================
# Baseline B Test Script - mTLS only (no DIDComm, no VPs)
# =============================================================================
# Tests direct NF-to-NF communication via mTLS without DIDComm/VP overhead
# For performance comparison against V1 (encrypted) and V4a (signed)
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[PASS]${NC} $1"; }
error() { echo -e "${RED}[FAIL]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
header() { echo -e "\n${CYAN}═══════════════════════════════════════════════════════════════${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"; }

# Configuration
CLUSTER_A_CONTEXT="kind-cluster-a"
CLUSTER_B_CONTEXT="kind-cluster-b"
NS_A="nf-a-namespace"
NS_B="nf-b-namespace"
NUM_RUNS=${1:-10}

# Get Gateway IPs and Ports
get_gateway_info() {
    CLUSTER_A_IP=$(kubectl --context $CLUSTER_A_CONTEXT get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
    CLUSTER_B_IP=$(kubectl --context $CLUSTER_B_CONTEXT get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')

    CLUSTER_A_PORT=$(kubectl --context $CLUSTER_A_CONTEXT get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.ports[?(@.name=="http2")].nodePort}')
    CLUSTER_B_PORT=$(kubectl --context $CLUSTER_B_CONTEXT get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.ports[?(@.name=="http2")].nodePort}')

    info "Cluster-A Gateway: $CLUSTER_A_IP:$CLUSTER_A_PORT"
    info "Cluster-B Gateway: $CLUSTER_B_IP:$CLUSTER_B_PORT"
}

# Apply baseline configuration
apply_baseline_config() {
    header "Applying Baseline B Configuration"

    kubectl apply -f deploy/mtls-config/mtls-baseline.yaml --context $CLUSTER_A_CONTEXT 2>/dev/null || true
    kubectl apply -f deploy/mtls-config/mtls-baseline.yaml --context $CLUSTER_B_CONTEXT 2>/dev/null || true

    sleep 3
    success "Baseline B configuration applied"
}

# Test baseline endpoint availability
test_baseline_health() {
    header "Testing Baseline Endpoint Availability"

    # Test NF-A baseline endpoint
    info "Testing NF-A /baseline/process..."
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST "http://$CLUSTER_A_IP:$CLUSTER_A_PORT/baseline/process" \
        -H "Content-Type: application/json" \
        -d '{"service":"echo","action":"test","params":{"test":true},"sender":"test","timestamp":'$(date +%s000)'}' \
        --max-time 10 2>/dev/null || echo "000")

    if [ "$RESPONSE" = "200" ]; then
        success "NF-A baseline endpoint: OK"
    else
        error "NF-A baseline endpoint: HTTP $RESPONSE"
        return 1
    fi

    # Test NF-B baseline endpoint
    info "Testing NF-B /baseline/process..."
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST "http://$CLUSTER_B_IP:$CLUSTER_B_PORT/baseline/process" \
        -H "Content-Type: application/json" \
        -d '{"service":"echo","action":"test","params":{"test":true},"sender":"test","timestamp":'$(date +%s000)'}' \
        --max-time 10 2>/dev/null || echo "000")

    if [ "$RESPONSE" = "200" ]; then
        success "NF-B baseline endpoint: OK"
    else
        error "NF-B baseline endpoint: HTTP $RESPONSE"
        return 1
    fi
}

# Run baseline performance test
run_baseline_performance_test() {
    header "Baseline B Performance Test ($NUM_RUNS runs)"

    LATENCIES=()
    SUCCESSES=0
    FAILURES=0

    for i in $(seq 1 $NUM_RUNS); do
        START_TIME=$(date +%s%3N)

        # Call NF-A's baseline/request which will call NF-B's baseline/process
        RESPONSE=$(curl -s -w "\n%{http_code}" \
            -X POST "http://$CLUSTER_A_IP:$CLUSTER_A_PORT/baseline/request" \
            -H "Content-Type: application/json" \
            -d '{"service":"nudm-sdm","action":"am-data","params":{"supi":"imsi-262011234567890"}}' \
            --max-time 30 2>/dev/null)

        END_TIME=$(date +%s%3N)
        HTTP_CODE=$(echo "$RESPONSE" | tail -1)
        BODY=$(echo "$RESPONSE" | head -n -1)

        LATENCY=$((END_TIME - START_TIME))

        if [ "$HTTP_CODE" = "200" ]; then
            LATENCIES+=($LATENCY)
            ((SUCCESSES++))
            echo -e "  Run $i: ${GREEN}${LATENCY}ms${NC}"
        else
            ((FAILURES++))
            echo -e "  Run $i: ${RED}FAILED (HTTP $HTTP_CODE)${NC}"
        fi
    done

    # Calculate statistics
    if [ ${#LATENCIES[@]} -gt 0 ]; then
        SUM=0
        MIN=${LATENCIES[0]}
        MAX=${LATENCIES[0]}

        for lat in "${LATENCIES[@]}"; do
            SUM=$((SUM + lat))
            [ $lat -lt $MIN ] && MIN=$lat
            [ $lat -gt $MAX ] && MAX=$lat
        done

        AVG=$((SUM / ${#LATENCIES[@]}))

        echo ""
        echo "┌─────────────────────────────────────────┐"
        echo "│  BASELINE B PERFORMANCE RESULTS         │"
        echo "├─────────────────────────────────────────┤"
        printf "│  Successful Runs:  %-20s│\n" "$SUCCESSES / $NUM_RUNS"
        printf "│  Average Latency:  %-20s│\n" "${AVG}ms"
        printf "│  Min Latency:      %-20s│\n" "${MIN}ms"
        printf "│  Max Latency:      %-20s│\n" "${MAX}ms"
        echo "└─────────────────────────────────────────┘"

        # Save results for comparison
        echo "$AVG" > /tmp/baseline-b-avg-latency.txt
        echo "$MIN" > /tmp/baseline-b-min-latency.txt
        echo "$MAX" > /tmp/baseline-b-max-latency.txt
    fi
}

# Test 5G service (UDM subscriber data)
test_5g_service() {
    header "Testing 5G UDM Service via Baseline B"

    info "Requesting subscriber data for IMSI-262011234567890..."

    RESPONSE=$(curl -s \
        -X POST "http://$CLUSTER_A_IP:$CLUSTER_A_PORT/baseline/request" \
        -H "Content-Type: application/json" \
        -d '{"service":"nudm-sdm","action":"am-data","params":{"supi":"imsi-262011234567890"}}' \
        --max-time 30 2>/dev/null)

    if echo "$RESPONSE" | grep -q "subscribedUeAmbr"; then
        success "5G UDM service response received"
        echo ""
        echo "Response (truncated):"
        echo "$RESPONSE" | head -c 500
        echo "..."
    else
        error "5G UDM service failed"
        echo "Response: $RESPONSE"
        return 1
    fi
}

# Compare with DIDComm modes (if data available)
compare_modes() {
    header "Mode Comparison"

    BASELINE_AVG=$(cat /tmp/baseline-b-avg-latency.txt 2>/dev/null || echo "N/A")

    echo "┌──────────────────────────────────────────────────────────┐"
    echo "│  MODE COMPARISON (Average Latency)                       │"
    echo "├──────────────────────────────────────────────────────────┤"
    printf "│  Baseline B (mTLS only):     %-26s│\n" "${BASELINE_AVG}ms"
    printf "│  V4a (mTLS + DIDComm JWS):   %-26s│\n" "Run test-v1-vs-v4a-comparison.sh"
    printf "│  V1 (mTLS + DIDComm JWE):    %-26s│\n" "Run test-v1-vs-v4a-comparison.sh"
    echo "└──────────────────────────────────────────────────────────┘"
    echo ""
    info "For full comparison, run all three mode tests and compare results."
}

# Main
main() {
    header "BASELINE B TEST SUITE"
    echo "Mode: mTLS only (no DIDComm, no VP exchange)"
    echo "Purpose: Performance baseline for comparison with V1/V4a"
    echo ""

    get_gateway_info
    apply_baseline_config
    test_baseline_health
    test_5g_service
    run_baseline_performance_test
    compare_modes

    header "TEST COMPLETE"
    success "Baseline B tests finished successfully"
}

# Run
main "$@"
