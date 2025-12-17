#!/bin/bash
set -e

echo "================================================================================
🚀 DIDComm v2 Prototype - Complete Cluster Setup
================================================================================
"

# Configuration
ISTIO_VERSION="1.24.1"
DOCKER_IMAGE="veramo-nf:phase7"

echo "📋 Setup Configuration:"
echo "   Istio Version: $ISTIO_VERSION"
echo "   Docker Image:  $DOCKER_IMAGE"
echo "   Clusters:      cluster-a, cluster-b"
echo ""

# Step 1: Create Docker Network
echo "================================================================================
📦 Step 1: Creating Docker Network
================================================================================
"
if docker network inspect kind >/dev/null 2>&1; then
    echo "✅ Docker network 'kind' already exists"
else
    docker network create kind --driver=bridge --subnet=172.23.0.0/16
    echo "✅ Docker network 'kind' created"
fi
echo ""

# Step 2: Create Kind Clusters
echo "================================================================================
🔧 Step 2: Creating Kind Clusters
================================================================================
"

# Cluster A configuration
cat > /tmp/kind-cluster-a.yaml <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: cluster-a
nodes:
  - role: control-plane
    extraPortMappings:
    - containerPort: 80
      hostPort: 8080
      protocol: TCP
    - containerPort: 443
      hostPort: 8443
      protocol: TCP
networking:
  podSubnet: "10.244.0.0/16"
  serviceSubnet: "10.96.0.0/12"
EOF

# Cluster B configuration
cat > /tmp/kind-cluster-b.yaml <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: cluster-b
nodes:
  - role: control-plane
    extraPortMappings:
    - containerPort: 80
      hostPort: 9080
      protocol: TCP
    - containerPort: 443
      hostPort: 9443
      protocol: TCP
networking:
  podSubnet: "10.245.0.0/16"
  serviceSubnet: "10.97.0.0/12"
EOF

# Create clusters
if kind get clusters | grep -q "^cluster-a$"; then
    echo "⚠️  Cluster-A already exists, skipping creation"
else
    kind create cluster --config /tmp/kind-cluster-a.yaml
    echo "✅ Cluster-A created"
fi

if kind get clusters | grep -q "^cluster-b$"; then
    echo "⚠️  Cluster-B already exists, skipping creation"
else
    kind create cluster --config /tmp/kind-cluster-b.yaml
    echo "✅ Cluster-B created"
fi

# Connect clusters to Docker network
docker network connect kind cluster-a-control-plane 2>/dev/null || echo "✅ Cluster-A already connected to network"
docker network connect kind cluster-b-control-plane 2>/dev/null || echo "✅ Cluster-B already connected to network"

# Get Docker network IPs
CLUSTER_A_IP=$(docker network inspect kind | jq -r '.[0].Containers | to_entries[] | select(.value.Name=="cluster-a-control-plane") | .value.IPv4Address' | cut -d'/' -f1)
CLUSTER_B_IP=$(docker network inspect kind | jq -r '.[0].Containers | to_entries[] | select(.value.Name=="cluster-b-control-plane") | .value.IPv4Address' | cut -d'/' -f1)

echo "✅ Cluster IPs:"
echo "   Cluster-A: $CLUSTER_A_IP"
echo "   Cluster-B: $CLUSTER_B_IP"
echo ""

# Step 3: Install Istio
echo "================================================================================
🕸️  Step 3: Installing Istio Service Mesh
================================================================================
"

# Download Istio if not present
if [ ! -d "istio-$ISTIO_VERSION" ]; then
    echo "📥 Downloading Istio $ISTIO_VERSION..."
    curl -L https://istio.io/downloadIstio | ISTIO_VERSION=$ISTIO_VERSION sh -
fi

export PATH=$PWD/istio-$ISTIO_VERSION/bin:$PATH

# Install Istio in Cluster-A
echo "📦 Installing Istio in Cluster-A..."
kubectl config use-context kind-cluster-a
istioctl install --set profile=demo -y
kubectl label namespace default istio-injection=enabled --overwrite
kubectl create namespace nf-a-namespace || true
kubectl label namespace nf-a-namespace istio-injection=enabled --overwrite
echo "✅ Istio installed in Cluster-A"

