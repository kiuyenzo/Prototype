#!/usr/bin/env ts-node
"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDIDDocument = resolveDIDDocument;
exports.extractEncryptionKey = extractEncryptionKey;
exports.getRecipientPublicKey = getRecipientPublicKey;
exports.precacheDIDs = precacheDIDs;
exports.clearCache = clearCache;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Cache for resolved DID documents
 */
const didDocumentCache = new Map();
/**
 * Known DID document file paths
 */
const DID_PATHS = {
    'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a': '../cluster-a/did-nf-a/did.json',
    'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b': '../cluster-b/did-nf-b/did.json',
};
/**
 * Load a DID document from local filesystem
 */
function loadLocalDIDDocument(did) {
    try {
        const relativePath = DID_PATHS[did];
        if (!relativePath) {
            console.log(`⚠️  No local DID document path for ${did}`);
            return null;
        }
        // Resolve path relative to this file
        const fullPath = path_1.default.resolve(__dirname, relativePath);
        if (!fs_1.default.existsSync(fullPath)) {
            console.log(`⚠️  DID document not found at ${fullPath}`);
            return null;
        }
        const content = fs_1.default.readFileSync(fullPath, 'utf-8');
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
async function resolveDIDDocument(did, agent) {
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
 * Pre-cache known DIDs for faster access
 */
function precacheDIDs() {
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
function clearCache() {
    didDocumentCache.clear();
    console.log('🗑️  DID cache cleared');
}
