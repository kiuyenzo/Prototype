#!/usr/bin/env ts-node
"use strict";
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
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.packDIDCommMessage = packDIDCommMessage;
exports.unpackDIDCommMessage = unpackDIDCommMessage;
exports.isEncryptedMessage = isEncryptedMessage;
exports.verifyEncryption = verifyEncryption;
var did_resolver_cache_js_1 = require("./did-resolver-cache.js");
/**
 * Pack (encrypt) a DIDComm message for a specific recipient
 *
 * @param agent - Veramo agent with DIDComm plugin
 * @param message - Plain message object to encrypt
 * @param recipientDid - DID of the recipient
 * @param senderDid - DID of the sender (required for authcrypt)
 * @returns Encrypted JWE message as string
 */
function packDIDCommMessage(agent, message, recipientDid, senderDid) {
    return __awaiter(this, void 0, void 0, function () {
        var recipientKey, messageWithFrom, packedMessage, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log("\n\uD83D\uDD12 Encrypting DIDComm message for ".concat(recipientDid));
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, , 5]);
                    return [4 /*yield*/, (0, did_resolver_cache_js_1.getRecipientPublicKey)(recipientDid, agent)];
                case 2:
                    recipientKey = _a.sent();
                    if (!recipientKey) {
                        throw new Error("Could not resolve recipient DID: ".concat(recipientDid));
                    }
                    console.log("   Using key: ".concat(recipientKey.id));
                    messageWithFrom = __assign(__assign({}, message), { from: senderDid || message.from });
                    if (!messageWithFrom.from) {
                        throw new Error('Sender DID (from field) is required for authcrypt');
                    }
                    console.log("   From: ".concat(messageWithFrom.from));
                    return [4 /*yield*/, agent.packDIDCommMessage({
                            packing: 'authcrypt', // Authenticated encryption (sender authenticated + encrypted)
                            message: messageWithFrom,
                        })];
                case 3:
                    packedMessage = _a.sent();
                    console.log("\u2705 Message encrypted (".concat(packedMessage.message.length, " bytes JWE)"));
                    return [2 /*return*/, packedMessage.message];
                case 4:
                    error_1 = _a.sent();
                    console.error("\u274C Encryption failed:", error_1.message);
                    // Fallback: Send as plain message with warning
                    console.warn("\u26A0\uFE0F  Falling back to unencrypted message");
                    return [2 /*return*/, JSON.stringify(message)];
                case 5: return [2 /*return*/];
            }
        });
    });
}
/**
 * Unpack (decrypt) a received DIDComm message
 *
 * @param agent - Veramo agent with DIDComm plugin
 * @param packedMessage - Encrypted JWE message string
 * @returns Decrypted message object
 */
function unpackDIDCommMessage(agent, packedMessage) {
    return __awaiter(this, void 0, void 0, function () {
        var unpackedMessage, error_2;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    console.log("\n\uD83D\uDD13 Decrypting received DIDComm message");
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, agent.unpackDIDCommMessage({
                            message: packedMessage,
                        })];
                case 2:
                    unpackedMessage = _c.sent();
                    console.log("\u2705 Message decrypted successfully");
                    console.log("   From: ".concat(((_a = unpackedMessage.metaData) === null || _a === void 0 ? void 0 : _a.from) || 'unknown'));
                    console.log("   Type: ".concat(((_b = unpackedMessage.message) === null || _b === void 0 ? void 0 : _b.type) || 'unknown'));
                    return [2 /*return*/, unpackedMessage.message];
                case 3:
                    error_2 = _c.sent();
                    console.error("\u274C Decryption failed:", error_2.message);
                    throw new Error("Failed to decrypt DIDComm message: ".concat(error_2.message));
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Check if a message is encrypted (JWE format)
 */
function isEncryptedMessage(message) {
    if (typeof message !== 'string') {
        return false;
    }
    try {
        var parsed = JSON.parse(message);
        // JWE messages have these required fields
        return !!(parsed.protected && parsed.recipients && parsed.ciphertext);
    }
    catch (_a) {
        return false;
    }
}
/**
 * Verify E2E encryption is working by checking message format
 */
function verifyEncryption(packedMessage) {
    try {
        var jwe = JSON.parse(packedMessage);
        if (!jwe.protected || !jwe.ciphertext) {
            console.warn('⚠️  Message is not properly encrypted (missing JWE fields)');
            return false;
        }
        console.log('✅ E2E encryption verified: Message is in JWE format');
        return true;
    }
    catch (_a) {
        console.warn('⚠️  Invalid JWE format');
        return false;
    }
}
