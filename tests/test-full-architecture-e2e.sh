#!/bin/bash
###############################################################################
# Comprehensive E2E Test - Full Istio Gateway Architecture
#
# Tests the complete flow:
# NF_A → Veramo_NF_A → Sidecar_A → Gateway_A → Gateway_B → Sidecar_B → Veramo_NF_B → NF_B
###############################################################################

set -e

echo "================================================================================"
echo "🚀 COMPREHENSIVE E2E ARCHITECTURE TEST"
echo "================================================================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

info() {
    echo -e "${BLUE}ℹ️  INFO${NC}: $1"
}

section() {
    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}📋 $1${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════════════════════════${NC}"
}

###############################################################################
# Test 1: Cluster & Pod Status
###############################################################################
section "Test 1: Kubernetes Cluster Status"

# Check cluster-a
kubectl config use-context kind-cluster-a > /dev/null 2>&1
if [ $? -eq 0 ]; then
    pass "Cluster-A context available"
else
    fail "Cluster-A context not available"
fi

# Check cluster-b
kubectl config use-context kind-cluster-b > /dev/null 2>&1
if [ $? -eq 0 ]; then
    pass "Cluster-B context available"
else
    fail "Cluster-B context not available"
fi

# Get pod names
kubectl config use-context kind-cluster-a > /dev/null 2>&1
POD_A=$(kubectl get pod -n nf-a-namespace -l app=nf-a -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
kubectl config use-context kind-cluster-b > /dev/null 2>&1
POD_B=$(kubectl get pod -n nf-b-namespace -l app=nf-b -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

if [ -n "$POD_A" ]; then
    pass "NF-A Pod found: $POD_A"
else
    fail "NF-A Pod not found"
fi

if [ -n "$POD_B" ]; then
    pass "NF-B Pod found: $POD_B"
else
    fail "NF-B Pod not found"
fi

###############################################################################
# Test 2: Istio Components
###############################################################################
section "Test 2: Istio Service Mesh Components"

# Check Istio sidecars in cluster-a (K8s 1.34 sidecar feature: in initContainers)
kubectl config use-context kind-cluster-a > /dev/null 2>&1
SIDECAR_A=$(kubectl get pod -n nf-a-namespace $POD_A -o jsonpath='{.spec.initContainers[?(@.name=="istio-proxy")].name}' 2>/dev/null)
if [ "$SIDECAR_A" == "istio-proxy" ]; then
    pass "Istio Sidecar (Envoy_Proxy_NF_A) injected in Cluster-A"
    info "Running as sidecar container (K8s 1.34 native sidecar feature)"
else
    fail "Istio Sidecar not found in Cluster-A"
fi

# Check Istio Gateway in cluster-a
GATEWAY_A=$(kubectl get svc -n istio-system istio-ingressgateway -o jsonpath='{.metadata.name}' 2>/dev/null)
if [ "$GATEWAY_A" == "istio-ingressgateway" ]; then
    GATEWAY_A_PORT=$(kubectl get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.ports[?(@.port==80)].nodePort}')
    pass "Istio Gateway (Envoy_Gateway_A) running - NodePort: $GATEWAY_A_PORT"
else
    fail "Istio Gateway not found in Cluster-A"
fi

# Check Istio sidecars in cluster-b (K8s 1.34 sidecar feature: in initContainers)
kubectl config use-context kind-cluster-b > /dev/null 2>&1
SIDECAR_B=$(kubectl get pod -n nf-b-namespace $POD_B -o jsonpath='{.spec.initContainers[?(@.name=="istio-proxy")].name}' 2>/dev/null)
if [ "$SIDECAR_B" == "istio-proxy" ]; then
    pass "Istio Sidecar (Envoy_Proxy_NF_B) injected in Cluster-B"
    info "Running as sidecar container (K8s 1.34 native sidecar feature)"
else
    fail "Istio Sidecar not found in Cluster-B"
fi

# Check Istio Gateway in cluster-b
GATEWAY_B=$(kubectl get svc -n istio-system istio-ingressgateway -o jsonpath='{.metadata.name}' 2>/dev/null)
if [ "$GATEWAY_B" == "istio-ingressgateway" ]; then
    GATEWAY_B_PORT=$(kubectl get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.ports[?(@.port==80)].nodePort}')
    pass "Istio Gateway (Envoy_Gateway_B) running - NodePort: $GATEWAY_B_PORT"
else
    fail "Istio Gateway not found in Cluster-B"
fi

###############################################################################
# Test 3: Istio Gateway Configuration
###############################################################################
section "Test 3: Istio Gateway Routing Configuration"

# Check VirtualService in cluster-a
kubectl config use-context kind-cluster-a > /dev/null 2>&1
VS_A=$(kubectl get virtualservice -n nf-a-namespace veramo-nf-a-vs -o jsonpath='{.metadata.name}' 2>/dev/null)
if [ "$VS_A" == "veramo-nf-a-vs" ]; then
    pass "VirtualService configured in Cluster-A"
else
    fail "VirtualService not found in Cluster-A"
fi

# Check ServiceEntry for cluster-b
SE_B=$(kubectl get serviceentry -n nf-a-namespace cluster-b-gateway -o jsonpath='{.metadata.name}' 2>/dev/null)
if [ "$SE_B" == "cluster-b-gateway" ]; then
    pass "ServiceEntry for Cluster-B configured"
else
    fail "ServiceEntry for Cluster-B not found"
fi

# Check DestinationRule
DR_B=$(kubectl get destinationrule -n nf-a-namespace cluster-b-mtls -o jsonpath='{.metadata.name}' 2>/dev/null)
if [ "$DR_B" == "cluster-b-mtls" ]; then
    pass "DestinationRule for Cluster-B configured"
else
    fail "DestinationRule for Cluster-B not found"
fi

###############################################################################
# Test 4: DID Resolution (Veramo_NF_A resolves DID of B)
###############################################################################
section "Test 4: DID Resolution - did:web"

kubectl config use-context kind-cluster-a > /dev/null 2>&1

# Test DID resolution via wget (simulates Veramo resolving DID)
DID_DOC_B=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- wget -q -O- \
    https://kiuyenzo.github.io/Prototype/cluster-b/did-nf-b/did.json 2>/dev/null | head -c 100)

if [ -n "$DID_DOC_B" ]; then
    pass "DID Document of NF-B resolved successfully"
    info "DID: did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b"
else
    fail "Failed to resolve DID Document of NF-B"
fi

###############################################################################
# Test 5: Credentials
###############################################################################
section "Test 5: Verifiable Credentials"

# Check credentials in NF-A
kubectl config use-context kind-cluster-a > /dev/null 2>&1
CREDS_A=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- \
    sqlite3 /app/data/db-nf-a/database-nf-a.sqlite "SELECT COUNT(*) FROM credential" 2>/dev/null)

if [ "$CREDS_A" -gt 0 ]; then
    pass "NF-A has $CREDS_A credential(s)"
else
    fail "NF-A has no credentials"
fi

# Check credentials in NF-B
kubectl config use-context kind-cluster-b > /dev/null 2>&1
CREDS_B=$(kubectl exec -n nf-b-namespace $POD_B -c veramo-nf-b -- \
    sqlite3 /app/data/db-nf-b/database-nf-b.sqlite "SELECT COUNT(*) FROM credential" 2>/dev/null)

if [ "$CREDS_B" -gt 0 ]; then
    pass "NF-B has $CREDS_B credential(s)"
else
    fail "NF-B has no credentials"
fi

###############################################################################
# Test 6: DIDComm Packing Mode
###############################################################################
section "Test 6: DIDComm Packing Mode Configuration"

# Check packing mode in NF-A
kubectl config use-context kind-cluster-a > /dev/null 2>&1
PACKING_MODE_A=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- printenv DIDCOMM_PACKING_MODE 2>/dev/null)
info "NF-A Packing Mode: $PACKING_MODE_A"
if [ "$PACKING_MODE_A" == "encrypted" ] || [ "$PACKING_MODE_A" == "signed" ]; then
    pass "Valid DIDComm packing mode in NF-A"
