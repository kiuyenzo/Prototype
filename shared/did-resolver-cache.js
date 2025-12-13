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
exports.resolveDIDDocument = resolveDIDDocument;
exports.extractEncryptionKey = extractEncryptionKey;
exports.getRecipientPublicKey = getRecipientPublicKey;
exports.precacheDIDs = precacheDIDs;
exports.clearCache = clearCache;
var fs = require("fs");
/**
 * Cache for resolved DID documents
 */
var didDocumentCache = new Map();
/**
 * Known DID document file paths (absolute paths from container root)
 */
var DID_PATHS = {
    'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a': '/app/prototype/cluster-a/did-nf-a/did.json',
    'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b': '/app/prototype/cluster-b/did-nf-b/did.json',
};
/**
 * Load a DID document from local filesystem
 */
function loadLocalDIDDocument(did) {
    try {
        var filePath = DID_PATHS[did];
        if (!filePath) {
            console.log("\u26A0\uFE0F  No local DID document path for ".concat(did));
            return null;
        }
        if (!fs.existsSync(filePath)) {
            console.log("\u26A0\uFE0F  DID document not found at ".concat(filePath));
            return null;
        }
        var content = fs.readFileSync(filePath, 'utf-8');
        var didDocument = JSON.parse(content);
        console.log("\u2705 Loaded local DID document for ".concat(did));
        return didDocument;
    }
    catch (error) {
        console.error("\u274C Error loading DID document:", error.message);
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
function resolveDIDDocument(did, agent) {
    return __awaiter(this, void 0, void 0, function () {
        var localDoc, result, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    // Check cache first
                    if (didDocumentCache.has(did)) {
                        console.log("\uD83D\uDCE6 Using cached DID document for ".concat(did));
                        return [2 /*return*/, didDocumentCache.get(did)];
                    }
                    localDoc = loadLocalDIDDocument(did);
                    if (localDoc) {
                        didDocumentCache.set(did, localDoc);
                        return [2 /*return*/, localDoc];
                    }
                    if (!(agent && agent.resolveDid)) return [3 /*break*/, 4];
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    console.log("\uD83D\uDD0D Resolving DID via agent: ".concat(did));
                    return [4 /*yield*/, agent.resolveDid({ didUrl: did })];
                case 2:
                    result = _a.sent();
                    if (result && result.didDocument) {
                        didDocumentCache.set(did, result.didDocument);
                        return [2 /*return*/, result.didDocument];
                    }
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _a.sent();
                    console.error("\u274C Agent DID resolution failed:", error_1.message);
                    return [3 /*break*/, 4];
                case 4:
                    console.error("\u274C Could not resolve DID: ".concat(did));
                    return [2 /*return*/, null];
            }
        });
    });
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
        var keyAgreementId_1 = didDocument.keyAgreement[0];
        // Find the verification method
        var keyMethod = didDocument.verificationMethod.find(function (vm) { return vm.id === keyAgreementId_1 || vm.id.endsWith(keyAgreementId_1.split('#')[1]); });
        if (keyMethod) {
            console.log("\u2705 Found keyAgreement key: ".concat(keyMethod.id));
            return keyMethod;
        }
    }
    // Fallback: use first verification method
    var firstKey = didDocument.verificationMethod[0];
    console.log("\u26A0\uFE0F  No keyAgreement found, using first key: ".concat(firstKey === null || firstKey === void 0 ? void 0 : firstKey.id));
    return firstKey;
}
/**
 * Get recipient public key for encryption
 *
 * @param recipientDid - DID of the recipient
 * @param agent - Veramo agent
 * @returns Public key or null
 */
function getRecipientPublicKey(recipientDid, agent) {
    return __awaiter(this, void 0, void 0, function () {
        var didDocument;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, resolveDIDDocument(recipientDid, agent)];
                case 1:
                    didDocument = _a.sent();
                    if (!didDocument) {
                        return [2 /*return*/, null];
                    }
                    return [2 /*return*/, extractEncryptionKey(didDocument)];
            }
        });
    });
}
/**
 * Pre-cache known DIDs for faster access
 */
function precacheDIDs() {
    console.log('📦 Pre-caching known DIDs...');
    for (var _i = 0, _a = Object.keys(DID_PATHS); _i < _a.length; _i++) {
        var did = _a[_i];
        var doc = loadLocalDIDDocument(did);
        if (doc) {
            didDocumentCache.set(did, doc);
        }
    }
    console.log("\u2705 Cached ".concat(didDocumentCache.size, " DID documents"));
}
/**
 * Clear DID cache
 */
function clearCache() {
    didDocumentCache.clear();
    console.log('🗑️  DID cache cleared');
}
