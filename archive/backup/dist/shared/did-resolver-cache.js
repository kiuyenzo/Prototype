#!/usr/bin/env ts-node
/**
 * Local DID Document Cache for Testing
 *
 * This module provides cached DID documents for NF-A and NF-B
 * to avoid external HTTPS resolution during testing.
 *
 * In production, this would be replaced with:
 * - Universal Resolver
 * - Local DID registry
 * - Cached DID documents from previous resolutions
 */
import * as fs from 'fs';
/**
 * Cache for resolved DID documents
 */
const didDocumentCache = new Map();
/**
 * Known DID document file paths (absolute paths from container root)
 */
const DID_PATHS = {
    'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a': '/app/prototype/cluster-a/did-nf-a/did.json',
    'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b': '/app/prototype/cluster-b/did-nf-b/did.json',
};
/**
 * Load a DID document from local filesystem
 */
function loadLocalDIDDocument(did) {
    try {
        const filePath = DID_PATHS[did];
        if (!filePath) {
            console.log(`⚠️  No local DID document path for ${did}`);
            return null;
        }
        if (!fs.existsSync(filePath)) {
            console.log(`⚠️  DID document not found at ${filePath}`);
            return null;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        const didDocument = JSON.parse(content);
        console.log(`✅ Loaded local DID document for ${did}`);
        return didDocument;
    }
    catch (error) {
        console.error(`❌ Error loading DID document:`, error.message);
        return null;
    }
}
/**
 * Resolve a DID document (with local cache)
 *
 * @param did - DID to resolve
 * @param agent - Veramo agent (optional, for fallback resolution)
 * @returns DID document or null
 */
export async function resolveDIDDocument(did, agent) {
    // Check cache first
    if (didDocumentCache.has(did)) {
        console.log(`📦 Using cached DID document for ${did}`);
        return didDocumentCache.get(did);
    }
    // Try local file first
    const localDoc = loadLocalDIDDocument(did);
    if (localDoc) {
        didDocumentCache.set(did, localDoc);
        return localDoc;
    }
    // Fallback to agent resolution
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
export function extractEncryptionKey(didDocument) {
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
export async function getRecipientPublicKey(recipientDid, agent) {
    const didDocument = await resolveDIDDocument(recipientDid, agent);
    if (!didDocument) {
        return null;
    }
    return extractEncryptionKey(didDocument);
}
/**
 * Pre-cache known DIDs for faster access
 */
export function precacheDIDs() {
    console.log('📦 Pre-caching known DIDs...');
    for (const did of Object.keys(DID_PATHS)) {
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
export function clearCache() {
    didDocumentCache.clear();
    console.log('🗑️  DID cache cleared');
}
