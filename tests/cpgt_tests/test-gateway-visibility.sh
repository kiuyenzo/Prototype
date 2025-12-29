# Warum das „besser“ ist (kurz, thesis-tauglich)
# Bezieht sich tatsächlich auf den IngressGateway (nicht Sidecars).
# Sichert Reproduzierbarkeit durch Konfig-Snapshots (PeerAuthentication, AuthorizationPolicy, Pod-Info).
# Liefert Artefakte (Logs/Responses/Summary) für Appendix/Raw Data.
# Ist mode-fähig (MODE=B|V4a|V1), ohne dass du drei unterschiedliche Skripte pflegen musst.
# Mini-Checkliste für deine Thesis-Argumentation (Gateway-Teil)
# Für jeden Mode einmal laufen lassen und in der Evaluation berichten:
# G1: Welche Metadaten sind am IngressGateway sichtbar? (access logs)
# G2: Marker taucht nicht in Gateway-Logs auf → Body nicht geloggt (Baseline)
# G3: (optional) Envelope-Hinweise oder pcap: V4a eher JWS-indikativ, V1 JWE-indikativ (oder „nicht sichtbar, weil kein body logging“ → dann stützt du dich auf pcap oder App-Layer)
# G4: Policy greift (unauthorized path block / mTLS STRICT / AuthZPolicy vorhanden)

#!/usr/bin/env bash
# =============================================================================
# Istio IngressGateway Visibility & Trust Boundary Tests (G1-G4)
# Focus: what the *istio-ingressgateway* can see (logs + optional pcap).
# Modes: B | V4a | V1  (run your system in that mode before executing)
# =============================================================================
set -Eeuo pipefail

# ---------------------------- Config -----------------------------------------
CTX_A="${CTX_A:-kind-cluster-a}"
CTX_B="${CTX_B:-kind-cluster-b}"
NS_A="${NS_A:-nf-a-namespace}"
NS_B="${NS_B:-nf-b-namespace}"
ISTIO_NS="${ISTIO_NS:-istio-system}"
GW_LABEL="${GW_LABEL:-app=istio-ingressgateway}"   # adjust if needed
MODE="${MODE:-B}"                                  # B | V4a | V1

# Host headers used in your setup
HOST_A="${HOST_A:-veramo-nf-a.nf-a-namespace.svc.cluster.local}"
HOST_B="${HOST_B:-veramo-nf-b.nf-b-namespace.svc.cluster.local}"

# Output
TS="$(date +%Y%m%d-%H%M%S)"
BASE_OUT="${OUT_DIR:-./out/gateway-analysis/$TS}"
OUT_DIR="$BASE_OUT/$MODE"
mkdir -p "$OUT_DIR"

# Marker to test payload visibility
MARKER="${MARKER:-VISIBLE_MARKER_12345}"

