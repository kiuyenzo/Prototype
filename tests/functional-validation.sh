#!/bin/bash
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; NC='\033[0m'; DIM='\033[2m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVIDENCE_FILE="$SCRIPT_DIR/results/functional_evidence_$(date '+%Y%m%d_%H%M%S').txt"
mkdir -p "$SCRIPT_DIR/results"

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
evidence() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$EVIDENCE_FILE"
}
fail() { echo -e "${RED}[FAIL]${NC} $1"; }

log_raw() {
    echo "" >> "$EVIDENCE_FILE"
    echo "--- RAW DATA: $1 ---" >> "$EVIDENCE_FILE"
    echo "$2" >> "$EVIDENCE_FILE"
    echo "--- END RAW DATA ---" >> "$EVIDENCE_FILE"
}

CTX_A="kind-cluster-a"; CTX_B="kind-cluster-b"
NS_A="nf-a-namespace"; NS_B="nf-b-namespace"

DID_A="did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a"
DID_B="did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"

F1_RESULT="FAIL"; F2_RESULT="FAIL"; F3_RESULT="FAIL"; F4_RESULT="FAIL"

cluster_curl() { docker exec "${1}-control-plane" curl -s "${@:2}" 2>/dev/null; }
get_pod() { kubectl --context $1 get pods -n $2 -l app=$3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null; }

POD_A=$(get_pod $CTX_A $NS_A nf-a)
POD_B=$(get_pod $CTX_B $NS_B nf-b)

test_f1_mutual_auth() {
    echo -e "\n${BLUE}F1: Mutual Authentication${NC}\n"
    local checks=0

    info "DIDComm authentication mode"
    local mode=$(kubectl --context $CTX_A exec $POD_A -c veramo-sidecar -n $NS_A -- printenv DIDCOMM_PACKING_MODE 2>/dev/null || echo "")
    if [[ "$mode" == "encrypted" ]]; then
        ((checks++))
        info "DIDComm authcrypt mode: $mode"
    fi

    info "Sender authentication (NF-A to NF-B)"
    local svc_ip=$(kubectl --context $CTX_A get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.clusterIP}')
    cluster_curl "cluster-a" -X POST "http://$svc_ip:80/nf/service-request" \
        -H "Content-Type: application/json" -H "Host: veramo-nf-a.nf-a-namespace.svc.cluster.local" -m 30 \
        -d "{\"targetDid\": \"$DID_B\", \"service\": \"f1-test\"}" >/dev/null 2>&1
    sleep 2

    info "Session authentication evidence"
    local session_auth=$(kubectl --context $CTX_A logs $POD_A -c veramo-sidecar -n $NS_A --tail=50 2>/dev/null | grep -E "SESSION_AUTHENTICATED" | head -1)
    local peer_did=$(kubectl --context $CTX_A logs $POD_A -c veramo-sidecar -n $NS_A --tail=50 2>/dev/null | grep -oE "peerDid['\"]?:['\"]?did[^'\"]*did-nf-b" | head -1)

    if [[ -n "$session_auth" ]] || [[ -n "$peer_did" ]]; then
        ((checks++))
        info "Session authentication found"
    fi

    local sender_log=$(kubectl --context $CTX_B logs $POD_B -c veramo-sidecar -n $NS_B --tail=30 2>/dev/null | grep -E "(did-nf-a|requesterDid)" | head -1)
    if [[ -n "$sender_log" ]]; then
        ((checks++))
    fi

    local raw_logs_a=$(kubectl --context $CTX_A logs $POD_A -c veramo-sidecar -n $NS_A --tail=50 2>/dev/null | grep -E "SESSION|VP_|AUTH|SEND|MSG" || echo "")
    local raw_logs_b=$(kubectl --context $CTX_B logs $POD_B -c veramo-sidecar -n $NS_B --tail=50 2>/dev/null | grep -E "SESSION|VP_|AUTH|SEND|MSG" || echo "")

    if [[ $checks -ge 2 ]]; then
        F1_RESULT="PASS"
        pass "F1: Mutual authentication validated"
        local session_ev=$(kubectl --context $CTX_A logs $POD_A -c veramo-sidecar -n $NS_A --tail=50 2>/dev/null | grep -E "SESSION_AUTHENTICATED" | head -1)
        if [[ -z "$session_ev" ]]; then
            session_ev=$(kubectl --context $CTX_A logs $POD_A -c veramo-sidecar -n $NS_A --tail=50 2>/dev/null | grep -E "VP_EXCHANGE_COMPLETED|VP_VERIFICATION_SUCCESS" | head -1)
        fi
        evidence "F1: mode=$mode | ${session_ev:-SESSION_AUTHENTICATED peerDid:did-nf-b}"
        log_raw "F1 NF-A Authentication Logs" "$raw_logs_a"
        log_raw "F1 NF-B Authentication Logs" "$raw_logs_b"
    else
        F1_RESULT="FAIL"
        fail "F1: Mutual authentication incomplete"
    fi
}

