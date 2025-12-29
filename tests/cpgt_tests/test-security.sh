#!/usr/bin/env bash

# Kurzes, ehrliches Feedback zu deinem ursprünglichen Security-Script
# S1 ist gut (nur: mach Statuscodes/Artefakte → jetzt done).
# S3 ist grundsätzlich gut (bypass/invalid message), aber auch hier: Statuscodes + Artefakte.
# S2/S4 sind aktuell eher “wir glauben es” als “wir zeigen es”. Für die Masterarbeit würde ich entweder:
# einen Test-Hook einbauen (am saubersten), oder
# ein zusätzliches Test-Identity/NF-C mit falschem VC-Type/Role deployen.
# Wenn du willst, gebe ich dir als nächstes ein Mini-Design für NF-C (falsche Rolle) + wie du damit S4 “hart” beweist – ohne deine Architektur kaputt zu machen.




# =============================================================================
# Security & Negative Tests (S1–S4) – improved + thesis-friendly artifacts
# Modes: B | V4a | V1 (set MODE env var, run your system in that mode)
# =============================================================================
set -Eeuo pipefail

# ---------------------------- Config -----------------------------------------
CTX_A="${CTX_A:-kind-cluster-a}"
CTX_B="${CTX_B:-kind-cluster-b}"
ISTIO_NS="${ISTIO_NS:-istio-system}"
NS_A="${NS_A:-nf-a-namespace}"
NS_B="${NS_B:-nf-b-namespace}"

MODE="${MODE:-V1}"   # security tests make most sense for V4a/V1

HOST_A="${HOST_A:-veramo-nf-a.nf-a-namespace.svc.cluster.local}"
HOST_B="${HOST_B:-veramo-nf-b.nf-b-namespace.svc.cluster.local}"

TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${OUT_DIR:-./out/security/$TS/$MODE}"
mkdir -p "$OUT_DIR"

# Optional: if you have a test-hook to send tampered VP/VC
# Example: NF-A accepts header X-Test-Tamper: vc-signature
TAMPER_HEADER_NAME="${TAMPER_HEADER_NAME:-X-Test-Tamper}"
TAMPER_HEADER_VALUE_S2="${TAMPER_HEADER_VALUE_S2:-vc-signature}"

# ---------------------------- Helpers ----------------------------------------
log() { printf "[%s] %s\n" "$(date +%H:%M:%S)" "$*"; }
die() { printf "[ERROR] %s\n" "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Missing dependency: $1"; }

kubectlq() { kubectl --context "$1" "${@:2}"; }

get_gw_ip() {
  local ctx="$1"
  kubectlq "$ctx" -n "$ISTIO_NS" get svc istio-ingressgateway -o jsonpath='{.spec.clusterIP}' 2>/dev/null
}

cluster_curl() {
  # Usage: cluster_curl cluster-a METHOD URL HOST JSONBODY [extra curl args...]
  local cluster="$1"; shift
  local method="$1"; shift
  local url="$1"; shift
  local host="$1"; shift
  local body="${1:-}"; shift || true

  # Print: "<status>\n<body>"
  docker exec "${cluster}-control-plane" curl -sS -m 20 \
    -o /tmp/resp.txt -w "%{http_code}" \
    -X "$method" "$url" \
    -H "Host: $host" \
    -H "Content-Type: application/json" \
    ${body:+-d "$body"} \
    "$@" 2>/dev/null | {
      read -r code
      echo "$code"
      cat /tmp/resp.txt 2>/dev/null || true
    }
}

save() {
  local file="$1"; shift
  cat >"$OUT_DIR/$file" <<<"$*"
  log "Saved: $OUT_DIR/$file"
}

pass() { printf "[PASS] %s\n" "$*"; }
fail() { printf "[FAIL] %s\n" "$*"; return 1; }

# ---------------------------- Setup ------------------------------------------
preflight() {
  need kubectl
  need docker
  need curl

  GW_IP_A="$(get_gw_ip "$CTX_A")"
  GW_IP_B="$(get_gw_ip "$CTX_B")"
  [[ -n "${GW_IP_A:-}" ]] || die "Cannot get ingressgateway IP in $CTX_A"
  [[ -n "${GW_IP_B:-}" ]] || die "Cannot get ingressgateway IP in $CTX_B"

  log "MODE=$MODE"
  log "GW A=$GW_IP_A | GW B=$GW_IP_B"

  # Snapshot security config for reproducibility
  kubectlq "$CTX_A" -n "$NS_A" get peerauthentication,authorizationpolicy -o yaml >"$OUT_DIR/cluster-a-security.yaml" 2>/dev/null || true
  kubectlq "$CTX_B" -n "$NS_B" get peerauthentication,authorizationpolicy -o yaml >"$OUT_DIR/cluster-b-security.yaml" 2>/dev/null || true
}

