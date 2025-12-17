#!/bin/bash
# Generate mTLS certificates for Envoy Proxies and Gateways
#
# This script creates:
# - CA certificate (ca-cert.pem, ca-key.pem)
# - Server certificates for Envoy Gateways
# - Client certificates for Envoy Proxies

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CERTS_DIR_A="${SCRIPT_DIR}/cluster-a/envoy/certs"
CERTS_DIR_B="${SCRIPT_DIR}/cluster-b/envoy/certs"

# Create cert directories
mkdir -p "${CERTS_DIR_A}"
mkdir -p "${CERTS_DIR_B}"

echo "🔐 Generating mTLS certificates for Envoy..."

# ============================================================================
# 1. Generate CA (Certificate Authority)
# ============================================================================
echo ""
echo "📋 Step 1: Generating CA certificate..."

openssl req -x509 -newkey rsa:4096 -keyout "${CERTS_DIR_A}/ca-key.pem" \
  -out "${CERTS_DIR_A}/ca-cert.pem" -days 365 -nodes \
  -subj "/C=DE/ST=Bavaria/L=Munich/O=Prototype/OU=CA/CN=Prototype-CA"

# Copy CA to cluster-b
cp "${CERTS_DIR_A}/ca-cert.pem" "${CERTS_DIR_B}/ca-cert.pem"
cp "${CERTS_DIR_A}/ca-key.pem" "${CERTS_DIR_B}/ca-key.pem"

echo "✅ CA certificate created"

# ============================================================================
# 2. Generate Server Certificates for Envoy Gateways
# ============================================================================
echo ""
echo "📋 Step 2: Generating server certificates for Envoy Gateways..."

# Cluster A - Gateway
openssl req -newkey rsa:4096 -keyout "${CERTS_DIR_A}/server-key.pem" \
  -out "${CERTS_DIR_A}/server.csr" -nodes \
  -subj "/C=DE/ST=Bavaria/L=Munich/O=Prototype/OU=Cluster-A/CN=envoy-gateway-a"

# Add SAN for DNS name
cat > "${CERTS_DIR_A}/server.ext" << EOF
subjectAltName = DNS:envoy-gateway-a,DNS:localhost
EOF

openssl x509 -req -in "${CERTS_DIR_A}/server.csr" \
  -CA "${CERTS_DIR_A}/ca-cert.pem" -CAkey "${CERTS_DIR_A}/ca-key.pem" \
  -CAcreateserial -out "${CERTS_DIR_A}/server-cert.pem" -days 365 \
  -extfile "${CERTS_DIR_A}/server.ext"

rm "${CERTS_DIR_A}/server.csr" "${CERTS_DIR_A}/server.ext"

echo "✅ Server certificate for Cluster A created"

# Cluster B - Gateway
openssl req -newkey rsa:4096 -keyout "${CERTS_DIR_B}/server-key.pem" \
  -out "${CERTS_DIR_B}/server.csr" -nodes \
  -subj "/C=DE/ST=Bavaria/L=Munich/O=Prototype/OU=Cluster-B/CN=envoy-gateway-b"

# Add SAN for DNS name
cat > "${CERTS_DIR_B}/server.ext" << EOF
subjectAltName = DNS:envoy-gateway-b,DNS:localhost
EOF

openssl x509 -req -in "${CERTS_DIR_B}/server.csr" \
  -CA "${CERTS_DIR_B}/ca-cert.pem" -CAkey "${CERTS_DIR_B}/ca-key.pem" \
  -CAcreateserial -out "${CERTS_DIR_B}/server-cert.pem" -days 365 \
  -extfile "${CERTS_DIR_B}/server.ext"

rm "${CERTS_DIR_B}/server.csr" "${CERTS_DIR_B}/server.ext"

echo "✅ Server certificate for Cluster B created"

# ============================================================================
# 3. Generate Client Certificates for Envoy Proxies
# ============================================================================
echo ""
echo "📋 Step 3: Generating client certificates for Envoy Proxies..."

# Cluster A - Proxy
openssl req -newkey rsa:4096 -keyout "${CERTS_DIR_A}/client-key.pem" \
  -out "${CERTS_DIR_A}/client.csr" -nodes \
  -subj "/C=DE/ST=Bavaria/L=Munich/O=Prototype/OU=Cluster-A/CN=envoy-proxy-nf-a"

# Add SAN for DNS name
cat > "${CERTS_DIR_A}/client.ext" << EOF
subjectAltName = DNS:envoy-proxy-nf-a,DNS:localhost
EOF

openssl x509 -req -in "${CERTS_DIR_A}/client.csr" \
  -CA "${CERTS_DIR_A}/ca-cert.pem" -CAkey "${CERTS_DIR_A}/ca-key.pem" \
  -CAcreateserial -out "${CERTS_DIR_A}/client-cert.pem" -days 365 \
  -extfile "${CERTS_DIR_A}/client.ext"

rm "${CERTS_DIR_A}/client.csr" "${CERTS_DIR_A}/client.ext"

echo "✅ Client certificate for Cluster A created"

# Cluster B - Proxy
openssl req -newkey rsa:4096 -keyout "${CERTS_DIR_B}/client-key.pem" \
  -out "${CERTS_DIR_B}/client.csr" -nodes \
  -subj "/C=DE/ST=Bavaria/L=Munich/O=Prototype/OU=Cluster-B/CN=envoy-proxy-nf-b"

# Add SAN for DNS name
cat > "${CERTS_DIR_B}/client.ext" << EOF
subjectAltName = DNS:envoy-proxy-nf-b,DNS:localhost
EOF

openssl x509 -req -in "${CERTS_DIR_B}/client.csr" \
  -CA "${CERTS_DIR_B}/ca-cert.pem" -CAkey "${CERTS_DIR_B}/ca-key.pem" \
  -CAcreateserial -out "${CERTS_DIR_B}/client-cert.pem" -days 365 \
  -extfile "${CERTS_DIR_B}/client.ext"

rm "${CERTS_DIR_B}/client.csr" "${CERTS_DIR_B}/client.ext"

echo "✅ Client certificate for Cluster B created"

# ============================================================================
# 4. Set proper permissions
# ============================================================================
echo ""
echo "📋 Step 4: Setting proper permissions..."

chmod 644 "${CERTS_DIR_A}"/*.pem
chmod 644 "${CERTS_DIR_B}"/*.pem
chmod 600 "${CERTS_DIR_A}"/*-key.pem
chmod 600 "${CERTS_DIR_B}"/*-key.pem

echo "✅ Permissions set"

# ============================================================================
# 5. Summary
# ============================================================================
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           mTLS Certificates Generated Successfully            ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "📁 Cluster A certificates:"
echo "   CA:     ${CERTS_DIR_A}/ca-cert.pem"
echo "   Server: ${CERTS_DIR_A}/server-cert.pem"
echo "   Client: ${CERTS_DIR_A}/client-cert.pem"
echo ""
echo "📁 Cluster B certificates:"
echo "   CA:     ${CERTS_DIR_B}/ca-cert.pem"
echo "   Server: ${CERTS_DIR_B}/server-cert.pem"
echo "   Client: ${CERTS_DIR_B}/client-cert.pem"
echo ""
echo "🔒 All certificates valid for 365 days"
echo ""
