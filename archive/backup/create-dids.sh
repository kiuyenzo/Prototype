#!/bin/bash
# Create DIDComm-ready DIDs in both agents using Veramo CLI

POD_A="nf-a-76c7686b89-hv92b"
POD_B="nf-b-856fd58967-mlts4"

echo "=== Creating DID in NF-A ==="
kubectl config use-context kind-cluster-a
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
cd /app/cluster-a && veramo did create-empty --alias nf-a-did
"

echo ""
echo "=== Creating DID in NF-B ==="
kubectl config use-context kind-cluster-b
kubectl exec -n nf-b-namespace $POD_B -c veramo-nf-b -- sh -c "
cd /app/cluster-b && veramo did create-empty --alias nf-b-did
"

echo ""
echo "=== Listing DIDs in NF-A ==="
kubectl config use-context kind-cluster-a
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- sh -c "
cd /app/cluster-a && veramo did list
"

echo ""
echo "=== Listing DIDs in NF-B ==="
kubectl config use-context kind-cluster-b
kubectl exec -n nf-b-namespace $POD_B -c veramo-nf-b -- sh -c "
cd /app/cluster-b && veramo did list
"

