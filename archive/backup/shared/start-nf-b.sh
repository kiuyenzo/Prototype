#!/bin/bash
# Start NF-B HTTP Server (local development)

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "🚀 Starting NF-B HTTP Server..."
echo ""

PORT=3001 \
DID_NF_B=did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b \
DB_PATH="${SCRIPT_DIR}/../cluster-b/database-nf-b.sqlite" \
DB_ENCRYPTION_KEY=3859413b662c8fc7e632cda1fe9d5f07991c0b5d2bd2d8a69fa36e9e25cfef1d \
node --loader ts-node/esm "${SCRIPT_DIR}/didcomm-http-server.ts"