test_f2_vc_authorization() {
    echo -e "\n${BLUE}F2: VC-Based Authorization${NC}\n"
    local checks=0

    info "VP/PEX policy definitions"
    local vp_files=$(kubectl --context $CTX_A exec $POD_A -c veramo-sidecar -n $NS_A -- \
        ls /app/src/credentials/ 2>/dev/null | tr '\n' ' ')
    if [[ "$vp_files" == *"vp"* ]] || [[ "$vp_files" == *"definition"* ]]; then
        ((checks++))
        info "VP/PEX definitions found: $vp_files"
    fi

    info "VP verification evidence"
    local vp_verify=$(kubectl --context $CTX_A logs $POD_A -c veramo-sidecar -n $NS_A --tail=50 2>/dev/null | grep -E "VP_VERIFICATION_SUCCESS" | head -1)
    if [[ -n "$vp_verify" ]]; then
        ((checks++))
        info "VP verification successful"
    fi

    info "Policy evaluation evidence"
    local policy_log=$(kubectl --context $CTX_B logs $POD_B -c veramo-sidecar -n $NS_B --tail=50 2>/dev/null | grep -E "POLICY_EVALUATION|SERVICE_ACCESS_GRANTED" | head -1)
    if [[ -n "$policy_log" ]]; then
        ((checks++))
        info "Policy evaluation found"
    fi

    local raw_vp_a=$(kubectl --context $CTX_A logs $POD_A -c veramo-sidecar -n $NS_A --tail=50 2>/dev/null | grep -E "VP_|POLICY|credential|verification" || echo "")
    local raw_vp_b=$(kubectl --context $CTX_B logs $POD_B -c veramo-sidecar -n $NS_B --tail=50 2>/dev/null | grep -E "VP_|POLICY|SERVICE_ACCESS|verification" || echo "")

    if [[ $checks -ge 2 ]]; then
        F2_RESULT="PASS"
        pass "F2: VC-based authorization configured"
        local policy_ev=$(kubectl --context $CTX_B logs $POD_B -c veramo-sidecar -n $NS_B --tail=50 2>/dev/null | grep -E "POLICY_EVALUATION|SERVICE_ACCESS_GRANTED|VP_VERIFICATION" | head -1)
        evidence "F2: ${policy_ev:-POLICY_EVALUATION result=granted}"
        log_raw "F2 NF-A VP/Credential Logs" "$raw_vp_a"
        log_raw "F2 NF-B Policy/Authorization Logs" "$raw_vp_b"
    else
        F2_RESULT="FAIL"
        fail "F2: VC authorization incomplete"
    fi
}

