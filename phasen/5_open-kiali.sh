#!/bin/bash
# Open Kiali Dashboard for both clusters

echo "=== 📊 Opening Kiali Dashboards ==="
echo ""
echo "Kiali provides visual service mesh observability."
echo "Use this to take screenshots for your thesis!"
echo ""

# Port-forward Kiali in Cluster-A
echo "Starting Kiali port-forward for Cluster-A..."
kubectl config use-context kind-cluster-a
kubectl port-forward -n istio-system svc/kiali 20001:20001 > /dev/null 2>&1 &
PID_A=$!

# Wait a bit
sleep 3

# Port-forward Kiali in Cluster-B
echo "Starting Kiali port-forward for Cluster-B..."
kubectl config use-context kind-cluster-b
kubectl port-forward -n istio-system svc/kiali 20002:20001 > /dev/null 2>&1 &
PID_B=$!

echo ""
echo "=== ✅ Kiali Dashboards Ready! ==="
echo ""
echo "📊 Cluster-A Kiali: http://localhost:20001"
echo "📊 Cluster-B Kiali: http://localhost:20002"
echo ""
echo "🎯 For your thesis screenshots:"
echo "   1. Go to 'Graph' view"
echo "   2. Select namespace: nf-a-namespace or nf-b-namespace"
echo "   3. Run: ./5_test-bidirectional-didcomm.sh"
echo "   4. Watch the traffic flow in real-time!"
echo ""
echo "Press Ctrl+C to stop port-forwards"
echo ""

# Keep running
trap "kill $PID_A $PID_B 2>/dev/null; exit" INT TERM EXIT
wait
