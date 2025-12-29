#!/usr/bin/env bash
set -e

GW_IP="10.107.211.76"
HOST_A="veramo-nf-a.nf-a-namespace.svc.cluster.local"
NF_B_DID="did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"
OUT_DIR="./out/perf/thesis-final"
N=10

mkdir -p "$OUT_DIR/B" "$OUT_DIR/V4a" "$OUT_DIR/V1"

# Test Baseline B
echo "=== MODE=B (Baseline) ==="
kubectl --context kind-cluster-a -n nf-a-namespace set env deployment/nf-a -c veramo-sidecar DIDCOMM_PACKING_MODE=none
kubectl --context kind-cluster-b -n nf-b-namespace set env deployment/nf-b -c veramo-sidecar DIDCOMM_PACKING_MODE=none
kubectl --context kind-cluster-a -n nf-a-namespace rollout status deployment/nf-a --timeout=60s
kubectl --context kind-cluster-b -n nf-b-namespace rollout status deployment/nf-b --timeout=60s
sleep 3

echo "iter,kind,latency_ms" > "$OUT_DIR/B/latency.csv"
for i in $(seq 1 $N); do
  t=$(docker exec cluster-a-control-plane curl -sS -o /dev/null -w "%{time_total}" \
    -X POST "http://$GW_IP:80/baseline/service" \
    -H "Content-Type: application/json" \
    -H "Host: $HOST_A" \
    -m 60 \
    -d '{"service":"nudm-sdm","action":"am-data","params":{"supi":"imsi-262011234567890"}}')
  ms=$(echo "$t * 1000" | bc | cut -d. -f1)
  echo "$i,baseline,$ms" >> "$OUT_DIR/B/latency.csv"
  echo "B iter $i: ${ms}ms"
  sleep 0.2
done

# Test V4a (JWS)
echo ""
echo "=== MODE=V4a (JWS) ==="
kubectl --context kind-cluster-a -n nf-a-namespace set env deployment/nf-a -c veramo-sidecar DIDCOMM_PACKING_MODE=signed
kubectl --context kind-cluster-b -n nf-b-namespace set env deployment/nf-b -c veramo-sidecar DIDCOMM_PACKING_MODE=signed
kubectl --context kind-cluster-a -n nf-a-namespace rollout status deployment/nf-a --timeout=60s
kubectl --context kind-cluster-b -n nf-b-namespace rollout status deployment/nf-b --timeout=60s
sleep 3

echo "iter,kind,latency_ms" > "$OUT_DIR/V4a/latency.csv"
for i in $(seq 1 $N); do
  t1=$(docker exec cluster-a-control-plane curl -sS -o /dev/null -w "%{time_total}" \
    -X POST "http://$GW_IP:80/nf/service-request" \
    -H "Content-Type: application/json" \
    -H "Host: $HOST_A" \
    -m 60 \
    -d "{\"targetDid\":\"$NF_B_DID\",\"service\":\"nudm-sdm\",\"action\":\"am-data\",\"params\":{\"supi\":\"imsi-262011234567890\"}}")
  ms1=$(echo "$t1 * 1000" | bc | cut -d. -f1)

  t2=$(docker exec cluster-a-control-plane curl -sS -o /dev/null -w "%{time_total}" \
    -X POST "http://$GW_IP:80/nf/service-request" \
    -H "Content-Type: application/json" \
    -H "Host: $HOST_A" \
    -m 60 \
    -d "{\"targetDid\":\"$NF_B_DID\",\"service\":\"nudm-sdm\",\"action\":\"am-data\",\"params\":{\"supi\":\"imsi-262011234567890\"}}")
  ms2=$(echo "$t2 * 1000" | bc | cut -d. -f1)

  echo "$i,first,$ms1" >> "$OUT_DIR/V4a/latency.csv"
  echo "$i,reuse,$ms2" >> "$OUT_DIR/V4a/latency.csv"
  echo "V4a iter $i: first=${ms1}ms reuse=${ms2}ms"
  sleep 0.2
done

# Test V1 (JWE)
echo ""
echo "=== MODE=V1 (JWE) ==="
kubectl --context kind-cluster-a -n nf-a-namespace set env deployment/nf-a -c veramo-sidecar DIDCOMM_PACKING_MODE=encrypted
kubectl --context kind-cluster-b -n nf-b-namespace set env deployment/nf-b -c veramo-sidecar DIDCOMM_PACKING_MODE=encrypted
kubectl --context kind-cluster-a -n nf-a-namespace rollout status deployment/nf-a --timeout=60s
kubectl --context kind-cluster-b -n nf-b-namespace rollout status deployment/nf-b --timeout=60s
sleep 3

echo "iter,kind,latency_ms" > "$OUT_DIR/V1/latency.csv"
for i in $(seq 1 $N); do
  t1=$(docker exec cluster-a-control-plane curl -sS -o /dev/null -w "%{time_total}" \
    -X POST "http://$GW_IP:80/nf/service-request" \
    -H "Content-Type: application/json" \
    -H "Host: $HOST_A" \
    -m 60 \
    -d "{\"targetDid\":\"$NF_B_DID\",\"service\":\"nudm-sdm\",\"action\":\"am-data\",\"params\":{\"supi\":\"imsi-262011234567890\"}}")
  ms1=$(echo "$t1 * 1000" | bc | cut -d. -f1)

  t2=$(docker exec cluster-a-control-plane curl -sS -o /dev/null -w "%{time_total}" \
    -X POST "http://$GW_IP:80/nf/service-request" \
    -H "Content-Type: application/json" \
    -H "Host: $HOST_A" \
    -m 60 \
    -d "{\"targetDid\":\"$NF_B_DID\",\"service\":\"nudm-sdm\",\"action\":\"am-data\",\"params\":{\"supi\":\"imsi-262011234567890\"}}")
  ms2=$(echo "$t2 * 1000" | bc | cut -d. -f1)

  echo "$i,first,$ms1" >> "$OUT_DIR/V1/latency.csv"
  echo "$i,reuse,$ms2" >> "$OUT_DIR/V1/latency.csv"
  echo "V1 iter $i: first=${ms1}ms reuse=${ms2}ms"
  sleep 0.2
done

echo ""
echo "=== DONE ==="
echo "Output: $OUT_DIR"
cat "$OUT_DIR/B/latency.csv"
echo ""
cat "$OUT_DIR/V4a/latency.csv"
echo ""
cat "$OUT_DIR/V1/latency.csv"
