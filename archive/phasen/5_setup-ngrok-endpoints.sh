#!/bin/bash
# Setup public ngrok endpoints for DID documents

echo "=== 🌐 Setting up ngrok public endpoints ==="
echo ""
echo "This will create public URLs for your local Kubernetes clusters"
echo "that can be used in DID documents on GitHub Pages."
echo ""

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok is not installed"
    echo ""
    echo "Install ngrok:"
    echo "  1. Go to https://ngrok.com and sign up"
    echo "  2. Download ngrok for macOS"
    echo "  3. Run: brew install ngrok/ngrok/ngrok"
    echo "  4. Authenticate: ngrok authtoken <your-token>"
    exit 1
fi

echo "✅ ngrok is installed"
echo ""

# Get current cluster IPs and ports
kubectl config use-context kind-cluster-a > /dev/null 2>&1
CLUSTER_A_IP=$(docker network inspect kind | python3 -c "import json, sys; data = json.load(sys.stdin); containers = data[0]['Containers']; cluster_a = [c for c in containers.values() if 'cluster-a-control-plane' in c['Name']]; print(cluster_a[0]['IPv4Address'].split('/')[0] if cluster_a else '')")
NODEPORT_A=$(kubectl get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.ports[?(@.name=="http2")].nodePort}')

kubectl config use-context kind-cluster-b > /dev/null 2>&1
CLUSTER_B_IP=$(docker network inspect kind | python3 -c "import json, sys; data = json.load(sys.stdin); containers = data[0]['Containers']; cluster_b = [c for c in containers.values() if 'cluster-b-control-plane' in c['Name']]; print(cluster_b[0]['IPv4Address'].split('/')[0] if cluster_b else '')")
NODEPORT_B=$(kubectl get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.ports[?(@.name=="http2")].nodePort}')

echo "Local endpoints:"
echo "  Cluster-A: http://${CLUSTER_A_IP}:${NODEPORT_A}/messaging"
echo "  Cluster-B: http://${CLUSTER_B_IP}:${NODEPORT_B}/messaging"
echo ""

echo "=== Starting ngrok tunnels ==="
echo ""
echo "⚠️  IMPORTANT: Keep these ngrok processes running!"
echo "    Press Ctrl+C in THIS terminal to stop all tunnels."
echo ""

# Start ngrok for Cluster-A in background
echo "Starting ngrok for Cluster-A..."
ngrok http ${CLUSTER_A_IP}:${NODEPORT_A} --log=stdout > /tmp/ngrok-a.log 2>&1 &
NGROK_PID_A=$!
sleep 3

# Start ngrok for Cluster-B in background
echo "Starting ngrok for Cluster-B..."
ngrok http ${CLUSTER_B_IP}:${NODEPORT_B} --log=stdout > /tmp/ngrok-b.log 2>&1 &
NGROK_PID_B=$!
sleep 3

# Get ngrok public URLs
echo ""
echo "Fetching ngrok public URLs..."
sleep 2

NGROK_URL_A=$(curl -s http://localhost:4040/api/tunnels | python3 -c "import json, sys; tunnels = json.load(sys.stdin).get('tunnels', []); print(tunnels[0]['public_url'] if tunnels else '')" 2>/dev/null)
NGROK_URL_B=$(curl -s http://localhost:4041/api/tunnels | python3 -c "import json, sys; tunnels = json.load(sys.stdin).get('tunnels', []); print(tunnels[0]['public_url'] if tunnels else '')" 2>/dev/null)

if [ -z "$NGROK_URL_A" ] || [ -z "$NGROK_URL_B" ]; then
    echo "❌ Failed to get ngrok URLs"
    echo ""
    echo "Check ngrok logs:"
    echo "  Cluster-A: cat /tmp/ngrok-a.log"
    echo "  Cluster-B: cat /tmp/ngrok-b.log"
    kill $NGROK_PID_A $NGROK_PID_B 2>/dev/null
    exit 1
fi

# Convert http to https if needed
NGROK_URL_A=${NGROK_URL_A/http:/https:}
NGROK_URL_B=${NGROK_URL_B/http:/https:}

echo ""
echo "=== ✅ ngrok tunnels active! ==="
echo ""
echo "Public URLs:"
echo "  Cluster-A: ${NGROK_URL_A}/messaging"
echo "  Cluster-B: ${NGROK_URL_B}/messaging"
echo ""

# Update DID documents
echo "=== Updating DID documents ==="

python3 << EOF
import json

# Update Cluster-A DID
with open('cluster-a/did-nf-a/did.json', 'r') as f:
    did_a = json.load(f)

did_a['service'][0]['serviceEndpoint'] = '${NGROK_URL_A}/messaging'

with open('cluster-a/did-nf-a/did.json', 'w') as f:
    json.dump(did_a, f, indent=2)
    f.write('\n')

print(f"✅ Updated cluster-a/did-nf-a/did.json")
print(f"   serviceEndpoint: {did_a['service'][0]['serviceEndpoint']}")

# Update Cluster-B DID
with open('cluster-b/did-nf-b/did.json', 'r') as f:
    did_b = json.load(f)

did_b['service'][0]['serviceEndpoint'] = '${NGROK_URL_B}/messaging'

with open('cluster-b/did-nf-b/did.json', 'w') as f:
    json.dump(did_b, f, indent=2)
    f.write('\n')

print(f"✅ Updated cluster-b/did-nf-b/did.json")
print(f"   serviceEndpoint: {did_b['service'][0]['serviceEndpoint']}")
EOF

echo ""
echo "=== 📝 Next steps: ==="
echo ""
echo "1. Commit and push DID documents to GitHub:"
echo "   git add cluster-a/did-nf-a/did.json cluster-b/did-nf-b/did.json"
echo "   git commit -m 'Update DID documents with ngrok endpoints'"
echo "   git push origin main"
echo ""
echo "2. Enable GitHub Pages (if not already):"
echo "   https://github.com/kiuyenzo/Prototype/settings/pages"
echo "   - Source: Deploy from branch 'main'"
echo ""
echo "3. Wait ~2 minutes for GitHub Pages deployment"
echo ""
echo "4. Test DID resolution:"
echo "   veramo did resolve did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a"
echo ""
echo "⚠️  IMPORTANT: Keep this terminal open to maintain ngrok tunnels!"
echo ""

# Cleanup handler
cleanup() {
    echo ""
    echo "Stopping ngrok tunnels..."
    kill $NGROK_PID_A $NGROK_PID_B 2>/dev/null

    # Restore local IPs
    echo "Restoring local IPs in DID documents..."
    ./5_update-did-endpoints.sh > /dev/null 2>&1
    echo "✅ Cleaned up"
    exit 0
}

trap cleanup INT TERM EXIT

echo "Press Ctrl+C to stop ngrok and restore local IPs..."
wait
