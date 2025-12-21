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
        sqlite3 "$DB_PATH" "DELETE FROM identifier WHERE did != '$OWN_DID';" 2>/dev/null
        echo "✅ Database reset (kept: own DID, Keys, own VC)"
    else
        echo "✅ Database reset (kept: DIDs, Keys, VCs)"
    fi
else
    echo "ℹ️ No database found, starting fresh"
fi

# Start the sidecar
exec node src/veramo-sidecar.js