# Install Istio in Cluster-B
echo "📦 Installing Istio in Cluster-B..."
kubectl config use-context kind-cluster-b
istioctl install --set profile=demo -y
kubectl label namespace default istio-injection=enabled --overwrite
kubectl create namespace nf-b-namespace || true
kubectl label namespace nf-b-namespace istio-injection=enabled --overwrite
echo "✅ Istio installed in Cluster-B"
echo ""

# Step 4: Build and Load Docker Image
echo "================================================================================
🐋 Step 4: Building and Loading Docker Image
================================================================================
"

# COMMENTED OUT - Using sidecar architecture instead (./sidecar/build-and-deploy.sh)
# echo "🔨 Building Docker image: $DOCKER_IMAGE"
# docker build -t $DOCKER_IMAGE .
#
# echo "📤 Loading image into Cluster-A..."
# kind load docker-image $DOCKER_IMAGE --name cluster-a
#
# echo "📤 Loading image into Cluster-B..."
# kind load docker-image $DOCKER_IMAGE --name cluster-b

echo "⏭️  Skipped - use ./sidecar/build-and-deploy.sh for sidecar architecture"
echo ""

# Step 5: Generate TLS Certificates
echo "================================================================================
🔐 Step 5: Generating mTLS Certificates
================================================================================
"

mkdir -p certs
cd certs

# Generate CA certificate
if [ ! -f ca-cert.pem ]; then
    echo "🔑 Generating CA certificate..."
    openssl req -x509 -newkey rsa:4096 -keyout ca-key.pem -out ca-cert.pem -days 365 -nodes -subj "/CN=Gateway-CA/O=Prototype"
    echo "✅ CA certificate created"
else
    echo "✅ CA certificate already exists"
fi

# Generate server certificates
if [ ! -f cluster-a-server-cert-new.pem ]; then
    echo "🔑 Generating server certificate for Cluster-A..."
    openssl req -newkey rsa:4096 -keyout cluster-a-server-key-new.pem -out cluster-a-server.csr -nodes -subj "/CN=cluster-a.external/O=Prototype"
    openssl x509 -req -in cluster-a-server.csr -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial -out cluster-a-server-cert-new.pem -days 365
    echo "✅ Server certificate for Cluster-A created"
else
    echo "✅ Server certificate for Cluster-A already exists"
fi

if [ ! -f cluster-b-server-cert-new.pem ]; then
    echo "🔑 Generating server certificate for Cluster-B..."
    openssl req -newkey rsa:4096 -keyout cluster-b-server-key-new.pem -out cluster-b-server.csr -nodes -subj "/CN=cluster-b.external/O=Prototype"
    openssl x509 -req -in cluster-b-server.csr -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial -out cluster-b-server-cert-new.pem -days 365
    echo "✅ Server certificate for Cluster-B created"
else
    echo "✅ Server certificate for Cluster-B already exists"
fi

# Generate client certificates
if [ ! -f cluster-a-client-cert.pem ]; then
    echo "🔑 Generating client certificate for Cluster-A..."
    openssl req -newkey rsa:4096 -keyout cluster-a-client-key.pem -out cluster-a-client.csr -nodes -subj "/CN=cluster-a-gateway/O=Prototype"
    openssl x509 -req -in cluster-a-client.csr -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial -out cluster-a-client-cert.pem -days 365
    echo "✅ Client certificate for Cluster-A created"
else
    echo "✅ Client certificate for Cluster-A already exists"
fi

if [ ! -f cluster-b-client-cert.pem ]; then
    echo "🔑 Generating client certificate for Cluster-B..."
    openssl req -newkey rsa:4096 -keyout cluster-b-client-key.pem -out cluster-b-client.csr -nodes -subj "/CN=cluster-b-gateway/O=Prototype"
    openssl x509 -req -in cluster-b-client.csr -CA ca-cert.pem -CAkey ca-key.pem -CAcreateserial -out cluster-b-client-cert.pem -days 365
    echo "✅ Client certificate for Cluster-B created"
else
    echo "✅ Client certificate for Cluster-B already exists"
fi

cd ..
echo ""

# Step 6: Deploy Certificates to Clusters
echo "================================================================================
📜 Step 6: Deploying Certificates to Clusters
================================================================================
"

