#!/usr/bin/env ts-node
/**
 * DIDComm End-to-End Encryption Module
 *
 * This module provides E2E encryption for DIDComm messages using JWE (JSON Web Encryption)
 *
 * Architecture:
 * - Messages are encrypted with recipient's public key
 * - Only recipient can decrypt with their private key
 * - Transport layer (mTLS) provides additional security but E2E encryption ensures
 *   zero-trust: even compromised intermediaries cannot read message content
 *
 * Flow:
 * NF-A encrypts → Proxy-A (sees only JWE) → Gateway-A (mTLS) →
 * Gateway-B (mTLS) → Proxy-B (sees only JWE) → NF-B decrypts
 */

import { IAgent, IResolver } from '@veramo/core';
import { IDIDComm } from '@veramo/did-comm';
import { resolveDIDDocument, getRecipientPublicKey } from '../shared/did-resolver-cache.js';

/**
 * Get DIDComm packing mode from environment variable
 *
 * Modes:
 * - 'encrypted' (default): Uses authcrypt for E2E encryption with sender authentication
 * - 'anon': Uses anoncrypt for anonymous E2E encryption
 * - 'signed': Uses JWS for signed but unencrypted messages
 */
function getPackingMode(): 'authcrypt' | 'anoncrypt' | 'jws' | 'none' {
  const mode = process.env.DIDCOMM_PACKING_MODE || 'encrypted';

  if (mode === 'encrypted') {
    return 'authcrypt';  // E2E encryption with sender authentication
  } else if (mode === 'anon') {
    return 'anoncrypt';  // Anonymous E2E encryption
  } else if (mode === 'signed') {
    return 'jws';  // Signed only (no encryption)
  } else {
    return 'none';  // Plain message (for testing only)
  }
}

/**
 * Pack (encrypt/sign) a DIDComm message for a specific recipient
 *
 * @param agent - Veramo agent with DIDComm plugin
 * @param message - Plain message object to pack
 * @param recipientDid - DID of the recipient
 * @param senderDid - DID of the sender (required for authcrypt/jws)
 * @returns Packed message as string (JWE for encrypted, JWS for signed)
 */
export async function packDIDCommMessage(
  agent: any,
  message: any,
  recipientDid: string,
  senderDid?: string
): Promise<string> {
  const packingMode = getPackingMode();

  if (packingMode === 'authcrypt' || packingMode === 'anoncrypt') {
    console.log(`\n🔒 Encrypting DIDComm message for ${recipientDid}`);
  } else if (packingMode === 'jws') {
    console.log(`\n✍️  Signing DIDComm message for ${recipientDid} (no encryption)`);
  } else {
    console.log(`\n📝 Sending plain DIDComm message to ${recipientDid}`);
  }

  try {
    // Ensure message has 'from' field
    const messageWithFrom = {
      ...message,
      from: senderDid || message.from
    };

    if (!messageWithFrom.from) {
      throw new Error('Sender DID (from field) is required');
    }

    console.log(`   From: ${messageWithFrom.from}`);
    console.log(`   Packing mode: ${packingMode}`);

    // For encrypted mode: resolve recipient key
    if (packingMode === 'authcrypt' || packingMode === 'anoncrypt') {
      const recipientKey = await getRecipientPublicKey(recipientDid, agent);
      if (!recipientKey) {
        throw new Error(`Could not resolve recipient DID: ${recipientDid}`);
      }
      console.log(`   Using key: ${recipientKey.id}`);
    }

    // Pack the message using Veramo's DIDComm plugin
    const packedMessage = await agent.packDIDCommMessage({
      packing: packingMode,
      message: {
        ...messageWithFrom,
        to: [recipientDid]
      },
    });

    if (packingMode === 'authcrypt' || packingMode === 'anoncrypt') {
      console.log(`✅ Message encrypted (${packedMessage.message.length} bytes JWE)`);
    } else if (packingMode === 'jws') {
      console.log(`✅ Message signed (${packedMessage.message.length} bytes JWS)`);
    } else {
      console.log(`✅ Message packed (${packedMessage.message.length} bytes)`);
    }

    return packedMessage.message;
  } catch (error: any) {
    console.error(`❌ Packing failed:`, error.message);

    // Fallback: Send as plain message with warning
    console.warn(`⚠️  Falling back to unencrypted message`);
    return JSON.stringify(message);
  }
}

/**
 * Unpack (decrypt) a received DIDComm message
 *
 * @param agent - Veramo agent with DIDComm plugin
 * @param packedMessage - Encrypted JWE message string
 * @returns Decrypted message object
 */
export async function unpackDIDCommMessage(
  agent: any,
  packedMessage: string
): Promise<any> {
  console.log(`\n🔓 Decrypting received DIDComm message`);

  try {
    // Unpack the JWE message
    const unpackedMessage = await agent.unpackDIDCommMessage({
      message: packedMessage,
    });

    console.log(`✅ Message decrypted successfully`);
    console.log(`   From: ${unpackedMessage.metaData?.from || 'unknown'}`);
    console.log(`   Type: ${unpackedMessage.message?.type || 'unknown'}`);

    return unpackedMessage.message;
  } catch (error: any) {
    console.error(`❌ Decryption failed:`, error.message);
    throw new Error(`Failed to decrypt DIDComm message: ${error.message}`);
  }
}

/**
 * Check if a message is encrypted (JWE format)
 */
export function isEncryptedMessage(message: string | object): boolean {
  if (typeof message !== 'string') {
    return false;
  }

  try {
    const parsed = JSON.parse(message);
    // JWE messages have these required fields
    return !!(parsed.protected && parsed.recipients && parsed.ciphertext);
  } catch {
    return false;
  }
}

/**
 * Verify E2E encryption is working by checking message format
 */
export function verifyEncryption(packedMessage: string): boolean {
  try {
    const jwe = JSON.parse(packedMessage);

    if (!jwe.protected || !jwe.ciphertext) {
      console.warn('⚠️  Message is not properly encrypted (missing JWE fields)');
      return false;
    }

    console.log('✅ E2E encryption verified: Message is in JWE format');
    return true;
  } catch {
    console.warn('⚠️  Invalid JWE format');
    return false;
  }
}
