#!/bin/bash
# =============================================================================
# DIDComm v2 Prototype - Cluster Setup
# Creates KinD clusters, installs Istio, generates certs, deploys application
# =============================================================================
set -e

ISTIO_VERSION="1.24.1"

echo "=== DIDComm Prototype Setup ==="

# Step 1: Docker Network
echo "[1/8] Docker network..."
docker network inspect kind >/dev/null 2>&1 || docker network create kind --driver=bridge --subnet=172.23.0.0/16

# Step 2: Create KinD Clusters
echo "[2/8] Creating KinD clusters..."
kind get clusters | grep -q "^cluster-a$" || kind create cluster --config deploy/cluster-a/kind-config.yaml
kind get clusters | grep -q "^cluster-b$" || kind create cluster --config deploy/cluster-b/kind-config.yaml

docker network connect kind cluster-a-control-plane 2>/dev/null || true
docker network connect kind cluster-b-control-plane 2>/dev/null || true

CLUSTER_A_IP=$(docker network inspect kind | jq -r '.[0].Containers | to_entries[] | select(.value.Name=="cluster-a-control-plane") | .value.IPv4Address' | cut -d'/' -f1)
CLUSTER_B_IP=$(docker network inspect kind | jq -r '.[0].Containers | to_entries[] | select(.value.Name=="cluster-b-control-plane") | .value.IPv4Address' | cut -d'/' -f1)
echo "   Cluster-A: $CLUSTER_A_IP, Cluster-B: $CLUSTER_B_IP"

# Step 3: Install Istio
echo "[3/8] Installing Istio..."
for ctx in kind-cluster-a kind-cluster-b; do
  kubectl config use-context $ctx >/dev/null
  istioctl install --set profile=demo -y >/dev/null 2>&1
  kubectl label namespace default istio-injection=enabled --overwrite >/dev/null
done

kubectl config use-context kind-cluster-a >/dev/null
kubectl create namespace nf-a-namespace 2>/dev/null || true
kubectl label namespace nf-a-namespace istio-injection=enabled --overwrite >/dev/null

kubectl config use-context kind-cluster-b >/dev/null
kubectl create namespace nf-b-namespace 2>/dev/null || true
kubectl label namespace nf-b-namespace istio-injection=enabled --overwrite >/dev/null

# Step 4: Generate mTLS Certificates
echo "[4/8] Generating certificates..."
mkdir -p certs && cd certs

[ -f ca-cert.pem ] || openssl req -x509 -newkey rsa:4096 -keyout ca-key.pem -out ca-cert.pem -days 365 -nodes -subj "/CN=Gateway-CA/O=Prototype" 2>/dev/null

for cluster in cluster-a cluster-b; do
  [ -f ${cluster}-server-cert-new.pem ] || {
    openssl req -newkey rsa:4096 -keyout ${cluster}-server-key-new.pem -out ${cluster}-server.csr -nodes -subj "/CN=${cluster}.external/O=Prototype" 2>/dev/null
    openssl x509 -req -in ${cluster}-server.csr -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial -out ${cluster}-server-cert-new.pem -days 365 2>/dev/null
  }
  [ -f ${cluster}-client-cert.pem ] || {
    openssl req -newkey rsa:4096 -keyout ${cluster}-client-key.pem -out ${cluster}-client.csr -nodes -subj "/CN=${cluster}-gateway/O=Prototype" 2>/dev/null
    openssl x509 -req -in ${cluster}-client.csr -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial -out ${cluster}-client-cert.pem -days 365 2>/dev/null
  }
done
cd ..

# Step 5: Deploy Certificates
echo "[5/8] Deploying certificates..."
for cluster in cluster-a cluster-b; do
  kubectl config use-context kind-${cluster} >/dev/null
  kubectl create secret tls istio-ingressgateway-certs -n istio-system \
    --key=certs/${cluster}-server-key-new.pem --cert=certs/${cluster}-server-cert-new.pem \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl create secret generic istio-client-certs -n istio-system \
    --from-file=tls.crt=certs/${cluster}-client-cert.pem \
    --from-file=tls.key=certs/${cluster}-client-key.pem \
    --from-file=ca.crt=certs/ca-cert.pem \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl create secret generic istio-ca-certs -n istio-system \
    --from-file=ca.crt=certs/ca-cert.pem \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
