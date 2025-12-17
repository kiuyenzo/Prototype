#!/bin/sh
set -e

echo "================================================================================
🚀 Veramo NF Startup Script
================================================================================
"

# Determine which cluster this is based on environment variables
if [ "$DID_NF_A" ]; then
    CLUSTER="cluster-a"
    DB_PATH="${DB_PATH:-/app/cluster-a/database-nf-a.sqlite}"
    NF_DID="$DID_NF_A"
    ISSUER_DID="did:web:kiuyenzo.github.io:Prototype:cluster-a:did-issuer-a"
    echo "📍 Cluster: A"
elif [ "$DID_NF_B" ]; then
    CLUSTER="cluster-b"
    DB_PATH="${DB_PATH:-/app/cluster-b/database-nf-b.sqlite}"
    NF_DID="$DID_NF_B"
    ISSUER_DID="did:web:kiuyenzo.github.io:Prototype:cluster-b:did-issuer-b"
    echo "📍 Cluster: B"
else
    echo "❌ Error: Neither DID_NF_A nor DID_NF_B is set"
    exit 1
fi

echo "   Database: $DB_PATH"
echo "   NF DID: $NF_DID"
echo ""

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    echo "📦 Database not found - will be created by Veramo on first run"
else
    echo "✅ Database found: $DB_PATH"
fi

# Check credential count
CRED_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM credential" 2>/dev/null || echo "0")
echo "🎫 Current credentials: $CRED_COUNT"

if [ "$CRED_COUNT" -eq "0" ]; then
    echo ""
    echo "⚠️  No credentials found - creating self-signed NetworkFunctionCredential..."
    echo ""

    # Create self-signed credentials (NF signs its own credential)
    # This is simpler for a prototype and doesn't require a separate issuer DID
    if node /app/shared/create-self-signed-credential.js "$DB_PATH" "$NF_DID" "$CLUSTER"; then
        echo ""
        echo "✅ Self-signed credentials created successfully"
    else
        echo ""
        echo "⚠️  Credential creation failed, but continuing anyway"
        echo "   (Credentials may be created later if needed)"
    fi
else
    echo "✅ Credentials already exist - skipping creation"
fi

echo ""
echo "================================================================================
🎯 Starting DIDComm HTTP Server...
================================================================================
"

# Start the main application
exec node /app/shared/didcomm-http-server.js