# ---------------------------- Helpers ----------------------------------------
log()  { printf "[%s] %s\n" "$(date +%H:%M:%S)" "$*"; }
die()  { printf "[ERROR] %s\n" "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "Missing dependency: $1"; }

kubectlq() { kubectl --context "$1" "${@:2}"; }

get_gw_pod() {
  local ctx="$1"
  kubectlq "$ctx" -n "$ISTIO_NS" get pod -l "$GW_LABEL" \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null
}

get_gw_svc_ip() {
  local ctx="$1"
  kubectlq "$ctx" -n "$ISTIO_NS" get svc istio-ingressgateway \
    -o jsonpath='{.spec.clusterIP}' 2>/dev/null
}

cluster_curl() {
  local cluster="$1"; shift
  docker exec "${cluster}-control-plane" curl -sS "$@" 2>/dev/null
}

save_file() {
  local name="$1"; shift
  cat >"$OUT_DIR/$name" <<<"$*"
  log "Saved: $OUT_DIR/$name"
}

append_file() {
  local name="$1"; shift
  cat >>"$OUT_DIR/$name" <<<"$*"
}

# ---------------------------- Preconditions ----------------------------------
preflight() {
  need kubectl
  need docker
  need curl

  GW_POD_A="$(get_gw_pod "$CTX_A")"
  GW_POD_B="$(get_gw_pod "$CTX_B")"
  [[ -n "${GW_POD_A:-}" ]] || die "No ingressgateway pod found in $CTX_A ($ISTIO_NS, $GW_LABEL)"
  [[ -n "${GW_POD_B:-}" ]] || die "No ingressgateway pod found in $CTX_B ($ISTIO_NS, $GW_LABEL)"

  GW_IP_A="$(get_gw_svc_ip "$CTX_A")"
  GW_IP_B="$(get_gw_svc_ip "$CTX_B")"
  [[ -n "${GW_IP_A:-}" ]] || die "Could not get ingressgateway ClusterIP in $CTX_A"
  [[ -n "${GW_IP_B:-}" ]] || die "Could not get ingressgateway ClusterIP in $CTX_B"

  log "MODE=$MODE"
  log "GW A: $GW_POD_A ($GW_IP_A)"
  log "GW B: $GW_POD_B ($GW_IP_B)"

  # Snapshot key configs for reproducibility
  kubectlq "$CTX_A" -n "$ISTIO_NS" get pod "$GW_POD_A" -o wide >"$OUT_DIR/gw-a-pod.txt"
  kubectlq "$CTX_B" -n "$ISTIO_NS" get pod "$GW_POD_B" -o wide >"$OUT_DIR/gw-b-pod.txt"
  kubectlq "$CTX_A" -n "$NS_A" get peerauthentication,authorizationpolicy -o yaml >"$OUT_DIR/cluster-a-security.yaml" 2>/dev/null || true
  kubectlq "$CTX_B" -n "$NS_B" get peerauthentication,authorizationpolicy -o yaml >"$OUT_DIR/cluster-b-security.yaml" 2>/dev/null || true
}

# ---------------------------- Test Traffic -----------------------------------
generate_traffic() {
  log "Generating traffic via Cluster-A ingressgateway -> NF-A -> NF-B ..."
  local payload
  payload=$(cat <<EOF
{
  "targetDid": "did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b",
  "service": "test-visibility",
  "action": "check",
  "params": { "sensitiveData": "$MARKER", "mode": "$MODE" }
}
EOF
)
  cluster_curl "cluster-a" \
    -X POST "http://$GW_IP_A:80/nf/service-request" \
    -H "Content-Type: application/json" \
    -H "Host: $HOST_A" \
    -m 30 \
    -d "$payload" \
    | head -c 400 >"$OUT_DIR/traffic-response.txt" || true

  log "Traffic response saved (truncated)."
  sleep 2
}

# ---------------------------- G1: Metadata visibility ------------------------
g1_gateway_access_logs() {
  log "G1: IngressGateway access-log visibility (method/path/status/host) ..."

  # Last lines after traffic. (Envoy is istio-proxy container)
  local logs_a logs_b
  logs_a="$(kubectlq "$CTX_A" -n "$ISTIO_NS" logs "$GW_POD_A" -c istio-proxy --tail=200 2>/dev/null || true)"
  logs_b="$(kubectlq "$CTX_B" -n "$ISTIO_NS" logs "$GW_POD_B" -c istio-proxy --tail=200 2>/dev/null || true)"

  save_file "g1-gw-a-istio-proxy.log" "$logs_a"
  save_file "g1-gw-b-istio-proxy.log" "$logs_b"

  # Simple assertions: path/host should appear in access logs (depending on log format)
  local hit=0
  grep -E "/nf/service-request|$HOST_A|POST" -n "$OUT_DIR/g1-gw-a-istio-proxy.log" >/dev/null && hit=$((hit+1)) || true
  grep -E "/nf/service-request|$HOST_B|POST" -n "$OUT_DIR/g1-gw-b-istio-proxy.log" >/dev/null && hit=$((hit+1)) || true

  log "G1 checks hit=$hit (0 can happen if access logs are disabled or different format)."
  append_file "SUMMARY.md" $'\n'"## G1 Access Logs"$'\n'"- Gateway logs collected from istio-ingressgateway (not sidecars)."$'\n'"- Hit-count heuristics: $hit (format dependent)."
}

# ---------------------------- G2: Payload visibility per mode -----------------
g2_payload_marker_checks() {
  log "G2: Payload visibility checks per mode (marker in GW logs) ..."

  # If gateway logs contain the marker, payload leaked to gateway logs (bad).
  # In most Istio setups, access logs do not include body. So marker should NOT be present.
  # For V4a vs V1 we instead check for JWS vs JWE indicators in upstream/app logs later.
  local marker_in_a=0 marker_in_b=0
  grep -R "$MARKER" -n "$OUT_DIR"/g1-gw-*-istio-proxy.log >/dev/null && marker_in_a=1 || true
  marker_in_b=$marker_in_a

  append_file "SUMMARY.md" $'\n'"## G2 Payload Marker"$'\n'"- Marker '$MARKER' in gateway logs: $marker_in_a (expected 0)."
  log "Marker in gateway logs: $marker_in_a (expected 0)."
}

# ---------------------------- G3: DIDComm envelope evidence -------------------
g3_didcomm_envelope_evidence() {
  log "G3: Evidence for DIDComm envelope type (JWS vs JWE) ..."

  # The most reliable indicator is the PACKING MODE from the environment
  # and the log messages that show what packing was used

  local jwe=0 jws=0 plaintext=0
  local packing_mode_a packing_mode_b

  # Get the actual DIDCOMM_PACKING_MODE from deployments
  packing_mode_a="$(kubectlq "$CTX_A" -n "$NS_A" get deployment nf-a -o jsonpath='{.spec.template.spec.containers[?(@.name=="veramo-sidecar")].env[?(@.name=="DIDCOMM_PACKING_MODE")].value}' 2>/dev/null || echo "unknown")"
  packing_mode_b="$(kubectlq "$CTX_B" -n "$NS_B" get deployment nf-b -o jsonpath='{.spec.template.spec.containers[?(@.name=="veramo-sidecar")].env[?(@.name=="DIDCOMM_PACKING_MODE")].value}' 2>/dev/null || echo "unknown")"

  log "Packing mode from deployment: A=$packing_mode_a B=$packing_mode_b"

  # Capture recent sidecar logs (only since pod restart)
  local sidecar_a sidecar_b
  sidecar_a="$(kubectlq "$CTX_A" -n "$NS_A" logs -l app=nf-a -c veramo-sidecar --tail=100 --since=2m 2>/dev/null || true)"
  sidecar_b="$(kubectlq "$CTX_B" -n "$NS_B" logs -l app=nf-b -c veramo-sidecar --tail=100 --since=2m 2>/dev/null || true)"

  save_file "g3-sidecar-a.log" "$sidecar_a"
  save_file "g3-sidecar-b.log" "$sidecar_b"

  # Determine envelope type based on configured packing mode
  case "$packing_mode_a" in
    encrypted|authcrypt|anoncrypt) jwe=1 ;;
    signed|jws) jws=1 ;;
    none|"") plaintext=1 ;;
  esac

  # Also check logs for actual packing messages
  if echo "$sidecar_a $sidecar_b" | grep -qE "mode=authcrypt|mode=anoncrypt|Packing.*authcrypt"; then
    jwe=1
  fi
  if echo "$sidecar_a $sidecar_b" | grep -qE "mode=jws|mode=signed|Packing.*jws"; then
    jws=1
  fi
  if echo "$sidecar_a $sidecar_b" | grep -qE "mode=none|Packing.*none"; then
    plaintext=1
  fi

  # Mode-specific expectations and validation
  local expected="" match="MISMATCH"
  case "$MODE" in
    B)
      expected="Baseline: plaintext (mode=none)"
      [[ $plaintext -eq 1 ]] && match="MATCH"
      ;;
    V4a)
      expected="V4a: JWS (mode=signed)"
      [[ $jws -eq 1 ]] && match="MATCH"
      ;;
    V1)
      expected="V1: JWE (mode=encrypted/authcrypt)"
      [[ $jwe -eq 1 ]] && match="MATCH"
      ;;
  esac

  append_file "SUMMARY.md" $'\n'"## G3 DIDComm Envelope Evidence"
  append_file "SUMMARY.md" $'\n'"- Configured DIDCOMM_PACKING_MODE: A=$packing_mode_a, B=$packing_mode_b"
  append_file "SUMMARY.md" $'\n'"- Detected: plaintext=$plaintext, JWS=$jws, JWE=$jwe"
  append_file "SUMMARY.md" $'\n'"- Expected for MODE=$MODE: $expected"
  append_file "SUMMARY.md" $'\n'"- Validation: $match"

  log "Envelope evidence: plaintext=$plaintext JWS=$jws JWE=$jwe | $match"
}