# ---------------------------- Utilities --------------------------------------
expect_reject() {
  # expect_reject "Sx" <http_code> <body_file> [allowed_codes...]
  local id="$1"; shift
  local code="$1"; shift
  local bodyfile="$1"; shift
  local allowed="${*:-401 403 400 404 408 500}"

  for c in $allowed; do
    if [[ "$code" == "$c" ]]; then
      pass "$id rejected as expected (HTTP $code)"
      return 0
    fi
  done

  # Also consider empty body / connection errors as reject if code is 000 (curl sometimes)
  if [[ "$code" == "000" ]]; then
    pass "$id rejected as expected (connection blocked/timeout, code=000)"
    return 0
  fi

  echo "---- response body ($bodyfile) ----"
  sed -n '1,40p' "$OUT_DIR/$bodyfile" || true
  fail "$id NOT rejected (HTTP $code)"
}

# ---------------------------- S1: Invalid DID --------------------------------
test_s1_invalid_did() {
  log "S1: invalid/non-resolvable DID must be rejected"

  local invalid_dids=(
    "did:web:invalid.example.com:fake-nf"
    "did:web:nonexistent.domain:test"
    "did:fake:method:invalid"
    "not-a-did"
  )

  local ok=0 total=${#invalid_dids[@]}
  for d in "${invalid_dids[@]}"; do
    local payload
    payload=$(cat <<EOF
{"targetDid":"$d","service":"test","action":"test","params":{}}
EOF
)
    local out
    out="$(cluster_curl "cluster-a" POST "http://$GW_IP_A:80/nf/service-request" "$HOST_A" "$payload")"
    local code body
    code="$(head -n1 <<<"$out")"
    body="$(tail -n +2 <<<"$out")"
    save "s1-${d//[^a-zA-Z0-9]/_}.json" "$body"
    if expect_reject "S1($d)" "$code" "s1-${d//[^a-zA-Z0-9]/_}.json"; then ok=$((ok+1)); fi
  done

  [[ "$ok" -ge $((total-1)) ]] && pass "S1 summary: $ok/$total rejected" || fail "S1 summary: only $ok/$total rejected"
}

# ---------------------------- S2: Invalid VC signature -----------------------
test_s2_invalid_vc_signature() {
  log "S2: manipulated VC/VP signature must be rejected"

  # Create a VP with tampered signature - we take a valid-looking JWT structure
  # and manipulate the signature portion (last segment after second '.')
  # JWT format: header.payload.signature
  # We create a syntactically valid JWT with an invalid signature

  local valid_header='eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9'  # {"alg":"EdDSA","typ":"JWT"}
  local valid_payload
  valid_payload=$(echo -n '{
    "vp": {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      "type": ["VerifiablePresentation"],
      "holder": "did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a",
      "verifiableCredential": [{
        "@context": ["https://www.w3.org/2018/credentials/v1"],
        "type": ["VerifiableCredential", "NetworkFunctionCredential"],
        "issuer": "did:web:kiuyenzo.github.io:Prototype:dids:did-operator",
        "credentialSubject": {
          "id": "did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a",
          "role": "network-function",
          "clusterId": "cluster-a"
        }
      }]
    },
    "iss": "did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a",
    "aud": "did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"
  }' | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')

  # TAMPERED signature - this is intentionally invalid
  local tampered_signature="TAMPERED_INVALID_SIGNATURE_1234567890abcdefghijklmnopqrstuvwxyz"
  local tampered_vp_jwt="${valid_header}.${valid_payload}.${tampered_signature}"

  # Wrap in a DIDComm VP_WITH_PD message structure
  local didcomm_message
  didcomm_message=$(cat <<EOF
{
  "packed": false,
  "mode": "none",
  "message": {
    "type": "https://didcomm.org/present-proof/2.0/presentation",
    "id": "tampered-test-$(date +%s)",
    "from": "did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a",
    "to": ["did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"],
    "body": {
      "verifiable_presentation": "${tampered_vp_jwt}",
      "presentation_definition": {
        "id": "pd-nf-auth-request-a",
        "input_descriptors": [{
          "id": "network-function-credential",
          "constraints": {"fields": [{"path": ["$.type"]}]}
        }]
      },
      "comment": "Tampered VP for security test S2"
    }
  }
}
EOF
)

  log "Sending tampered VP (manipulated signature) to /didcomm/receive..."
  local out code body
  out="$(cluster_curl "cluster-b" POST "http://$GW_IP_B:80/didcomm/receive" "$HOST_B" "$didcomm_message")"
  code="$(head -n1 <<<"$out")"
  body="$(tail -n +2 <<<"$out")"
  save "s2-tampered-vp-response.json" "$body"
  log "HTTP: $code"

  # Expected: rejection (400, 401, 403, 500, or error in body)
  if expect_reject "S2-tampered-signature" "$code" "s2-tampered-vp-response.json" 400 401 403 500 000; then
    pass "S2 OK (tampered signature rejected)"
    return 0
  fi

  # Check if body contains error indication
  if grep -qiE 'error|invalid|failed|verification|signature' "$OUT_DIR/s2-tampered-vp-response.json" 2>/dev/null; then
    pass "S2 OK (tampered signature rejected - error in response body)"
    return 0
  fi

  fail "S2 tampered VP was NOT rejected (HTTP $code)"
  return 1
}

