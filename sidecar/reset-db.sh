#!/bin/bash
# Reset Veramo database on pod startup
# Keeps: DID, Keys, own VC
# Deletes: VPs, Messages, Peer VCs

DB_PATH="${DB_PATH:-/app/database.sqlite}"

if [ -f "$DB_PATH" ]; then
    echo "🧹 Resetting database: $DB_PATH"

    # Get own DID from environment or detect from DB
    OWN_DID="${OWN_DID:-}"

    if [ -n "$OWN_DID" ]; then
        sqlite3 "$DB_PATH" "DELETE FROM presentation;"
        sqlite3 "$DB_PATH" "DELETE FROM message;"
        sqlite3 "$DB_PATH" "DELETE FROM credential WHERE json_extract(raw, '\$.credentialSubject.id') != '$OWN_DID';"
        echo "✅ Database reset complete"
    else
        echo "⚠️ OWN_DID not set, skipping credential cleanup"
        sqlite3 "$DB_PATH" "DELETE FROM presentation;"
        sqlite3 "$DB_PATH" "DELETE FROM message;"
        echo "✅ Presentations and messages cleared"
    fi
else
    echo "ℹ️ No database found at $DB_PATH, skipping reset"
fi
