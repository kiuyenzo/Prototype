#!/usr/bin/env node
/**
 * Veramo DID Resolver Configuration
 *
 * Uses Veramo's built-in DID resolution with web-did-resolver
 * for standard-compliant did:web resolution via HTTPS
 */

const { DIDResolverPlugin } = require('@veramo/did-resolver');
const { Resolver } = require('did-resolver');
const { getResolver: getWebDidResolver } = require('web-did-resolver');

/**
 * Create DID Resolver Plugin for Veramo Agent
 *
 * Supports:
 * - did:web (via HTTPS to domain/.well-known/did.json or domain/path/did.json)
 *
 * @returns {DIDResolverPlugin} Configured resolver plugin
 */
function createDIDResolverPlugin() {
  const webResolver = getWebDidResolver();

  const resolver = new Resolver({
    ...webResolver,
  });

  return new DIDResolverPlugin({ resolver });
}

/**
 * Resolve a DID document using Veramo agent
 *
 * @param {any} agent - Veramo agent with DIDResolver plugin
 * @param {string} did - DID to resolve
 * @returns {Promise<any>} DID document or null
 */
async function resolveDID(agent, did) {
  try {
    console.log(`🔍 Resolving DID via Veramo: ${did}`);
    const startTime = Date.now();

    const result = await agent.resolveDid({ didUrl: did });
    const elapsed = Date.now() - startTime;

    if (result && result.didDocument) {
      console.log(`✅ DID resolved (${elapsed}ms): ${did}`);
      return result.didDocument;
    }

    console.log(`⚠️  DID resolution returned no document: ${did}`);
    return null;
  } catch (error) {
    console.error(`❌ DID resolution failed: ${error.message}`);
    return null;
  }
}

/**
 * Extract encryption key (keyAgreement) from DID document
 *
 * @param {any} didDocument - DID document
 * @returns {any} Key for encryption or null
 */
function extractEncryptionKey(didDocument) {
  if (!didDocument || !didDocument.verificationMethod) {
    return null;
  }

  // Look for keyAgreement keys (used for encryption)
  if (didDocument.keyAgreement && didDocument.keyAgreement.length > 0) {
    const keyAgreementId = didDocument.keyAgreement[0];

    // Handle both reference (string) and embedded key
    if (typeof keyAgreementId === 'object') {
      return keyAgreementId;
    }

    // Find the verification method by ID
    const keyMethod = didDocument.verificationMethod.find(
      (vm) => vm.id === keyAgreementId || vm.id.endsWith(keyAgreementId.split('#')[1])
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
 * @param {any} agent - Veramo agent
 * @param {string} recipientDid - DID of the recipient
 * @returns {Promise<any>} Public key or null
 */
async function getRecipientPublicKey(agent, recipientDid) {
  const didDocument = await resolveDID(agent, recipientDid);
  if (!didDocument) {
    return null;
  }
  return extractEncryptionKey(didDocument);
}

module.exports = {
  createDIDResolverPlugin,
  resolveDID,
  extractEncryptionKey,
  getRecipientPublicKey,
};
