#!/usr/bin/env bash
# =============================================================================
# Performance Tests (P1-P4) - thesis-ready
#
# Usage:
#   MODE=B ./test-performance.sh       # Run single mode
#   MODE=ALL ./test-performance.sh     # Run ALL modes (B, V4a, V1) automatically
#
# Outputs: CSV + summary + comparison table + plot data
# =============================================================================
set -Eeuo pipefail

# ---------------------------- Config -----------------------------------------
MODE="${MODE:-B}"                       # B | V4a | V1 | ALL
RUN_ALL="${RUN_ALL:-false}"             # Set to true to run all modes
CTX_A="${CTX_A:-kind-cluster-a}"
CTX_B="${CTX_B:-kind-cluster-b}"
NS_A="${NS_A:-nf-a-namespace}"
NS_B="${NS_B:-nf-b-namespace}"
ISTIO_NS="${ISTIO_NS:-istio-system}"

HOST_A="${HOST_A:-veramo-nf-a.nf-a-namespace.svc.cluster.local}"
BASELINE_PATH="${BASELINE_PATH:-/baseline/service}"
VP_PATH="${VP_PATH:-/nf/service-request}"

NUM="${NUM:-10}"                        # iterations (>=10 recommended)
WARMUP="${WARMUP:-3}"                   # warmup iterations
TIMEOUT_FIRST="${TIMEOUT_FIRST:-60}"
TIMEOUT_SUB="${TIMEOUT_SUB:-30}"

CPU_SAMPLE_SECONDS="${CPU_SAMPLE_SECONDS:-15}"
CPU_SAMPLE_INTERVAL="${CPU_SAMPLE_INTERVAL:-1}"

# Output
TS="$(date +%Y%m%d-%H%M%S)"
BASE_OUT="${OUT_BASE:-./out/perf/thesis-$TS}"

# Target DID
NF_B_DID="${NF_B_DID:-did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b}"

# Workload
SERVICE="${SERVICE:-nudm-sdm}"
ACTION="${ACTION:-am-data}"
SUPI="${SUPI:-imsi-262011234567890}"

# ---------------------------- Helpers ----------------------------------------
log() { printf "[%s] %s\n" "$(date +%H:%M:%S)" "$*"; }
die() { printf "[ERROR] %s\n" "$*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || die "Missing dependency: $1"; }

kubectlq(){ kubectl --context "$1" "${@:2}"; }

cluster_curl(){
  local cluster="$1"; shift
  docker exec "${cluster}-control-plane" curl -sS "$@" 2>/dev/null
}

ms_now(){ python3 -c "import time; print(int(time.time()*1000))"; }

json_len(){
  python3 -c "import sys; print(len(sys.stdin.read().encode('utf-8')))"
}

stats_from_csv(){
  local file="$1" col="$2"
  python3 - "$file" "$col" <<'PY'
import csv,sys,statistics,math
path=sys.argv[1]; col=int(sys.argv[2])-1
vals=[]
with open(path,newline="") as f:
  r=csv.reader(f)
  header=next(r,None)
  for row in r:
    try:
      vals.append(float(row[col]))
    except: pass
if not vals:
  print("count=0")
  sys.exit(0)
vals_sorted=sorted(vals)
def p(pct):
  k=(len(vals_sorted)-1)*pct/100
  f=math.floor(k); c=math.ceil(k)
  if f==c: return vals_sorted[int(k)]
  return vals_sorted[f]*(c-k)+vals_sorted[c]*(k-f)
print(f"count={len(vals)} mean={statistics.mean(vals):.2f} median={statistics.median(vals):.2f} p95={p(95):.2f} min={min(vals):.2f} max={max(vals):.2f}")
PY
}

get_gw_ip(){
  kubectlq "$1" -n "$ISTIO_NS" get svc istio-ingressgateway -o jsonpath='{.spec.clusterIP}' 2>/dev/null
}

get_pod(){
  kubectlq "$1" -n "$2" get pod -l "$3" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null
}

# ---------------------------- Mode Switching ---------------------------------
switch_mode(){
  local mode="$1"
  local packing

  case "$mode" in
    B)   packing="none" ;;
    V4a) packing="signed" ;;
    V1)  packing="encrypted" ;;
    *)   die "Unknown mode: $mode" ;;
  esac

  log "Switching to MODE=$mode (DIDCOMM_PACKING_MODE=$packing)..."

  kubectl --context "$CTX_A" -n "$NS_A" set env deployment/nf-a \
    -c veramo-sidecar DIDCOMM_PACKING_MODE="$packing"
  kubectl --context "$CTX_B" -n "$NS_B" set env deployment/nf-b \
    -c veramo-sidecar DIDCOMM_PACKING_MODE="$packing"

  log "Waiting for rollout..."
  kubectl --context "$CTX_A" -n "$NS_A" rollout status deployment/nf-a --timeout=120s
  kubectl --context "$CTX_B" -n "$NS_B" rollout status deployment/nf-b --timeout=120s

  sleep 5
  log "Mode switched to $mode"
}

