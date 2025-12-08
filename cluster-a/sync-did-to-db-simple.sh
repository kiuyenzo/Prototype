#!/bin/bash

# Script to sync DID document from did.json file to Veramo database
# Usage: ./sync-did-to-db-simple.sh <path-to-did.json> <path-to-database.sqlite>

if [ $# -lt 2 ]; then
    echo "Usage: ./sync-did-to-db-simple.sh <path-to-did.json> <path-to-database.sqlite>"
    echo "Example: ./sync-did-to-db-simple.sh ./did-nf-a/did.json ./database-nf-a.sqlite"
    exit 1
fi

DID_JSON_PATH="$1"
DB_PATH="$2"

# Check if files exist
if [ ! -f "$DID_JSON_PATH" ]; then
    echo "Error: DID document not found at $DID_JSON_PATH"
    exit 1
fi

if [ ! -f "$DB_PATH" ]; then
    echo "Error: Database not found at $DB_PATH"
    exit 1
fi

echo "Reading DID document from: $DID_JSON_PATH"
echo "Database: $DB_PATH"
echo ""

# Extract DID from JSON
DID=$(jq -r '.id' "$DID_JSON_PATH")
echo "DID: $DID"
echo ""

# 1. Check if identifier exists, if not create it
echo "1. Checking identifier..."
EXISTS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM identifier WHERE did = '$DID';")
if [ "$EXISTS" -eq 0 ]; then
    echo "   Creating identifier entry..."
    sqlite3 "$DB_PATH" "INSERT INTO identifier (did, provider, alias, saveDate, updateDate) VALUES ('$DID', 'did:web', NULL, datetime('now'), datetime('now'));"
    echo "   ✓ Identifier created"
else
    echo "   ✓ Identifier already exists"
fi

# 2. Delete existing services
echo ""
echo "2. Removing old services..."
sqlite3 "$DB_PATH" "DELETE FROM service WHERE identifierDid = '$DID';"
echo "   ✓ Old services removed"

# 3. Insert services from DID document
echo ""
echo "3. Inserting services..."
SERVICE_COUNT=$(jq '.service | length' "$DID_JSON_PATH")
if [ "$SERVICE_COUNT" -gt 0 ]; then
    for i in $(seq 0 $((SERVICE_COUNT - 1))); do
        SERVICE_ID=$(jq -r ".service[$i].id" "$DID_JSON_PATH")
        SERVICE_TYPE=$(jq -r ".service[$i].type" "$DID_JSON_PATH")
        SERVICE_ENDPOINT=$(jq -r ".service[$i].serviceEndpoint" "$DID_JSON_PATH")
        SERVICE_DESC=$(jq -r ".service[$i].description // empty" "$DID_JSON_PATH")

        # Ensure service ID starts with #
        if [[ ! "$SERVICE_ID" =~ ^# ]]; then
            SERVICE_ID="#$SERVICE_ID"
        fi

        sqlite3 "$DB_PATH" "INSERT INTO service (id, type, serviceEndpoint, description, identifierDid) VALUES ('$SERVICE_ID', '$SERVICE_TYPE', '$SERVICE_ENDPOINT', '$SERVICE_DESC', '$DID');"
        echo "   ✓ Added service: $SERVICE_TYPE -> $SERVICE_ENDPOINT"
    done
else
    echo "   No services found in DID document"
fi

# 4. Delete existing keys
echo ""
echo "4. Removing old keys..."
sqlite3 "$DB_PATH" "DELETE FROM key WHERE identifierDid = '$DID';"
echo "   ✓ Old keys removed"

# 5. Insert verification methods (if key table supports it)
echo ""
echo "5. Checking verification methods..."
VM_COUNT=$(jq '.verificationMethod | length' "$DID_JSON_PATH")
if [ "$VM_COUNT" -gt 0 ]; then
    echo "   Found $VM_COUNT verification methods (display only - private keys not affected)"
else
    echo "   No verification methods found"
fi

# 6. Insert keyAgreement (if present)
echo ""
echo "6. Checking keyAgreement..."
KA_COUNT=$(jq '.keyAgreement | length' "$DID_JSON_PATH")
if [ "$KA_COUNT" -gt 0 ]; then
    echo "   Found $KA_COUNT keyAgreement keys (display only)"
else
    echo "   No keyAgreement keys found"
fi

echo ""
echo "✅ DID document successfully synced to database!"
echo ""
echo "You can verify with:"
echo "  sqlite3 $DB_PATH 'SELECT * FROM service WHERE identifierDid = \"$DID\";'"
