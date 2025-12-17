#!/usr/bin/env node
"use strict";
/**
 * Local DID Resolver
 *
 * Resolves did:web DIDs from local files when external network is unavailable.
 * Falls back to web resolution if local file not found.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLocalDIDResolver = getLocalDIDResolver;
exports.createLocalResolver = createLocalResolver;

const fs = require('fs');
const path = require('path');

// Mapping of DID prefixes to local file paths
const DID_FILE_PATHS = {
  'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a': '/app/cluster-a/did-nf-a/did.json',
  'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-issuer-a': '/app/cluster-a/did-issuer-a/did.json',
  'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b': '/app/cluster-b/did-nf-b/did.json',
  'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-issuer-b': '/app/cluster-b/did-issuer-b/did.json',
};

/**
 * Get local DID resolver for did:web method
 */
function getLocalDIDResolver() {
  return {
    web: async (did, parsed) => {
      console.log(`🔍 Local DID resolver: ${did}`);

      // Check if we have a local file for this DID
      const localPath = DID_FILE_PATHS[did];
      if (localPath && fs.existsSync(localPath)) {
        try {
          const didDocument = JSON.parse(fs.readFileSync(localPath, 'utf8'));
          console.log(`   ✅ Resolved from local file: ${localPath}`);
          return {
            didDocument,
            didResolutionMetadata: { contentType: 'application/did+json' },
            didDocumentMetadata: {}
          };
        } catch (error) {
          console.error(`   ❌ Failed to read local DID file: ${error.message}`);
        }
      }

      // Fallback: try to resolve from web (will fail if no network)
      console.log(`   ⚠️  No local file for ${did}, attempting web resolution...`);
      return null; // Return null to let the chain continue to web resolver
    }
  };
}

/**
 * Create a combined resolver with local files first, then web fallback
 */
function createLocalResolver(webResolver) {
  const localResolver = getLocalDIDResolver();

  return {
    web: async (did, parsed, resolver, options) => {
      // Try local first
      const localResult = await localResolver.web(did, parsed);
      if (localResult) {
        return localResult;
      }

      // Fall back to web resolver
      if (webResolver && webResolver.web) {
        console.log(`   Falling back to web resolver...`);
        return webResolver.web(did, parsed, resolver, options);
      }

      return {
        didDocument: null,
        didResolutionMetadata: { error: 'notFound', message: 'DID not found locally or via web' },
        didDocumentMetadata: {}
      };
    }
  };
}

exports.default = { getLocalDIDResolver, createLocalResolver };
