#!/bin/bash
set -e

echo " Set up Kubernetes Clusters "
./scripts/setup-clusters.sh

echo ""
echo "Build Docker Images and Deploy to Clusters"
./scripts/build-and-deploy.sh

