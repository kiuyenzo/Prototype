#!/bin/bash
# Basic connectivity test between clusters

POD_A="nf-a-76c7686b89-hv92b"
POD_B="nf-b-856fd58967-mlts4"

echo "=== Test 1: NF-A can reach internet? ==="
kubectl config use-context kind-cluster-a
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
wget -qO- --spider https://www.google.com 2>&1 | head -3
"

echo ""
echo "=== Test 2: NF-A can resolve cluster-b DNS (via Docker network)? ==="
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
ping -c 2 172.23.0.3 2>&1 || echo 'Ping might be disabled'
"

echo ""
echo "=== Test 3: NF-A can reach cluster-b Istio IngressGateway NodePort? ==="
# Port 30132 is the HTTP port of istio-ingressgateway
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
wget -qO- --spider --timeout=5 http://172.23.0.3:30132 2>&1 | head -5
"

echo ""
echo "=== Test 4: What is the Docker network for cluster-b control plane? ==="
docker inspect cluster-b-control-plane | grep -A 10 '"Networks"'

echo ""
echo "=== Test 5: Can we reach NF-B directly via ClusterIP from outside? ==="
kubectl config use-context kind-cluster-b
NF_B_IP=$(kubectl get svc veramo-nf-b -n nf-b-namespace -o jsonpath='{.spec.clusterIP}')
echo "NF-B ClusterIP: $NF_B_IP"

echo ""
echo "=== Summary ==="
echo "Cluster-A pod: $POD_A"
echo "Cluster-B pod: $POD_B"
echo "Cluster-B Docker IP: 172.23.0.3"
echo "Istio IngressGateway HTTP NodePort: 30132"
