#!/bin/bash
# Setup mTLS certificates for cross-cluster communication
# Creates a shared CA and certificates for both clusters

set -e

CERT_DIR="./certs"
mkdir -p $CERT_DIR

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║       Setting up mTLS Certificates for Cross-Cluster           ║"
echo "╚════════════════════════════════════════════════════════════════╝"

# ============================================
# Step 1: Create Shared CA
# ============================================
echo ""
echo "📜 Step 1: Creating Shared CA..."

# Generate CA private key
openssl genrsa -out $CERT_DIR/ca.key 4096

# Generate CA certificate
openssl req -new -x509 -days 365 -key $CERT_DIR/ca.key \
  -out $CERT_DIR/ca.crt \
  -subj "/CN=Prototype-CA/O=Prototype/C=DE"

echo "   ✅ CA created: $CERT_DIR/ca.crt"

# ============================================
# Step 2: Create Cluster-A Certificate
# ============================================
echo ""
echo "📜 Step 2: Creating Cluster-A certificate..."

# Generate private key
openssl genrsa -out $CERT_DIR/cluster-a.key 2048

# Generate CSR
openssl req -new -key $CERT_DIR/cluster-a.key \
  -out $CERT_DIR/cluster-a.csr \
  -subj "/CN=cluster-a.external/O=Prototype/C=DE"

# Create extensions file for SAN
cat > $CERT_DIR/cluster-a.ext << EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = cluster-a.external
DNS.2 = *.nf-a-namespace.svc.cluster.local
DNS.3 = istio-ingressgateway.istio-system.svc.cluster.local
IP.1 = 172.23.0.2
EOF

# Sign certificate with CA
openssl x509 -req -in $CERT_DIR/cluster-a.csr \
  -CA $CERT_DIR/ca.crt -CAkey $CERT_DIR/ca.key \
  -CAcreateserial -out $CERT_DIR/cluster-a.crt \
  -days 365 -extfile $CERT_DIR/cluster-a.ext

echo "   ✅ Cluster-A cert created: $CERT_DIR/cluster-a.crt"

# ============================================
# Step 3: Create Cluster-B Certificate
# ============================================
echo ""
echo "📜 Step 3: Creating Cluster-B certificate..."

# Generate private key
openssl genrsa -out $CERT_DIR/cluster-b.key 2048

# Generate CSR
openssl req -new -key $CERT_DIR/cluster-b.key \
  -out $CERT_DIR/cluster-b.csr \
  -subj "/CN=cluster-b.external/O=Prototype/C=DE"

# Create extensions file for SAN
cat > $CERT_DIR/cluster-b.ext << EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = cluster-b.external
DNS.2 = *.nf-b-namespace.svc.cluster.local
DNS.3 = istio-ingressgateway.istio-system.svc.cluster.local
IP.1 = 172.23.0.3
EOF

# Sign certificate with CA
openssl x509 -req -in $CERT_DIR/cluster-b.csr \
  -CA $CERT_DIR/ca.crt -CAkey $CERT_DIR/ca.key \
  -CAcreateserial -out $CERT_DIR/cluster-b.crt \
  -days 365 -extfile $CERT_DIR/cluster-b.ext

echo "   ✅ Cluster-B cert created: $CERT_DIR/cluster-b.crt"

# ============================================
# Step 4: Deploy to Cluster-A
# ============================================
echo ""
echo "🚀 Step 4: Deploying certificates to Cluster-A..."

kubectl config use-context kind-cluster-a

# Create secret for Istio Ingress Gateway (server cert)
kubectl create secret tls istio-ingressgateway-certs \
  --cert=$CERT_DIR/cluster-a.crt \
  --key=$CERT_DIR/cluster-a.key \
  -n istio-system \
  --dry-run=client -o yaml | kubectl apply -f -

# Create secret for CA certificate
kubectl create secret generic istio-ingressgateway-ca-certs \
  --from-file=ca.crt=$CERT_DIR/ca.crt \
  -n istio-system \
  --dry-run=client -o yaml | kubectl apply -f -

# Create secret for client certificates (to connect to cluster-b)
kubectl create secret generic cluster-b-client-certs \
  --from-file=tls.crt=$CERT_DIR/cluster-a.crt \
  --from-file=tls.key=$CERT_DIR/cluster-a.key \
  --from-file=ca.crt=$CERT_DIR/ca.crt \
  -n nf-a-namespace \
  --dry-run=client -o yaml | kubectl apply -f -

echo "   ✅ Certificates deployed to Cluster-A"

# ============================================
# Step 5: Deploy to Cluster-B
# ============================================
echo ""
echo "🚀 Step 5: Deploying certificates to Cluster-B..."

kubectl config use-context kind-cluster-b

# Create secret for Istio Ingress Gateway (server cert)
kubectl create secret tls istio-ingressgateway-certs \
  --cert=$CERT_DIR/cluster-b.crt \
  --key=$CERT_DIR/cluster-b.key \
  -n istio-system \
  --dry-run=client -o yaml | kubectl apply -f -

# Create secret for CA certificate
kubectl create secret generic istio-ingressgateway-ca-certs \
  --from-file=ca.crt=$CERT_DIR/ca.crt \
  -n istio-system \
  --dry-run=client -o yaml | kubectl apply -f -

# Create secret for client certificates (to connect to cluster-a)
kubectl create secret generic cluster-a-client-certs \
  --from-file=tls.crt=$CERT_DIR/cluster-b.crt \
  --from-file=tls.key=$CERT_DIR/cluster-b.key \
  --from-file=ca.crt=$CERT_DIR/ca.crt \
  -n nf-b-namespace \
  --dry-run=client -o yaml | kubectl apply -f -

echo "   ✅ Certificates deployed to Cluster-B"

# ============================================
# Step 6: Restart Istio Ingress Gateways
# ============================================
echo ""
echo "🔄 Step 6: Restarting Istio Ingress Gateways..."

kubectl config use-context kind-cluster-a
kubectl rollout restart deployment/istio-ingressgateway -n istio-system

kubectl config use-context kind-cluster-b
kubectl rollout restart deployment/istio-ingressgateway -n istio-system

echo "   ✅ Ingress Gateways restarting"

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    mTLS Setup Complete!                        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Certificates created in: $CERT_DIR/"
echo "  - ca.crt/key         : Shared CA"
echo "  - cluster-a.crt/key  : Cluster-A certificate"
echo "  - cluster-b.crt/key  : Cluster-B certificate"
echo ""
echo "Next: Update gateway.yaml to use MUTUAL TLS mode"