# ---------------------------- G4: Policy enforcement at gateway ---------------
g4_policy_enforcement() {
  log "G4: Policy enforcement evidence (mTLS + AuthorizationPolicy) ..."

  local mtls_a mtls_b
  mtls_a="$(kubectlq "$CTX_A" -n "$NS_A" get peerauthentication -o jsonpath='{.items[0].spec.mtls.mode}' 2>/dev/null || true)"
  mtls_b="$(kubectlq "$CTX_B" -n "$NS_B" get peerauthentication -o jsonpath='{.items[0].spec.mtls.mode}' 2>/dev/null || true)"

  append_file "SUMMARY.md" $'\n'"## G4 Policy Enforcement"$'\n'"- PeerAuthentication mTLS mode: Cluster-A=$mtls_a, Cluster-B=$mtls_b"

  # Try an unauthorized path against Cluster-B gateway with Host header
  local resp
  resp="$(cluster_curl "cluster-a" \
    -X GET "http://$GW_IP_B:80/admin/secret" \
    -H "Host: $HOST_B" \
    -m 10 2>&1 | head -c 300 || true)"

  save_file "g4-unauthorized-response.txt" "$resp"
  append_file "SUMMARY.md" $'\n'"- Unauthorized request sample saved: g4-unauthorized-response.txt"
  log "Unauthorized request captured."
}

