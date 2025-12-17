#!/bin/bash
#
# Generate mTLS Certificates for Envoy Gateways
# This script creates separate certificates for Gateway-to-Gateway communication
#
# Certificate Structure:
# - CA (shared between both clusters)
# - Gateway-A: server-cert + client-cert for outgoing connections
# - Gateway-B: server-cert + client-cert for outgoing connections
#

set -e

echo "🔐 Generating mTLS Certificates for Envoy Gateways"
echo ""

# Directories - use absolute path from script location
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
CLUSTER_A_CERTS="$PROJECT_ROOT/cluster-a/envoy/certs"
CLUSTER_B_CERTS="$PROJECT_ROOT/cluster-b/envoy/certs"

# Create directories if they don't exist
mkdir -p "$CLUSTER_A_CERTS"
mkdir -p "$CLUSTER_B_CERTS"

# Check if CA already exists
if [ ! -f "$CLUSTER_A_CERTS/ca-cert.pem" ]; then
    echo "📝 Generating Certificate Authority (CA)..."

    # Generate CA private key
    openssl genrsa -out "$CLUSTER_A_CERTS/ca-key.pem" 4096

    # Generate CA certificate
    openssl req -new -x509 -days 365 -key "$CLUSTER_A_CERTS/ca-key.pem" \
        -out "$CLUSTER_A_CERTS/ca-cert.pem" \
        -subj "/C=DE/ST=Bavaria/L=Munich/O=Prototype/OU=CA/CN=Prototype-CA"

    # Copy CA to cluster B
    cp "$CLUSTER_A_CERTS/ca-cert.pem" "$CLUSTER_B_CERTS/ca-cert.pem"
    cp "$CLUSTER_A_CERTS/ca-key.pem" "$CLUSTER_B_CERTS/ca-key.pem"

    echo "✅ CA generated"
else
    echo "ℹ️  Using existing CA"
fi

# Function to generate gateway certificates
generate_gateway_cert() {
    local GATEWAY_NAME=$1
    local CERT_DIR=$2
    local SAN=$3

    echo ""
    echo "📝 Generating certificates for $GATEWAY_NAME..."

    # Server Certificate (for incoming connections)
    echo "   - Server certificate (SAN: $SAN)"

    # Generate server private key
    openssl genrsa -out "$CERT_DIR/gateway-server-key.pem" 4096

    # Generate server CSR
    openssl req -new -key "$CERT_DIR/gateway-server-key.pem" \
        -out "$CERT_DIR/gateway-server.csr" \
        -subj "/C=DE/ST=Bavaria/L=Munich/O=Prototype/OU=Gateway/CN=$SAN"

    # Create SAN config
    cat > "$CERT_DIR/gateway-server-san.cnf" <<EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req

[req_distinguished_name]

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = $SAN
DNS.2 = localhost
EOF

    # Sign server certificate
    openssl x509 -req -days 365 \
        -in "$CERT_DIR/gateway-server.csr" \
        -CA "$CERT_DIR/ca-cert.pem" \
        -CAkey "$CERT_DIR/ca-key.pem" \
        -CAcreateserial \
        -out "$CERT_DIR/gateway-server-cert.pem" \
        -extensions v3_req \
        -extfile "$CERT_DIR/gateway-server-san.cnf"

    # Client Certificate (for outgoing connections)
    echo "   - Client certificate (SAN: $SAN)"

    # Generate client private key
    openssl genrsa -out "$CERT_DIR/gateway-client-key.pem" 4096

    # Generate client CSR
    openssl req -new -key "$CERT_DIR/gateway-client-key.pem" \
        -out "$CERT_DIR/gateway-client.csr" \
        -subj "/C=DE/ST=Bavaria/L=Munich/O=Prototype/OU=Gateway-Client/CN=$SAN"

    # Sign client certificate (with same SAN)
    openssl x509 -req -days 365 \
        -in "$CERT_DIR/gateway-client.csr" \
        -CA "$CERT_DIR/ca-cert.pem" \
        -CAkey "$CERT_DIR/ca-key.pem" \
        -CAcreateserial \
        -out "$CERT_DIR/gateway-client-cert.pem" \
        -extensions v3_req \
        -extfile "$CERT_DIR/gateway-server-san.cnf"

    # Cleanup CSR and config files
    rm "$CERT_DIR/gateway-server.csr" "$CERT_DIR/gateway-client.csr" "$CERT_DIR/gateway-server-san.cnf"

    echo "✅ Certificates for $GATEWAY_NAME generated"
}

# Generate Gateway A certificates
generate_gateway_cert "Gateway-A" "$CLUSTER_A_CERTS" "envoy-gateway-a"

# Generate Gateway B certificates
generate_gateway_cert "Gateway-B" "$CLUSTER_B_CERTS" "envoy-gateway-b"

echo ""
echo "🎉 All gateway certificates generated successfully!"
echo ""
echo "📁 Certificates location:"
echo "   Cluster A: $CLUSTER_A_CERTS"
echo "   Cluster B: $CLUSTER_B_CERTS"
echo ""
echo "⚠️  Note: The old proxy certificates (client-cert.pem, server-cert.pem) are kept for proxy-gateway communication"
echo "    Use gateway-*-cert.pem for gateway-to-gateway communication"