done

# Step 6: Patch Istio Gateways
echo "[6/8] Patching gateways..."
PATCH_VOLUMES='[{"op":"add","path":"/spec/template/spec/volumes/-","value":{"name":"client-certs","secret":{"secretName":"istio-client-certs","optional":true}}},{"op":"add","path":"/spec/template/spec/volumes/-","value":{"name":"ca-certs","secret":{"secretName":"istio-ca-certs","optional":true}}}]'
PATCH_MOUNTS='[{"op":"add","path":"/spec/template/spec/containers/0/volumeMounts/-","value":{"name":"client-certs","mountPath":"/etc/istio/client-certs","readOnly":true}},{"op":"add","path":"/spec/template/spec/containers/0/volumeMounts/-","value":{"name":"ca-certs","mountPath":"/etc/istio/ca-certs","readOnly":true}}]'

for ctx in kind-cluster-a kind-cluster-b; do
  kubectl config use-context $ctx >/dev/null
  kubectl patch deployment istio-ingressgateway -n istio-system --type='json' -p="$PATCH_VOLUMES" 2>/dev/null || true
  kubectl patch deployment istio-ingressgateway -n istio-system --type='json' -p="$PATCH_MOUNTS" 2>/dev/null || true
done

# Step 7: Configure Cross-Cluster IPs
echo "[7/8] Configuring cross-cluster..."
CLUSTER_A_HTTPS_NODEPORT=$(kubectl get svc istio-ingressgateway -n istio-system --context kind-cluster-a -o jsonpath='{.spec.ports[?(@.port==443)].nodePort}')
CLUSTER_B_HTTPS_NODEPORT=$(kubectl get svc istio-ingressgateway -n istio-system --context kind-cluster-b -o jsonpath='{.spec.ports[?(@.port==443)].nodePort}')

sed -i.bak "s|address: 172\.[0-9]*\.[0-9]*\.[0-9]*$|address: $CLUSTER_B_IP|g" deploy/cluster-a/gateway.yaml
sed -i.bak "s|https-didcomm: [0-9]*$|https-didcomm: $CLUSTER_B_HTTPS_NODEPORT|g" deploy/cluster-a/gateway.yaml
sed -i.bak "s|address: 172\.[0-9]*\.[0-9]*\.[0-9]*$|address: $CLUSTER_A_IP|g" deploy/cluster-b/gateway.yaml
sed -i.bak "s|https-didcomm: [0-9]*$|https-didcomm: $CLUSTER_A_HTTPS_NODEPORT|g" deploy/cluster-b/gateway.yaml
rm -f deploy/cluster-*/gateway.yaml.bak

# Step 8: Deploy Application
echo "[8/8] Deploying application..."
kubectl config use-context kind-cluster-a >/dev/null
kubectl apply -f deploy/cluster-a/ >/dev/null

kubectl config use-context kind-cluster-b >/dev/null
kubectl apply -f deploy/cluster-b/ >/dev/null

# Wait for pods
echo "Waiting for pods..."
kubectl config use-context kind-cluster-a >/dev/null
kubectl rollout status deployment nf-a -n nf-a-namespace --timeout=120s >/dev/null 2>&1 || true

kubectl config use-context kind-cluster-b >/dev/null
kubectl rollout status deployment nf-b -n nf-b-namespace --timeout=120s >/dev/null 2>&1 || true

echo ""
echo "=== Setup Complete ==="
echo "Cluster-A: $CLUSTER_A_IP | Cluster-B: $CLUSTER_B_IP"
echo ""
echo "Next: ./scripts/deploy/build-and-deploy.sh"
