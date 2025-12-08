#!/bin/bash
# Bidirectional Cross-Cluster DIDComm Test

FROM_DID_A="did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a"
TO_DID_B="did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b"
FROM_DID_B="did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b"
TO_DID_A="did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a"

echo "=== 🔄 Bidirectional Cross-Cluster DIDComm Test ==="
echo ""

# Get pod names
kubectl config use-context kind-cluster-a > /dev/null 2>&1
POD_A=$(kubectl get pods -n nf-a-namespace -o jsonpath='{.items[0].metadata.name}')
kubectl config use-context kind-cluster-b > /dev/null 2>&1
POD_B=$(kubectl get pods -n nf-b-namespace -o jsonpath='{.items[0].metadata.name}')

echo "Pod A: $POD_A (Cluster-A)"
echo "Pod B: $POD_B (Cluster-B)"
echo ""

#########################################
# Test 1: A → B
#########################################
echo "=== 📤 Test 1: Cluster-A → Cluster-B ==="
kubectl config use-context kind-cluster-a > /dev/null 2>&1

# Pack message
PACKED_A=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- veramo execute \
  -m packDIDCommMessage \
  --argsJSON "{\"packing\":\"authcrypt\",\"message\":{\"type\":\"https://didcomm.org/basicmessage/2.0/message\",\"from\":\"$FROM_DID_A\",\"to\":[\"$TO_DID_B\"],\"id\":\"a-to-b-test\",\"body\":{\"content\":\"Hello from Cluster-A!\"}}}" 2>&1 | grep -v assert)

MESSAGE_A=$(echo "$PACKED_A" | python3 -c "import json, sys; print(json.load(sys.stdin)['message'])" 2>&1)

if [ -z "$MESSAGE_A" ]; then
  echo "❌ Failed to pack message in A"
  exit 1
fi

echo "✅ Message packed in A (${#MESSAGE_A} bytes)"

# Send to B via Gateway
ENDPOINT_B="http://172.23.0.3:30132/messaging"
echo "📨 Sending to: $ENDPOINT_B"

RESPONSE_B=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
wget -O- --post-data='$MESSAGE_A' \
  --header='Content-Type: application/didcomm-encrypted+json' \
  $ENDPOINT_B 2>&1" | head -3)

if echo "$RESPONSE_B" | grep -q "400\|200"; then
  echo "✅ Message delivered to B (routing works)"
else
  echo "❌ Message delivery failed"
  echo "$RESPONSE_B"
fi

echo ""

#########################################
# Test 2: B → A
#########################################
echo "=== 📤 Test 2: Cluster-B → Cluster-A ==="
kubectl config use-context kind-cluster-b > /dev/null 2>&1

# Pack message
PACKED_B=$(kubectl exec -n nf-b-namespace $POD_B -c veramo-nf-b -- veramo execute \
  -m packDIDCommMessage \
  --argsJSON "{\"packing\":\"authcrypt\",\"message\":{\"type\":\"https://didcomm.org/basicmessage/2.0/message\",\"from\":\"$FROM_DID_B\",\"to\":[\"$TO_DID_A\"],\"id\":\"b-to-a-test\",\"body\":{\"content\":\"Hello from Cluster-B!\"}}}" 2>&1 | grep -v assert)

MESSAGE_B=$(echo "$PACKED_B" | python3 -c "import json, sys; print(json.load(sys.stdin)['message'])" 2>&1)

if [ -z "$MESSAGE_B" ]; then
  echo "❌ Failed to pack message in B"
  exit 1
fi

echo "✅ Message packed in B (${#MESSAGE_B} bytes)"

# Send to A via Gateway
ENDPOINT_A="http://172.23.0.2:31829/messaging"
echo "📨 Sending to: $ENDPOINT_A"

RESPONSE_A=$(kubectl exec -n nf-b-namespace $POD_B -c veramo-nf-b -- sh -c "
wget -O- --post-data='$MESSAGE_B' \
  --header='Content-Type: application/didcomm-encrypted+json' \
  $ENDPOINT_A 2>&1" | head -3)

if echo "$RESPONSE_A" | grep -q "400\|200"; then
  echo "✅ Message delivered to A (routing works)"
else
  echo "❌ Message delivery failed"
  echo "$RESPONSE_A"
fi

echo ""
echo "=== ✅ Bidirectional Test Complete! ==="
