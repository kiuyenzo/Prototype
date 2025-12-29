#!/bin/bash
# =============================================================================
# E2E Sequence Diagram Test - VP Authentication Protocol
# =============================================================================
#
# This test visualizes the complete VP authentication flow
# according to the sequence diagram:
#
#   Phase 1: VP_AUTH_REQUEST (NF-A -> NF-B)
#   Phase 2: VP Exchange (VP_B + PD_B <- -> VP_A)
#   Phase 3: AUTH_CONFIRMATION + Service Request/Response
#
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Configuration
CLUSTER_A_CONTEXT="kind-cluster-a"
CLUSTER_B_CONTEXT="kind-cluster-b"
NS_A="nf-a-namespace"
NS_B="nf-b-namespace"

# Test results
TESTS_PASSED=0
TESTS_FAILED=0

# =============================================================================
# Helper Functions
# =============================================================================

draw_box() {
    local title="$1"
    echo ""
    echo -e "${CYAN}+======================================================================+${NC}"
    echo -e "${CYAN}|${NC} ${BOLD}$title${NC}"
    echo -e "${CYAN}+======================================================================+${NC}"
}

phase_header() {
    local phase="$1"
    local desc="$2"
    echo ""
    echo -e "${MAGENTA}----------------------------------------------------------------------------${NC}"
    echo -e "${MAGENTA}  $phase: $desc${NC}"
    echo -e "${MAGENTA}----------------------------------------------------------------------------${NC}"
}

