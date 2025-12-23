#!/usr/bin/env ts-node
"use strict";
/**
 * Veramo Sidecar - DIDComm Handler (Port 3001)
 * Pod: [NF:3000] ↔ [Veramo:3001] ↔ [Istio Envoy]
 * Flow: NF → Veramo (VP Auth, DIDComm) → Envoy → Mesh → Remote Veramo → Remote NF
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const core_1 = require("@veramo/core");
const did_resolver_1 = require("@veramo/did-resolver");
const credential_w3c_1 = require("@veramo/credential-w3c");
const key_manager_1 = require("@veramo/key-manager");
const did_manager_1 = require("@veramo/did-manager");
const data_store_1 = require("@veramo/data-store");
const kms_local_1 = require("@veramo/kms-local");
const did_provider_web_1 = require("@veramo/did-provider-web");
const did_resolver_2 = require("did-resolver");
const web_did_resolver_1 = require("web-did-resolver");
const did_comm_1 = require("@veramo/did-comm");
const message_handler_1 = require("@veramo/message-handler");
const typeorm_1 = require("typeorm");
const data_store_2 = require("@veramo/data-store");
const didcomm_vp_wrapper_js_1 = require("./lib/didcomm/vp-wrapper.js");
const didcomm_messages_js_1 = require("./lib/didcomm/messages.js");
const session_manager_js_1 = require("./lib/session/manager.js");
const pex_definitions_js_1 = require("./lib/credentials/vp_definitions.js"); // PEX (@sphereon/pex)
// Inline DIDComm encryption (replaces encryption.js)
const packMode = () => ({ encrypted: 'authcrypt', anon: 'anoncrypt', signed: 'jws', none: 'none' }[process.env.DIDCOMM_PACKING_MODE] || 'authcrypt');
const packMsg = async (a, m, to, from) => {
    try {
        console.log(`📦 Packing: mode=${packMode()}, from=${from}, to=${to}`);
        const packed = await a.packDIDCommMessage({ packing: packMode(), message: { ...m, from, to: [to] } });
        console.log(`✅ Packed successfully, length=${packed.message.length}`);
        return packed.message;
    } catch (e) {
        console.log(`❌ Pack failed: ${e.message}`);
        return JSON.stringify(m);
    }
};
const unpackMsg = async (a, p) => (await a.unpackDIDCommMessage({ message: p })).message;

// Configuration
const DB_PATH = process.env.DB_PATH || './database.sqlite'; //welche DB?: Die DB wird per Environment Variable gesetzt in cluster-a/deployment.yaml:
const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || '';
const VERAMO_PORT = process.env.VERAMO_PORT || 3001, NF_PORT = process.env.NF_PORT || 3000;
const MY_DID = process.env.MY_DID || '', PACKING_MODE = process.env.DIDCOMM_PACKING_MODE || 'encrypted';
const isNFA = MY_DID.includes('nf-a');
const MY_PD = isNFA ? pex_definitions_js_1.PRESENTATION_DEFINITION_A : pex_definitions_js_1.PRESENTATION_DEFINITION_B;
const THEIR_DID = isNFA ? 'did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b' : 'did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a';
let agent, wrapper, sessionManager;
// Pending service requests waiting for authentication
const pendingServiceRequests = new Map();
/**
 * Initialize Veramo agent
 */
async function initializeAgent() {
    console.log(`🔧 Initializing Veramo Sidecar [DID: ${MY_DID}, Mode: ${PACKING_MODE}]`);
    const dbConnection = new typeorm_1.DataSource({
        type: 'sqlite',
        database: DB_PATH,
        synchronize: false,
        migrationsRun: true,
        migrations: data_store_2.migrations,
        logging: false,
        entities: data_store_2.Entities,
    });
    await dbConnection.initialize();
    agent = (0, core_1.createAgent)({
        plugins: [
            new key_manager_1.KeyManager({
                store: new data_store_1.KeyStore(dbConnection),
                kms: {
                    local: new kms_local_1.KeyManagementSystem(new data_store_1.PrivateKeyStore(dbConnection, new kms_local_1.SecretBox(DB_ENCRYPTION_KEY))),
                },
            }),
            new did_manager_1.DIDManager({
                store: new data_store_1.DIDStore(dbConnection),
                defaultProvider: 'did:web',
                providers: {
                    'did:web': new did_provider_web_1.WebDIDProvider({ defaultKms: 'local' }),
                },
            }),
            new did_resolver_1.DIDResolverPlugin({
                resolver: new did_resolver_2.Resolver({ ...(0, web_did_resolver_1.getResolver)() }),
            }),
            new credential_w3c_1.CredentialPlugin(),
            new data_store_1.DataStore(dbConnection),
            new data_store_1.DataStoreORM(dbConnection),
            new did_comm_1.DIDComm(),
            new message_handler_1.MessageHandler({ messageHandlers: [] }),
            // SelectiveDisclosure ist deprecated in v6 - manuelle SDR-Implementierung wird verwendet
        ],
    });
    wrapper = new didcomm_vp_wrapper_js_1.DIDCommVPWrapper(agent);
    sessionManager = new session_manager_js_1.SessionManager();
}
/**
 * Load credentials from database
 */
