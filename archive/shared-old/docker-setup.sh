#!/bin/bash
# Docker Setup Script for Prototype
#
# This script sets up the Docker environment for both clusters

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║             Docker Environment Setup                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Create inter-cluster network
echo "📋 Step 1: Creating inter-cluster Docker network..."
if docker network inspect inter-cluster-network >/dev/null 2>&1; then
  echo "   Network already exists, skipping..."
else
  docker network create inter-cluster-network
  echo "✅ Inter-cluster network created"
fi

# Step 2: Generate certificates if not exist
echo ""
echo "📋 Step 2: Checking mTLS certificates..."
if [ ! -f "${SCRIPT_DIR}/cluster-a/envoy/certs/ca-cert.pem" ]; then
  echo "   Certificates not found, generating..."
  bash "${SCRIPT_DIR}/generate-certs.sh"
else
  echo "✅ Certificates already exist"
fi

# Step 3: Start Cluster A
echo ""
echo "📋 Step 3: Starting Cluster A..."
cd "${SCRIPT_DIR}/cluster-a"
docker-compose up -d
echo "✅ Cluster A started"

# Step 4: Start Cluster B
echo ""
echo "📋 Step 4: Starting Cluster B..."
cd "${SCRIPT_DIR}/cluster-b"
docker-compose up -d
echo "✅ Cluster B started"

# Step 5: Wait for services to be ready
echo ""
echo "📋 Step 5: Waiting for services to be ready..."
sleep 5

# Health checks
echo ""
echo "🏥 Health Checks:"
echo "   Checking Veramo NF-A..."
curl -s http://localhost:3000/health | jq '.' || echo "   ⚠️  NF-A not ready yet"

echo "   Checking Veramo NF-B..."
curl -s http://localhost:3001/health | jq '.' || echo "   ⚠️  NF-B not ready yet"

echo "   Checking Envoy Proxy NF-A..."
curl -s http://localhost:9901/ready || echo "   ⚠️  Envoy Proxy NF-A not ready yet"

echo "   Checking Envoy Proxy NF-B..."
curl -s http://localhost:9903/ready || echo "   ⚠️  Envoy Proxy NF-B not ready yet"

# Summary
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                 Docker Setup Complete                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "📊 Service URLs:"
echo ""
echo "Cluster A:"
echo "   Veramo NF-A:         http://localhost:3000"
echo "   Envoy Proxy NF-A:    http://localhost:8080"
echo "   Envoy Gateway A:     https://localhost:8443 (internal)"
echo "   Envoy Gateway A Ext: https://localhost:8444 (external)"
echo "   Admin Proxy:         http://localhost:9901"
echo "   Admin Gateway:       http://localhost:9902"
echo ""
echo "Cluster B:"
echo "   Veramo NF-B:         http://localhost:3001"
echo "   Envoy Proxy NF-B:    http://localhost:8082"
echo "   Envoy Gateway B:     https://localhost:8445 (internal)"
echo "   Envoy Gateway B Ext: https://localhost:8446 (external)"
echo "   Admin Proxy:         http://localhost:9903"
echo "   Admin Gateway:       http://localhost:9904"
echo ""
echo "📝 Useful Commands:"
echo "   View logs:     docker-compose -f cluster-a/docker-compose.yml logs -f"
echo "   Stop all:      docker-compose -f cluster-a/docker-compose.yml down && docker-compose -f cluster-b/docker-compose.yml down"
echo "   Restart:       bash docker-setup.sh"
echo ""