# ---------------------------- Preconditions ----------------------------------
preflight(){
  need kubectl; need docker; need curl; need python3

  GW_IP_A="$(get_gw_ip "$CTX_A")"
  GW_IP_B="$(get_gw_ip "$CTX_B")"
  [[ -n "${GW_IP_A:-}" ]] || die "Could not get ingressgateway ClusterIP in $CTX_A"
  [[ -n "${GW_IP_B:-}" ]] || die "Could not get ingressgateway ClusterIP in $CTX_B"

  NF_A_POD="$(get_pod "$CTX_A" "$NS_A" "app=nf-a")"
  NF_B_POD="$(get_pod "$CTX_B" "$NS_B" "app=nf-b")"
  [[ -n "${NF_A_POD:-}" ]] || die "Could not find nf-a pod in $CTX_A/$NS_A"
  [[ -n "${NF_B_POD:-}" ]] || die "Could not find nf-b pod in $CTX_B/$NS_B"

  log "MODE=$CURRENT_MODE OUT_DIR=$OUT_DIR"
  log "GW_A=$GW_IP_A HOST_A=$HOST_A"
}

# ---------------------------- Request builders --------------------------------
payload_json(){
  cat <<EOF
{
  "targetDid": "$NF_B_DID",
  "service": "$SERVICE",
  "action": "$ACTION",
  "params": { "supi": "$SUPI" }
}
EOF
}

call_endpoint(){
  local path="$1" timeout_s="$2" tag="$3"
  local body; body="$(payload_json)"
  printf "%s" "$body" >"$OUT_DIR/req-$tag.json"
  cluster_curl "cluster-a" \
    -X POST "http://$GW_IP_A:80$path" \
    -H "Content-Type: application/json" \
    -H "Host: $HOST_A" \
    -m "$timeout_s" \
    -d "$body"
}

# =============================================================================
# P1: Estimated Handshake Overhead
# =============================================================================
p1_handshake_estimate(){
  log "P1: estimated handshake overhead (first vs subsequent) ..."
  local csv="$OUT_DIR/p1_handshake.csv"
  echo "iteration,first_ms,sub_ms,est_handshake_ms" >"$csv"

  for i in $(seq 1 "$WARMUP"); do
    call_endpoint "$VP_PATH" "$TIMEOUT_FIRST" "warmup-$i" >/dev/null || true
    sleep 0.3
  done

  for i in $(seq 1 "$NUM"); do
    local t0 t1 first_ms sub_ms est

    t0="$(ms_now)"
    call_endpoint "$VP_PATH" "$TIMEOUT_FIRST" "p1-$i-first" >"$OUT_DIR/resp-p1-$i-first.json" || true
    t1="$(ms_now)"
    first_ms=$((t1-t0))

    sleep 0.3

    t0="$(ms_now)"
    call_endpoint "$VP_PATH" "$TIMEOUT_SUB" "p1-$i-sub" >"$OUT_DIR/resp-p1-$i-sub.json" || true
    t1="$(ms_now)"
    sub_ms=$((t1-t0))

    est=$(( first_ms - sub_ms ))
    (( est < 0 )) && est=0
    echo "$i,$first_ms,$sub_ms,$est" >>"$csv"
    sleep 0.5
  done

  log "P1 stats: $(stats_from_csv "$csv" 4)"
}