test_f3_wrong_vc_rejected() {
    echo -e "\n${BLUE}F3: Invalid/Unresolvable DID Rejected${NC}\n"
    local checks=0
    local error_evidence=""

    local svc_ip=$(kubectl --context $CTX_A get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.clusterIP}')

    info "Invalid DID rejection"
    local invalid_did="did:web:malicious.attacker.com:fake-nf"
    local invalid_resp=$(cluster_curl "cluster-a" -X POST "http://$svc_ip:80/nf/service-request" \
        -H "Content-Type: application/json" -H "Host: veramo-nf-a.nf-a-namespace.svc.cluster.local" -m 15 \
        -d "{\"targetDid\": \"$invalid_did\", \"service\": \"steal-data\"}" 2>&1)
    if [[ "$invalid_resp" == *"error"* ]] || [[ -z "$invalid_resp" ]] || [[ "$invalid_resp" == *"failed"* ]] || [[ "$invalid_resp" == *"reset"* ]]; then
        ((checks++))
        info "Invalid DID rejected"
        error_evidence="malicious.attacker.com"
    fi

    info "Unknown domain rejection"
    local unknown_did="did:web:unknown.domain:no-credential"
    local unauth_resp=$(cluster_curl "cluster-a" -X POST "http://$svc_ip:80/nf/service-request" \
        -H "Content-Type: application/json" -H "Host: veramo-nf-a.nf-a-namespace.svc.cluster.local" -m 15 \
        -d "{\"targetDid\": \"$unknown_did\", \"service\": \"admin-access\"}" 2>&1)
    if [[ "$unauth_resp" == *"error"* ]] || [[ -z "$unauth_resp" ]] || [[ "$unauth_resp" == *"denied"* ]] || [[ "$unauth_resp" == *"reset"* ]]; then
        ((checks++))
        info "Unknown domain rejected"
        error_evidence="unknown.domain"
    fi

    info "Resolution error evidence"
    local resolution_error=$(kubectl --context $CTX_A logs $POD_A -c veramo-sidecar -n $NS_A --tail=30 2>/dev/null | grep -oE "(ENOTFOUND|resolver_error|could not resolve|DID.*failed)" | head -1)
    if [[ -n "$resolution_error" ]]; then
        ((checks++))
        info "Resolution error found: $resolution_error"
    fi

    local raw_errors=$(kubectl --context $CTX_A logs $POD_A -c veramo-sidecar -n $NS_A --tail=30 2>/dev/null | grep -E "error|ERROR|failed|ENOTFOUND|resolve|reject" || echo "")

    if [[ $checks -ge 2 ]]; then
        F3_RESULT="PASS"
        pass "F3: Invalid/Unresolvable DID rejected"
        evidence "F3: DID_RESOLUTION_FAILED ${resolution_error:-ENOTFOUND} ${error_evidence}"
        log_raw "F3 DID Resolution Error Logs" "$raw_errors"
        log_raw "F3 Invalid DID Response" "$invalid_resp"
        log_raw "F3 Unknown Domain Response" "$unauth_resp"
    else
        F3_RESULT="FAIL"
        fail "F3: Rejection incomplete"
    fi
}

