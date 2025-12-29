#!/bin/bash
# =============================================================================
# Cross-Cluster Connectivity Setup
# =============================================================================
# Configures ServiceEntry resources for cross-cluster communication.
# Must be run after Kind clusters are created (IPs are dynamic).
#
# Usage: ./scripts/setup/configure-cross-cluster.sh
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Configuration
CLUSTER_A_CONTEXT="kind-cluster-a"
CLUSTER_B_CONTEXT="kind-cluster-b"
NS_A="nf-a-namespace"
NS_B="nf-b-namespace"

echo "=============================================="
echo "  Cross-Cluster Connectivity Setup"
echo "=============================================="
echo ""

# Get actual Node IPs
info "Detecting cluster IPs..."
CLUSTER_A_NODE_IP=$(kubectl --context $CLUSTER_A_CONTEXT get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
CLUSTER_B_NODE_IP=$(kubectl --context $CLUSTER_B_CONTEXT get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')

if [ -z "$CLUSTER_A_NODE_IP" ] || [ -z "$CLUSTER_B_NODE_IP" ]; then
    error "Could not detect cluster IPs. Are both clusters running?"
    exit 1
fi

# Get actual NodePorts
CLUSTER_A_HTTP_PORT=$(kubectl --context $CLUSTER_A_CONTEXT get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.ports[?(@.name=="http2")].nodePort}')
CLUSTER_B_HTTP_PORT=$(kubectl --context $CLUSTER_B_CONTEXT get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.ports[?(@.name=="http2")].nodePort}')
CLUSTER_A_HTTPS_PORT=$(kubectl --context $CLUSTER_A_CONTEXT get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}')
CLUSTER_B_HTTPS_PORT=$(kubectl --context $CLUSTER_B_CONTEXT get svc -n istio-system istio-ingressgateway -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}')

echo ""
info "Cluster-A: $CLUSTER_A_NODE_IP (HTTP: $CLUSTER_A_HTTP_PORT, HTTPS: $CLUSTER_A_HTTPS_PORT)"
info "Cluster-B: $CLUSTER_B_NODE_IP (HTTP: $CLUSTER_B_HTTP_PORT, HTTPS: $CLUSTER_B_HTTPS_PORT)"
echo ""

# Apply ServiceEntry for Cluster-A to reach Cluster-B
info "Configuring Cluster-A → Cluster-B connectivity..."
kubectl --context $CLUSTER_A_CONTEXT apply -f - <<EOF
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: cluster-b-gateway
  namespace: $NS_A
spec:
  hosts:
  - cluster-b.external
  addresses:
  - $CLUSTER_B_NODE_IP
  ports:
  - name: http-didcomm
    number: $CLUSTER_B_HTTP_PORT
    protocol: HTTP
  - name: https-didcomm
    number: ${CLUSTER_B_HTTPS_PORT:-30392}
    protocol: HTTPS
  location: MESH_EXTERNAL
  resolution: STATIC
  endpoints:
  - address: $CLUSTER_B_NODE_IP
    ports:
      http-didcomm: $CLUSTER_B_HTTP_PORT
      https-didcomm: ${CLUSTER_B_HTTPS_PORT:-30392}
---
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: veramo-nf-b-external
  namespace: $NS_A
spec:
  hosts:
  - veramo-nf-b.nf-b-namespace.svc.cluster.local
  addresses:
  - 240.0.0.3
  ports:
  - name: http-veramo
    number: 3001
    protocol: HTTP
  location: MESH_EXTERNAL
  resolution: STATIC
  endpoints:
  - address: $CLUSTER_B_NODE_IP
    ports:
      http-veramo: $CLUSTER_B_HTTP_PORT
EOF

# Apply ServiceEntry for Cluster-B to reach Cluster-A
info "Configuring Cluster-B → Cluster-A connectivity..."
kubectl --context $CLUSTER_B_CONTEXT apply -f - <<EOF
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: cluster-a-gateway
  namespace: $NS_B
spec:
  hosts:
  - cluster-a.external
  addresses:
  - $CLUSTER_A_NODE_IP
  ports:
  - name: http-didcomm
    number: $CLUSTER_A_HTTP_PORT
    protocol: HTTP
  - name: https-didcomm
    number: ${CLUSTER_A_HTTPS_PORT:-32236}
    protocol: HTTPS
  location: MESH_EXTERNAL
  resolution: STATIC
  endpoints:
  - address: $CLUSTER_A_NODE_IP
    ports:
      http-didcomm: $CLUSTER_A_HTTP_PORT
      https-didcomm: ${CLUSTER_A_HTTPS_PORT:-32236}
---
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: veramo-nf-a-external
  namespace: $NS_B
spec:
  hosts:
  - veramo-nf-a.nf-a-namespace.svc.cluster.local
  addresses:
  - 240.0.0.2
  ports:
  - name: http-veramo
    number: 3001
    protocol: HTTP
  location: MESH_EXTERNAL
  resolution: STATIC
  endpoints:
  - address: $CLUSTER_A_NODE_IP
    ports:
      http-veramo: $CLUSTER_A_HTTP_PORT
EOF

echo ""
success "Cross-cluster connectivity configured!"
echo ""
echo "Verify with:"
echo "  kubectl --context $CLUSTER_A_CONTEXT get serviceentry -n $NS_A"
echo "  kubectl --context $CLUSTER_B_CONTEXT get serviceentry -n $NS_B"
