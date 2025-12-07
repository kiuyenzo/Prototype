#!/bin/bash
# DIDComm Smoke Test: A → B

FROM_DID="did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a"
TO_DID="did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b"
POD_A="nf-a-76c7686b89-hv92b"
POD_B="nf-b-856fd58967-mlts4"

echo "🚀 Sending DIDComm message from NF-A to NF-B..."
echo "FROM: $FROM_DID"
echo "TO: $TO_DID"

# Send message via Veramo API
kubectl config use-context kind-cluster-a

kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
wget -O- --post-data='{
  \"jsonrpc\": \"2.0\",
  \"id\": 1,
  \"method\": \"sendDIDCommMessage\",
  \"params\": {
    \"data\": {
      \"from\": \"$FROM_DID\",
      \"to\": \"$TO_DID\",
      \"type\": \"test\",
      \"body\": {
        \"message\": \"Hello from NF-A! Testing DIDComm cross-cluster communication.\"
      }
    }
  }
}' --header='Content-Type: application/json' http://localhost:7001/agent 2>&1
"

echo ""
echo "✅ Message sent! Checking logs..."
echo ""
echo "=== NF-A Logs (Sender) ==="
kubectl logs -n nf-a-namespace $POD_A -c veramo-nf-a --tail=20

echo ""
echo "=== NF-B Logs (Receiver) ==="
kubectl config use-context kind-cluster-b
kubectl logs -n nf-b-namespace $POD_B -c veramo-nf-b --tail=20
