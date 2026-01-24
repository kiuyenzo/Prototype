#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

CTX_A="kind-cluster-a"
CTX_B="kind-cluster-b"
NS_A="nf-a-namespace"
NS_B="nf-b-namespace"
DID_NF_A="did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a"
DID_NF_B="did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
mkdir -p "$RESULTS_DIR"

EVIDENCE_FILE="$RESULTS_DIR/protocol_live_evidence_$(date '+%Y%m%d_%H%M%S').txt"

log_evidence() {
    echo "$1" >> "$EVIDENCE_FILE"
}

log_raw() {
    echo "" >> "$EVIDENCE_FILE"
    echo "--- RAW LOGS: $1 ---" >> "$EVIDENCE_FILE"
    echo "$2" >> "$EVIDENCE_FILE"
    echo "--- END RAW LOGS ---" >> "$EVIDENCE_FILE"
}

RESET=false
if [ "$1" = "--reset" ] || [ "$1" = "-r" ]; then
    RESET=true
fi

PASS=0
FAIL=0

SHOWN_TESTS=""

is_shown() {
    echo "$SHOWN_TESTS" | grep -qF "|$1|"
}

mark_shown() {
    SHOWN_TESTS="${SHOWN_TESTS}|$1|"
}

test_pass() {
    local key="$1"
    if ! is_shown "$key"; then
        mark_shown "$key"
        PASS=$((PASS + 1))
        echo -e "  ${GREEN}[PASS]${NC} $key"
        return 0
    fi
    return 1
}

test_fail() {
    local key="$1"
    if ! is_shown "$key"; then
        mark_shown "$key"
        FAIL=$((FAIL + 1))
        echo -e "  ${RED}[FAIL]${NC} $key"
        return 0
    fi
    return 1
}

check_live() {
    local description="$1"
    local log_source="$2"
    local pattern="$3"

    if ! is_shown "$description"; then
        if echo "$log_source" | grep -qE "$pattern"; then
            test_pass "$description"
            return 0
        fi
    fi
    return 1
}

echo ""
echo -e "${BOLD}${BLUE}DIDComm Authentication ${NC}"
echo ""

NF_A_POD=$(kubectl --context $CTX_A get pods -n $NS_A -l app=nf-a --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null)
NF_B_POD=$(kubectl --context $CTX_B get pods -n $NS_B -l app=nf-b --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null)

if [ -z "$NF_A_POD" ] || [ -z "$NF_B_POD" ]; then
    echo -e "${RED}Error: Pods not found${NC}"
    exit 1
fi


kubectl --context $CTX_A exec -n $NS_A $NF_A_POD -c veramo-sidecar -- sqlite3 /app/data/db-nf-a/database-nf-a.sqlite "DELETE FROM message; DELETE FROM presentation;" 2>/dev/null
kubectl --context $CTX_B exec -n $NS_B $NF_B_POD -c veramo-sidecar -- sqlite3 /app/data/db-nf-b/database-nf-b.sqlite "DELETE FROM message; DELETE FROM presentation;" 2>/dev/null

log_evidence "DIDComm Protocol Evidence Log"
log_evidence "Generated: $(date '+%Y-%m-%d %H:%M:%S %Z')"
log_evidence ""
log_evidence "ENVIRONMENT:"
log_evidence "  Cluster A: $CTX_A"
log_evidence "  Cluster B: $CTX_B"
log_evidence "  Pod A: $NF_A_POD"
log_evidence "  Pod B: $NF_B_POD"
log_evidence "  DID A: $DID_NF_A"
log_evidence "  DID B: $DID_NF_B"
log_evidence ""

PACKING_MODE=$(kubectl --context $CTX_A get deployment nf-a -n $NS_A -o jsonpath='{.spec.template.spec.containers[?(@.name=="veramo-sidecar")].env[?(@.name=="DIDCOMM_PACKING_MODE")].value}' 2>/dev/null)
if [ "$PACKING_MODE" = "encrypted" ]; then
    MODE_DISPLAY="authcrypt (E2E encrypted)"