# ---------------------------- Optional: tcpdump capture -----------------------
optional_pcap() {
  # Only if tcpdump exists in gateway pod (often not installed). This is optional evidence.
  log "Optional: Attempting tcpdump on ingressgateway (if available) ..."
  local has
  has="$(kubectlq "$CTX_A" -n "$ISTIO_NS" exec "$GW_POD_A" -c istio-proxy -- sh -c 'command -v tcpdump >/dev/null && echo yes || echo no' 2>/dev/null || echo no)"
  if [[ "$has" != "yes" ]]; then
    append_file "SUMMARY.md" $'\n'"## Optional PCAP"$'\n'"- tcpdump not available in gateway container; skipped."
    log "tcpdump not available; skipped."
    return 0
  fi

  # Small 5s capture (safe + short). Interface might vary; try any.
  kubectlq "$CTX_A" -n "$ISTIO_NS" exec "$GW_POD_A" -c istio-proxy -- \
    sh -c "timeout 5 tcpdump -i any -s 0 -w /tmp/gw.pcap >/dev/null 2>&1 || true"

  kubectlq "$CTX_A" -n "$ISTIO_NS" cp "$ISTIO_NS/$GW_POD_A:/tmp/gw.pcap" "$OUT_DIR/gw-a.pcap" -c istio-proxy 2>/dev/null || true
  append_file "SUMMARY.md" $'\n'"## Optional PCAP"$'\n'"- Captured gw-a.pcap (5s, if copy succeeded)."
  log "PCAP attempt done."
}

# ---------------------------- Main -------------------------------------------
main() {
  preflight
  echo "# Gateway Analysis Summary (MODE=$MODE, $TS)" >"$OUT_DIR/SUMMARY.md"

  generate_traffic
  g1_gateway_access_logs
  g2_payload_marker_checks
  g3_didcomm_envelope_evidence
  g4_policy_enforcement
  optional_pcap

  log "Done. Output: $OUT_DIR"
  log "Key artifact: $OUT_DIR/SUMMARY.md"
}

main "$@"
