#!/usr/bin/env bash
# =============================================================================
# Run Performance Tests for All Modes (B, V4a, V1)
# Switches DIDCOMM_PACKING_MODE and collects latency data
# =============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

N="${N:-20}"  # iterations per mode
TS="$(date +%Y%m%d-%H%M%S)"
OUT_BASE="${OUT_DIR:-$ROOT_DIR/out/perf/thesis-$TS}"

CTX_A="${CTX_A:-kind-cluster-a}"
CTX_B="${CTX_B:-kind-cluster-b}"
NS_A="${NS_A:-nf-a-namespace}"
NS_B="${NS_B:-nf-b-namespace}"

log() { printf "[%s] %s\n" "$(date +%H:%M:%S)" "$*"; }

switch_mode() {
  local mode="$1"
  local packing

  case "$mode" in
    B)   packing="none" ;;
    V4a) packing="signed" ;;
    V1)  packing="encrypted" ;;
    *)   echo "Unknown mode: $mode"; exit 1 ;;
  esac

  log "Switching to MODE=$mode (packing=$packing)..."

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

run_perf_test() {
  local mode="$1"
  log "Running performance test for MODE=$mode (N=$N iterations)..."

  MODE="$mode" N="$N" OUT_BASE="$OUT_BASE" bash "$SCRIPT_DIR/test-performance.sh"
}

main() {
  mkdir -p "$OUT_BASE"
  log "Performance tests output: $OUT_BASE"
  log "Iterations per mode: $N"

  for mode in B V4a V1; do
    log "========== MODE=$mode =========="
    switch_mode "$mode"
    run_perf_test "$mode"
    log "Completed MODE=$mode"
    echo ""
  done

  log "All performance tests complete!"
  log "Output directory: $OUT_BASE"

  # Generate charts if script exists
  if [[ -f "$SCRIPT_DIR/generate_performance_charts.py" ]]; then
    log "Generating performance charts..."
    python3 "$SCRIPT_DIR/generate_performance_charts.py" "$OUT_BASE"
  fi
}

main "$@"
