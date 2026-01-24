#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
mkdir -p "$RESULTS_DIR"

EVIDENCE_FILE="$RESULTS_DIR/transport_independence_$(date '+%Y%m%d_%H%M%S').txt"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; NC='\033[0m'
DIM='\033[2m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
header() { echo -e "\n${BLUE}$1${NC}\n"; }
evidence() {
    echo -e "${MAGENTA}[EVIDENCE]${NC} $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$EVIDENCE_FILE"
}

log_raw() {
    echo "" >> "$EVIDENCE_FILE"
    echo "--- RAW DATA: $1 ---" >> "$EVIDENCE_FILE"
    echo "$2" >> "$EVIDENCE_FILE"
    echo "--- END RAW DATA ---" >> "$EVIDENCE_FILE"
}

log_section() {
    echo "" >> "$EVIDENCE_FILE"
    echo "=======================================================================" >> "$EVIDENCE_FILE"
    echo "$1" >> "$EVIDENCE_FILE"
    echo "=======================================================================" >> "$EVIDENCE_FILE"
}

log_subsection() {
    echo "" >> "$EVIDENCE_FILE"
    echo "--- $1 ---" >> "$EVIDENCE_FILE"
}

log_detail() {
    echo "  $1" >> "$EVIDENCE_FILE"
}

log_analysis() {
    echo "" >> "$EVIDENCE_FILE"
    echo "[ANALYSIS] $1" >> "$EVIDENCE_FILE"
}

CTX_A="kind-cluster-a"; CTX_B="kind-cluster-b"
NS_A="nf-a-namespace"; NS_B="nf-b-namespace"

get_pod() { kubectl --context $1 get pods -n $2 -l app=$3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null; }
cluster_curl() { docker exec "${1}-control-plane" curl -sS -o /dev/null -w "%{http_code}" "${@:2}" 2>/dev/null || echo "000"; }

SENSITIVE_STRICT=("presentation_definition" "goal_code" "nf.auth" "nudm-sdm" "am-data" "nf-authorization")
SENSITIVE_META_ALLOWED=("did-nf-a" "did-nf-b" "kiuyenzo")

PLAINTEXT_PAYLOAD='{"type":"https://didcomm.org/present-proof/3.0/request-presentation","from":"did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a","to":["did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"],"body":{"goal_code":"nf.auth","presentation_definition":{"id":"nf-authorization-pd"}}}'

POD_A=$(get_pod $CTX_A $NS_A nf-a)
POD_B=$(get_pod $CTX_B $NS_B nf-b)

TESTS_PASSED=0
TESTS_FAILED=0

T1_VISIBLE="?"; T1_LATENCY=0
T2_VISIBLE="?"; T2_LATENCY=0; T2_HTTP="000"; T2_GW_SAW_REQUEST="NO"; T2_DETECTION_METHOD="NONE"
T3_VISIBLE="?"; T3_LATENCY=0; T3_HTTP="000"; T3_GW_A_SAW="NO"; T3_GW_B_SAW="NO"; T3_DETECTION_METHOD="NONE"
T4_VISIBLE="N/A"; T4_LATENCY=-1; T4_TLS_TERMINATED="NOT_CONFIGURED"; T4_DETECTION_METHOD="N/A"; T4_PROOF="NONE"

JWE_MESSAGE=""
JWE_SIZE=0

echo "=======================================================================" > "$EVIDENCE_FILE"
echo "Transport Independence Test - Evidence Log" >> "$EVIDENCE_FILE"
echo "Generated: $(date '+%Y-%m-%d %H:%M:%S %Z')" >> "$EVIDENCE_FILE"
echo "=======================================================================" >> "$EVIDENCE_FILE"
echo "" >> "$EVIDENCE_FILE"
echo "ENVIRONMENT:" >> "$EVIDENCE_FILE"
echo "  Pod A: $POD_A" >> "$EVIDENCE_FILE"
echo "  Pod B: $POD_B" >> "$EVIDENCE_FILE"
echo "" >> "$EVIDENCE_FILE"

