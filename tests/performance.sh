#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()   { echo -e "${BLUE}[INFO]${NC} $1"; }
metric() { echo -e "${GREEN}[METRIC]${NC} $1"; }
warn()   { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()  { echo -e "${RED}[ERROR]${NC} $1"; }

CLUSTER_A_CONTEXT="kind-cluster-a"
CLUSTER_B_CONTEXT="kind-cluster-b"
NS_A="nf-a-namespace"
NS_B="nf-b-namespace"
HOST_HEADER="veramo-nf-a.nf-a-namespace.svc.cluster.local"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NF_B_DID="did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"

RUN_ID="performance_$(date +"%Y-%m-%d_%H-%M-%S")"
OUTPUT_DIR="$SCRIPT_DIR/results/$RUN_ID"
mkdir -p "$OUTPUT_DIR"

ITERATIONS=${1:-50}
WARMUP_ITERATIONS=5

LATENCY_CSV="$OUTPUT_DIR/latency-metrics.csv"
SIZE_CSV="$OUTPUT_DIR/payload-size-metrics.csv"
CPU_CSV="$OUTPUT_DIR/cpu-metrics.csv"

get_cluster_ips() {
    CLUSTER_A_SVC_IP=$(kubectl --context "$CLUSTER_A_CONTEXT" \
        get svc -n istio-system istio-ingressgateway \
        -o jsonpath='{.spec.clusterIP}' 2>/dev/null)

    CLUSTER_B_SVC_IP=$(kubectl --context "$CLUSTER_B_CONTEXT" \
        get svc -n istio-system istio-ingressgateway \
        -o jsonpath='{.spec.clusterIP}' 2>/dev/null)

    if [[ -z "$CLUSTER_A_SVC_IP" ]]; then
        error "Cannot get Cluster A service IP"
        exit 1
    fi

    if [[ -z "$CLUSTER_B_SVC_IP" ]]; then
        error "Cannot get Cluster B service IP"
        exit 1
    fi
}

curl_timed() {
    local cluster=$1
    local url=$2
    local packing=$3
    local payload=$4

    local result
    result=$(docker exec "${cluster}-control-plane" curl -o /dev/null -s \
        -w '%{time_total}' \
        --http1.1 \
        --no-keepalive \
        -X POST \
        -H "Host: ${HOST_HEADER}" \
        -H "Content-Type: application/json" \
        -H "X-DIDComm-Packing: ${packing}" \
        -m 60 \
        -d "${payload}" \
        "${url}" 2>/dev/null)

    if [[ -n "$result" && "$result" != "0.000000" ]]; then
        python3 -c "print(int(float('$result') * 1000))" 2>/dev/null || echo "-1"
    else
        echo "-1"
    fi
}

cluster_curl() {
    local cluster=$1
    shift
    docker exec "${cluster}-control-plane" curl -s \
        --http1.1 \
        --no-keepalive \
        -H "Host: ${HOST_HEADER}" \
        -H "Content-Type: application/json" \
        "$@"
}

calc_percentile() {
    local p=$1
    shift
    local -a sorted=("$@")
    local n=${#sorted[@]}
    (( n == 0 )) && echo 0 && return

    local idx
    idx=$(python3 -c "import math; print(max(0, min($n-1, int(math.ceil($p/100.0*$n)-1))))")
    echo "${sorted[idx]}"
}

calc_stddev() {
    local -a values=("$@")
    local n=${#values[@]}
    (( n < 2 )) && echo 0 && return

    python3 -c "
import statistics
vals = [${values[*]}]
print(int(statistics.stdev(vals)))
" 2>/dev/null || echo 0
}

shuffle_array() {
    local -a arr=("$@")
    python3 -c "
import random
arr = '${arr[*]}'.split()
random.shuffle(arr)
print(' '.join(arr))
"
}

declare -a BASELINE_LATENCIES
declare -a SIGNED_LATENCIES
declare -a ENCRYPTED_LATENCIES
declare -a HANDSHAKE_NONE_LATENCIES
declare -a HANDSHAKE_JWS_LATENCIES
declare -a HANDSHAKE_JWE_LATENCIES

test_latency() {
    echo ""
    echo -e "${BLUE}Latency Tests: Baseline vs Signed vs Encrypted${NC}"
    echo ""

    BASELINE_LATENCIES=()
    SIGNED_LATENCIES=()
    ENCRYPTED_LATENCIES=()
    HANDSHAKE_NONE_LATENCIES=()
    HANDSHAKE_JWS_LATENCIES=()
    HANDSHAKE_JWE_LATENCIES=()

    local WARMUP_PAYLOAD="{\"targetDid\": \"$NF_B_DID\", \"service\": \"warmup\", \"action\": \"init\"}"
    local TEST_PAYLOAD="{\"targetDid\": \"$NF_B_DID\", \"service\": \"nudm-sdm\", \"action\": \"am-data\"}"

    for w in $(seq 1 $WARMUP_ITERATIONS); do
        cluster_curl "cluster-a" -X POST "http://$CLUSTER_A_SVC_IP:80/nf/service-request" \
            -H "X-DIDComm-Packing: none" -m 60 -d "$WARMUP_PAYLOAD" >/dev/null 2>&1 || true

        cluster_curl "cluster-a" -X POST "http://$CLUSTER_A_SVC_IP:80/nf/service-request" \
            -H "X-DIDComm-Packing: jws" -m 60 -d "$WARMUP_PAYLOAD" >/dev/null 2>&1 || true

        cluster_curl "cluster-a" -X POST "http://$CLUSTER_A_SVC_IP:80/nf/service-request" \
            -H "X-DIDComm-Packing: authcrypt" -m 60 -d "$WARMUP_PAYLOAD" >/dev/null 2>&1 || true

        sleep 0.5
    done

    echo "Iteration,Baseline_ms,Signed_ms,Encrypted_ms,HS_None_ms,HS_JWS_ms,HS_JWE_ms" > "$LATENCY_CSV"

    for i in $(seq 1 $ITERATIONS); do
        echo -e "${BOLD}Iteration $i/$ITERATIONS${NC}"

        local modes_str
        modes_str=$(shuffle_array baseline signed encrypted hs_none hs_jws hs_jwe)
        local -a shuffled=($modes_str)

        local baseline_latency="NA"
        local signed_latency="NA"
        local encrypted_latency="NA"
        local hs_none_latency="NA"
        local hs_jws_latency="NA"
        local hs_jwe_latency="NA"

        for mode in "${shuffled[@]}"; do
            local latency

            case $mode in
                baseline)
                    latency=$(curl_timed "cluster-a" \
                        "http://$CLUSTER_A_SVC_IP:80/nf/service-request" \
                        "none" \
                        "$TEST_PAYLOAD")

                    if [[ $latency -gt 0 ]]; then
                        echo "  [B] Plain:       ${latency} ms"
                        baseline_latency=$latency
                        BASELINE_LATENCIES+=($latency)
                    else
                        warn "  [B] Plain:       FAILED"
                    fi
                    ;;

                signed)
                    latency=$(curl_timed "cluster-a" \
                        "http://$CLUSTER_A_SVC_IP:80/nf/service-request" \
                        "jws" \
                        "$TEST_PAYLOAD")

                    if [[ $latency -gt 0 ]]; then
                        echo "  [S] Signed:      ${latency} ms"
                        signed_latency=$latency
                        SIGNED_LATENCIES+=($latency)
                    else
                        warn "  [S] Signed:      FAILED"
                    fi
                    ;;

                encrypted)
                    latency=$(curl_timed "cluster-a" \
                        "http://$CLUSTER_A_SVC_IP:80/nf/service-request" \
                        "authcrypt" \
                        "$TEST_PAYLOAD")

                    if [[ $latency -gt 0 ]]; then
                        echo "  [E] Encrypted:   ${latency} ms"
                        encrypted_latency=$latency
                        ENCRYPTED_LATENCIES+=($latency)
                    else
                        warn "  [E] Encrypted:   FAILED"
                    fi
                    ;;

                hs_none)
                    local hs_payload="{\"targetDid\": \"$NF_B_DID\", \"service\": \"handshake\", \"action\": \"vp-auth-none-$i\"}"
                    latency=$(curl_timed "cluster-a" \
                        "http://$CLUSTER_A_SVC_IP:80/nf/service-request" \
                        "none" \
                        "$hs_payload")

                    if [[ $latency -gt 0 ]]; then
                        echo "  [H0] HS None:    ${latency} ms"
                        hs_none_latency=$latency
                        HANDSHAKE_NONE_LATENCIES+=($latency)
                    else
                        warn "  [H0] HS None:    FAILED"
                    fi
                    ;;

                hs_jws)
                    local hs_payload="{\"targetDid\": \"$NF_B_DID\", \"service\": \"handshake\", \"action\": \"vp-auth-jws-$i\"}"
                    latency=$(curl_timed "cluster-a" \
                        "http://$CLUSTER_A_SVC_IP:80/nf/service-request" \
                        "jws" \
                        "$hs_payload")

                    if [[ $latency -gt 0 ]]; then
                        echo "  [H1] HS JWS:     ${latency} ms"
                        hs_jws_latency=$latency
                        HANDSHAKE_JWS_LATENCIES+=($latency)
                    else
                        warn "  [H1] HS JWS:     FAILED"
                    fi
                    ;;

                hs_jwe)
                    local hs_payload="{\"targetDid\": \"$NF_B_DID\", \"service\": \"handshake\", \"action\": \"vp-auth-jwe-$i\"}"
                    latency=$(curl_timed "cluster-a" \
                        "http://$CLUSTER_A_SVC_IP:80/nf/service-request" \
                        "authcrypt" \
                        "$hs_payload")

                    if [[ $latency -gt 0 ]]; then
                        echo "  [H2] HS JWE:     ${latency} ms"
                        hs_jwe_latency=$latency
                        HANDSHAKE_JWE_LATENCIES+=($latency)
                    else
                        warn "  [H2] HS JWE:     FAILED"
                    fi
                    ;;
            esac

            sleep 0.2
        done

        echo "$i,$baseline_latency,$signed_latency,$encrypted_latency,$hs_none_latency,$hs_jws_latency,$hs_jwe_latency" >> "$LATENCY_CSV"

        sleep 0.5
    done
}

