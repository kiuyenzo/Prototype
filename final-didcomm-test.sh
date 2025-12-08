#!/bin/bash
# Final DIDComm Cross-Cluster Test

FROM_DID="did:key:z6MkqHfBtQeYnFZSLYEgf6E1QDHY9isGyFDyg5tAuBhrcB5c"
TO_DID="did:key:z6MkqgbgWGoXWH96GwgEZBsiJMxwdsv2AfUUPgdKLftFpNqU"
POD_A="nf-a-76c7686b89-b745v"
POD_B="nf-b-856fd58967-mlts4"

echo "=== DIDComm Cross-Cluster Test ==="
echo "FROM: $FROM_DID (NF-A)"
echo "TO: $TO_DID (NF-B)"
echo ""

echo "=== Step 1: Pack DIDComm message in NF-A ==="
kubectl config use-context kind-cluster-a
PACKED=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
wget -qO- --post-data='{
  \"packing\": \"authcrypt\",
  \"message\": {
    \"type\": \"https://didcomm.org/basicmessage/2.0/message\",
    \"from\": \"$FROM_DID\",
    \"to\": [\"$TO_DID\"],
    \"id\": \"cross-cluster-$(date +%s)\",
    \"body\": {
      \"content\": \"Hello from NF-A to NF-B! This is a cross-cluster DIDComm test message.\"
    }
  }
}' \
  --header='Content-Type: application/json' \
  --header='Authorization: Bearer test123' \
  http://localhost:7001/agent/packDIDCommMessage 2>&1
")

MESSAGE=$(echo "$PACKED" | python3 -c "import json, sys; print(json.load(sys.stdin)['message'])")

if [ -z "$MESSAGE" ]; then
  echo "❌ Failed to pack message"
  exit 1
fi

echo "✅ Message packed successfully"
echo "Encrypted message length: ${#MESSAGE} bytes"
echo ""

echo "=== Step 2: Send encrypted message to NF-B via NodePort ==="
kubectl config use-context kind-cluster-a
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
wget -O- --post-data='$MESSAGE' \
  --header='Content-Type: application/didcomm-encrypted+json' \
  http://172.23.0.3:30700/messaging 2>&1 | head -10
"

echo ""
echo "=== Step 3: Check NF-B logs for received message ==="
kubectl config use-context kind-cluster-b
echo "NF-B logs (last 20 lines):"
kubectl logs -n nf-b-namespace $POD_B -c veramo-nf-b --tail=20 | grep -v assert

echo ""
echo "=== Test Complete ===\"