# Deploy to Cluster-A
echo "📤 Deploying certificates to Cluster-A..."
kubectl config use-context kind-cluster-a

kubectl create secret tls istio-ingressgateway-certs -n istio-system \
  --key=certs/cluster-a-server-key-new.pem \
  --cert=certs/cluster-a-server-cert-new.pem \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic istio-client-certs -n istio-system \
  --from-file=tls.crt=certs/cluster-a-client-cert.pem \
  --from-file=tls.key=certs/cluster-a-client-key.pem \
  --from-file=ca.crt=certs/ca-cert.pem \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic istio-ca-certs -n istio-system \
  --from-file=ca.crt=certs/ca-cert.pem \
  --dry-run=client -o yaml | kubectl apply -f -

echo "✅ Certificates deployed to Cluster-A"

# Deploy to Cluster-B
echo "📤 Deploying certificates to Cluster-B..."
kubectl config use-context kind-cluster-b

kubectl create secret tls istio-ingressgateway-certs -n istio-system \
  --key=certs/cluster-b-server-key-new.pem \
  --cert=certs/cluster-b-server-cert-new.pem \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic istio-client-certs -n istio-system \
  --from-file=tls.crt=certs/cluster-b-client-cert.pem \
  --from-file=tls.key=certs/cluster-b-client-key.pem \
  --from-file=ca.crt=certs/ca-cert.pem \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic istio-ca-certs -n istio-system \
  --from-file=ca.crt=certs/ca-cert.pem \
  --dry-run=client -o yaml | kubectl apply -f -

echo "✅ Certificates deployed to Cluster-B"
echo ""

# Step 7: Patch Istio Ingress Gateways
echo "================================================================================
🔧 Step 7: Configuring Istio Ingress Gateways with mTLS
================================================================================
"

# Patch Cluster-A Gateway
echo "🔧 Patching Cluster-A Ingress Gateway..."
kubectl config use-context kind-cluster-a

kubectl patch deployment istio-ingressgateway -n istio-system --type='json' -p='[
  {
    "op": "add",
    "path": "/spec/template/spec/volumes/-",
    "value": {
      "name": "client-certs",
      "secret": {
        "secretName": "istio-client-certs",
        "optional": true
      }
    }
  },
  {
    "op": "add",
    "path": "/spec/template/spec/volumes/-",
    "value": {
      "name": "ca-certs",
      "secret": {
        "secretName": "istio-ca-certs",
        "optional": true
      }
    }
  }
]'

kubectl patch deployment istio-ingressgateway -n istio-system --type='json' -p='[
  {
    "op": "add",
    "path": "/spec/template/spec/containers/0/volumeMounts/-",
    "value": {
      "name": "client-certs",
      "mountPath": "/etc/istio/client-certs",
      "readOnly": true
    }
  },
  {
    "op": "add",
    "path": "/spec/template/spec/containers/0/volumeMounts/-",
    "value": {
      "name": "ca-certs",
      "mountPath": "/etc/istio/ca-certs",
      "readOnly": true
    }
  }
]'

echo "✅ Cluster-A Gateway patched"

# Patch Cluster-B Gateway
echo "🔧 Patching Cluster-B Ingress Gateway..."
kubectl config use-context kind-cluster-b

kubectl patch deployment istio-ingressgateway -n istio-system --type='json' -p='[
  {
    "op": "add",
    "path": "/spec/template/spec/volumes/-",
    "value": {
      "name": "client-certs",
      "secret": {
        "secretName": "istio-client-certs",
        "optional": true
      }
    }
  },
  {
    "op": "add",
    "path": "/spec/template/spec/volumes/-",
    "value": {
      "name": "ca-certs",
      "secret": {
        "secretName": "istio-ca-certs",
        "optional": true
      }
    }
  }
]'

kubectl patch deployment istio-ingressgateway -n istio-system --type='json' -p='[
  {
    "op": "add",
    "path": "/spec/template/spec/containers/0/volumeMounts/-",
    "value": {
      "name": "client-certs",
      "mountPath": "/etc/istio/client-certs",
      "readOnly": true
    }
  },
  {
    "op": "add",
    "path": "/spec/template/spec/containers/0/volumeMounts/-",
    "value": {
      "name": "ca-certs",
      "mountPath": "/etc/istio/ca-certs",
      "readOnly": true
    }
  }
]'

