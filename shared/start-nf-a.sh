#!/bin/bash
# Start NF-A HTTP Server (local development)

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "🚀 Starting NF-A HTTP Server..."
echo ""

PORT=3000 \
DID_NF_A=did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a \
DB_PATH="${SCRIPT_DIR}/../cluster-a/database-nf-a.sqlite" \
DB_ENCRYPTION_KEY=ed9733675a04a20b91c5beb2196a6c964dce7d520a77be577a8a605911232ba6 \
node --loader ts-node/esm "${SCRIPT_DIR}/didcomm-http-server.ts"
