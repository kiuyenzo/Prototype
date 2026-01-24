#!/bin/sh

echo "[START] Veramo Sidecar starting..."

if [ -f "$DB_PATH" ]; then
    echo "[RESET] Resetting database on startup..."

    sqlite3 "$DB_PATH" "DELETE FROM presentation;" 2>/dev/null
    sqlite3 "$DB_PATH" "DELETE FROM message;" 2>/dev/null

    if [ -n "$OWN_DID" ]; then
        sqlite3 "$DB_PATH" "DELETE FROM credential WHERE json_extract(raw, '\$.credentialSubject.id') != '$OWN_DID';" 2>/dev/null

        ALIAS=$(echo "$OWN_DID" | grep -oE 'did-nf-[ab]$' || echo "own")
        sqlite3 "$DB_PATH" "INSERT OR REPLACE INTO identifier (did, provider, alias, saveDate, updateDate, controllerKeyId) VALUES ('$OWN_DID', 'did:web', '$ALIAS', datetime('now'), datetime('now'), '$OWN_DID#key-1');"
        echo "[OK] Database reset + identifier registered: $OWN_DID"

        # Check if credentials exist, create if not
        VC_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM credential;" 2>/dev/null || echo "0")
        if [ "$VC_COUNT" = "0" ]; then
            echo "[INIT] No credentials found, creating..."
            node /app/scripts/create-credentials.mjs 2>/dev/null || echo "[WARN] Could not create credentials"
        fi
    else
        echo "[OK] Database reset (kept: DIDs, Keys, VCs)"
    fi
else
    echo "[INFO] No database found, starting fresh"
fi

exec node src/app/veramo-sidecar.js
