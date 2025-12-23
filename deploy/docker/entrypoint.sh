#!/bin/sh
# Veramo Sidecar Entrypoint
# Resets database on startup, then starts the sidecar

echo "🚀 Veramo Sidecar starting..."

# Reset database if it exists
if [ -f "$DB_PATH" ]; then
    echo "🧹 Resetting database on startup..."

    # Full reset: Delete VPs, Messages, peer VCs, and peer DIDs
    # Keep only: own DID, own Keys, own VC
    sqlite3 "$DB_PATH" "DELETE FROM presentation;" 2>/dev/null
    sqlite3 "$DB_PATH" "DELETE FROM message;" 2>/dev/null

    if [ -n "$OWN_DID" ]; then
        sqlite3 "$DB_PATH" "DELETE FROM credential WHERE json_extract(raw, '\$.credentialSubject.id') != '$OWN_DID';" 2>/dev/null
        # Keep peer identifiers for VP save foreign key constraints
        # sqlite3 "$DB_PATH" "DELETE FROM identifier WHERE did != '$OWN_DID';" 2>/dev/null

        # Always ensure own DID is registered as identifier
        # Extract alias from DID (did-nf-a or did-nf-b)
        ALIAS=$(echo "$OWN_DID" | grep -oE 'did-nf-[ab]$' || echo "own")
        sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO identifier (did, provider, alias, saveDate, updateDate, controllerKeyId) VALUES ('$OWN_DID', 'did:web', '$ALIAS', datetime('now'), datetime('now'), '$OWN_DID#key-1');"
        echo "✅ Database reset + identifier registered: $OWN_DID"
    else
        echo "✅ Database reset (kept: DIDs, Keys, VCs)"
    fi
else
    echo "ℹ️ No database found, starting fresh"
fi

# Start the sidecar
exec node src/veramo-sidecar.js