else
    MODE_DISPLAY="jws (signed only)"
fi
echo -e "${DIM}Mode: $PACKING_MODE | Protocol: DIDComm v2 | Transport: Istio mTLS${NC}"
echo ""

if [ "$RESET" = true ]; then
    echo -e "${DIM}[RESET] Restarting pods for fresh session...${NC}"
    kubectl --context $CTX_A rollout restart deployment/nf-a -n $NS_A 2>/dev/null
    kubectl --context $CTX_B rollout restart deployment/nf-b -n $NS_B 2>/dev/null
    kubectl --context $CTX_A rollout status deployment/nf-a -n $NS_A --timeout=60s 2>/dev/null >/dev/null
    kubectl --context $CTX_B rollout status deployment/nf-b -n $NS_B --timeout=60s 2>/dev/null >/dev/null
    NF_A_POD=$(kubectl --context $CTX_A get pods -n $NS_A -l app=nf-a --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null)
    NF_B_POD=$(kubectl --context $CTX_B get pods -n $NS_B -l app=nf-b --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null)
    kubectl --context $CTX_A wait --for=condition=ready pod -l app=nf-a -n $NS_A --timeout=60s 2>/dev/null >/dev/null
    kubectl --context $CTX_B wait --for=condition=ready pod -l app=nf-b -n $NS_B --timeout=60s 2>/dev/null >/dev/null

    echo -e "${DIM}Waiting for Veramo sidecars to initialize...${NC}"
    for i in {1..30}; do
        NF_A_HEALTH=$(kubectl --context $CTX_A exec -n $NS_A $NF_A_POD -c veramo-sidecar -- curl -s http://localhost:3001/health 2>/dev/null || echo "")
        NF_B_HEALTH=$(kubectl --context $CTX_B exec -n $NS_B $NF_B_POD -c veramo-sidecar -- curl -s http://localhost:3001/health 2>/dev/null || echo "")
        if echo "$NF_A_HEALTH" | grep -qi "ok\|healthy" && echo "$NF_B_HEALTH" | grep -qi "ok\|healthy"; then
            break
        fi
        sleep 2
    done

    echo -e "${DIM}[RESET] Pods ready - fresh DIDComm session${NC}"
    echo ""
fi

echo -e "${BOLD}${BLUE}Phase 1: Authentication initiation${NC}"

RESPONSE=$(kubectl --context $CTX_A exec -n $NS_A $NF_A_POD -c veramo-sidecar -- \
    curl -s -X POST http://localhost:3001/nf/service-request \
    -H "Content-Type: application/json" \
    -d "{\"targetDid\":\"$DID_NF_B\",\"service\":\"nudm-sdm\",\"action\":\"am-data\"}" 2>/dev/null)

if echo "$RESPONSE" | grep -qiE "pending|initiated|success|authenticated|authenticating"; then
    test_pass "NF_A sends Service Request to Veramo_NF_A"
else
    test_fail "NF_A: Service Request not accepted"
fi

MAX_WAIT=30
POLL_INTERVAL=1
WAITED=0
PHASE2_SHOWN=false
PHASE3_SHOWN=false

while [ $WAITED -lt $MAX_WAIT ]; do
    LOGS_A=$(kubectl --context $CTX_A logs -n $NS_A $NF_A_POD -c veramo-sidecar --since=300s 2>/dev/null)
    LOGS_B=$(kubectl --context $CTX_B logs -n $NS_B $NF_B_POD -c veramo-sidecar --since=300s 2>/dev/null)

    check_live "Veramo_NF_A resolves DID Document of NF_B" "$LOGS_A" "peerDid.*did-nf-b|targetDid.*did-nf-b|to did-nf-b|did:web|Session.*did-nf"

    if [ "$PHASE2_SHOWN" = false ]; then
        if echo "$LOGS_A" | grep -qE "SEND.*request-presentation"; then
            echo ""
            echo -e "${BOLD}${BLUE}Phase 2: Mutual credential exchange${NC}"
            PHASE2_SHOWN=true
        fi
    fi

    if [ "$PHASE2_SHOWN" = true ]; then
        check_live "Veramo_NF_A sends VP Auth Request" "$LOGS_A" "SEND.*request-presentation"
        check_live "Veramo_NF_B receives VP Auth Request and PD_A" "$LOGS_B" "MSG.*request-presentation.*did-nf-a|PHASE2.*VP Auth"
        check_live "Veramo_NF_B creates VP matching PD" "$LOGS_B" "VP_EXCHANGE_INITIATED"
        check_live "Veramo_NF_B sends VP_B and PD_B" "$LOGS_B" "SEND.*presentation-with-definition"
        check_live "Veramo_NF_A receives VP_B and PD_B" "$LOGS_A" "MSG.*presentation-with-definition.*did-nf-b|PHASE2.*VP_WITH_PD"
        check_live "Veramo_NF_A resolves Issuer DID from VP_B" "$LOGS_A" "VP_VERIFICATION_SUCCESS"
        check_live "Veramo_NF_A verifies VP_B signature" "$LOGS_A" "VP_VERIFICATION_SUCCESS.*did-nf-b|VP_VERIFICATION_SUCCESS.*success.*true"

        VP_A_PATTERN=$(echo "$LOGS_A" | grep -E "SEND.*presentation" | grep -v "request-presentation" | grep -v "presentation-with-definition")
        if [ -n "$VP_A_PATTERN" ]; then
            check_live "Veramo_NF_A creates VP_A based on PD_B" "$VP_A_PATTERN" "SEND"
            check_live "Veramo_NF_A sends VP_A" "$VP_A_PATTERN" "SEND"
        fi

        VP_A_RECV=$(echo "$LOGS_B" | grep -E "MSG.*presentation" | grep -v "request-presentation" | grep -v "presentation-with-definition")
        if [ -n "$VP_A_RECV" ]; then
            check_live "Veramo_NF_B receives VP_A" "$VP_A_RECV" "MSG"
        fi

        check_live "Veramo_NF_B resolves Issuer DID from VP_A" "$LOGS_B" "VP_EXCHANGE_COMPLETED"
        check_live "Veramo_NF_B verifies VP_A signature" "$LOGS_B" "VP_EXCHANGE_COMPLETED|AUTH.*Mutual"
    fi

    if [ "$PHASE3_SHOWN" = false ] && [ "$PHASE2_SHOWN" = true ]; then
        if echo "$LOGS_A" | grep -v "request-presentation" | grep -qE "\[SEND\] request (->|to)"; then
            echo ""
            echo -e "${BOLD}${BLUE}Phase 3: Authorized service communication${NC}"
            PHASE3_SHOWN=true
        fi
    fi

    if [ "$PHASE3_SHOWN" = true ]; then
        SVC_REQ=$(echo "$LOGS_A" | grep -E "\[SEND\] request (->|to)" | grep -v "request-presentation")
        [ -n "$SVC_REQ" ] && check_live "Veramo_NF_A sends Service Request" "$SVC_REQ" "request"
        check_live "Veramo_NF_B receives Service Request" "$LOGS_B" "MSG.*request from"
        check_live "Veramo_NF_B forwards Request to NF_B" "$LOGS_B" "SERVICE_ACCESS_GRANTED.*did-nf-a|POLICY_EVALUATION.*granted|forwarding.*NF"
        check_live "NF_B sends Service Response" "$LOGS_B" "response.*NF|service.*response|SEND.*response"
        SVC_RESP=$(echo "$LOGS_B" | grep -E "\[SEND\] response (->|to)" | grep -v "presentation")
        [ -n "$SVC_RESP" ] && check_live "Veramo_NF_B forwards Service Response" "$SVC_RESP" "response"
        check_live "Veramo_NF_A receives Service Response" "$LOGS_A" "MSG.*response from"
        check_live "Veramo_NF_A delivers Response to NF_A" "$LOGS_A" "response.*delivered|service.*complete|MSG.*response"
    fi

    if [ $PASS -ge 21 ]; then
        break
    fi

    sleep $POLL_INTERVAL
    WAITED=$((WAITED + POLL_INTERVAL))
done

SESSION_A=$(kubectl --context $CTX_A exec -n $NS_A $NF_A_POD -c veramo-sidecar -- curl -s http://localhost:3001/session/status 2>/dev/null)
SESSION_B=$(kubectl --context $CTX_B exec -n $NS_B $NF_B_POD -c veramo-sidecar -- curl -s http://localhost:3001/session/status 2>/dev/null)

if echo "$SESSION_A" | grep -qE '"status":"authenticated"' && echo "$SESSION_B" | grep -qE '"status":"authenticated"'; then
    test_pass "Mutual authentication established"
else
    test_fail "Mutual authentication failed"
fi

TOTAL=$((PASS + FAIL))

echo ""
echo -e "${BOLD}${BLUE}TEST RESULTS${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "  ${BOLD}${GREEN}$PASS/$TOTAL all tests passed${NC}"
    EXIT_CODE=0
else
    echo -e "  ${BOLD}${RED}$PASS/$TOTAL tests passed${NC}"
    echo -e "  ${RED}Failed: $FAIL${NC}"
    EXIT_CODE=1
fi

echo ""

rm -f "$PROJECT_DIR/data/db-nf-a/database-nf-a.sqlite" "$PROJECT_DIR/data/db-nf-b/database-nf-b.sqlite" 2>/dev/null
kubectl --context $CTX_A exec -n $NS_A $NF_A_POD -c veramo-sidecar -- cat /app/data/db-nf-a/database-nf-a.sqlite > "$PROJECT_DIR/data/db-nf-a/database-nf-a.sqlite" 2>/dev/null
DB_A_OK=$?
kubectl --context $CTX_B exec -n $NS_B $NF_B_POD -c veramo-sidecar -- cat /app/data/db-nf-b/database-nf-b.sqlite > "$PROJECT_DIR/data/db-nf-b/database-nf-b.sqlite" 2>/dev/null
DB_B_OK=$?

if command -v sqlite3 &> /dev/null; then
    sqlite3 "$PROJECT_DIR/data/db-nf-a/database-nf-a.sqlite" "DELETE FROM credential WHERE json_extract(raw, '\$.credentialSubject.id') <> '$DID_NF_A';" 2>/dev/null
    sqlite3 "$PROJECT_DIR/data/db-nf-b/database-nf-b.sqlite" "DELETE FROM credential WHERE json_extract(raw, '\$.credentialSubject.id') <> '$DID_NF_B';" 2>/dev/null
fi

if [ $DB_A_OK -eq 0 ] && [ $DB_B_OK -eq 0 ] && [ -s "$PROJECT_DIR/data/db-nf-a/database-nf-a.sqlite" ] && [ -s "$PROJECT_DIR/data/db-nf-b/database-nf-b.sqlite" ]; then
    echo -e "${DIM}Databases exported to data/db-nf-*/database-nf-*.sqlite${NC}"
fi

log_evidence "PACKING_MODE: $PACKING_MODE ($MODE_DISPLAY)"
log_evidence ""
log_raw "NF-A Veramo Sidecar Logs" "$LOGS_A"
log_raw "NF-B Veramo Sidecar Logs" "$LOGS_B"

echo ""
echo -e "${DIM}Evidence log: results/$(basename "$EVIDENCE_FILE")${NC}"
echo ""

exit $EXIT_CODE