# =============================================================================
# P2: E2E Latency (baseline vs vp_first vs vp_sub)
# =============================================================================
p2_e2e_latency(){
  log "P2: E2E latency baseline vs VP ..."
  local csv="$OUT_DIR/p2_latency.csv"
  echo "iteration,variant,latency_ms" >"$csv"

  for i in $(seq 1 "$NUM"); do
    local t0 t1 ms

    # Baseline
    t0="$(ms_now)"
    call_endpoint "$BASELINE_PATH" "$TIMEOUT_SUB" "p2-$i-baseline" >"$OUT_DIR/resp-p2-$i-baseline.json" || true
    t1="$(ms_now)"; ms=$((t1-t0))
    echo "$i,baseline,$ms" >>"$csv"
    sleep 0.2

    # VP first
    t0="$(ms_now)"
    call_endpoint "$VP_PATH" "$TIMEOUT_FIRST" "p2-$i-vp-first" >"$OUT_DIR/resp-p2-$i-vp-first.json" || true
    t1="$(ms_now)"; ms=$((t1-t0))
    echo "$i,vp_first,$ms" >>"$csv"
    sleep 0.2

    # VP subsequent
    t0="$(ms_now)"
    call_endpoint "$VP_PATH" "$TIMEOUT_SUB" "p2-$i-vp-sub" >"$OUT_DIR/resp-p2-$i-vp-sub.json" || true
    t1="$(ms_now)"; ms=$((t1-t0))
    echo "$i,vp_sub,$ms" >>"$csv"
    sleep 0.6
  done
}

# =============================================================================
# P3: Payload size
# =============================================================================
p3_payload_sizes(){
  log "P3: payload sizes ..."
  local csv="$OUT_DIR/p3_payload.csv"
  echo "variant,request_bytes,response_bytes" >"$csv"

  local req; req="$(payload_json)"
  local req_bytes; req_bytes="$(printf "%s" "$req" | json_len)"

  local resp_b; resp_b="$(call_endpoint "$BASELINE_PATH" "$TIMEOUT_SUB" "p3-baseline" || true)"
  printf "%s" "$resp_b" >"$OUT_DIR/resp-p3-baseline.json"
  local resp_b_bytes; resp_b_bytes="$(printf "%s" "$resp_b" | json_len)"

  local resp_v; resp_v="$(call_endpoint "$VP_PATH" "$TIMEOUT_FIRST" "p3-vp" || true)"
  printf "%s" "$resp_v" >"$OUT_DIR/resp-p3-vp.json"
  local resp_v_bytes; resp_v_bytes="$(printf "%s" "$resp_v" | json_len)"

  echo "baseline,$req_bytes,$resp_b_bytes" >>"$csv"
  echo "vp,$req_bytes,$resp_v_bytes" >>"$csv"

  log "P3: req=$req_bytes baseline_resp=$resp_b_bytes vp_resp=$resp_v_bytes"
}

# =============================================================================
# P4: CPU sampling
# =============================================================================
p4_cpu_sampling(){
  log "P4: CPU sampling for ${CPU_SAMPLE_SECONDS}s ..."
  local csv="$OUT_DIR/p4_cpu.csv"
  echo "ts,pod,container,cpu_m,mem_mi" >"$csv"

  local end=$(( $(date +%s) + CPU_SAMPLE_SECONDS ))
  while [ "$(date +%s)" -lt "$end" ]; do
    local ts="$(date +%s)"
    local out_a out_b

    out_a="$(kubectlq "$CTX_A" -n "$NS_A" top pod "$NF_A_POD" --containers 2>/dev/null || true)"
    out_b="$(kubectlq "$CTX_B" -n "$NS_B" top pod "$NF_B_POD" --containers 2>/dev/null || true)"

    if [[ -n "$out_a" ]]; then
      echo "$out_a" | tail -n +2 | awk -v ts="$ts" 'NF>=4{gsub(/m/,"",$3); gsub(/Mi/,"",$4); print ts","$1","$2","$3","$4}' >>"$csv" || true
    fi
    if [[ -n "$out_b" ]]; then
      echo "$out_b" | tail -n +2 | awk -v ts="$ts" 'NF>=4{gsub(/m/,"",$3); gsub(/Mi/,"",$4); print ts","$1","$2","$3","$4}' >>"$csv" || true
    fi

    sleep "$CPU_SAMPLE_INTERVAL"
  done
}

