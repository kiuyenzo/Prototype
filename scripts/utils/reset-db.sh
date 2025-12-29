#!/bin/bash
# Reset Veramo databases locally
# Keeps: DID, Keys, own VC
# Deletes: VPs, Messages, Peer VCs

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Database paths
DBS=(
    "$PROJECT_DIR/data/db-nf-a/database-nf-a.sqlite:did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a"
    "$PROJECT_DIR/data/db-nf-b/database-nf-b.sqlite:did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"
    "$PROJECT_DIR/data/db-issuer/database-issuer.sqlite:did:web:kiuyenzo.github.io:Prototype:dids:did-issuer"
)

for entry in "${DBS[@]}"; do
    DB_PATH="${entry%%:*}"
    OWN_DID="${entry#*:}"

    if [ -f "$DB_PATH" ]; then
        echo "Resetting: $(basename "$DB_PATH")"
        sqlite3 "$DB_PATH" "DELETE FROM presentation;" 2>/dev/null
        sqlite3 "$DB_PATH" "DELETE FROM message;" 2>/dev/null
        sqlite3 "$DB_PATH" "DELETE FROM credential WHERE json_extract(raw, '\$.credentialSubject.id') != '$OWN_DID';" 2>/dev/null
        echo "  Done"
    else
        echo "Not found: $DB_PATH"
    fi
done

echo "All databases reset"