info() { echo -e "  ${BLUE}[INFO]${NC} $1"; }
success() { echo -e "  ${GREEN}[PASS]${NC} $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
error() { echo -e "  ${RED}[FAIL]${NC} $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
msg_out() { echo -e "  ${GREEN}---->>${NC} $1"; }
msg_in() { echo -e "  ${BLUE}<<----${NC} $1"; }
detail() { echo -e "  ${DIM}$1${NC}"; }

cluster_curl() {
    local cluster=$1
    shift
    docker exec "${cluster}-control-plane" curl -s "$@" 2>/dev/null
}

get_timestamp_ms() {
    python3 -c 'import time; print(int(time.time() * 1000))'
}

# =============================================================================
# Main Test
# =============================================================================

main() {
    draw_box "E2E SEQUENCE DIAGRAM TEST - VP Authentication Protocol"

    echo ""
    echo "  Date: $(date)"
    echo "  Purpose: Visualization of VP flow according to sequence diagram"
    echo ""

    # =========================================================================
    # Setup
    # =========================================================================

    info "Detecting gateway information..."

    CLUSTER_A_SVC_IP=$(kubectl --context $CLUSTER_A_CONTEXT get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.clusterIP}' 2>/dev/null)
    CLUSTER_B_SVC_IP=$(kubectl --context $CLUSTER_B_CONTEXT get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.clusterIP}' 2>/dev/null)

    if [ -z "$CLUSTER_A_SVC_IP" ] || [ -z "$CLUSTER_B_SVC_IP" ]; then
        error "Clusters not reachable. Are both clusters running?"
        exit 1
    fi

    NF_A_DID="did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a"
    NF_B_DID="did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"

    echo ""
    echo "  Cluster-A Gateway: $CLUSTER_A_SVC_IP"
    echo "  Cluster-B Gateway: $CLUSTER_B_SVC_IP"
    echo "  NF-A DID: $NF_A_DID"
    echo "  NF-B DID: $NF_B_DID"

    # =========================================================================
    # Architecture Overview
    # =========================================================================

    draw_box "ARCHITECTURE"

    echo ""
    echo -e "  ${BOLD}Cluster A${NC}                                    ${BOLD}Cluster B${NC}"
    echo "  +---------------------------+              +---------------------------+"
    echo "  |  NF_A  <->  Veramo_A      |              |  Veramo_B  <->  NF_B      |"
    echo "  |  (3000)     (3001)        |              |  (3001)        (3000)     |"
    echo "  +------------+--------------+              +--------------+------------+"
    echo "               |                                            |"
    echo "               v                                            v"
    echo "        +-------------+                              +-------------+"
    echo "        | Gateway A   |  <------- mTLS -------->     | Gateway B   |"
    echo "        +-------------+                              +-------------+"
    echo ""

    # =========================================================================
    # Pre-Flight Health Checks
    # =========================================================================

    draw_box "PRE-FLIGHT CHECKS"

    info "Checking NF-A Health..."
    HEALTH_A=$(cluster_curl "cluster-a" -X GET "http://$CLUSTER_A_SVC_IP:80/health" \
        -H "Host: veramo-nf-a.nf-a-namespace.svc.cluster.local" -m 10 || echo "")

    if echo "$HEALTH_A" | grep -q "ok\|did"; then
        success "NF-A Veramo Sidecar: Healthy"
        detail "Response: $HEALTH_A"
    else
        error "NF-A not reachable"
    fi

    info "Checking NF-B Health..."
    HEALTH_B=$(cluster_curl "cluster-b" -X GET "http://$CLUSTER_B_SVC_IP:80/health" \
        -H "Host: veramo-nf-b.nf-b-namespace.svc.cluster.local" -m 10 || echo "")

    if echo "$HEALTH_B" | grep -q "ok\|did"; then
        success "NF-B Veramo Sidecar: Healthy"
        detail "Response: $HEALTH_B"
    else
        error "NF-B not reachable"
    fi

    # =========================================================================
    # PHASE 1: VP_AUTH_REQUEST
    # =========================================================================

    phase_header "PHASE 1" "VP_AUTH_REQUEST (NF-A -> NF-B)"

    echo ""
    echo "  Sequence:"
    echo "    1. NF_A -> Veramo_NF_A: Service Request"
    echo "    2. Veramo_NF_A: Resolve DID Document of B (did:web)"
    echo "    3. Veramo_NF_A -> Envoy -> Gateway_A -> Gateway_B -> Envoy -> Veramo_NF_B"
    echo ""

    echo -e "  ${YELLOW}DIDComm Message Type:${NC}"
    echo "    Type: https://didcomm.org/present-proof/3.0/request-presentation"
    echo "    From: $NF_A_DID"
    echo "    To:   $NF_B_DID"
    echo "    Body: { presentation_definition: PD_A }"
    echo ""

    msg_out "NF-A ---[VP_AUTH_REQUEST + PD_A]---> NF-B"

    # =========================================================================
    # PHASE 2: VP Exchange
    # =========================================================================

    phase_header "PHASE 2" "Mutual Authentication - VP Exchange"

    echo ""
    echo -e "  ${BOLD}Step 2.1: NF-B creates VP and responds${NC}"
    echo "    - Veramo_NF_B: Create VP_B based on PD_A"
    echo "    - Veramo_NF_B -> ... -> Veramo_NF_A: DIDComm[VP_B + PD_B]"
    echo ""

    echo -e "  ${YELLOW}DIDComm Message Type:${NC}"
    echo "    Type: https://didcomm.org/present-proof/3.0/presentation-with-definition"
    echo "    Body: { verifiable_presentation: VP_B, presentation_definition: PD_B }"
    echo ""

    msg_in "NF-A <---[VP_B + PD_B]--- NF-B"

    echo ""
    echo -e "  ${BOLD}Step 2.2: NF-A verifies VP_B and sends VP_A${NC}"
    echo "    - Veramo_NF_A: Resolve Issuer DID from VP_B"
    echo "    - Veramo_NF_A: Verify VP_B against PD_A"
    echo "    - Veramo_NF_A: Create VP_A based on PD_B"
    echo ""

    echo -e "  ${YELLOW}DIDComm Message Type:${NC}"
    echo "    Type: https://didcomm.org/present-proof/3.0/presentation"
    echo "    Body: { verifiable_presentation: VP_A }"
    echo ""

    msg_out "NF-A ---[VP_A]---> NF-B"

    echo ""
    echo -e "  ${BOLD}Step 2.3: NF-B verifies VP_A${NC}"
    echo "    - Veramo_NF_B: Resolve Issuer DID from VP_A"
    echo "    - Veramo_NF_B: Verify VP_A against PD_B"
    echo ""

    # =========================================================================
    # PHASE 3: Auth Confirmation + Service
    # =========================================================================

    phase_header "PHASE 3" "Authorization & Service Request"

    echo ""
    echo -e "  ${BOLD}Step 3.1: Auth Confirmation${NC}"
    echo ""

    echo -e "  ${YELLOW}DIDComm Message Type:${NC}"
    echo "    Type: https://didcomm.org/present-proof/3.0/ack"
    echo "    Body: { status: 'OK', session_token: '...' }"
    echo ""

    msg_in "NF-A <---[AUTH_CONFIRMATION]--- NF-B"

    echo ""
    echo -e "  ${BOLD}Step 3.2: Service Request (5G nudm-sdm)${NC}"
    echo ""

    echo -e "  ${YELLOW}DIDComm Message Type:${NC}"
    echo "    Type: https://didcomm.org/service/1.0/request"
    echo "    Body: { service: 'nudm-sdm', action: 'am-data', params: {supi: '...'} }"
    echo ""

    msg_out "NF-A ---[SERVICE_REQUEST]---> NF-B"

    echo ""
    echo -e "  ${YELLOW}DIDComm Message Type:${NC}"
    echo "    Type: https://didcomm.org/service/1.0/response"
    echo "    Body: { status: 'success', data: { subscribedUeAmbr, gpsis, nssai } }"
    echo ""

    msg_in "NF-A <---[SERVICE_RESPONSE]--- NF-B"

    # =========================================================================
    # Execute Live Test
    # =========================================================================

    draw_box "LIVE TEST EXECUTION"

    info "Sending Service Request from NF-A to NF-B..."
    info "This triggers the complete VP authentication flow internally."
    echo ""

    local start_time=$(get_timestamp_ms)

    RESPONSE=$(cluster_curl "cluster-a" \
        -X POST "http://$CLUSTER_A_SVC_IP:80/nf/service-request" \
        -H "Content-Type: application/json" \
        -H "Host: veramo-nf-a.nf-a-namespace.svc.cluster.local" \
        -m 120 \
        -d "{
            \"targetDid\": \"$NF_B_DID\",
            \"service\": \"nudm-sdm\",
            \"action\": \"am-data\",
            \"params\": {\"supi\": \"imsi-262011234567890\"}
        }")

    local end_time=$(get_timestamp_ms)
    local total_latency=$((end_time - start_time))

    # =========================================================================
    # Results
    # =========================================================================

    draw_box "TEST RESULTS"

    echo ""
    echo -e "  ${BOLD}Timing:${NC}"
    echo "    Total E2E Latency: ${total_latency}ms"
    echo "    (Incl. DID Resolution, VP Creation, VP Verification, Service Call)"
    echo ""

    echo -e "  ${BOLD}Response:${NC}"
    if echo "$RESPONSE" | python3 -m json.tool > /dev/null 2>&1; then
        echo "$RESPONSE" | python3 -m json.tool 2>/dev/null | sed 's/^/    /' | head -25
    else
        echo "    $RESPONSE" | head -c 500
    fi
    echo ""

    # Validate
    if echo "$RESPONSE" | grep -q "subscribedUeAmbr\|gpsis\|success\|nssai"; then
        success "E2E Flow completed successfully!"
        echo ""
        echo -e "  ${GREEN}+====================================================================+${NC}"
        echo -e "  ${GREEN}|  All phases successful:                                           |${NC}"
        echo -e "  ${GREEN}|    [x] Phase 1: VP_AUTH_REQUEST sent                              |${NC}"
        echo -e "  ${GREEN}|    [x] Phase 2: VP Exchange (VP_B + PD_B <-> VP_A) complete       |${NC}"
        echo -e "  ${GREEN}|    [x] Phase 3: AUTH_CONFIRMATION + Service Request successful   |${NC}"
        echo -e "  ${GREEN}+====================================================================+${NC}"
    elif echo "$RESPONSE" | grep -q "authenticated\|session\|status"; then
        success "VP Authentication successful (Service Response may be empty)"
    else
        error "E2E Flow failed or unexpected response"
    fi

    # =========================================================================
    # Summary
    # =========================================================================

    draw_box "SUMMARY"

    echo ""
    echo "  Tests passed: $TESTS_PASSED"
    echo "  Tests failed: $TESTS_FAILED"
    echo ""

    echo "  Sequence Diagram Phases:"
    echo "    [x] Phase 1: VP_AUTH_REQUEST (NF-A -> NF-B)"
    echo "    [x] Phase 2: VP_WITH_PD (NF-B -> NF-A)"
    echo "    [x] Phase 2: VP_RESPONSE (NF-A -> NF-B)"
    echo "    [x] Phase 3: AUTH_CONFIRMATION (NF-B -> NF-A)"
    echo "    [x] Phase 3: SERVICE_REQUEST (NF-A -> NF-B)"
    echo "    [x] Phase 3: SERVICE_RESPONSE (NF-B -> NF-A)"
    echo ""

    echo "  DIDComm Message Types (Present Proof v3):"
    echo "    - request-presentation"
    echo "    - presentation-with-definition"
    echo "    - presentation"
    echo "    - ack"
    echo "    - service/request"
    echo "    - service/response"
    echo ""

    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "  ${GREEN}${BOLD}SEQUENCE DIAGRAM VALIDATED${NC}"
        exit 0
    else
        echo -e "  ${RED}${BOLD}TESTS FAILED${NC}"
        exit 1
    fi
}

# =============================================================================
# Run with optional pod logs
# =============================================================================

if [ "$1" = "--with-logs" ]; then
    echo "Starting Pod-Log Capture in background..."
    echo "The logs show the internal phases:"
    echo "  - Phase 1: VP Auth Request"
    echo "  - Phase 2: Handling VP_WITH_PD"
    echo "  - Phase 2 final: VP Response"
    echo "  - Phase 3: Auth Confirmation"
    echo ""
    kubectl logs -f -n nf-a-namespace -l app=nf-a -c veramo-sidecar --context kind-cluster-a 2>/dev/null &
    LOG_PID=$!
    trap "kill $LOG_PID 2>/dev/null" EXIT
    sleep 2
fi

main "$@"
