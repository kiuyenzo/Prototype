#!/bin/bash
# Deploy existing mTLS certificates to KinD clusters
# Uses certificates from ./certs/ folder

set -e

CERT_DIR="./certs"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║       Deploying mTLS Certificates to KinD Clusters             ║"
echo "╚════════════════════════════════════════════════════════════════╝"

# Check certificates exist
if [ ! -f "$CERT_DIR/ca-cert.pem" ]; then
  echo "❌ CA certificate not found: $CERT_DIR/ca-cert.pem"
  exit 1
fi

echo ""
echo "📜 Found certificates:"
ls -la $CERT_DIR/*.pem

# ============================================
# Deploy to Cluster-A
# ============================================
echo ""
echo "🚀 Deploying to Cluster-A..."
kubectl config use-context kind-cluster-a

# Gateway TLS certificate (server cert for incoming mTLS)
echo "   Creating istio-ingressgateway-certs secret..."
kubectl create secret tls istio-ingressgateway-certs \
  --cert=$CERT_DIR/cluster-a-server-cert-new.pem \
  --key=$CERT_DIR/cluster-a-server-key-new.pem \
  -n istio-system \
  --dry-run=client -o yaml | kubectl apply -f -

# CA certificate for verifying client certs
echo "   Creating istio-ingressgateway-ca-certs secret..."
kubectl create secret generic istio-ingressgateway-ca-certs \
  --from-file=ca.crt=$CERT_DIR/ca-cert.pem \
  -n istio-system \
  --dry-run=client -o yaml | kubectl apply -f -

# Client certificate for connecting to Cluster-B (for DestinationRule)
echo "   Creating cluster-b-client-certs secret..."
kubectl create secret generic cluster-b-client-certs \
  --from-file=tls.crt=$CERT_DIR/cluster-a-client-cert.pem \
  --from-file=tls.key=$CERT_DIR/cluster-a-client-key.pem \
  --from-file=ca.crt=$CERT_DIR/ca-cert.pem \
  -n istio-system \
  --dry-run=client -o yaml | kubectl apply -f -

echo "   ✅ Cluster-A secrets created"

# ============================================
# Deploy to Cluster-B
# ============================================
echo ""
echo "🚀 Deploying to Cluster-B..."
kubectl config use-context kind-cluster-b

# Gateway TLS certificate (server cert for incoming mTLS)
echo "   Creating istio-ingressgateway-certs secret..."
kubectl create secret tls istio-ingressgateway-certs \
  --cert=$CERT_DIR/cluster-b-server-cert-new.pem \
  --key=$CERT_DIR/cluster-b-server-key-new.pem \
  -n istio-system \
  --dry-run=client -o yaml | kubectl apply -f -

# CA certificate for verifying client certs
echo "   Creating istio-ingressgateway-ca-certs secret..."
kubectl create secret generic istio-ingressgateway-ca-certs \
  --from-file=ca.crt=$CERT_DIR/ca-cert.pem \
  -n istio-system \
  --dry-run=client -o yaml | kubectl apply -f -

# Client certificate for connecting to Cluster-A (for DestinationRule)
echo "   Creating cluster-a-client-certs secret..."
kubectl create secret generic cluster-a-client-certs \
  --from-file=tls.crt=$CERT_DIR/cluster-b-client-cert.pem \
  --from-file=tls.key=$CERT_DIR/cluster-b-client-key.pem \
  --from-file=ca.crt=$CERT_DIR/ca-cert.pem \
  -n istio-system \
  --dry-run=client -o yaml | kubectl apply -f -

echo "   ✅ Cluster-B secrets created"

# ============================================
# Restart Istio Ingress Gateways
# ============================================
echo ""
echo "🔄 Restarting Istio Ingress Gateways to pick up new certs..."

kubectl config use-context kind-cluster-a
kubectl rollout restart deployment/istio-ingressgateway -n istio-system

kubectl config use-context kind-cluster-b
kubectl rollout restart deployment/istio-ingressgateway -n istio-system

echo ""
echo "⏳ Waiting for Ingress Gateways to be ready..."
sleep 10

kubectl config use-context kind-cluster-a
kubectl wait --for=condition=available deployment/istio-ingressgateway -n istio-system --timeout=60s

kubectl config use-context kind-cluster-b
kubectl wait --for=condition=available deployment/istio-ingressgateway -n istio-system --timeout=60s

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║              mTLS Certificates Deployed!                       ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Secrets created:"
echo "  Cluster-A:"
echo "    - istio-ingressgateway-certs     (server cert)"
echo "    - istio-ingressgateway-ca-certs  (CA for client verification)"
echo "    - cluster-b-client-certs         (client cert for outbound mTLS)"
echo ""
echo "  Cluster-B:"
echo "    - istio-ingressgateway-certs     (server cert)"
echo "    - istio-ingressgateway-ca-certs  (CA for client verification)"
echo "    - cluster-a-client-certs         (client cert for outbound mTLS)"
echo ""
echo "Next: Apply gateway configurations with:"
echo "  kubectl apply -f cluster-a/gateway.yaml --context kind-cluster-a"
echo "  kubectl apply -f cluster-b/gateway.yaml --context kind-cluster-b"