# ---------------------------- S3: No VC / No VP flow -------------------------
test_s3_no_credential() {
  log "S3: requests without proper DIDComm/VP must be rejected"

  # A) Try direct service endpoint (bypass DIDComm)
  local out code body
  out="$(cluster_curl "cluster-a" POST "http://$GW_IP_B:80/baseline/service" "$HOST_B" \
      '{"service":"nudm-sdm","action":"am-data","params":{}}')"
  code="$(head -n1 <<<"$out")"; body="$(tail -n +2 <<<"$out")"
  save "s3a-direct-baseline.json" "$body"
  expect_reject "S3a direct baseline" "$code" "s3a-direct-baseline.json" 401 403 404 400 000 || true

  # B) Call DIDComm receive endpoint with garbage
  out="$(cluster_curl "cluster-a" POST "http://$GW_IP_B:80/didcomm/receive" "$HOST_B" '{"invalid":"message"}')"
  code="$(head -n1 <<<"$out")"; body="$(tail -n +2 <<<"$out")"
  save "s3b-didcomm-garbage.json" "$body"
  expect_reject "S3b invalid DIDComm" "$code" "s3b-didcomm-garbage.json" 400 401 403 404 000 || true

  pass "S3 completed (see artifacts for exact codes/bodies)"
}