async function loadCredentials() {
    const credentials = await agent.dataStoreORMGetVerifiableCredentials({
        where: [{ column: 'subject', value: [MY_DID] }]
    });
    return credentials
        .filter((cred) => cred.verifiableCredential.type.includes('NetworkFunctionCredential'))
        .map((cred) => cred.verifiableCredential);
}
/**
 * Call NF container for business logic (localhost:3000)
 */
async function callNFService(service, action, params) {
    console.log(`📤 NF call: ${service}/${action}`);
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ service, action, params });
        const req = http_1.default.request({
            hostname: 'localhost',
            port: NF_PORT,
            path: '/service',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) resolve(JSON.parse(data));
                else reject(new Error(`NF returned ${res.statusCode}: ${data}`));
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}
/**
 * Send response back to NF container (for async flows)
 */
async function sendResponseToNF(data) {
    return new Promise((resolve) => {
        const payload = JSON.stringify(data);
        const req = http_1.default.request({
            hostname: 'localhost', port: NF_PORT, path: '/response', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve());
        });
        req.on('error', () => resolve());
        req.write(payload);
        req.end();
    });
}
/** Send DIDComm message via Istio mesh or Docker Compose */
async function sendDIDCommMessage(message, targetDid) {
    const USE_K8S = process.env.USE_KUBERNETES === 'true';
    // Updated for new DID format: dids:did-nf-a / dids:did-nf-b
    const targetIsA = targetDid.includes('did-nf-a');
    const targetHost = targetIsA ? 'veramo-nf-a.nf-a-namespace.svc.cluster.local' : 'veramo-nf-b.nf-b-namespace.svc.cluster.local';
    const targetUrl = USE_K8S
        ? `http://${targetHost}:3001/didcomm/send`
        : `http://envoy-proxy-nf-${isNFA ? 'a' : 'b'}:8080/didcomm/send`;
    console.log(`📤 DIDComm: ${message.type.split('/').pop()} → ${targetDid.split(':').pop()}`);
    const packedMessage = await packMsg(agent, message, targetDid, MY_DID);
    const payload = JSON.stringify({
        packed: true,
        mode: PACKING_MODE,
        message: packedMessage
    });
    return new Promise((resolve, reject) => {
        const req = http_1.default.request(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'X-Target-DID': targetDid,
                'Host': targetHost
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) resolve();
                else reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}
/** Handle incoming DIDComm message from Envoy */
async function handleIncomingMessage(messageOrEncrypted) {
    console.log(`🔍 Incoming: packed=${messageOrEncrypted.packed}, mode=${messageOrEncrypted.mode}, msgLen=${messageOrEncrypted.message?.length || 'N/A'}`);
    let message;
    try {
        if ((messageOrEncrypted.packed || messageOrEncrypted.encrypted) && messageOrEncrypted.message) {
            console.log(`🔐 Unpacking message...`);
            message = await unpackMsg(agent, messageOrEncrypted.message);
            console.log(`✅ Unpacked: type=${message.type}`);
        } else {
            message = messageOrEncrypted;
        }
    } catch (unpackError) {
        console.log(`❌ Unpack failed: ${unpackError.message}`);
        console.log(`📦 Raw: ${messageOrEncrypted.message?.substring(0, 300)}`);
        throw unpackError;
    }
    console.log(`📨 ${message.type.split('/').pop()} from ${message.from?.split(':').pop()}`);
    try { await agent.dataStoreSaveMessage({ message: { id: message.id || `msg-${Date.now()}`, type: message.type, from: message.from, to: message.to?.[0] || MY_DID, createdAt: new Date().toISOString(), data: message.body } }); } catch (e) { /* ignore */ }
    const credentials = await loadCredentials();
    const MT = didcomm_messages_js_1.DIDCOMM_MESSAGE_TYPES;
    switch (message.type) {
        case MT.VP_AUTH_REQUEST: {
            const session = sessionManager.createSession(message.from, message.to[0], message.id);
            const vpWithPD = await wrapper.handleVPAuthRequest(message, MY_DID, credentials, MY_PD);
            sessionManager.updateSession(session.sessionId, { responderPdSent: true });
            return vpWithPD;
        }
        case MT.VP_WITH_PD: {
            const session = sessionManager.getSessionByDids(message.from, message.to?.[0] || MY_DID) || sessionManager.getSessionByDids(MY_DID, message.from);
            if (!session) throw new Error('No active session found');
            const vpResponse = await wrapper.handleVPWithPD(message, credentials, MY_DID, MY_PD);
            sessionManager.markResponderVpReceived(session.sessionId);
            return vpResponse;
        }
        case MT.VP_RESPONSE: {
            const session = sessionManager.getSessionByDids(message.from, message.to[0]);
            if (!session) throw new Error('No active session found');
            const authConfirmation = await wrapper.handleVPResponse(message);
            sessionManager.markInitiatorVpReceived(session.sessionId);
            sessionManager.markAuthenticated(session.sessionId);
            return authConfirmation;
        }
        case MT.AUTH_CONFIRMATION: {
            const session = sessionManager.getSessionByDids(message.from, message.to[0]);
            if (session) sessionManager.markAuthenticated(session.sessionId);
            await wrapper.handleAuthConfirmation(message);
            const pending = pendingServiceRequests.get(message.from);
            if (pending) {
                pendingServiceRequests.delete(message.from);
                await sendDIDCommMessage((0, didcomm_messages_js_1.createServiceRequest)(MY_DID, message.from, pending.service, pending.action, pending.params), message.from);
            }
            return null;
        }
        case MT.SERVICE_REQUEST: {
            const session = sessionManager.getSessionByDids(message.from, message.to[0]);
            if (!session || session.status !== 'authenticated') return (0, didcomm_messages_js_1.createServiceResponse)(MY_DID, message.from, 'error', undefined, 'Not authenticated');
            try {
                return (0, didcomm_messages_js_1.createServiceResponse)(MY_DID, message.from, 'success', await callNFService(message.body.service, message.body.action, message.body.params));
            } catch (error) {
                return (0, didcomm_messages_js_1.createServiceResponse)(MY_DID, message.from, 'error', undefined, error.message);
            }
        }
        case MT.SERVICE_RESPONSE:
            await sendResponseToNF({ type: 'service_response', from: message.from, status: message.body.status, data: message.body.data, error: message.body.error });
            return null;
        default:
            console.log(`⚠️ Unknown: ${message.type}`);
            return null;
    }
}
/** HTTP helper */
const json = (res, data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const parseBody = (req) => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(JSON.parse(b))); });