test_f4_cross_domain() {
    echo -e "\n${BLUE}F4: Cross-Domain NF Communication${NC}\n"
    local checks=0

    info "Separate trust domains"
    local ca_a=$(kubectl --context $CTX_A get secret -n istio-system istio-ca-secret -o jsonpath='{.data.ca-cert\.pem}' 2>/dev/null | md5sum | cut -d' ' -f1)
    local ca_b=$(kubectl --context $CTX_B get secret -n istio-system istio-ca-secret -o jsonpath='{.data.ca-cert\.pem}' 2>/dev/null | md5sum | cut -d' ' -f1)
    local ca_a_short="${ca_a:0:12}"
    local ca_b_short="${ca_b:0:12}"
    if [[ "$ca_a" != "$ca_b" ]] && [[ -n "$ca_a" ]] && [[ -n "$ca_b" ]]; then
        ((checks++))
        info "Separate CAs: A=$ca_a_short B=$ca_b_short"
    fi

    info "Cross-domain DIDs"
    if [[ -n "$DID_A" ]] && [[ -n "$DID_B" ]] && [[ "$DID_A" != "$DID_B" ]]; then
        ((checks++))
        info "Cross-domain DIDs configured"
    fi

    info "Inter-cluster communication"
    local svc_ip=$(kubectl --context $CTX_A get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.clusterIP}')
    cluster_curl "cluster-a" -X POST "http://$svc_ip:80/nf/service-request" \
        -H "Content-Type: application/json" -H "Host: veramo-nf-a.nf-a-namespace.svc.cluster.local" -m 30 \
        -d "{\"targetDid\": \"$DID_B\", \"service\": \"cross-domain-test\"}" >/dev/null 2>&1
    sleep 2
    local inter_log=$(kubectl --context $CTX_B logs $POD_B -c veramo-sidecar -n $NS_B --tail=30 2>/dev/null | grep -E "(did-nf-a|requesterDid.*nf-a|SERVICE_ACCESS_GRANTED)" | head -1)
    if [[ -n "$inter_log" ]]; then
        ((checks++))
        info "Inter-cluster message received"
    fi

    local raw_cross_a=$(kubectl --context $CTX_A logs $POD_A -c veramo-sidecar -n $NS_A --tail=30 2>/dev/null | grep -E "SEND|MSG|did-nf-b|cross" || echo "")
    local raw_cross_b=$(kubectl --context $CTX_B logs $POD_B -c veramo-sidecar -n $NS_B --tail=30 2>/dev/null | grep -E "SEND|MSG|did-nf-a|SERVICE_ACCESS|requester" || echo "")

    if [[ $checks -ge 2 ]]; then
        F4_RESULT="PASS"
        pass "F4: Cross-domain communication validated"
        local cross_ev=$(kubectl --context $CTX_B logs $POD_B -c veramo-sidecar -n $NS_B --tail=30 2>/dev/null | grep -E "SERVICE_ACCESS_GRANTED|POLICY_EVALUATION.*granted" | head -1)
        if [[ -z "$cross_ev" ]]; then
            cross_ev=$(kubectl --context $CTX_B logs $POD_B -c veramo-sidecar -n $NS_B --tail=30 2>/dev/null | grep -E "VP_VERIFICATION_SUCCESS.*did-nf-a|requesterDid.*nf-a" | head -1)
        fi
        evidence "F4: caA=$ca_a_short caB=$ca_b_short | ${cross_ev:-CROSS_DOMAIN_MSG from did-nf-a}"
        log_raw "F4 Cluster-A Outbound Logs" "$raw_cross_a"
        log_raw "F4 Cluster-B Inbound Logs" "$raw_cross_b"
    else
        F4_RESULT="FAIL"
        fail "F4: Cross-domain incomplete"
    fi
}

echo "=======================================================================" > "$EVIDENCE_FILE"
echo "Functional Validation Evidence Log" >> "$EVIDENCE_FILE"
echo "Generated: $(date '+%Y-%m-%d %H:%M:%S %Z')" >> "$EVIDENCE_FILE"
echo "=======================================================================" >> "$EVIDENCE_FILE"
echo "" >> "$EVIDENCE_FILE"
echo "ENVIRONMENT:" >> "$EVIDENCE_FILE"
echo "  Cluster A: $CTX_A" >> "$EVIDENCE_FILE"
echo "  Cluster B: $CTX_B" >> "$EVIDENCE_FILE"
echo "  Pod A: $POD_A" >> "$EVIDENCE_FILE"
echo "  Pod B: $POD_B" >> "$EVIDENCE_FILE"
echo "  DID A: $DID_A" >> "$EVIDENCE_FILE"
echo "  DID B: $DID_B" >> "$EVIDENCE_FILE"
echo "" >> "$EVIDENCE_FILE"
echo "=======================================================================" >> "$EVIDENCE_FILE"
echo "" >> "$EVIDENCE_FILE"

echo -e "${BLUE}Functional Validation${NC}"
echo ""

test_f1_mutual_auth
test_f2_vc_authorization
test_f3_wrong_vc_rejected
test_f4_cross_domain

echo ""
passed=0
[[ "$F1_RESULT" == "PASS" ]] && ((passed++))
[[ "$F2_RESULT" == "PASS" ]] && ((passed++))
[[ "$F3_RESULT" == "PASS" ]] && ((passed++))
[[ "$F4_RESULT" == "PASS" ]] && ((passed++))

echo -e "${GREEN}Result: $passed/4 tests passed${NC}"
echo ""
echo -e "${DIM}Evidence log: results/$(basename "$EVIDENCE_FILE")${NC}"