# =============================================================================
# Run single mode tests
# =============================================================================
run_single_mode(){
  local mode="$1"
  CURRENT_MODE="$mode"
  OUT_DIR="$BASE_OUT/$mode"
  mkdir -p "$OUT_DIR"

  preflight

  log "Warmup..."
  for i in $(seq 1 "$WARMUP"); do
    call_endpoint "$VP_PATH" "$TIMEOUT_FIRST" "warmup-$i" >/dev/null || true
  done

  p1_handshake_estimate
  p2_e2e_latency
  p3_payload_sizes

  # Load burst before CPU sampling
  log "Load burst..."
  for j in $(seq 1 5); do
    (call_endpoint "$VP_PATH" "$TIMEOUT_FIRST" "load-$j" >/dev/null || true) &
  done
  wait || true

  p4_cpu_sampling

  log "Mode $mode complete: $OUT_DIR"
}

# =============================================================================
# Generate Comparison Table & Plot Data
# =============================================================================
generate_comparison(){
  log "Generating comparison table and plot data..."

  local compare_csv="$BASE_OUT/comparison_table.csv"
  local plot_csv="$BASE_OUT/plot_data.csv"

  # Comparison table header
  echo "mode,metric,variant,mean,median,p95,min,max,n" >"$compare_csv"

  # Plot data header (for boxplots/bar charts)
  echo "mode,kind,latency_ms" >"$plot_csv"

  for mode in B V4a V1; do
    local mode_dir="$BASE_OUT/$mode"
    [[ -d "$mode_dir" ]] || continue

    # Extract P2 latency stats per variant
    if [[ -f "$mode_dir/p2_latency.csv" ]]; then
      python3 - "$mode_dir/p2_latency.csv" "$mode" "$compare_csv" "$plot_csv" <<'PY'
import csv, sys, statistics, math
from collections import defaultdict

csv_file = sys.argv[1]
mode = sys.argv[2]
compare_csv = sys.argv[3]
plot_csv = sys.argv[4]

data = defaultdict(list)
with open(csv_file) as f:
    reader = csv.DictReader(f)
    for row in reader:
        variant = row['variant']
        latency = float(row['latency_ms'])
        data[variant].append(latency)

def pct(vals, p):
    vals = sorted(vals)
    k = (len(vals)-1) * p / 100
    f, c = int(k), min(int(k)+1, len(vals)-1)
    return vals[f] * (c-k) + vals[c] * (k-f) if f != c else vals[int(k)]

# Write to comparison CSV
with open(compare_csv, 'a') as f:
    for variant, vals in data.items():
        if not vals:
            continue
        mean = statistics.mean(vals)
        median = statistics.median(vals)
        p95 = pct(vals, 95)
        minv, maxv = min(vals), max(vals)
        f.write(f"{mode},P2_latency,{variant},{mean:.2f},{median:.2f},{p95:.2f},{minv:.2f},{maxv:.2f},{len(vals)}\n")

# Write to plot CSV
with open(plot_csv, 'a') as f:
    for variant, vals in data.items():
        # Map variant names for plotting
        if variant == 'baseline':
            kind = 'baseline'
        elif variant == 'vp_first':
            kind = 'first'
        elif variant == 'vp_sub':
            kind = 'reuse'
        else:
            kind = variant
        for v in vals:
            f.write(f"{mode},{kind},{v:.0f}\n")
PY
    fi

    # Extract P1 handshake stats
    if [[ -f "$mode_dir/p1_handshake.csv" ]]; then
      python3 - "$mode_dir/p1_handshake.csv" "$mode" "$compare_csv" <<'PY'
import csv, sys, statistics
csv_file = sys.argv[1]
mode = sys.argv[2]
compare_csv = sys.argv[3]

vals = []
with open(csv_file) as f:
    reader = csv.DictReader(f)
    for row in reader:
        vals.append(float(row['est_handshake_ms']))

if vals:
    vals = sorted(vals)
    mean = statistics.mean(vals)
    median = statistics.median(vals)
    p95 = vals[int((len(vals)-1)*0.95)]
    with open(compare_csv, 'a') as f:
        f.write(f"{mode},P1_handshake,estimated,{mean:.2f},{median:.2f},{p95:.2f},{min(vals):.2f},{max(vals):.2f},{len(vals)}\n")
PY
    fi
  done

  log "Comparison table: $compare_csv"
  log "Plot data: $plot_csv"
}

