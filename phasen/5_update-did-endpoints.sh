#!/bin/bash
# Update DID document service endpoints with current Kind cluster IPs

echo "=== 🔄 Updating DID Document Service Endpoints ==="
echo ""

# Get Kind cluster IPs from Docker network
CLUSTER_A_IP=$(docker network inspect kind | python3 -c "import json, sys; data = json.load(sys.stdin); containers = data[0]['Containers']; cluster_a = [c for c in containers.values() if 'cluster-a-control-plane' in c['Name']]; print(cluster_a[0]['IPv4Address'].split('/')[0] if cluster_a else '')")

CLUSTER_B_IP=$(docker network inspect kind | python3 -c "import json, sys; data = json.load(sys.stdin); containers = data[0]['Containers']; cluster_b = [c for c in containers.values() if 'cluster-b-control-plane' in c['Name']]; print(cluster_b[0]['IPv4Address'].split('/')[0] if cluster_b else '')")

if [ -z "$CLUSTER_A_IP" ] || [ -z "$CLUSTER_B_IP" ]; then
  echo "❌ Error: Could not find Kind cluster IPs"
  echo "Make sure both clusters are running:"
  echo "  kind create cluster --name cluster-a"
  echo "  kind create cluster --name cluster-b"
  exit 1
fi

echo "Found cluster IPs:"
echo "  Cluster-A: $CLUSTER_A_IP"
echo "  Cluster-B: $CLUSTER_B_IP"
echo ""

# Get NodePorts
kubectl config use-context kind-cluster-a > /dev/null 2>&1
NODEPORT_A=$(kubectl get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.ports[?(@.name=="http2")].nodePort}')

kubectl config use-context kind-cluster-b > /dev/null 2>&1
NODEPORT_B=$(kubectl get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.ports[?(@.name=="http2")].nodePort}')

echo "Found NodePorts:"
echo "  Cluster-A Gateway: $NODEPORT_A"
echo "  Cluster-B Gateway: $NODEPORT_B"
echo ""

# Update DID documents
ENDPOINT_A="http://${CLUSTER_A_IP}:${NODEPORT_A}/messaging"
ENDPOINT_B="http://${CLUSTER_B_IP}:${NODEPORT_B}/messaging"

echo "Updating DID documents..."

# Update cluster-a/did-nf-a/did.json
python3 << EOF
import json

with open('cluster-a/did-nf-a/did.json', 'r') as f:
    did = json.load(f)

did['service'][0]['serviceEndpoint'] = '$ENDPOINT_A'

with open('cluster-a/did-nf-a/did.json', 'w') as f:
    json.dump(did, f, indent=2)
    f.write('\n')

print(f"✅ Updated cluster-a/did-nf-a/did.json: {did['service'][0]['serviceEndpoint']}")
EOF

# Update cluster-b/did-nf-b/did.json
python3 << EOF
import json

with open('cluster-b/did-nf-b/did.json', 'r') as f:
    did = json.load(f)

did['service'][0]['serviceEndpoint'] = '$ENDPOINT_B'

with open('cluster-b/did-nf-b/did.json', 'w') as f:
    json.dump(did, f, indent=2)
    f.write('\n')

print(f"✅ Updated cluster-b/did-nf-b/did.json: {did['service'][0]['serviceEndpoint']}")
EOF

echo ""
echo "=== ✅ DID Documents Updated Successfully ==="
echo ""
echo "Service Endpoints:"
echo "  NF-A: $ENDPOINT_A"
echo "  NF-B: $ENDPOINT_B"
echo ""
echo "⚠️  Note: If you've published these DIDs to GitHub Pages, you'll need to"
echo "          commit and push the updated files for did:web resolution to work."