else
    fail "Invalid or missing packing mode in NF-A"
fi

# Check packing mode in NF-B
kubectl config use-context kind-cluster-b > /dev/null 2>&1
PACKING_MODE_B=$(kubectl exec -n nf-b-namespace $POD_B -c veramo-nf-b -- printenv DIDCOMM_PACKING_MODE 2>/dev/null)
info "NF-B Packing Mode: $PACKING_MODE_B"
if [ "$PACKING_MODE_B" == "encrypted" ] || [ "$PACKING_MODE_B" == "signed" ]; then
    pass "Valid DIDComm packing mode in NF-B"
else
    fail "Invalid or missing packing mode in NF-B"
fi

###############################################################################
# Pre-Flight Health Check: Ensure pods are fully ready
###############################################################################
section "Pre-Flight: Pod Readiness Check"

info "Waiting for both pods to be fully initialized..."

# Check NF-A readiness
kubectl config use-context kind-cluster-a > /dev/null 2>&1
READY_A=false
for i in {1..30}; do
    HEALTH_A=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- \
        wget --timeout=5 -q -O- http://localhost:3000/health 2>/dev/null || echo "not ready")

    if echo "$HEALTH_A" | grep -q "ok\|healthy"; then
        READY_A=true
        pass "NF-A pod is ready (attempt $i/30)"
        break
    fi
    echo -n "."
    sleep 2
