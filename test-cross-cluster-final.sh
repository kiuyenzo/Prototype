#!/bin/bash
# Final Cross-Cluster DIDComm Test

FROM_DID="did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a"
TO_DID="did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b"
POD_A="nf-a-dff54d45f-hcck7"

echo "=== 🚀 Final Cross-Cluster DIDComm Test ==="
echo "FROM: $FROM_DID (Cluster-A)"
echo "TO: $TO_DID (Cluster-B)"
echo ""

echo "=== Step 1: Pack DIDComm message in NF-A ==="
kubectl config use-context kind-cluster-a
PACKED=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- wget -qO- \
  --post-data='{"packing":"authcrypt","message":{"type":"https://didcomm.org/basicmessage/2.0/message","from":"'"$FROM_DID"'","to":["'"$TO_DID"'"],"id":"cross-cluster-success","body":{"content":"🎉 SUCCESS! Cross-cluster DIDComm with did:web via Istio Gateway!"}}}' \
  --header='Content-Type: application/json' \
  --header='Authorization: Bearer test123' \
  http://localhost:7001/agent/packDIDCommMessage 2>&1)

MESSAGE=$(echo "$PACKED" | python3 -c "import json, sys; print(json.load(sys.stdin)['message'])")

if [ -z "$MESSAGE" ]; then
  echo "❌ Failed to pack message"
  exit 1
fi

echo "✅ Message packed (${#MESSAGE} bytes)"
echo ""

echo "=== Step 2: Resolve NF-B DID to get service endpoint ==="
ENDPOINT=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- wget -qO- \
  --post-data="{\"didUrl\":\"$TO_DID\"}" \
  --header='Content-Type: application/json' \
  --header='Authorization: Bearer test123' \
  http://localhost:7001/agent/resolveDid 2>&1 | python3 -c "import json, sys; print(json.load(sys.stdin)['didDocument']['service'][0]['serviceEndpoint'])")

echo "✅ Service Endpoint: $ENDPOINT"
echo ""

echo "=== Step 3: Send encrypted DIDComm message to NF-B ==="
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
wget -O- --post-data='$MESSAGE' \
  --header='Content-Type: application/didcomm-encrypted+json' \
  $ENDPOINT 2>&1 | head -5
"

echo ""
echo "=== Step 4: Check NF-B logs ==="
kubectl config use-context kind-cluster-b
echo "NF-B logs (last 30 lines):"
kubectl logs -n nf-b-namespace -l app=nf-b -c veramo-nf-b --tail=30 | grep -v assert | tail -15

echo ""
echo "=== ✅ Cross-Cluster DIDComm Test Complete! ==="