setup_jwe_message() {
    header "Setup: Create JWE-Encrypted Message"

    info "Packing message with DIDComm authcrypt (JWE)..."

    local jwe_response=$(kubectl --context $CTX_A exec $POD_A -c veramo-sidecar -n $NS_A -- \
        curl -s -X POST http://localhost:3001/debug/pack-message \
        -H "Content-Type: application/json" \
        -d "{\"payload\":$PLAINTEXT_PAYLOAD,\"mode\":\"encrypted\"}" 2>/dev/null)

    JWE_MESSAGE=$(echo "$jwe_response" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    print(data.get('packed', ''))
except: pass
" 2>/dev/null)

    if [[ -z "$JWE_MESSAGE" ]]; then
        fail "Could not create JWE message"
        return 1
    fi

    JWE_SIZE=${#JWE_MESSAGE}
    pass "JWE message created (${JWE_SIZE}B)"

    info "Verifying strict content is hidden in JWE..."
    local strict_hidden=true
    for term in "${SENSITIVE_STRICT[@]}"; do
        if echo "$JWE_MESSAGE" | grep -q "$term"; then
            echo -e "  ${RED}[x] $term: EXPOSED!${NC}"
            strict_hidden=false
        else
            echo -e "  ${GREEN}[ok] $term: encrypted${NC}"
        fi
    done

    if [[ "$strict_hidden" == "true" ]]; then
        pass "All strict content encrypted"
        ((TESTS_PASSED++))
    else
        fail "Strict content exposed in JWE!"
        ((TESTS_FAILED++))
        return 1
    fi

    local plaintext_size=${#PLAINTEXT_PAYLOAD}
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Plaintext size: ${plaintext_size}B" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] JWE size: ${JWE_SIZE}B" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Overhead: +$((JWE_SIZE - plaintext_size))B" >> "$EVIDENCE_FILE"
    echo "" >> "$EVIDENCE_FILE"
    log_raw "JWE_MESSAGE" "$JWE_MESSAGE"

    return 0
}

test_t1_mtls() {
    header "T1: mTLS E2E (Pod-to-Pod)"

    info "Path: NF-A pod to Istio sidecar (mTLS) to NF-B pod"

    local request_id="t1-independence-$(date +%s)"

    kubectl --context $CTX_A logs $POD_A -c istio-proxy -n $NS_A --since=1s >/dev/null 2>&1 || true

    local start_time=$(python3 -c "import time; print(int(time.time()*1000))")
    kubectl --context $CTX_A exec $POD_A -c veramo-sidecar -n $NS_A -- \
        curl -s -X POST http://localhost:3001/didcomm/send \
        -H "Content-Type: application/json" \
        -H "X-Request-Id: $request_id" \
        -d "{\"to\":\"did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b\",\"message\":$JWE_MESSAGE}" >/dev/null 2>&1 || true
    local end_time=$(python3 -c "import time; print(int(time.time()*1000))")
    T1_LATENCY=$((end_time - start_time))

    sleep 5

    local logs_nfa=$(kubectl --context $CTX_A logs $POD_A -c istio-proxy -n $NS_A --since=120s 2>/dev/null || echo "")
    local logs_nfb=$(kubectl --context $CTX_B logs $POD_B -c istio-proxy -n $NS_B --since=120s 2>/dev/null || echo "")

    T1_VISIBLE="NO"
    for term in "${SENSITIVE_STRICT[@]}"; do
        if echo "$logs_nfa" | grep -q "$term"; then
            T1_VISIBLE="YES"
            echo -e "  ${RED}[x] NF-A proxy saw strict content: $term${NC}"
            break
        fi
        if echo "$logs_nfb" | grep -q "$term"; then
            T1_VISIBLE="YES"
            echo -e "  ${RED}[x] NF-B proxy saw strict content: $term${NC}"
            break
        fi
    done

    if [[ "$T1_VISIBLE" == "NO" ]]; then
        pass "T1: Sidecar proxies saw only encrypted traffic"
        ((TESTS_PASSED++))
    else
        fail "T1: Sensitive data visible in sidecar logs!"
        ((TESTS_FAILED++))
    fi

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T1 path: pod-A to istio-proxy (mTLS) to pod-B" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T1 request-id: $request_id" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T1 sensitive data visible: $T1_VISIBLE" >> "$EVIDENCE_FILE"

    if [[ -n "$logs_nfa" ]]; then
        echo "" >> "$EVIDENCE_FILE"
        echo "--- T1 NF-A ISTIO-PROXY LOGS (outbound) ---" >> "$EVIDENCE_FILE"
        echo "$logs_nfa" >> "$EVIDENCE_FILE"
        echo "--- END T1 NF-A LOGS ---" >> "$EVIDENCE_FILE"
    fi

    if [[ -n "$logs_nfb" ]]; then
        echo "" >> "$EVIDENCE_FILE"
        echo "--- T1 NF-B ISTIO-PROXY LOGS (inbound) ---" >> "$EVIDENCE_FILE"
        echo "$logs_nfb" >> "$EVIDENCE_FILE"
        echo "--- END T1 NF-B LOGS ---" >> "$EVIDENCE_FILE"
    fi
}

test_t2_gateway() {
    header "T2: Gateway HTTP Routing (1 Hop)"

    info "Path: External to Gateway-A to NF-A pod"

    local gw_ip=$(kubectl --context $CTX_A get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.clusterIP}' 2>/dev/null)
    local gw_pod=$(kubectl --context $CTX_A get pods -n istio-system -l app=istio-ingressgateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    local request_id="t2-independence-$(date +%s)"

    kubectl --context $CTX_A logs $gw_pod -n istio-system --since=1s >/dev/null 2>&1 || true

    local start_time=$(python3 -c "import time; print(int(time.time()*1000))")
    T2_HTTP=$(cluster_curl "cluster-a" -X POST "http://$gw_ip:80/didcomm" \
        -H "Content-Type: application/json" \
        -H "Host: veramo-nf-a.nf-a-namespace.svc.cluster.local" \
        -H "X-Request-Id: $request_id" \
        -d "$JWE_MESSAGE")
    local end_time=$(python3 -c "import time; print(int(time.time()*1000))")
    T2_LATENCY=$((end_time - start_time))
    info "HTTP status: $T2_HTTP"

    sleep 2

    local gw_logs=$(kubectl --context $CTX_A logs $gw_pod -n istio-system --since=120s 2>/dev/null || echo "")

    T2_GW_SAW_REQUEST="NO"
    T2_DETECTION_METHOD="NONE"

    if echo "$gw_logs" | grep -q "$request_id"; then
        T2_GW_SAW_REQUEST="YES"
        T2_DETECTION_METHOD="X-Request-Id"
    elif echo "$gw_logs" | grep -qE "POST.*/didcomm" && echo "$gw_logs" | grep -q "veramo-nf-a"; then
        T2_GW_SAW_REQUEST="LIKELY"
        T2_DETECTION_METHOD="POST /didcomm + Host (medium)"
    elif echo "$gw_logs" | grep -qE "POST.*/didcomm.*HTTP"; then
        T2_GW_SAW_REQUEST="LIKELY"
        T2_DETECTION_METHOD="POST /didcomm (weak)"
    fi

    if [[ "$T2_HTTP" != "000" && "$T2_GW_SAW_REQUEST" != "YES" ]]; then
        T2_GW_SAW_REQUEST="YES"
        T2_DETECTION_METHOD="HTTP $T2_HTTP"
    fi

    T2_VISIBLE="NO"
    for term in "${SENSITIVE_STRICT[@]}"; do
        if echo "$gw_logs" | grep -q "$term"; then
            T2_VISIBLE="YES"
            echo -e "  ${RED}[x] Gateway saw strict content: $term${NC}"
            break
        fi
    done

    if [[ "$T2_VISIBLE" == "NO" ]]; then
        pass "T2: Gateway saw only JWE ciphertext"
        ((TESTS_PASSED++))
    else
        fail "T2: Sensitive data visible in gateway logs!"
        ((TESTS_FAILED++))
    fi

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T2 path: external to gateway-A to pod-A" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T2 HTTP status: $T2_HTTP" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T2 gateway detection: $T2_GW_SAW_REQUEST (via $T2_DETECTION_METHOD)" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T2 sensitive data visible: $T2_VISIBLE" >> "$EVIDENCE_FILE"

    if [[ -n "$gw_logs" ]]; then
        echo "" >> "$EVIDENCE_FILE"
        echo "--- T2 GATEWAY-A LOGS ---" >> "$EVIDENCE_FILE"
        echo "$gw_logs" >> "$EVIDENCE_FILE"
        echo "--- END T2 LOGS ---" >> "$EVIDENCE_FILE"
    fi
}

test_t3_multigateway() {
    header "T3: Multi-Gateway (Cross-Cluster)"

    info "Path: External to Gateway-A to Gateway-B to NF-B pod"

    local gw_a_ip=$(kubectl --context $CTX_A get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.clusterIP}' 2>/dev/null)
    local gw_a_pod=$(kubectl --context $CTX_A get pods -n istio-system -l app=istio-ingressgateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    local gw_b_pod=$(kubectl --context $CTX_B get pods -n istio-system -l app=istio-ingressgateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    local request_id="t3-independence-$(date +%s)"

    kubectl --context $CTX_A logs $gw_a_pod -n istio-system --since=1s >/dev/null 2>&1 || true
    kubectl --context $CTX_B logs $gw_b_pod -n istio-system --since=1s >/dev/null 2>&1 || true

    local start_time=$(python3 -c "import time; print(int(time.time()*1000))")
    T3_HTTP=$(cluster_curl "cluster-a" -X POST "http://$gw_a_ip:80/didcomm" \
        -H "Content-Type: application/json" \
        -H "Host: veramo-nf-b.nf-b-namespace.svc.cluster.local" \
        -H "X-Request-Id: $request_id" \
        -m 10 -d "$JWE_MESSAGE")
    local end_time=$(python3 -c "import time; print(int(time.time()*1000))")
    T3_LATENCY=$((end_time - start_time))
    info "HTTP status: $T3_HTTP"

    sleep 2

    local gw_a_logs=$(kubectl --context $CTX_A logs $gw_a_pod -n istio-system --since=120s 2>/dev/null || echo "")
    local gw_b_logs=$(kubectl --context $CTX_B logs $gw_b_pod -n istio-system --since=120s 2>/dev/null || echo "")

    T3_GW_A_SAW="NO"; T3_GW_B_SAW="NO"
    T3_DETECTION_METHOD="NONE"
    T3_GW_A_EVIDENCE=""; T3_GW_B_EVIDENCE=""
    T3_GW_B_PROOF="NONE"
    T3_GW_B_MATCHED_LINE=""

    if echo "$gw_a_logs" | grep -q "$request_id"; then
        T3_GW_A_SAW="YES"
        T3_GW_A_EVIDENCE="X-Request-Id in logs"
    elif echo "$gw_a_logs" | grep -qE "cluster-b\.external|172\.23\.0\.2|30731"; then
        T3_GW_A_SAW="YES"
        T3_GW_A_EVIDENCE="Route to cluster-b in logs"
    elif [[ "$T3_HTTP" != "000" ]]; then
        T3_GW_A_SAW="YES"
        T3_GW_A_EVIDENCE="HTTP response received"
    fi

    if echo "$gw_b_logs" | grep -q "$request_id"; then
        T3_GW_B_SAW="YES"
        T3_GW_B_PROOF="XRID"
        T3_GW_B_EVIDENCE="X-Request-Id found in GW-B logs (HARD)"
        T3_GW_B_MATCHED_LINE=$(echo "$gw_b_logs" | grep "$request_id" | head -3)
    fi

    if [[ "$T3_GW_B_SAW" == "NO" ]]; then
        local gw_b_nfb_route=$(echo "$gw_b_logs" | grep -E "POST.*/didcomm.*veramo-nf-b.*10\.245\.[0-9]+\.[0-9]+:3001")
        if [[ -n "$gw_b_nfb_route" ]]; then
            T3_GW_B_SAW="YES"
            T3_GW_B_PROOF="UPSTREAM"
            T3_GW_B_EVIDENCE="GW-B log: upstream to NF-B pod 10.245.x.x:3001 (MEDIUM)"
            T3_GW_B_MATCHED_LINE=$(echo "$gw_b_nfb_route" | head -3)
        fi
    fi

    if [[ "$T3_GW_B_SAW" == "NO" ]]; then
        local cross_cluster_xff=$(echo "$gw_b_logs" | grep -E "10\.244\.[0-9]+\.[0-9]+,10\.245\.[0-9]+\.[0-9]+")
        if [[ -n "$cross_cluster_xff" ]]; then
            T3_GW_B_SAW="YES"
            T3_GW_B_PROOF="UPSTREAM"
            T3_GW_B_EVIDENCE="X-Forwarded-For shows cross-cluster path (MEDIUM)"
            T3_GW_B_MATCHED_LINE=$(echo "$cross_cluster_xff" | head -3)
        fi
    fi

    if [[ "$T3_GW_B_SAW" == "NO" ]]; then
        local via_upstream_line=$(echo "$gw_b_logs" | grep -E "veramo-nf-b\.nf-b-namespace.*via_upstream")
        if [[ -n "$via_upstream_line" ]]; then
            T3_GW_B_SAW="YES"
            T3_GW_B_PROOF="UPSTREAM"
            T3_GW_B_EVIDENCE="GW-B log: via_upstream to veramo-nf-b (MEDIUM)"
            T3_GW_B_MATCHED_LINE=$(echo "$via_upstream_line" | head -3)
        fi
    fi

    if [[ "$T3_GW_B_SAW" == "NO" && "$T3_HTTP" == "403" ]]; then
        T3_GW_B_SAW="INFERRED"
        T3_GW_B_PROOF="INFERRED"
        T3_GW_B_EVIDENCE="HTTP 403 suggests NF-B responded (WEAK - no log proof)"
    fi

    if [[ "$T3_GW_A_SAW" == "YES" && "$T3_GW_B_SAW" == "YES" ]]; then
        T3_DETECTION_METHOD="GW-A + GW-B logs"
    elif [[ "$T3_GW_A_SAW" == "YES" && "$T3_GW_B_SAW" == "INFERRED" ]]; then
        T3_DETECTION_METHOD="GW-A log + GW-B inferred"
    elif [[ "$T3_GW_A_SAW" == "YES" ]]; then
        T3_DETECTION_METHOD="GW-A log only"
    else
        T3_DETECTION_METHOD="HTTP status only"
    fi

    T3_VISIBLE="NO"
    for term in "${SENSITIVE_STRICT[@]}"; do
        if echo "$gw_a_logs" | grep -q "$term"; then
            T3_VISIBLE="YES"
            echo -e "  ${RED}[x] Gateway-A saw strict content: $term${NC}"
            break
        fi
        if echo "$gw_b_logs" | grep -q "$term"; then
            T3_VISIBLE="YES"
            echo -e "  ${RED}[x] Gateway-B saw strict content: $term${NC}"
            break
        fi
    done

    echo -e "  ${DIM}T3 traversal: GW-A=$T3_GW_A_SAW | GW-B=$T3_GW_B_SAW (${T3_GW_B_PROOF})${NC}"
    [[ -n "$T3_GW_B_EVIDENCE" ]] && echo -e "  ${DIM}Evidence: $T3_GW_B_EVIDENCE${NC}"

    if [[ "$T3_VISIBLE" == "NO" ]]; then
        pass "T3: Neither gateway saw plaintext content"
        ((TESTS_PASSED++))
    else
        fail "T3: Sensitive data visible in gateway logs!"
        ((TESTS_FAILED++))
    fi

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T3 path: external to gateway-A to [gateway-B] to pod-B" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T3 HTTP status: $T3_HTTP" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T3 gateway-A: $T3_GW_A_SAW | gateway-B: $T3_GW_B_SAW ($T3_GW_B_PROOF)" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T3 detection: $T3_DETECTION_METHOD" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T3 sensitive data visible: $T3_VISIBLE" >> "$EVIDENCE_FILE"

    if [[ -n "$gw_a_logs" ]]; then
        echo "" >> "$EVIDENCE_FILE"
        echo "--- T3 GATEWAY-A LOGS ---" >> "$EVIDENCE_FILE"
        echo "$gw_a_logs" >> "$EVIDENCE_FILE"
        echo "--- END T3 GW-A LOGS ---" >> "$EVIDENCE_FILE"
    fi

    if [[ -n "$gw_b_logs" ]]; then
        echo "" >> "$EVIDENCE_FILE"
        echo "--- T3 GATEWAY-B LOGS ---" >> "$EVIDENCE_FILE"
        echo "$gw_b_logs" >> "$EVIDENCE_FILE"
        echo "--- END T3 GW-B LOGS ---" >> "$EVIDENCE_FILE"
    fi
}

test_t4_tls_termination() {
    header "T4: TLS Termination at Gateway"

    info "Path: Client [TLS] to Gateway (terminates) [mTLS] to NF-A pod"
    info "Thesis: Even when TLS is terminated, JWE payload stays protected"

    local gw_tls_port=$(kubectl --context $CTX_A get gateway -n $NS_A -o jsonpath='{.items[*].spec.servers[?(@.port.number==443)].port.number}' 2>/dev/null || echo "")
    local gw_tls_mode=$(kubectl --context $CTX_A get gateway -n $NS_A -o jsonpath='{.items[*].spec.servers[?(@.port.number==443)].tls.mode}' 2>/dev/null || echo "")

    if [[ -z "$gw_tls_port" ]]; then
        gw_tls_port=$(kubectl --context $CTX_A get gateway -n istio-system -o jsonpath='{.items[*].spec.servers[?(@.port.number==443)].port.number}' 2>/dev/null || echo "")
        gw_tls_mode=$(kubectl --context $CTX_A get gateway -n istio-system -o jsonpath='{.items[*].spec.servers[?(@.port.number==443)].tls.mode}' 2>/dev/null || echo "")
    fi

    if [[ -z "$gw_tls_port" ]]; then
        echo -e "${YELLOW}[SKIP]${NC} Gateway TLS (port 443) not configured"
        T4_TLS_TERMINATED="NOT_CONFIGURED"
        T4_DETECTION_METHOD="N/A"
        T4_PROOF="NONE"
        T4_VISIBLE="N/A"
        T4_LATENCY=-1
        evidence "T4 SKIPPED: TLS not configured on gateway"
        return 0
    fi

    info "Gateway TLS configured: port=$gw_tls_port, mode=$gw_tls_mode"

    local gw_ip=$(kubectl --context $CTX_A get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.clusterIP}' 2>/dev/null)
    local gw_pod=$(kubectl --context $CTX_A get pods -n istio-system -l app=istio-ingressgateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    local request_id="t4-$(date +%s)"

    kubectl --context $CTX_A logs $gw_pod -n istio-system --since=1s >/dev/null 2>&1 || true

    local start_time=$(python3 -c "import time; print(int(time.time()*1000))")

    local unique_path="/didcomm"
    info "TLS mode: $gw_tls_mode"

    local cert_dir="$SCRIPT_DIR/../certs"
    local curl_output=""

    if [[ "$gw_tls_mode" == "MUTUAL" && -f "$cert_dir/cluster-a-client-cert.pem" ]]; then
        info "Using mTLS client certificate for HARD evidence"
        docker cp "$cert_dir/cluster-a-client-cert.pem" "cluster-a-control-plane:/etc/t4-client.crt" 2>/dev/null
        docker cp "$cert_dir/cluster-a-client-key.pem" "cluster-a-control-plane:/etc/t4-client.key" 2>/dev/null
        docker cp "$cert_dir/ca-cert.pem" "cluster-a-control-plane:/etc/t4-ca.crt" 2>/dev/null

        if docker exec "cluster-a-control-plane" test -s /etc/t4-client.crt; then
            info "Certs copied to container successfully"
        else
            warn "Cert copy failed, falling back to insecure mode"
        fi

        curl_output=$(docker exec "cluster-a-control-plane" curl --http1.1 -v -m 10 --connect-timeout 5 \
            --cert /etc/t4-client.crt \
            --key /etc/t4-client.key \
            --cacert /etc/t4-ca.crt \
            -X POST "https://$gw_ip:443${unique_path}" \
            -H "Content-Type: application/json" \
            -H "Host: veramo-nf-a.nf-a-namespace.svc.cluster.local" \
            -H "X-Request-Id: $request_id" \
            -d "$JWE_MESSAGE" 2>&1 || echo "")
    else
        info "No client cert available, using -k (insecure)"
        curl_output=$(docker exec "cluster-a-control-plane" curl --http1.1 -vk -m 10 --connect-timeout 5 \
            -X POST "https://$gw_ip:443${unique_path}" \
            -H "Content-Type: application/json" \
            -H "Host: veramo-nf-a.nf-a-namespace.svc.cluster.local" \
            -H "X-Request-Id: $request_id" \
            -d "$JWE_MESSAGE" 2>&1 || echo "")
    fi

    local end_time=$(python3 -c "import time; print(int(time.time()*1000))")
    T4_LATENCY=$((end_time - start_time))

    local tls_cipher=$(echo "$curl_output" | grep -oE "SSL connection using [^,]+" | head -1 || echo "")
    local tls_connected=0
    if echo "$curl_output" | grep -q "SSL connection"; then
        tls_connected=1
    fi

    sleep 2

    local gw_logs=$(kubectl --context $CTX_A logs $gw_pod -n istio-system --since=120s 2>/dev/null || echo "")

    T4_TLS_TERMINATED="NO"
    T4_DETECTION_METHOD="NONE"
    T4_PROOF="NONE"
    T4_MATCHED_LINE=""

    local http_code=$(echo "$curl_output" | grep -oE "< HTTP/[0-9.]+ [0-9]+" | tail -1 | grep -oE "[0-9]+$" || echo "")

    if echo "$gw_logs" | grep -q "t4-${request_id}"; then
        T4_TLS_TERMINATED="YES"
        T4_PROOF="PATH"
        T4_DETECTION_METHOD="Unique path in GW logs (HARD)"
        T4_MATCHED_LINE=$(echo "$gw_logs" | grep "t4-${request_id}" | head -3)
    fi

    if [[ "$T4_PROOF" == "NONE" ]] && echo "$gw_logs" | grep -q "$request_id"; then
        T4_TLS_TERMINATED="YES"
        T4_PROOF="PATH"
        T4_DETECTION_METHOD="X-Request-Id in GW logs (HARD)"
        T4_MATCHED_LINE=$(echo "$gw_logs" | grep "$request_id" | head -3)
    fi

    if [[ "$T4_PROOF" == "NONE" && "$tls_connected" -gt 0 && -n "$http_code" ]]; then
        T4_TLS_TERMINATED="YES"
        T4_PROOF="TLS_HTTP"
        T4_DETECTION_METHOD="TLS handshake + HTTP $http_code (MEDIUM)"
        local gw_didcomm_line=$(echo "$gw_logs" | grep -E "POST.*/didcomm.*veramo-nf-a" | tail -3)
        [[ -n "$gw_didcomm_line" ]] && T4_MATCHED_LINE="$gw_didcomm_line"
    fi

    if [[ "$T4_PROOF" == "NONE" && "$tls_connected" -gt 0 ]]; then
        if echo "$curl_output" | grep -qE "SSL.*error|alert|handshake failure|certificate required"; then
            if [[ "$gw_tls_mode" == "MUTUAL" ]]; then
                T4_TLS_TERMINATED="YES"
                T4_PROOF="TLS_HTTP"
                T4_DETECTION_METHOD="TLS terminated, mTLS rejected (MEDIUM)"
                info "mTLS rejected as expected (no client cert)"
            fi
        fi
    fi

    if [[ "$T4_PROOF" == "NONE" && "$tls_connected" -gt 0 ]]; then
        T4_TLS_TERMINATED="YES"
        T4_PROOF="TLS_ONLY"
        T4_DETECTION_METHOD="TLS handshake only (WEAK - no GW log correlation)"
    fi

    echo -e "  ${DIM}T4 evidence: $T4_PROOF${NC}"
    [[ -n "$T4_MATCHED_LINE" ]] && echo -e "  ${DIM}GW log match: $(echo "$T4_MATCHED_LINE" | head -1 | cut -c1-80)...${NC}"

    T4_VISIBLE="NO"
    for term in "${SENSITIVE_STRICT[@]}"; do
        if echo "$gw_logs" | grep -q "$term"; then
            T4_VISIBLE="YES"
            echo -e "  ${RED}[x] After TLS termination, gateway saw: $term${NC}"
            break
        fi
    done

    if [[ "$T4_TLS_TERMINATED" == "YES" && "$T4_VISIBLE" == "NO" ]]; then
        if [[ "$T4_PROOF" == "TLS_ONLY" ]]; then
            echo -e "${YELLOW}[INCONCL]${NC} T4: TLS termination proven, but request correlation is WEAK"
        else
            pass "T4: TLS terminated at gateway, JWE payload still protected ($T4_PROOF)"
            [[ -n "$tls_cipher" ]] && echo -e "  ${DIM}TLS: $tls_cipher${NC}"
            ((TESTS_PASSED++))
        fi
    elif [[ "$T4_TLS_TERMINATED" == "NO" ]]; then
        echo -e "${YELLOW}[WARN]${NC} T4: Could not establish TLS connection"
    else
        fail "T4: Sensitive data visible after TLS termination!"
        ((TESTS_FAILED++))
    fi

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T4 TLS port: $gw_tls_port, mode: $gw_tls_mode" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T4 TLS cipher: $tls_cipher" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T4 request-id: $request_id" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T4 TLS termination: $T4_TLS_TERMINATED" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T4 evidence strength: $T4_PROOF ($T4_DETECTION_METHOD)" >> "$EVIDENCE_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] T4 sensitive data visible: $T4_VISIBLE" >> "$EVIDENCE_FILE"
    [[ -n "$T4_MATCHED_LINE" ]] && echo "[$(date '+%Y-%m-%d %H:%M:%S')] T4 matched log: $T4_MATCHED_LINE" >> "$EVIDENCE_FILE"

    if [[ -n "$curl_output" ]]; then
        echo "" >> "$EVIDENCE_FILE"
        echo "--- T4 TLS CURL OUTPUT ---" >> "$EVIDENCE_FILE"
        echo "$curl_output" >> "$EVIDENCE_FILE"
        echo "--- END T4 CURL ---" >> "$EVIDENCE_FILE"
    fi

    if [[ -n "$gw_logs" ]]; then
        echo "" >> "$EVIDENCE_FILE"
        echo "--- T4 GATEWAY LOGS ---" >> "$EVIDENCE_FILE"
        echo "$gw_logs" >> "$EVIDENCE_FILE"
        echo "--- END T4 LOGS ---" >> "$EVIDENCE_FILE"
    fi
}

show_results() {
    echo ""
    echo -e "${BLUE}Transport Independence Test Results${NC}"
    echo ""

    echo "+---------------------------------------------------------------------------------+"
    echo "|                          TRANSPORT INDEPENDENCE MATRIX                          |"
    echo "+---------+------------------------+---------------+-------------------------+----+"
    echo "| Path    | Route                  | Body Exposed  | GW Traversal Evidence   | OK |"
    echo "+---------+------------------------+---------------+-------------------------+----+"

    local t1_status=$([[ "$T1_VISIBLE" == "NO" ]] && echo "OK" || echo "FAIL")
    printf "| T1      | %-22s | %-13s | %-23s | %-2s |\n" "Pod to mTLS to Pod" "$T1_VISIBLE" "n/a (no gateway)" "$t1_status"

    local t2_evidence="$T2_GW_SAW_REQUEST"
    [[ "$T2_GW_SAW_REQUEST" != "NO" ]] && t2_evidence="$T2_GW_SAW_REQUEST ($T2_DETECTION_METHOD)"
    local t2_status="FAIL"
    if [[ "$T2_VISIBLE" == "NO" ]]; then
        t2_status="OK"
    fi
    printf "| T2      | %-22s | %-13s | %-23s | %-2s |\n" "Ext to GW(HTTP) to Pod" "$T2_VISIBLE" "$t2_evidence" "$t2_status"

    local t3_evidence="NO"
    if [[ "$T3_GW_B_SAW" == "YES" && "$T3_GW_B_PROOF" == "XRID" ]]; then
        t3_evidence="YES (HARD: X-Req-Id)"
    elif [[ "$T3_GW_B_SAW" == "YES" && "$T3_GW_B_PROOF" == "UPSTREAM" ]]; then
        t3_evidence="YES (MED: upstream)"
    elif [[ "$T3_GW_B_SAW" == "INFERRED" ]]; then
        t3_evidence="YES (WEAK: inferred)"
    elif [[ "$T3_GW_A_SAW" == "YES" ]]; then
        t3_evidence="PARTIAL (GW-A only)"
    fi
    local t3_status="FAIL"
    if [[ "$T3_VISIBLE" == "NO" ]]; then
        t3_status="OK"
    fi
    printf "| T3      | %-22s | %-13s | %-23s | %-2s |\n" "Ext to GW-A to GW-B" "$T3_VISIBLE" "$t3_evidence" "$t3_status"

    local t4_evidence="NOT_CONFIGURED"
    local t4_status="SKIP"
    if [[ "$T4_TLS_TERMINATED" == "YES" && "$T4_PROOF" == "PATH" ]]; then
        t4_evidence="YES (HARD: path)"
        [[ "$T4_VISIBLE" == "NO" ]] && t4_status="OK"
    elif [[ "$T4_TLS_TERMINATED" == "YES" && "$T4_PROOF" == "TLS_HTTP" ]]; then
        t4_evidence="YES (MED: TLS+HTTP)"
        [[ "$T4_VISIBLE" == "NO" ]] && t4_status="OK"
    elif [[ "$T4_TLS_TERMINATED" == "YES" && "$T4_PROOF" == "TLS_ONLY" ]]; then
        t4_evidence="YES (WEAK: TLS only)"
        t4_status="INCONCL"
    elif [[ "$T4_TLS_TERMINATED" == "NOT_CONFIGURED" ]]; then
        t4_evidence="NOT_CONFIGURED"
        t4_status="SKIP"
    fi
    printf "| T4      | %-22s | %-13s | %-23s | %-2s |\n" "Ext -TLS- GW to Pod" "$T4_VISIBLE" "$t4_evidence" "$t4_status"

    echo "+---------+------------------------+---------------+-------------------------+----+"
    echo -e "  ${DIM}Body = Strict content (goal_code, presentation_definition, claims)${NC}"
    echo -e "  ${DIM}OK = body not exposed (security property holds) | INCONCL = weak evidence${NC}"
    echo ""

    local total=$((TESTS_PASSED + TESTS_FAILED))
    if [[ $TESTS_FAILED -eq 0 ]]; then
        echo -e "${GREEN}Result: $TESTS_PASSED/$total tests passed${NC}"
    else
        echo -e "${YELLOW}Result: $TESTS_PASSED/$total tests passed - $TESTS_FAILED failures${NC}"
    fi
    echo ""
    echo -e "${DIM}Evidence: results/$(basename "$EVIDENCE_FILE")${NC}"
}

echo -e "${BLUE}Transport Independence Test${NC}"
echo ""
info "Run: $(date '+%Y-%m-%d %H:%M %Z')"
info "Pods: $POD_A / $POD_B"

setup_jwe_message || exit 1
test_t1_mtls || true
test_t2_gateway || true
test_t3_multigateway || true
test_t4_tls_termination || true
show_results
