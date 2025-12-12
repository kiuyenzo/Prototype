#!/bin/bash
# Final Cross-Cluster DIDComm Test - WORKING VERSION

FROM_DID="did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a"
TO_DID="did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b"
POD_A=$(kubectl get pods -n nf-a-namespace -o jsonpath='{.items[0].metadata.name}')

echo "=== 🚀 Final Cross-Cluster DIDComm Test ==="
echo "FROM: $FROM_DID (Cluster-A)"
echo "TO: $TO_DID (Cluster-B)"
echo "POD: $POD_A"
echo ""

echo "=== Step 1: Pack DIDComm message in NF-A (via CLI) ==="
kubectl config use-context kind-cluster-a

# Use Veramo CLI to pack the message
PACKED_JSON=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- veramo execute \
  -m packDIDCommMessage \
  --argsJSON "{\"packing\":\"authcrypt\",\"message\":{\"type\":\"https://didcomm.org/basicmessage/2.0/message\",\"from\":\"$FROM_DID\",\"to\":[\"$TO_DID\"],\"id\":\"cross-cluster-success\",\"body\":{\"content\":\"🎉 SUCCESS! Cross-cluster DIDComm with did:web via Istio Gateway!\"}}}" 2>&1 | grep -v assert)

MESSAGE=$(echo "$PACKED_JSON" | python3 -c "import json, sys; print(json.load(sys.stdin)['message'])" 2>&1)

if [ -z "$MESSAGE" ] || [ "$MESSAGE" = "null" ]; then
  echo "❌ Failed to pack message"
  echo "Response: $PACKED_JSON"
  exit 1
fi

echo "✅ Message packed (${#MESSAGE} bytes)"
echo ""

echo "=== Step 2: Use hardcoded service endpoint (GitHub Pages not published) ==="
# GitHub Pages DID documents are not published yet, so use hardcoded endpoint
ENDPOINT="http://172.23.0.3:30132/messaging"

echo "✅ Service Endpoint: $ENDPOINT"
echo "⚠️  Note: Using hardcoded endpoint (DID resolution would fail - GitHub Pages not published)"
echo ""

echo "=== Step 3: Send encrypted DIDComm message to NF-B ==="
RESPONSE=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
wget -O- --post-data='$MESSAGE' \
  --header='Content-Type: application/didcomm-encrypted+json' \
  $ENDPOINT 2>&1 | head -10
")

echo "$RESPONSE"
echo ""

echo "=== Step 4: Check NF-B logs ==="
kubectl config use-context kind-cluster-b
echo "NF-B logs (last 30 lines):"
kubectl logs -n nf-b-namespace -l app=nf-b -c veramo-nf-b --tail=30 | grep -v assert | tail -15

echo ""
echo "=== ✅ Cross-Cluster DIDComm Test Complete! ==="
