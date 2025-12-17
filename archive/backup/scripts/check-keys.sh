#!/bin/bash
# Script to check if X25519 keys exist in Veramo databases

echo "════════════════════════════════════════════════════════════"
echo "  Checking X25519 Keys in Veramo Databases"
echo "════════════════════════════════════════════════════════════"
echo ""

# Check NF-A Database
echo "📁 Cluster A - NF-A Database:"
echo "────────────────────────────────────────────────────────────"

echo "DIDs:"
sqlite3 cluster-a/database-nf-a.sqlite "SELECT did, provider FROM identifier;" 2>/dev/null | while IFS='|' read -r did provider; do
  echo "  ✓ $did ($provider)"
done

echo ""
echo "Keys by Type:"
sqlite3 cluster-a/database-nf-a.sqlite "SELECT type, COUNT(*) FROM key GROUP BY type;" 2>/dev/null | while IFS='|' read -r type count; do
  if [ "$type" = "X25519" ]; then
    echo "  ✅ $type: $count"
  else
    echo "  • $type: $count"
  fi
done

echo ""
X25519_COUNT_A=$(sqlite3 cluster-a/database-nf-a.sqlite "SELECT COUNT(*) FROM key WHERE type='X25519';" 2>/dev/null)

if [ "$X25519_COUNT_A" -eq 0 ]; then
  echo "❌ NO X25519 keys found in NF-A database!"
  echo "   → Run: npx ts-node scripts/add-x25519-keys.ts"
else
  echo "✅ X25519 keys found: $X25519_COUNT_A"
  echo ""
  echo "X25519 Key Details:"
  sqlite3 cluster-a/database-nf-a.sqlite "SELECT kid, publicKeyHex FROM key WHERE type='X25519';" 2>/dev/null | while IFS='|' read -r kid pubkey; do
    echo "  • KID: ${kid:0:20}..."
    echo "    Public Key: ${pubkey:0:40}..."
  done
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo ""

# Check NF-B Database
echo "📁 Cluster B - NF-B Database:"
echo "────────────────────────────────────────────────────────────"

echo "DIDs:"
sqlite3 cluster-b/database-nf-b.sqlite "SELECT did, provider FROM identifier;" 2>/dev/null | while IFS='|' read -r did provider; do
  echo "  ✓ $did ($provider)"
done

echo ""
echo "Keys by Type:"
sqlite3 cluster-b/database-nf-b.sqlite "SELECT type, COUNT(*) FROM key GROUP BY type;" 2>/dev/null | while IFS='|' read -r type count; do
  if [ "$type" = "X25519" ]; then
    echo "  ✅ $type: $count"
  else
    echo "  • $type: $count"
  fi
done

echo ""
X25519_COUNT_B=$(sqlite3 cluster-b/database-nf-b.sqlite "SELECT COUNT(*) FROM key WHERE type='X25519';" 2>/dev/null)

if [ "$X25519_COUNT_B" -eq 0 ]; then
  echo "❌ NO X25519 keys found in NF-B database!"
  echo "   → Run: npx ts-node scripts/add-x25519-keys.ts"
else
  echo "✅ X25519 keys found: $X25519_COUNT_B"
  echo ""
  echo "X25519 Key Details:"
  sqlite3 cluster-b/database-nf-b.sqlite "SELECT kid, publicKeyHex FROM key WHERE type='X25519';" 2>/dev/null | while IFS='|' read -r kid pubkey; do
    echo "  • KID: ${kid:0:20}..."
    echo "    Public Key: ${pubkey:0:40}..."
  done
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo ""

# Summary
TOTAL_X25519=$((X25519_COUNT_A + X25519_COUNT_B))

if [ "$TOTAL_X25519" -eq 0 ]; then
  echo "❌ CRITICAL: No X25519 keys found in any database!"
  echo ""
  echo "Without X25519 keys, DIDComm authcrypt will NOT work."
  echo ""
  echo "Next steps:"
  echo "1. Run: npx ts-node scripts/add-x25519-keys.ts"
  echo "2. Update DID Documents with keyAgreement section"
  echo "3. Re-run this script to verify"
  exit 1
else
  echo "✅ Total X25519 keys found: $TOTAL_X25519"
  echo ""
  echo "Next steps:"
  echo "1. Update DID Documents (did.json files) with keyAgreement section"
  echo "2. See scripts/generate-x25519-example.md for format"
  echo ""
  echo "Example keyAgreement section:"
  echo '  "keyAgreement": ['
  echo '    {'
  echo '      "id": "did:web:nf-a.example.com#key-agreement-1",'
  echo '      "type": "X25519KeyAgreementKey2019",'
  echo '      "controller": "did:web:nf-a.example.com",'
  echo '      "publicKeyHex": "<YOUR_X25519_PUBLIC_KEY>"'
  echo '    }'
  echo '  ]'
  exit 0
fi