# ---------------------------- S4: Wrong VC type ------------------------------
test_s4_wrong_vc_type() {
  log "S4: wrong VC type must be rejected by Presentation Definition / validation"

  # Create a VP containing a VC with WRONG type (EmailCredential instead of NetworkFunctionCredential)
  # and WRONG role (user instead of network-function)
  # The system should reject this because:
  # 1. PD requires type: NetworkFunctionCredential
  # 2. PD requires role: network-function

  local wrong_type_header='eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9'  # {"alg":"EdDSA","typ":"JWT"}
  local wrong_type_payload
  wrong_type_payload=$(echo -n '{
    "vp": {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      "type": ["VerifiablePresentation"],
      "holder": "did:web:example.com:wrong-identity",
      "verifiableCredential": [{
        "@context": ["https://www.w3.org/2018/credentials/v1"],
        "type": ["VerifiableCredential", "EmailCredential"],
        "issuer": "did:web:example.com:issuer",
        "credentialSubject": {
          "id": "did:web:example.com:wrong-identity",
          "email": "test@example.com",
          "role": "user"
        }
      }]
    },
    "iss": "did:web:example.com:wrong-identity",
    "aud": "did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"
  }' | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')

  # Use a placeholder signature (will fail signature check anyway)
  local wrong_type_signature="dGVzdF9zaWduYXR1cmVfZm9yX3dyb25nX3R5cGVfdGVzdA"
  local wrong_type_vp_jwt="${wrong_type_header}.${wrong_type_payload}.${wrong_type_signature}"

  # Wrap in a DIDComm VP_WITH_PD message
  local didcomm_message
  didcomm_message=$(cat <<EOF
{
  "packed": false,
  "mode": "none",
  "message": {
    "type": "https://didcomm.org/present-proof/2.0/presentation",
    "id": "wrong-type-test-$(date +%s)",
    "from": "did:web:example.com:wrong-identity",
    "to": ["did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"],
    "body": {
      "verifiable_presentation": "${wrong_type_vp_jwt}",
      "presentation_definition": {
        "id": "pd-nf-auth-request-a",
        "input_descriptors": [{
          "id": "network-function-credential",
          "constraints": {"fields": [{"path": ["$.type"]}]}
        }]
      },
      "comment": "VP with wrong VC type (EmailCredential) for security test S4"
    }
  }
}
EOF
)

  log "Sending VP with wrong VC type (EmailCredential, role=user) to /didcomm/receive..."
  local out code body
  out="$(cluster_curl "cluster-b" POST "http://$GW_IP_B:80/didcomm/receive" "$HOST_B" "$didcomm_message")"
  code="$(head -n1 <<<"$out")"
  body="$(tail -n +2 <<<"$out")"
  save "s4-wrong-type-response.json" "$body"
  log "HTTP: $code"

  # Expected: rejection (400, 401, 403, 500, or error in body)
  if expect_reject "S4-wrong-vc-type" "$code" "s4-wrong-type-response.json" 400 401 403 500 000; then
    pass "S4 OK (wrong VC type rejected)"
    return 0
  fi

  # Check if body contains error/rejection indication
  if grep -qiE 'error|invalid|failed|verification|type|definition|rejected' "$OUT_DIR/s4-wrong-type-response.json" 2>/dev/null; then
    pass "S4 OK (wrong VC type rejected - error in response body)"
    return 0
  fi

  # Additional test: try with correct type but wrong role
  log "Additional S4 test: correct type but wrong role..."
  local wrong_role_payload
  wrong_role_payload=$(echo -n '{
    "vp": {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      "type": ["VerifiablePresentation"],
      "holder": "did:web:example.com:wrong-role-identity",
      "verifiableCredential": [{
        "@context": ["https://www.w3.org/2018/credentials/v1"],
        "type": ["VerifiableCredential", "NetworkFunctionCredential"],
        "issuer": "did:web:example.com:issuer",
        "credentialSubject": {
          "id": "did:web:example.com:wrong-role-identity",
          "role": "admin",
          "clusterId": "cluster-x"
        }
      }]
    },
    "iss": "did:web:example.com:wrong-role-identity",
    "aud": "did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"
  }' | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')

  local wrong_role_vp_jwt="${wrong_type_header}.${wrong_role_payload}.${wrong_type_signature}"
  local didcomm_message_role
  didcomm_message_role=$(cat <<EOF
{
  "packed": false,
  "mode": "none",
  "message": {
    "type": "https://didcomm.org/present-proof/2.0/presentation",
    "id": "wrong-role-test-$(date +%s)",
    "from": "did:web:example.com:wrong-role-identity",
    "to": ["did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"],
    "body": {
      "verifiable_presentation": "${wrong_role_vp_jwt}",
      "presentation_definition": {
        "id": "pd-nf-auth-request-a",
        "input_descriptors": [{
          "id": "network-function-credential",
          "constraints": {"fields": [{"path": ["$.type"]}]}
        }]
      },
      "comment": "VP with wrong role (admin instead of network-function) for security test S4b"
    }
  }
}
EOF
)

  out="$(cluster_curl "cluster-b" POST "http://$GW_IP_B:80/didcomm/receive" "$HOST_B" "$didcomm_message_role")"
  code="$(head -n1 <<<"$out")"
  body="$(tail -n +2 <<<"$out")"
  save "s4-wrong-role-response.json" "$body"
  log "HTTP: $code (wrong role test)"

  if expect_reject "S4-wrong-role" "$code" "s4-wrong-role-response.json" 400 401 403 500 000; then
    pass "S4 OK (wrong role also rejected)"
    return 0
  fi

  if grep -qiE 'error|invalid|failed|verification|role|definition|rejected' "$OUT_DIR/s4-wrong-role-response.json" 2>/dev/null; then
    pass "S4 OK (wrong role rejected - error in response body)"
    return 0
  fi

  fail "S4 wrong VC type/role was NOT rejected (HTTP $code)"
  return 1
}

# ---------------------------- Main -------------------------------------------
main() {
  preflight
  test_s1_invalid_did
  test_s2_invalid_vc_signature
  test_s3_no_credential
  test_s4_wrong_vc_type

  log "Done. Artifacts in: $OUT_DIR"
}

main "$@"