# =============================================================================
# Generate Charts
# =============================================================================
generate_charts(){
  log "Generating charts..."

  local plot_csv="$BASE_OUT/plot_data.csv"
  local plots_dir="$BASE_OUT/plots"
  mkdir -p "$plots_dir"

  [[ -f "$plot_csv" ]] || { log "No plot data found"; return 0; }

  python3 - "$plot_csv" "$plots_dir" "$BASE_OUT/comparison_table.csv" <<'PYSCRIPT'
import csv
import sys
from pathlib import Path
from collections import defaultdict
import matplotlib.pyplot as plt
import numpy as np

plot_csv = Path(sys.argv[1])
plots_dir = Path(sys.argv[2])
compare_csv = Path(sys.argv[3])

COLORS = {'B': '#E74C3C', 'V4a': '#F39C12', 'V1': '#27AE60'}
MODE_LABELS = {'B': 'Baseline B\n(no DIDComm)', 'V4a': 'V4a\n(DIDComm JWS)', 'V1': 'V1\n(DIDComm JWE)'}

# Load data
data = defaultdict(lambda: defaultdict(list))
with open(plot_csv) as f:
    reader = csv.DictReader(f)
    for row in reader:
        mode = row['mode']
        kind = row['kind']
        latency = float(row['latency_ms'])
        data[mode][kind].append(latency)

# 1. Boxplot
fig, ax = plt.subplots(figsize=(14, 6))
plot_data = []
labels = []
colors = []

for mode in ['B', 'V4a', 'V1']:
    if mode not in data:
        continue
    mode_data = data[mode]
    if mode == 'B':
        if 'baseline' in mode_data:
            plot_data.append(mode_data['baseline'])
            labels.append(f'B\n(baseline)')
            colors.append(COLORS['B'])
    else:
        if 'first' in mode_data:
            plot_data.append(mode_data['first'])
            labels.append(f'{mode}\n(first)')
            colors.append(COLORS[mode])
        if 'reuse' in mode_data:
            plot_data.append(mode_data['reuse'])
            labels.append(f'{mode}\n(reuse)')
            colors.append(COLORS[mode])

if plot_data:
    bp = ax.boxplot(plot_data, labels=labels, patch_artist=True)
    for patch, color in zip(bp['boxes'], colors):
        patch.set_facecolor(color)
        patch.set_alpha(0.7)
    ax.set_ylabel('Latency (ms)', fontsize=11)
    ax.set_xlabel('Mode / Call Type', fontsize=11)
    ax.set_title('Request Latency Distribution by Mode\n(P2: E2E Latency)', fontsize=12, fontweight='bold')
    ax.grid(axis='y', alpha=0.3)

    # Add stats
    for i, d in enumerate(plot_data):
        mean = np.mean(d)
        p95 = sorted(d)[int((len(d)-1)*0.95)] if d else 0
        ax.annotate(f'μ={mean:.0f}ms\np95={p95:.0f}ms',
                   xy=(i+1, max(d) if d else 0),
                   xytext=(0, 10),
                   textcoords='offset points',
                   ha='center', fontsize=8,
                   bbox=dict(boxstyle='round', facecolor='white', alpha=0.8))

    plt.tight_layout()
    plt.savefig(plots_dir / 'latency_boxplot.png', dpi=200, bbox_inches='tight')
    plt.close()
    print("[OK] latency_boxplot.png")

# 2. Mean comparison bar chart
fig, axes = plt.subplots(1, 2, figsize=(14, 5))

modes = [m for m in ['B', 'V4a', 'V1'] if m in data]
if modes:
    # Left: Overall mean
    ax1 = axes[0]
    means = []
    for mode in modes:
        all_lat = []
        for kind, vals in data[mode].items():
            all_lat.extend(vals)
        means.append(np.mean(all_lat) if all_lat else 0)

    x = np.arange(len(modes))
    bars = ax1.bar(x, means, color=[COLORS[m] for m in modes], alpha=0.85)
    ax1.set_ylabel('Mean Latency (ms)', fontsize=11)
    ax1.set_title('Mean Request Latency by Mode', fontsize=12, fontweight='bold')
    ax1.set_xticks(x)
    ax1.set_xticklabels([MODE_LABELS[m] for m in modes], fontsize=9)

    for bar, val in zip(bars, means):
        ax1.annotate(f'{val:.0f}ms',
                    xy=(bar.get_x() + bar.get_width()/2, bar.get_height()),
                    xytext=(0, 5), textcoords='offset points',
                    ha='center', fontsize=10, fontweight='bold')

    # Right: First vs Reuse
    ax2 = axes[1]
    width = 0.35
    first_means = []
    reuse_means = []

    for mode in modes:
        if mode == 'B':
            first_means.append(np.mean(data[mode].get('baseline', [0])))
            reuse_means.append(np.mean(data[mode].get('baseline', [0])))
        else:
            first_means.append(np.mean(data[mode].get('first', [0])))
            reuse_means.append(np.mean(data[mode].get('reuse', [0])))

    bars1 = ax2.bar(x - width/2, first_means, width, label='First Request',
                    color=[COLORS[m] for m in modes], alpha=0.9)
    bars2 = ax2.bar(x + width/2, reuse_means, width, label='Subsequent (Reuse)',
                    color=[COLORS[m] for m in modes], alpha=0.5, hatch='//')

    ax2.set_ylabel('Mean Latency (ms)', fontsize=11)
    ax2.set_title('First vs Subsequent Request Latency', fontsize=12, fontweight='bold')
    ax2.set_xticks(x)
    ax2.set_xticklabels([MODE_LABELS[m] for m in modes], fontsize=9)
    ax2.legend()

    for bars in [bars1, bars2]:
        for bar in bars:
            height = bar.get_height()
            ax2.annotate(f'{height:.0f}',
                        xy=(bar.get_x() + bar.get_width()/2, height),
                        xytext=(0, 3), textcoords='offset points',
                        ha='center', fontsize=9)

    plt.tight_layout()
    plt.savefig(plots_dir / 'latency_comparison.png', dpi=200, bbox_inches='tight')
    plt.close()
    print("[OK] latency_comparison.png")

# 3. Overhead analysis
if 'B' in data and (data['B'].get('baseline') or data['B'].get('first')):
    fig, ax = plt.subplots(figsize=(10, 6))

    baseline_mean = np.mean(data['B'].get('baseline', data['B'].get('first', [1])))

    vp_modes = [m for m in ['V4a', 'V1'] if m in data]
    if vp_modes:
        x = np.arange(len(vp_modes))
        width = 0.35

        first_overhead = []
        reuse_overhead = []

        for mode in vp_modes:
            first_mean = np.mean(data[mode].get('first', [0]))
            reuse_mean = np.mean(data[mode].get('reuse', [0]))
            first_overhead.append(((first_mean - baseline_mean) / baseline_mean) * 100 if baseline_mean > 0 else 0)
            reuse_overhead.append(((reuse_mean - baseline_mean) / baseline_mean) * 100 if baseline_mean > 0 else 0)

        bars1 = ax.bar(x - width/2, first_overhead, width, label='First Request Overhead',
                       color=[COLORS[m] for m in vp_modes], alpha=0.9)
        bars2 = ax.bar(x + width/2, reuse_overhead, width, label='Subsequent Request Overhead',
                       color=[COLORS[m] for m in vp_modes], alpha=0.5, hatch='//')

        ax.set_ylabel('Overhead vs Baseline (%)', fontsize=11)
        ax.set_title(f'DIDComm Latency Overhead vs Baseline\n(Baseline mean: {baseline_mean:.0f}ms)',
                     fontsize=12, fontweight='bold')
        ax.set_xticks(x)
        ax.set_xticklabels([MODE_LABELS[m] for m in vp_modes], fontsize=10)
        ax.legend()
        ax.axhline(y=0, color='gray', linestyle='--', alpha=0.5)

        for bars in [bars1, bars2]:
            for bar in bars:
                height = bar.get_height()
                ax.annotate(f'{height:+.1f}%',
                           xy=(bar.get_x() + bar.get_width()/2, height),
                           xytext=(0, 5 if height >= 0 else -15),
                           textcoords='offset points',
                           ha='center', fontsize=10, fontweight='bold')

        plt.tight_layout()
        plt.savefig(plots_dir / 'overhead_analysis.png', dpi=200, bbox_inches='tight')
        plt.close()
        print("[OK] overhead_analysis.png")

# 4. Generate stats CSV
stats_csv = plots_dir / 'latency_stats.csv'
with open(stats_csv, 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['mode', 'kind', 'n', 'mean_ms', 'median_ms', 'p95_ms', 'min_ms', 'max_ms'])

    for mode in ['B', 'V4a', 'V1']:
        if mode not in data:
            continue
        for kind, vals in data[mode].items():
            if not vals:
                continue
            vals = sorted(vals)
            n = len(vals)
            mean = np.mean(vals)
            median = np.median(vals)
            p95 = vals[int((n-1)*0.95)]
            writer.writerow([mode, kind, n, f'{mean:.1f}', f'{median:.1f}', f'{p95:.0f}', f'{min(vals):.0f}', f'{max(vals):.0f}'])

print("[OK] latency_stats.csv")
print(f"\nCharts saved to: {plots_dir}")
PYSCRIPT
}