echo "✅ Cluster-B Gateway patched"
echo ""

# Step 8: Auto-configure IPs and Ports
echo "================================================================================
🔧 Step 8: Auto-configuring IPs and Ports for Cross-Cluster Communication
================================================================================
"

# Get NodePorts for HTTPS (443) from Istio Ingress Gateways
CLUSTER_A_HTTPS_NODEPORT=$(kubectl get svc istio-ingressgateway -n istio-system --context kind-cluster-a -o jsonpath='{.spec.ports[?(@.port==443)].nodePort}')
CLUSTER_B_HTTPS_NODEPORT=$(kubectl get svc istio-ingressgateway -n istio-system --context kind-cluster-b -o jsonpath='{.spec.ports[?(@.port==443)].nodePort}')

echo "📊 Detected Configuration:"
echo "   Cluster-A IP:         $CLUSTER_A_IP"
echo "   Cluster-A HTTPS Port: $CLUSTER_A_HTTPS_NODEPORT"
echo "   Cluster-B IP:         $CLUSTER_B_IP"
echo "   Cluster-B HTTPS Port: $CLUSTER_B_HTTPS_NODEPORT"

# Update cluster-a/03-istio-gateway.yaml with Cluster-B's IP and port
echo "🔄 Updating cluster-a/03-istio-gateway.yaml..."
sed -i.bak "s|addresses:.*# Docker network IP of Cluster-B|addresses:\n  - $CLUSTER_B_IP  # Docker network IP of Cluster-B|" cluster-a/03-istio-gateway.yaml
sed -i.bak "s|address: 172\.[0-9]*\.[0-9]*\.[0-9]*$|address: $CLUSTER_B_IP|g" cluster-a/03-istio-gateway.yaml
sed -i.bak "s|number: [0-9]*  # HTTPS port|number: $CLUSTER_B_HTTPS_NODEPORT  # HTTPS port|g" cluster-a/03-istio-gateway.yaml
sed -i.bak "s|https-didcomm: [0-9]*$|https-didcomm: $CLUSTER_B_HTTPS_NODEPORT|g" cluster-a/03-istio-gateway.yaml

# Update cluster-b/03-istio-gateway.yaml with Cluster-A's IP and port
echo "🔄 Updating cluster-b/03-istio-gateway.yaml..."
sed -i.bak "s|addresses:.*# Docker network IP of Cluster-A|addresses:\n  - $CLUSTER_A_IP  # Docker network IP of Cluster-A|" cluster-b/03-istio-gateway.yaml
sed -i.bak "s|address: 172\.[0-9]*\.[0-9]*\.[0-9]*$|address: $CLUSTER_A_IP|g" cluster-b/03-istio-gateway.yaml
sed -i.bak "s|number: [0-9]*  # HTTPS port|number: $CLUSTER_A_HTTPS_NODEPORT  # HTTPS port|g" cluster-b/03-istio-gateway.yaml
sed -i.bak "s|https-didcomm: [0-9]*$|https-didcomm: $CLUSTER_A_HTTPS_NODEPORT|g" cluster-b/03-istio-gateway.yaml

# Clean up backup files
rm -f cluster-a/03-istio-gateway.yaml.bak cluster-b/03-istio-gateway.yaml.bak

echo "✅ YAML files updated with correct IPs and ports"
echo ""

# Step 9: Deploy Applications
echo "================================================================================
🚀 Step 9: Deploying Applications
================================================================================
"

# Deploy to Cluster-A
echo "📦 Deploying to Cluster-A..."
kubectl config use-context kind-cluster-a
kubectl apply -f cluster-a/01-namespace.yaml
kubectl apply -f cluster-a/02-deployment.yaml
kubectl apply -f cluster-a/03-istio-gateway.yaml
echo "✅ Application deployed to Cluster-A"