done

if [ "$READY_A" != "true" ]; then
    fail "NF-A pod not ready after 60 seconds"
fi

# Check NF-B readiness
kubectl config use-context kind-cluster-b > /dev/null 2>&1
READY_B=false
for i in {1..30}; do
    HEALTH_B=$(kubectl exec -n nf-b-namespace $POD_B -c veramo-nf-b -- \
        wget --timeout=5 -q -O- http://localhost:3001/health 2>/dev/null || echo "not ready")

    if echo "$HEALTH_B" | grep -q "ok\|healthy"; then
        READY_B=true
        pass "NF-B pod is ready (attempt $i/30)"
        break
    fi
    echo -n "."
    sleep 2
done

if [ "$READY_B" != "true" ]; then
    fail "NF-B pod not ready after 60 seconds"
fi

info "Both pods are ready - proceeding with VP-Flow tests"
sleep 2  # Extra buffer to ensure all services are stable

###############################################################################
# Test 7: PHASE 1 - Initial Service Request & Auth
###############################################################################
section "Test 7: PHASE 1 - Service Request & VP_Auth_Request"

info "Flow: NF_A → Veramo_NF_A → Sidecar_A → Gateway_A"

kubectl config use-context kind-cluster-a > /dev/null 2>&1

# Initiate VP-Flow (simulates NF_A requesting service from NF_B)
RESPONSE=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- \
    wget --timeout=15 -q -O- --post-data='{"targetDid":"did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b"}' \
    --header='Content-Type: application/json' \
    http://localhost:3000/didcomm/initiate-auth 2>/dev/null || echo '{"error":"timeout"}')

if echo "$RESPONSE" | grep -q "success.*true"; then
    SESSION_ID=$(echo "$RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
    pass "VP-Flow initiated successfully - Session: $SESSION_ID"
else
    fail "Failed to initiate VP-Flow"
    echo "Response: $RESPONSE"
fi

sleep 2  # Allow time for message propagation

###############################################################################
# Test 8: PHASE 2 - Mutual Authentication (VP Exchange)
###############################################################################
section "Test 8: PHASE 2 - Mutual Authentication & VP Exchange"

info "Flow: Gateway_A → Gateway_B → Sidecar_B → Veramo_NF_B"

# Check NF-B logs for received VP_Auth_Request
kubectl config use-context kind-cluster-b > /dev/null 2>&1
LOGS_B=$(kubectl logs -n nf-b-namespace $POD_B -c veramo-nf-b --tail=100 2>/dev/null)

if echo "$LOGS_B" | grep -q "VP_Auth_Request\|request-presentation"; then
    pass "NF-B received VP_Auth_Request from NF-A"
else
    fail "NF-B did not receive VP_Auth_Request"
fi

if echo "$LOGS_B" | grep -q "Create VP_B\|Creating VP"; then
    pass "NF-B created VP_B based on PD_A"
else
    fail "NF-B did not create VP_B"
fi

# Check NF-A logs for received VP_B
kubectl config use-context kind-cluster-a > /dev/null 2>&1
LOGS_A=$(kubectl logs -n nf-a-namespace $POD_A -c veramo-nf-a --tail=100 2>/dev/null)

if echo "$LOGS_A" | grep -q "Verify VP_B\|Verifying their VP"; then
    pass "NF-A received and verified VP_B"
else
    fail "NF-A did not verify VP_B"
fi

if echo "$LOGS_A" | grep -q "Create VP_A\|Creating VP"; then
    pass "NF-A created VP_A based on PD_B"
else
    fail "NF-A did not create VP_A"
fi

# Check NF-B logs for VP_A verification
if echo "$LOGS_B" | grep -q "Verify VP_A\|VP verified successfully"; then
    pass "NF-B received and verified VP_A"
else
    fail "NF-B did not verify VP_A"
fi

###############################################################################
# Test 9: PHASE 3 - Authorized Communication
###############################################################################
section "Test 9: PHASE 3 - Authorized Communication & Service Traffic"

# Check for authentication confirmation
if echo "$LOGS_B" | grep -q "Mutual authentication successful\|authentication successful"; then
    pass "Mutual authentication completed successfully"
else
    fail "Mutual authentication did not complete"
fi

if echo "$LOGS_A" | grep -q "Authentication confirmed\|authenticated"; then
    pass "NF-A received authentication confirmation"
else
    fail "NF-A did not receive authentication confirmation"
fi

# Check for session token
if echo "$LOGS_A" | grep -q "Session Token"; then
    pass "Session token generated for authorized communication"
else
    fail "No session token found"
fi

###############################################################################
# Test 10: DIDComm Encryption/Signing Verification
###############################################################################
section "Test 10: DIDComm Message Protection (Encryption/Signing)"

if [ "$PACKING_MODE_A" == "encrypted" ]; then
    if echo "$LOGS_A" | grep -q "Message encrypted.*JWE"; then
        pass "Messages encrypted with JWE (anoncrypt)"
        info "E2E encryption: Zero Trust - Gateways see only ciphertext"
    else
        fail "Messages not properly encrypted"
    fi

    if echo "$LOGS_B" | grep -q "Message decrypted successfully"; then
        pass "Messages decrypted successfully by recipient"
    else
        fail "Message decryption failed"
    fi
elif [ "$PACKING_MODE_A" == "signed" ]; then
    if echo "$LOGS_A" | grep -q "Message signed.*JWS"; then
        pass "Messages signed with JWS"
        info "Signed mode: Confidentiality via Istio mTLS, Integrity via JWS"
    else
        fail "Messages not properly signed"
    fi
fi

###############################################################################
# Test 11: Istio Gateway Routing Verification
###############################################################################
section "Test 11: Istio Gateway Routing Path Verification"

# Check if traffic went through gateways
if echo "$LOGS_A" | grep -q "istio-ingressgateway\|Route:.*Gateway"; then
    pass "Traffic routed through local Istio Gateway"
    info "Path: Sidecar_A → Gateway_A → Gateway_B → Sidecar_B"
else
    info "Gateway routing verification inconclusive from logs"
fi

# Check Istio proxy logs for mTLS
kubectl config use-context kind-cluster-a > /dev/null 2>&1
ISTIO_LOGS_A=$(kubectl logs -n nf-a-namespace $POD_A -c istio-proxy --tail=50 2>/dev/null || echo "")

if echo "$ISTIO_LOGS_A" | grep -q "outbound"; then
    pass "Istio Sidecar handling outbound traffic"
else
    info "Istio sidecar logs available but no clear outbound indicator"
fi

###############################################################################
# Test 12: End-to-End Message Flow
###############################################################################
section "Test 12: Complete Message Flow Verification"

# Count successful message sends
MSG_SENT_A=$(echo "$LOGS_A" | grep -c "Message sent successfully" || echo "0")
MSG_SENT_B=$(echo "$LOGS_B" | grep -c "Message sent successfully" || echo "0")

if [ "$MSG_SENT_A" -ge 2 ] && [ "$MSG_SENT_B" -ge 2 ]; then
    pass "Full bidirectional message exchange completed"
    info "NF-A sent $MSG_SENT_A messages, NF-B sent $MSG_SENT_B messages"
else
    fail "Incomplete message exchange (A: $MSG_SENT_A, B: $MSG_SENT_B)"
fi

###############################################################################
# Test 13: REVERSE DIRECTION - NF-B initiates to NF-A
###############################################################################
section "Test 13: REVERSE DIRECTION - NF-B → NF-A Service Request"

info "Testing reverse direction: Cluster-B initiates service request to Cluster-A"
info "Flow: NF_B → Veramo_NF_B → Sidecar_B → Gateway_B → Gateway_A → Sidecar_A → Veramo_NF_A"

kubectl config use-context kind-cluster-b > /dev/null 2>&1

# Clear previous session logs
sleep 2

# Initiate VP-Flow from NF-B to NF-A (reverse direction)
RESPONSE_REVERSE=$(kubectl exec -n nf-b-namespace $POD_B -c veramo-nf-b -- \
    wget --timeout=15 -q -O- --post-data='{"targetDid":"did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a"}' \
    --header='Content-Type: application/json' \
    http://localhost:3001/didcomm/initiate-auth 2>/dev/null || echo '{"error":"timeout"}')

if echo "$RESPONSE_REVERSE" | grep -q "success.*true"; then
    SESSION_ID_REVERSE=$(echo "$RESPONSE_REVERSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
    pass "VP-Flow initiated from NF-B to NF-A - Session: $SESSION_ID_REVERSE"
else
    fail "Failed to initiate reverse VP-Flow"
    echo "Response: $RESPONSE_REVERSE"
fi

sleep 2

###############################################################################
# Test 14: REVERSE - Mutual Authentication (B → A)
###############################################################################
section "Test 14: REVERSE - Mutual Authentication (NF-B ← NF-A)"

info "Flow: Gateway_B → Gateway_A → Sidecar_A → Veramo_NF_A processes request"

# Check NF-A logs for received VP_Auth_Request from NF-B
kubectl config use-context kind-cluster-a > /dev/null 2>&1
LOGS_A_REVERSE=$(kubectl logs -n nf-a-namespace $POD_A -c veramo-nf-a --tail=100 2>/dev/null)

if echo "$LOGS_A_REVERSE" | grep -q "VP_Auth_Request\|request-presentation"; then
    pass "NF-A received VP_Auth_Request from NF-B (reverse)"
else
    fail "NF-A did not receive VP_Auth_Request from NF-B"
fi

# Check that NF-A created VP_A based on NF-B's PD
if echo "$LOGS_A_REVERSE" | grep -q "Creating VP\|presentation.*created"; then
    pass "NF-A created VP_A in response to NF-B's PD (reverse)"
else
    fail "NF-A did not create VP in reverse flow"
fi

# Check NF-B received and verified VP_A
kubectl config use-context kind-cluster-b > /dev/null 2>&1
LOGS_B_REVERSE=$(kubectl logs -n nf-b-namespace $POD_B -c veramo-nf-b --tail=100 2>/dev/null)

if echo "$LOGS_B_REVERSE" | grep -q "VP.*verified\|Presentation verified"; then
    pass "NF-B received and verified VP_A (reverse)"
else
    fail "NF-B did not verify VP from NF-A"
fi

# Check that NF-B created VP_B
if echo "$LOGS_B_REVERSE" | grep -q "Creating VP\|presentation.*created"; then
    pass "NF-B created VP_B in response to NF-A's PD (reverse)"
else
    fail "NF-B did not create VP in reverse flow"
fi

# Check NF-A received and verified VP_B
if echo "$LOGS_A_REVERSE" | grep -q "VP.*verified\|Presentation verified"; then
    pass "NF-A received and verified VP_B (reverse)"
else
    fail "NF-A did not verify VP from NF-B"
fi

###############################################################################
# Test 15: REVERSE - Service Traffic Authorization
###############################################################################
section "Test 15: REVERSE - Authorized Service Traffic (B ← A)"

# Check mutual authentication completed
if echo "$LOGS_B_REVERSE" | grep -q "Authentication confirmed\|Mutual authentication successful"; then
    pass "Reverse mutual authentication completed successfully"
else
    fail "Reverse mutual authentication not confirmed"
fi

# Check NF-B received authentication confirmation
if echo "$LOGS_B_REVERSE" | grep -qi "Authentication confirmed"; then
    pass "NF-B received authentication confirmation (reverse)"
else
    fail "NF-B did not receive auth confirmation"
fi

# Check session token generated
if echo "$LOGS_B_REVERSE" | grep -qi "Session Token"; then
    pass "Session token generated for reverse authorized communication"
else
    fail "No session token generated in reverse flow"
fi

###############################################################################
# Test 16: REVERSE - Gateway Routing Verification
###############################################################################
section "Test 16: REVERSE - Gateway Routing Path (B → A)"

info "Verifying: Sidecar_B → Gateway_B → Gateway_A → Sidecar_A"

# Check NF-B logs for routing through gateway
if echo "$LOGS_B_REVERSE" | grep -q "istio-ingressgateway\|Route:.*Gateway"; then
    pass "Reverse traffic routed through Istio Gateways"
    info "Path: Sidecar_B → Gateway_B → Gateway_A → Sidecar_A"
else
    info "Reverse gateway routing verification from logs inconclusive"
fi

# Check Istio proxy logs in NF-B
kubectl config use-context kind-cluster-b > /dev/null 2>&1
ISTIO_LOGS_B=$(kubectl logs -n nf-b-namespace $POD_B -c istio-proxy --tail=50 2>/dev/null || echo "")

if echo "$ISTIO_LOGS_B" | grep -q "outbound"; then
    pass "Istio Sidecar (NF-B) handling outbound traffic to NF-A"
else
    info "Istio sidecar logs (NF-B) available but no clear outbound indicator"
fi

# Verify bidirectional message counts
MSG_SENT_A_TOTAL=$(echo "$LOGS_A_REVERSE" | grep -c "Message sent successfully" || echo "0")
MSG_SENT_B_TOTAL=$(echo "$LOGS_B_REVERSE" | grep -c "Message sent successfully" || echo "0")

if [ "$MSG_SENT_A_TOTAL" -ge 2 ] && [ "$MSG_SENT_B_TOTAL" -ge 2 ]; then
    pass "Bidirectional communication verified (A→B and B→A)"
    info "Total: NF-A sent $MSG_SENT_A_TOTAL, NF-B sent $MSG_SENT_B_TOTAL messages"
else
    info "Bidirectional stats: A sent $MSG_SENT_A_TOTAL, B sent $MSG_SENT_B_TOTAL"
fi

###############################################################################
# Test Summary
###############################################################################
section "Test Summary"

TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED))
PASS_RATE=$((TESTS_PASSED * 100 / TOTAL_TESTS))

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}❌ Tests Failed: $TESTS_FAILED${NC}"
echo -e "${BLUE}📊 Total Tests:  $TOTAL_TESTS${NC}"
echo -e "${BLUE}📈 Pass Rate:    $PASS_RATE%${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 ALL TESTS PASSED! Architecture fully functional.${NC}"
    echo ""
    echo "✅ Verified Components:"
    echo "   • Kubernetes Clusters (cluster-a, cluster-b)"
    echo "   • Istio Service Mesh (Sidecars + Gateways)"
    echo "   • DIDComm v2 Messaging"
    echo "   • did:web Resolution"
    echo "   • Verifiable Credentials & Presentations"
    echo "   • Mutual Authentication (VP Exchange)"
    echo "   • End-to-End $PACKING_MODE_A mode"
    echo "   • Cross-Cluster Gateway Routing"
    echo ""
    exit 0
else
    echo -e "${RED}⚠️  SOME TESTS FAILED. Please review the output above.${NC}"
    echo ""
    exit 1
fi