/** HTTP Server */
function createHTTPServer() {
    return http_1.default.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

        try {
            if (req.url === '/health' && req.method === 'GET') {
                return json(res, { status: 'ok', service: 'veramo-sidecar', did: MY_DID });
            }
            if (req.url === '/didcomm/receive' && req.method === 'POST') {
                const response = await handleIncomingMessage(await parseBody(req));
                return response ? json(res, response) : (res.writeHead(204), res.end());
            }
            if (req.url === '/didcomm/send' && req.method === 'POST') {
                const response = await handleIncomingMessage(await parseBody(req));
                if (response) await sendDIDCommMessage(response, response.to?.[0] || THEIR_DID);
                res.writeHead(200); res.end(); return;
            }
            if (req.url === '/nf/service-request' && req.method === 'POST') {
                const { targetDid, service, action, params } = await parseBody(req);
                const target = targetDid || THEIR_DID;
                const session = sessionManager.getSessionByDids(MY_DID, target);
                if (!session || session.status !== 'authenticated') {
                    pendingServiceRequests.set(target, { service, action, params, timestamp: Date.now() });
                    const newSession = sessionManager.createSession(MY_DID, target, `challenge-${Date.now()}`);
                    sessionManager.updateSession(newSession.sessionId, { initiatorPdSent: true });
                    await sendDIDCommMessage((0, didcomm_messages_js_1.createVPAuthRequest)(MY_DID, target, MY_PD, 'Auth required'), target);
                    return json(res, { status: 'authenticating', sessionId: newSession.sessionId }, 202);
                }
                const serviceReq = (0, didcomm_messages_js_1.createServiceRequest)(MY_DID, target, service, action, params);
                await sendDIDCommMessage(serviceReq, target);
                return json(res, { success: true, messageId: serviceReq.id });
            }
            if (req.url === '/session/status' && req.method === 'GET') {
                return json(res, { myDid: MY_DID, sessions: sessionManager.getAllSessions().map(s => ({ sessionId: s.sessionId, status: s.status, authenticated: s.status === 'authenticated' })) });
            }
            res.writeHead(404); res.end('Not Found');
        } catch (error) {
            console.error('HTTP error:', error.message);
            json(res, { error: error.message }, 500);
        }
    });
}
async function main() {
    await initializeAgent();
    const server = createHTTPServer();
    server.listen(VERAMO_PORT, () => {
        console.log(`🚀 Veramo Sidecar running on :${VERAMO_PORT} [DID: ${MY_DID.split(':').pop()}]`);
    });
}
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