# Deploy to Cluster-B
echo "📦 Deploying to Cluster-B..."
kubectl config use-context kind-cluster-b
kubectl apply -f cluster-b/01-namespace.yaml
kubectl apply -f cluster-b/02-deployment.yaml
kubectl apply -f cluster-b/03-istio-gateway.yaml
echo "✅ Application deployed to Cluster-B"
echo ""

# Step 10: Wait for Deployments
echo "================================================================================
⏳ Step 10: Waiting for Deployments to be Ready
================================================================================
"

echo "⏳ Waiting for Cluster-A deployments..."
kubectl config use-context kind-cluster-a
kubectl rollout status deployment istio-ingressgateway -n istio-system --timeout=120s
kubectl rollout status deployment nf-a -n nf-a-namespace --timeout=120s
echo "✅ Cluster-A deployments ready"

echo "⏳ Waiting for Cluster-B deployments..."
kubectl config use-context kind-cluster-b
kubectl rollout status deployment istio-ingressgateway -n istio-system --timeout=120s
kubectl rollout status deployment nf-b -n nf-b-namespace --timeout=120s
echo "✅ Cluster-B deployments ready"
echo ""

# Step 11: Verify Setup
echo "================================================================================
✅ Step 11: Verifying Setup
================================================================================
"

echo "🔍 Checking Cluster-A..."
kubectl config use-context kind-cluster-a
POD_A=$(kubectl get pod -n nf-a-namespace -l app=nf-a -o jsonpath='{.items[0].metadata.name}')
HEALTH_A=$(kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- wget -q -O- http://localhost:3000/health 2>/dev/null || echo '{"status":"error"}')
echo "   Pod: $POD_A"
echo "   Health: $HEALTH_A"

echo "🔍 Checking Cluster-B..."
kubectl config use-context kind-cluster-b
POD_B=$(kubectl get pod -n nf-b-namespace -l app=nf-b -o jsonpath='{.items[0].metadata.name}')
HEALTH_B=$(kubectl exec -n nf-b-namespace $POD_B -c veramo-nf-b -- wget -q -O- http://localhost:3001/health 2>/dev/null || echo '{"status":"error"}')
echo "   Pod: $POD_B"
echo "   Health: $HEALTH_B"
echo ""

# Step 12: Create Credentials
echo "================================================================================
🎫 Step 12: Creating NetworkFunction Credentials
================================================================================
"

echo "📝 Copying credential script and creating credentials..."

# Copy updated script to both pods and create credentials
kubectl config use-context kind-cluster-a
kubectl cp shared/create-nf-credentials.js nf-a-namespace/$POD_A:/app/shared/create-nf-credentials.js -c veramo-nf-a
kubectl exec -n nf-a-namespace $POD_A -c veramo-nf-a -- node /app/shared/create-nf-credentials.js cluster-a 2>&1 | grep -E "(✅|Created|successfully)" || true

kubectl config use-context kind-cluster-b
kubectl cp shared/create-nf-credentials.js nf-b-namespace/$POD_B:/app/shared/create-nf-credentials.js -c veramo-nf-b
kubectl exec -n nf-b-namespace $POD_B -c veramo-nf-b -- node /app/shared/create-nf-credentials.js cluster-b 2>&1 | grep -E "(✅|Created|successfully)" || true

echo "✅ Credentials created in both clusters"
echo ""

# Final Summary
echo "================================================================================
🎉 Setup Complete!
================================================================================
"
echo ""
echo "📊 Cluster Summary:"
echo "   Cluster-A IP:    $CLUSTER_A_IP"
echo "   Cluster-B IP:    $CLUSTER_B_IP"
echo "   Istio Version:   $ISTIO_VERSION"
echo "   Docker Image:    $DOCKER_IMAGE"
echo ""
echo "🧪 Run tests:"
echo "   ./tests/test-full-architecture-e2e.sh"
echo ""
echo "📋 Useful commands:"
echo "   kubectl config use-context kind-cluster-a"
echo "   kubectl config use-context kind-cluster-b"
echo "   kubectl get pods -n nf-a-namespace"
echo "   kubectl get pods -n nf-b-namespace"
echo "   kubectl logs -n nf-a-namespace -l app=nf-a -c veramo-nf-a"
echo "   kubectl logs -n nf-b-namespace -l app=nf-b -c veramo-nf-b"
echo ""
echo "================================================================================
"
