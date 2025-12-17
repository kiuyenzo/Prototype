#!/usr/bin/env ts-node
"use strict";
/**
 * DID Document Resolver with GitHub did:web Resolution
 *
 * This module resolves DID documents via:
 * 1. Cache (if available)
 * 2. GitHub Pages (did:web over HTTPS)
 * 3. Local fallback (for offline testing)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDIDDocument = resolveDIDDocument;
exports.extractEncryptionKey = extractEncryptionKey;
exports.getRecipientPublicKey = getRecipientPublicKey;
exports.precacheDIDs = precacheDIDs;
exports.clearCache = clearCache;
const fs = __importStar(require("fs"));
const https = __importStar(require("https"));

/**
 * Cache for resolved DID documents
 */
const didDocumentCache = new Map();

/**
 * Local fallback paths (used if GitHub is unreachable)
 */
const LOCAL_FALLBACK_PATHS = {
    'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a': '/app/cluster-a/did-nf-a/did.json',
    'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b': '/app/cluster-b/did-nf-b/did.json',
};

/**
 * Convert did:web to HTTPS URL
 * did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a
 * → https://kiuyenzo.github.io/Prototype/cluster-a/did-nf-a/did.json
 */
function didWebToUrl(did) {
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
async function fetchFromGitHub(did) {
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
function loadLocalDIDDocument(did) {
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
    }
    catch (error) {
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
async function resolveDIDDocument(did, agent) {
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
        }
        catch (error) {
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
function extractEncryptionKey(didDocument) {
    if (!didDocument || !didDocument.verificationMethod) {
        return null;
    }
    // Look for keyAgreement keys (used for encryption)
    if (didDocument.keyAgreement && didDocument.keyAgreement.length > 0) {
        const keyAgreementId = didDocument.keyAgreement[0];
        // Find the verification method
        const keyMethod = didDocument.verificationMethod.find((vm) => vm.id === keyAgreementId || vm.id.endsWith(keyAgreementId.split('#')[1]));
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
async function getRecipientPublicKey(recipientDid, agent) {
    const didDocument = await resolveDIDDocument(recipientDid, agent);
    if (!didDocument) {
        return null;
    }
    return extractEncryptionKey(didDocument);
}

/**
 * Pre-cache known DIDs from GitHub for faster access
 */
async function precacheDIDs() {
    console.log('📦 Pre-caching known DIDs from GitHub...');
    for (const did of Object.keys(LOCAL_FALLBACK_PATHS)) {
        // Try GitHub first
        const githubDoc = await fetchFromGitHub(did);
        if (githubDoc) {
            didDocumentCache.set(did, githubDoc);
        } else {
            // Fallback to local if GitHub fails
            const localDoc = loadLocalDIDDocument(did);
            if (localDoc) {
                didDocumentCache.set(did, localDoc);
            }
        }
    }
    console.log(`✅ Cached ${didDocumentCache.size} DID documents`);
}

/**
 * Clear DID cache
 */
function clearCache() {
    didDocumentCache.clear();
    console.log('🗑️  DID cache cleared');
}
