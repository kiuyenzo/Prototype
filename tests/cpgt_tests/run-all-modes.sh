#!/usr/bin/env bash
# Run gateway visibility tests for all 3 modes (B, V4a, V1)
# This script switches the DIDCOMM_PACKING_MODE in deployments and reruns tests
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_BASE="${OUT_DIR:-./out/gateway-analysis/thesis-$(date +%Y%m%d-%H%M%S)}"

CTX_A="${CTX_A:-kind-cluster-a}"
CTX_B="${CTX_B:-kind-cluster-b}"
NS_A="${NS_A:-nf-a-namespace}"
NS_B="${NS_B:-nf-b-namespace}"

log() { echo "[$(date +%H:%M:%S)] $*"; }

set_mode() {
  local mode="$1"
  local packing_mode

  case "$mode" in
    B)   packing_mode="none" ;;
    V4a) packing_mode="signed" ;;
    V1)  packing_mode="encrypted" ;;
    *)   echo "Unknown mode: $mode"; exit 1 ;;
  esac

  log "Setting DIDCOMM_PACKING_MODE=$packing_mode for mode $mode..."

  # Patch deployments in both clusters
  kubectl --context "$CTX_A" -n "$NS_A" set env deployment/nf-a DIDCOMM_PACKING_MODE="$packing_mode"
  kubectl --context "$CTX_B" -n "$NS_B" set env deployment/nf-b DIDCOMM_PACKING_MODE="$packing_mode"

  log "Waiting for rollout..."
  kubectl --context "$CTX_A" -n "$NS_A" rollout status deployment/nf-a --timeout=120s
  kubectl --context "$CTX_B" -n "$NS_B" rollout status deployment/nf-b --timeout=120s

  # Give pods time to fully initialize
  sleep 5
  log "Mode $mode ($packing_mode) active."
}

run_test() {
  local mode="$1"
  log "Running gateway visibility test for MODE=$mode..."
  OUT_DIR="$OUT_BASE" MODE="$mode" "$SCRIPT_DIR/test-gateway-visibility.sh"
}

main() {
  mkdir -p "$OUT_BASE"
  log "Output directory: $OUT_BASE"

  for mode in B V4a V1; do
    log "========== MODE: $mode =========="
    set_mode "$mode"
    run_test "$mode"
    echo ""
  done

  log "All modes completed. Generating comparison plots..."
  "$SCRIPT_DIR/run_gateway_plots.sh" "$OUT_BASE"

  log "Done! Results in: $OUT_BASE"
  log "Plots in: $OUT_BASE/plots/"
}

main "$@"
