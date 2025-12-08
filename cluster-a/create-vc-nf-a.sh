#!/bin/bash

# Script to create a Verifiable Credential for NF-A
# Usage: ./create-vc-nf-a.sh

ISSUER_DID="did:web:kiuyenzo.github.io:Prototype:cluster-a:did-issuer-a"
SUBJECT_DID="did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a"

echo "Creating Verifiable Credential..."
echo "Issuer: $ISSUER_DID"
echo "Subject: $SUBJECT_DID"
echo ""

# Create the credential
veramo credential create \
  --issuer "$ISSUER_DID" \
  --subject "$SUBJECT_DID" \
  --type "NetworkFunctionCredential" \
  --claim.role "network-function" \
  --claim.clusterId "cluster-a" \
  --claim.status "active" \
  --claim.capabilities "messaging,verification" \
  --save

echo ""
echo "✅ Credential created and saved to database!"
echo ""
echo "To verify the credential:"
echo "  veramo credential list"
