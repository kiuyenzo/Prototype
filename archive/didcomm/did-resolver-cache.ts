#!/usr/bin/env ts-node
/**
 * DID Document Resolver with GitHub did:web Resolution
 *
 * This module resolves DID documents via:
 * 1. Cache (if available)
 * 2. GitHub Pages (did:web over HTTPS)
 * 3. Local fallback (for offline testing)
 */

import * as fs from 'fs';
import https from 'https';

/**
 * Cache for resolved DID documents
 */
const didDocumentCache: Map<string, any> = new Map();

/**
 * Local fallback paths (used if GitHub is unreachable)
 */
const LOCAL_FALLBACK_PATHS: Record<string, string> = {
  'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a': '/app/cluster-a/did-nf-a/did.json',
  'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b': '/app/cluster-b/did-nf-b/did.json',
};

/**
 * Convert did:web to HTTPS URL
 * did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a
 * → https://kiuyenzo.github.io/Prototype/cluster-a/did-nf-a/did.json
 */
function didWebToUrl(did: string): string | null {
  if (!did.startsWith('did:web:')) {
    return null;
  }

  const parts = did.replace('did:web:', '').split(':');
  const domain = parts[0];
  const path = parts.slice(1).join('/');

  return `https://${domain}/${path}/did.json`;
}

/**
 * Fetch DID document from GitHub via HTTPS
 */
async function fetchFromGitHub(did: string): Promise<any | null> {
  const url = didWebToUrl(did);
  if (!url) {
    console.log(`⚠️  Cannot convert DID to URL: ${did}`);
    return null;
  }

  console.log(`🌐 Fetching DID from GitHub: ${url}`);

  return new Promise((resolve) => {
    const startTime = Date.now();

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const elapsed = Date.now() - startTime;

        if (res.statusCode === 200) {
          try {
            const didDocument = JSON.parse(data);
            console.log(`✅ Resolved DID from GitHub (${elapsed}ms): ${did}`);
            resolve(didDocument);
          } catch (e) {
            console.error(`❌ Invalid JSON from GitHub`);
            resolve(null);
          }
        } else {
          console.log(`⚠️  GitHub returned ${res.statusCode} for ${did}`);
          resolve(null);
        }
      });
    }).on('error', (err) => {
      console.log(`⚠️  GitHub fetch failed: ${err.message}`);
      resolve(null);
    });
  });
}

/**
 * Load a DID document from local filesystem (fallback)
 */
function loadLocalDIDDocument(did: string): any | null {
  try {
    const filePath = LOCAL_FALLBACK_PATHS[did];
    if (!filePath) {
      return null;
    }

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const didDocument = JSON.parse(content);

    console.log(`📦 Loaded local fallback DID for ${did}`);
    return didDocument;
  } catch (error: any) {
    return null;
  }
}

/**
 * Resolve a DID document
 * Priority: 1. Cache → 2. GitHub (did:web) → 3. Local fallback
 *
 * @param did - DID to resolve
 * @param agent - Veramo agent (optional)
 * @returns DID document or null
 */
export async function resolveDIDDocument(did: string, agent?: any): Promise<any | null> {
  // 1. Check cache first
  if (didDocumentCache.has(did)) {
    console.log(`📦 Using cached DID document for ${did}`);
    return didDocumentCache.get(did);
  }

  // 2. Try GitHub (did:web resolution)
  const githubDoc = await fetchFromGitHub(did);
  if (githubDoc) {
    didDocumentCache.set(did, githubDoc);
    return githubDoc;
  }

  // 3. Local fallback
  const localDoc = loadLocalDIDDocument(did);
  if (localDoc) {
    didDocumentCache.set(did, localDoc);
    return localDoc;
  }

  // 4. Agent fallback
  if (agent && agent.resolveDid) {
    try {
      console.log(`🔍 Resolving DID via agent: ${did}`);
      const result = await agent.resolveDid({ didUrl: did });
      if (result && result.didDocument) {
        didDocumentCache.set(did, result.didDocument);
        return result.didDocument;
      }
    } catch (error: any) {
      console.error(`❌ Agent DID resolution failed:`, error.message);
    }
  }

  console.error(`❌ Could not resolve DID: ${did}`);
  return null;
}

/**
 * Extract encryption key from DID document
 *
 * @param didDocument - DID document
 * @returns Public key for encryption or null
 */
export function extractEncryptionKey(didDocument: any): any | null {
  if (!didDocument || !didDocument.verificationMethod) {
    return null;
  }

  // Look for keyAgreement keys (used for encryption)
  if (didDocument.keyAgreement && didDocument.keyAgreement.length > 0) {
    const keyAgreementId = didDocument.keyAgreement[0];

    // Find the verification method
    const keyMethod = didDocument.verificationMethod.find(
      (vm: any) => vm.id === keyAgreementId || vm.id.endsWith(keyAgreementId.split('#')[1])
    );

    if (keyMethod) {
      console.log(`✅ Found keyAgreement key: ${keyMethod.id}`);
      return keyMethod;
    }
  }

  // Fallback: use first verification method
  const firstKey = didDocument.verificationMethod[0];
  console.log(`⚠️  No keyAgreement found, using first key: ${firstKey?.id}`);
  return firstKey;
}

/**
 * Get recipient public key for encryption
 *
 * @param recipientDid - DID of the recipient
 * @param agent - Veramo agent
 * @returns Public key or null
 */
export async function getRecipientPublicKey(recipientDid: string, agent?: any): Promise<any | null> {
  const didDocument = await resolveDIDDocument(recipientDid, agent);
  if (!didDocument) {
    return null;
  }

  return extractEncryptionKey(didDocument);
}

/**
 * Pre-cache known DIDs for faster access
 */
export function precacheDIDs(): void {
  console.log('📦 Pre-caching known DIDs...');

  for (const did of Object.keys(LOCAL_FALLBACK_PATHS)) {
    const doc = loadLocalDIDDocument(did);
    if (doc) {
      didDocumentCache.set(did, doc);
    }
  }

  console.log(`✅ Cached ${didDocumentCache.size} DID documents`);
}

/**
 * Clear DID cache
 */
export function clearCache(): void {
  didDocumentCache.clear();
  console.log('🗑️  DID cache cleared');
}
