#!/usr/bin/env ts-node
"use strict";
/**
 * DIDComm E2E Encryption Module - Uses Veramo's @veramo/did-comm plugin
 * Modes: 'encrypted' (authcrypt), 'anon' (anoncrypt), 'signed' (jws)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.packDIDCommMessage = packDIDCommMessage;
exports.unpackDIDCommMessage = unpackDIDCommMessage;
exports.isEncryptedMessage = isEncryptedMessage;
exports.verifyEncryption = verifyEncryption;

function getPackingMode() {
    const mode = process.env.DIDCOMM_PACKING_MODE || 'encrypted';
    return mode === 'encrypted' ? 'authcrypt' : mode === 'anon' ? 'anoncrypt' : mode === 'signed' ? 'jws' : 'none'; // evtl. umbennenn
}

/** 
 * Pack (encrypt/sign) a DIDComm message using Veramo's DIDComm plugin
 */
async function packDIDCommMessage(agent, message, recipientDid, senderDid) {
    const packingMode = getPackingMode();
    try {
        const packedMessage = await agent.packDIDCommMessage({
            packing: packingMode,
            message: { ...message, from: senderDid || message.from, to: [recipientDid] },
        });
        return packedMessage.message;
    } catch (error) {
        console.warn(`⚠️ Packing failed, fallback to plain: ${error.message}`);
        return JSON.stringify(message);
    }
}

/**
 * Unpack (decrypt) a received DIDComm message using Veramo's DIDComm plugin
 */
async function unpackDIDCommMessage(agent, packedMessage) {
    try {
        const result = await agent.unpackDIDCommMessage({ message: packedMessage });
        return result.message;
    } catch (error) {
        throw new Error(`Decrypt failed: ${error.message}`);
    }
}

/** Check if message is JWE encrypted */
function isEncryptedMessage(message) {
    if (typeof message !== 'string') return false;
    try {
        const parsed = JSON.parse(message);
        return !!(parsed.protected && parsed.recipients && parsed.ciphertext);
    } catch { return false; }
}

/** Verify JWE format */
function verifyEncryption(packedMessage) {
    try {
        const jwe = JSON.parse(packedMessage);
        return !!(jwe.protected && jwe.ciphertext);
    } catch { return false; }
}
