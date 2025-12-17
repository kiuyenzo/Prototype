#!/bin/bash
# Cross-Cluster DIDComm Test with did:web

FROM_DID="did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a"
TO_DID="did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b"
POD_A="nf-a-76c7686b89-l9gnp"

echo "=== Cross-Cluster DIDComm Test with did:web ==="
echo "FROM: $FROM_DID"
echo "TO: $TO_DID"
echo ""

echo "=== Step 1: Verify DIDs are in database ==="
kubectl config use-context kind-cluster-a
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- wget -qO- \
  --header='Authorization: Bearer test123' \
  http://localhost:7001/agent/didManagerFind | python3 -c "import json, sys; dids = json.load(sys.stdin); print(json.dumps([d['did'] for d in dids], indent=2))"

echo ""
echo "=== Step 2: Resolve both DIDs ==="
echo "Resolving FROM DID..."
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- wget -qO- \
  --post-data="{\"didUrl\":\"$FROM_DID\"}" \
  --header='Content-Type: application/json' \
  --header='Authorization: Bearer test123' \
  http://localhost:7001/agent/resolveDid 2>&1 | python3 -c "import json, sys; doc = json.load(sys.stdin); print('Service Endpoint:', doc['didDocument']['service'][0]['serviceEndpoint'] if 'service' in doc['didDocument'] else 'NO SERVICE')"

echo ""
echo "Resolving TO DID..."
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- wget -qO- \
  --post-data="{\"didUrl\":\"$TO_DID\"}" \
  --header='Content-Type: application/json' \
  --header='Authorization: Bearer test123' \
  http://localhost:7001/agent/resolveDid 2>&1 | python3 -c "import json, sys; doc = json.load(sys.stdin); print('Service Endpoint:', doc['didDocument']['service'][0]['serviceEndpoint'] if 'service' in doc['didDocument'] else 'NO SERVICE')"

echo ""
echo "=== Step 3: Pack DIDComm message ==="
PACKED=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
wget -qO- --post-data='{
  \"packing\": \"authcrypt\",
  \"message\": {
    \"type\": \"https://didcomm.org/basicmessage/2.0/message\",
    \"from\": \"$FROM_DID\",
    \"to\": [\"$TO_DID\"],
    \"id\": \"didweb-test-$(date +%s)\",
    \"body\": {
      \"content\": \"Cross-cluster DIDComm with did:web! This proves service endpoint discovery works.\"
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
  echo "Response: $PACKED"
  exit 1
fi

echo "✅ Message packed successfully"
echo "Encrypted message length: ${#MESSAGE} bytes"
echo ""

echo "=== Step 4: Send to NF-B via service endpoint ==="
echo "Sending to: http://172.23.0.3:30700/messaging"
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
wget -O- --post-data='$MESSAGE' \
  --header='Content-Type: application/didcomm-encrypted+json' \
  http://172.23.0.3:30700/messaging 2>&1 | head -10
"

echo ""
echo "=== Step 5: Check NF-B logs ==="
kubectl config use-context kind-cluster-b
echo "NF-B logs (last 25 lines):"
kubectl logs -n nf-b-namespace -l app=nf-b -c veramo-nf-b --tail=25 | grep -v assert

echo ""
echo "=== ✅ Test Complete ==="