test_payload_size() {
    echo ""
    echo -e "${BLUE}Payload Size Tests: Plain vs JWS vs JWE${NC}"
    echo ""

    local test_payload='{"service":"nudm-sdm","action":"am-data","supi":"imsi-001010123456789"}'
    local plain_size=${#test_payload}

    echo "Format,Size_Bytes,Overhead_Bytes,Overhead_Percent,Measured" > "$SIZE_CSV"

    local nf_a_pod
    nf_a_pod=$(kubectl --context "$CLUSTER_A_CONTEXT" get pods -n "$NS_A" \
        -l app=nf-a -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

    echo "Plain,$plain_size,0,0,YES" >> "$SIZE_CSV"
    metric "Plain:     ${plain_size} bytes (baseline)"

    local jws_response
    jws_response=$(kubectl --context "$CLUSTER_A_CONTEXT" exec -n "$NS_A" "$nf_a_pod" -c veramo-sidecar -- \
        curl -s -X POST "http://localhost:3001/debug/pack-message" \
        -H "Content-Type: application/json" \
        -d "{\"targetDid\": \"$NF_B_DID\", \"payload\": $test_payload, \"mode\": \"signed\"}" 2>/dev/null) || true

    local jws_size=0
    local jws_measured="NO"
    if [[ -n "$jws_response" ]] && echo "$jws_response" | grep -q "packed"; then
        jws_size=$(echo "$jws_response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(json.dumps(d.get('packed',{}))))" 2>/dev/null || echo "0")
        if [[ $jws_size -gt 100 ]]; then
            jws_measured="YES"
        fi
    fi

    if [[ "$jws_measured" == "YES" ]]; then
        local jws_overhead=$((jws_size - plain_size))
        local jws_pct=$((100 * jws_overhead / plain_size))
        echo "JWS,$jws_size,$jws_overhead,$jws_pct,YES" >> "$SIZE_CSV"
        metric "JWS:       ${jws_size} bytes (+${jws_overhead}B, +${jws_pct}%)"
    else
        echo "JWS,n/a,n/a,n/a,NO" >> "$SIZE_CSV"
        warn "JWS:       n/a (debug API not available)"
    fi

    local jwe_response
    jwe_response=$(kubectl --context "$CLUSTER_A_CONTEXT" exec -n "$NS_A" "$nf_a_pod" -c veramo-sidecar -- \
        curl -s -X POST "http://localhost:3001/debug/pack-message" \
        -H "Content-Type: application/json" \
        -d "{\"targetDid\": \"$NF_B_DID\", \"payload\": $test_payload, \"mode\": \"encrypted\"}" 2>/dev/null) || true

    local jwe_size=0
    local jwe_measured="NO"
    if [[ -n "$jwe_response" ]] && echo "$jwe_response" | grep -q "packed"; then
        jwe_size=$(echo "$jwe_response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(json.dumps(d.get('packed',{}))))" 2>/dev/null || echo "0")
        if [[ $jwe_size -gt 100 ]]; then
            jwe_measured="YES"
        fi
    fi

    if [[ "$jwe_measured" == "YES" ]]; then
        local jwe_overhead=$((jwe_size - plain_size))
        local jwe_pct=$((100 * jwe_overhead / plain_size))
        echo "JWE,$jwe_size,$jwe_overhead,$jwe_pct,YES" >> "$SIZE_CSV"
        metric "JWE:       ${jwe_size} bytes (+${jwe_overhead}B, +${jwe_pct}%)"
    else
        echo "JWE,n/a,n/a,n/a,NO" >> "$SIZE_CSV"
        warn "JWE:       n/a (debug API not available)"
    fi

    PLAIN_SIZE=$plain_size
    JWS_SIZE=$jws_size
    JWE_SIZE=$jwe_size
    JWS_MEASURED=$jws_measured
    JWE_MEASURED=$jwe_measured
}

test_cpu_usage() {
    echo ""
    echo -e "${BLUE}CPU Usage Tests${NC}"
    echo ""

    echo "Phase,Sample,Pod,Container,CPU_Millicores,Memory_Mi" > "$CPU_CSV"

    local nf_a_pod nf_b_pod
    nf_a_pod=$(kubectl --context "$CLUSTER_A_CONTEXT" get pods -n "$NS_A" \
        -l app=nf-a -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    nf_b_pod=$(kubectl --context "$CLUSTER_B_CONTEXT" get pods -n "$NS_B" \
        -l app=nf-b -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

    local metrics_available=false
    if kubectl --context "$CLUSTER_A_CONTEXT" top pod "$nf_a_pod" -n "$NS_A" --containers 2>/dev/null | grep -q "veramo"; then
        metrics_available=true
    fi

    if [[ "$metrics_available" == "true" ]]; then
        for sample in 1 2 3; do
            echo "  Idle sample $sample/3..."

            kubectl --context "$CLUSTER_A_CONTEXT" top pod "$nf_a_pod" -n "$NS_A" --containers 2>/dev/null | \
                tail -n +2 | while read -r pod container cpu mem; do
                echo "idle,$sample,$pod,$container,${cpu%m},${mem%Mi}" >> "$CPU_CSV"
            done

            kubectl --context "$CLUSTER_B_CONTEXT" top pod "$nf_b_pod" -n "$NS_B" --containers 2>/dev/null | \
                tail -n +2 | while read -r pod container cpu mem; do
                echo "idle,$sample,$pod,$container,${cpu%m},${mem%Mi}" >> "$CPU_CSV"
            done

            sleep 5
        done

        echo -e "${GREEN}[OK]${NC} CPU metrics collected"
        CPU_MEASURED="YES"
    else
        warn "metrics-server not available - SKIPPING CPU measurements"
        CPU_MEASURED="NO"
    fi
}

calculate_all_stats() {
    local -a sorted_baseline sorted_signed sorted_encrypted
    local -a sorted_hs_none sorted_hs_jws sorted_hs_jwe

    IFS=$'\n' sorted_baseline=($(printf '%s\n' "${BASELINE_LATENCIES[@]}" | sort -n)); unset IFS
    IFS=$'\n' sorted_signed=($(printf '%s\n' "${SIGNED_LATENCIES[@]}" | sort -n)); unset IFS
    IFS=$'\n' sorted_encrypted=($(printf '%s\n' "${ENCRYPTED_LATENCIES[@]}" | sort -n)); unset IFS
    IFS=$'\n' sorted_hs_none=($(printf '%s\n' "${HANDSHAKE_NONE_LATENCIES[@]}" | sort -n)); unset IFS
    IFS=$'\n' sorted_hs_jws=($(printf '%s\n' "${HANDSHAKE_JWS_LATENCIES[@]}" | sort -n)); unset IFS
    IFS=$'\n' sorted_hs_jwe=($(printf '%s\n' "${HANDSHAKE_JWE_LATENCIES[@]}" | sort -n)); unset IFS

    BASELINE_N=${#sorted_baseline[@]}
    BASELINE_P50=$(calc_percentile 50 "${sorted_baseline[@]}")
    BASELINE_P95=$(calc_percentile 95 "${sorted_baseline[@]}")
    BASELINE_P99=$(calc_percentile 99 "${sorted_baseline[@]}")
    BASELINE_MIN=${sorted_baseline[0]:-0}
    BASELINE_MAX=${sorted_baseline[$((BASELINE_N-1))]:-0}

    SIGNED_N=${#sorted_signed[@]}
    SIGNED_P50=$(calc_percentile 50 "${sorted_signed[@]}")
    SIGNED_P95=$(calc_percentile 95 "${sorted_signed[@]}")
    SIGNED_P99=$(calc_percentile 99 "${sorted_signed[@]}")
    SIGNED_MIN=${sorted_signed[0]:-0}
    SIGNED_MAX=${sorted_signed[$((SIGNED_N-1))]:-0}

    ENCRYPTED_N=${#sorted_encrypted[@]}
    ENCRYPTED_P50=$(calc_percentile 50 "${sorted_encrypted[@]}")
    ENCRYPTED_P95=$(calc_percentile 95 "${sorted_encrypted[@]}")
    ENCRYPTED_P99=$(calc_percentile 99 "${sorted_encrypted[@]}")
    ENCRYPTED_MIN=${sorted_encrypted[0]:-0}
    ENCRYPTED_MAX=${sorted_encrypted[$((ENCRYPTED_N-1))]:-0}

    HS_NONE_N=${#sorted_hs_none[@]}
    HS_NONE_P50=$(calc_percentile 50 "${sorted_hs_none[@]}")
    HS_NONE_P95=$(calc_percentile 95 "${sorted_hs_none[@]}")
    HS_NONE_P99=$(calc_percentile 99 "${sorted_hs_none[@]}")
    HS_NONE_MIN=${sorted_hs_none[0]:-0}
    HS_NONE_MAX=${sorted_hs_none[$((HS_NONE_N-1))]:-0}

    HS_JWS_N=${#sorted_hs_jws[@]}
    HS_JWS_P50=$(calc_percentile 50 "${sorted_hs_jws[@]}")
    HS_JWS_P95=$(calc_percentile 95 "${sorted_hs_jws[@]}")
    HS_JWS_P99=$(calc_percentile 99 "${sorted_hs_jws[@]}")
    HS_JWS_MIN=${sorted_hs_jws[0]:-0}
    HS_JWS_MAX=${sorted_hs_jws[$((HS_JWS_N-1))]:-0}

    HS_JWE_N=${#sorted_hs_jwe[@]}
    HS_JWE_P50=$(calc_percentile 50 "${sorted_hs_jwe[@]}")
    HS_JWE_P95=$(calc_percentile 95 "${sorted_hs_jwe[@]}")
    HS_JWE_P99=$(calc_percentile 99 "${sorted_hs_jwe[@]}")
    HS_JWE_MIN=${sorted_hs_jwe[0]:-0}
    HS_JWE_MAX=${sorted_hs_jwe[$((HS_JWE_N-1))]:-0}
}

generate_charts() {
    local chart_script="$SCRIPT_DIR/generate-performance-charts.py"

    if [[ -f "$chart_script" ]]; then
        python3 "$chart_script" >/dev/null 2>&1
        if [[ $? -eq 0 ]]; then
            echo -e "${GREEN}[OK]${NC} Charts: $SCRIPT_DIR/results/charts/"
        fi
    fi
}

main() {
    echo ""
    echo -e "${BLUE}Performance Overhead${NC}"
    echo ""

    get_cluster_ips

    test_latency
    calculate_all_stats
    test_payload_size
    test_cpu_usage

    generate_charts
}

main "$@"