# =============================================================================
# Print Final Summary
# =============================================================================
print_summary(){
  log "=============================================="
  log "PERFORMANCE TEST SUMMARY"
  log "=============================================="

  echo ""
  echo "Output directory: $BASE_OUT"
  echo ""

  if [[ -f "$BASE_OUT/comparison_table.csv" ]]; then
    echo "=== Comparison Table ==="
    cat "$BASE_OUT/comparison_table.csv" | column -t -s','
    echo ""
  fi

  if [[ -f "$BASE_OUT/plots/latency_stats.csv" ]]; then
    echo "=== Latency Statistics ==="
    cat "$BASE_OUT/plots/latency_stats.csv" | column -t -s','
    echo ""
  fi

  echo "=== Generated Files ==="
  find "$BASE_OUT" -type f \( -name "*.csv" -o -name "*.png" \) | sort
  echo ""

  log "Done!"
}

# =============================================================================
# Main
# =============================================================================
main(){
  mkdir -p "$BASE_OUT"

  if [[ "$MODE" == "ALL" || "$RUN_ALL" == "true" ]]; then
    log "Running ALL modes (B, V4a, V1)..."
    log "Output base: $BASE_OUT"
    echo ""

    for mode in B V4a V1; do
      log "=========================================="
      log "MODE=$mode"
      log "=========================================="
      switch_mode "$mode"
      run_single_mode "$mode"
      echo ""
    done

    generate_comparison
    generate_charts
    print_summary
  else
    # Single mode
    CURRENT_MODE="$MODE"
    OUT_DIR="$BASE_OUT/$MODE"
    mkdir -p "$OUT_DIR"

    run_single_mode "$MODE"

    # Generate comparison if multiple modes exist
    local mode_count=0
    for m in B V4a V1; do
      [[ -d "$BASE_OUT/$m" ]] && mode_count=$((mode_count+1))
    done

    if [[ $mode_count -gt 1 ]]; then
      generate_comparison
      generate_charts
    fi

    log "Done: $OUT_DIR"
  fi
}

main "$@"
