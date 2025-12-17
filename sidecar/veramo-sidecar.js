#!/usr/bin/env ts-node
"use strict";
/**
 * Veramo Sidecar - DIDComm Handler Container
 *
 * Architecture from Sequence Diagram:
 * - Veramo is the DIDComm entry point (talks to Envoy)
 * - Veramo handles: DID Resolution, VP Auth, Encryption
 * - Veramo calls NF for business logic via localhost:3000
 *
 * Container Layout (3 per pod):
 * ┌─────────────────────────────────────────────────────────┐
 * │ Pod                                                      │
 * │  ┌──────────────┐  localhost:3000  ┌─────────────────┐  │
 * │  │     NF       │ ←──────────────→ │ Veramo Sidecar  │  │
 * │  │ (Business)   │  Service Req/Res │  (Port 3001)    │  │
 * │  └──────────────┘                  └────────┬────────┘  │
 * │                                             │            │
 * │                                    ┌────────▼────────┐  │
 * │                                    │  Istio Envoy    │  │
 * │                                    │   (Sidecar)     │  │
 * │                                    └─────────────────┘  │
 * └─────────────────────────────────────────────────────────┘
 *
 * Flow:
 * 1. NF_A → Veramo_NF_A: Service Request (initiates flow)
 * 2. Veramo_NF_A: Resolve DID, VP Auth, DIDComm → Envoy
 * 3. ... mesh routing ...
 * 4. Veramo_NF_B: Receives DIDComm, VP Auth
 * 5. Veramo_NF_B → NF_B: Service Request (business logic)
 * 6. NF_B → Veramo_NF_B: Service Response
 * 7. Veramo_NF_B: DIDComm → Envoy → ... → Veramo_NF_A
 * 8. Veramo_NF_A → NF_A: Service Response
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
// Import from src modules (inside sidecar/)
const didcomm_vp_wrapper_js_1 = require("./src/didcomm-vp-wrapper.js");
const didcomm_messages_js_1 = require("./src/didcomm-messages.js");
const presentation_definitions_js_1 = require("./src/presentation-definitions.js");
const session_manager_js_1 = require("./src/session-manager.js");
const didcomm_encryption_js_1 = require("./src/didcomm-encryption.js");
// Configuration
const DB_PATH = process.env.DB_PATH || './database.sqlite';
const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || '';
const VERAMO_PORT = process.env.VERAMO_PORT || 3001;
const NF_PORT = process.env.NF_PORT || 3000;
const MY_DID = process.env.MY_DID || '';
const PACKING_MODE = process.env.DIDCOMM_PACKING_MODE || 'encrypted'; // 'encrypted' (V1) or 'signed' (V4a)
// Determine which NF this is
const isNFA = MY_DID.includes('nf-a');
const MY_PD = isNFA ? presentation_definitions_js_1.PRESENTATION_DEFINITION_A : presentation_definitions_js_1.PRESENTATION_DEFINITION_B;
const THEIR_DID = isNFA
    ? 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b'
    : 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
let agent;
let wrapper;
let sessionManager;
// Pending service requests waiting for authentication
const pendingServiceRequests = new Map();
/**
 * Initialize Veramo agent
 */
async function initializeAgent() {
    console.log('🔧 Initializing Veramo Sidecar...');
    console.log(`   DID: ${MY_DID}`);
    console.log(`   DB: ${DB_PATH}`);
    console.log(`   Mode: ${PACKING_MODE === 'encrypted' ? 'V1 (E2E encrypted)' : 'V4a (signed only, mTLS for confidentiality)'}`);
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
        ],
    });
    wrapper = new didcomm_vp_wrapper_js_1.DIDCommVPWrapper(agent);
    sessionManager = new session_manager_js_1.SessionManager();
    console.log('✅ Veramo Sidecar initialized');
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
    console.log(`\n📤 Calling NF container for business logic`);
    console.log(`   Service: ${service}`);
    console.log(`   Action: ${action}`);
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
                if (res.statusCode === 200) {
                    console.log(`✅ NF response received`);
                    resolve(JSON.parse(data));
                }
                else {
                    reject(new Error(`NF returned ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', (error) => {
            console.error(`❌ NF call failed: ${error.message}`);
            reject(error);
        });
        req.write(payload);
        req.end();
    });
}
/**
 * Send response back to NF container (for async flows)
 */
async function sendResponseToNF(data) {
    console.log(`\n📤 Sending response to NF container`);
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(data);
        const req = http_1.default.request({
            hostname: 'localhost',
            port: NF_PORT,
            path: '/response',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    console.log(`✅ Response delivered to NF`);
                    resolve();
                }
                else {
                    console.log(`⚠️ NF response endpoint returned ${res.statusCode}`);
                    resolve(); // Don't fail on response delivery issues
                }
            });
        });
        req.on('error', (error) => {
            console.log(`⚠️ Could not deliver to NF: ${error.message}`);
            resolve(); // Don't fail on response delivery issues
        });
        req.write(payload);
        req.end();
    });
}
/**
 * Send DIDComm message via Istio mesh
 *
 * Routes to either:
 * - Local service (same cluster): veramo-nf-X.nf-X-namespace.svc.cluster.local
 * - External cluster: cluster-X.external (ServiceEntry)
 */
async function sendDIDCommMessage(message, targetDid) {
    const USE_KUBERNETES = process.env.USE_KUBERNETES === 'true';
    // Determine if target is in same cluster or different cluster
    const targetIsClusterA = targetDid.includes('cluster-a');
    const targetIsClusterB = targetDid.includes('cluster-b');
    const weAreClusterA = MY_DID.includes('cluster-a');
    const weAreClusterB = MY_DID.includes('cluster-b');
    // Determine target URL based on cluster location
    let targetUrl;
    let targetHost;
    if (USE_KUBERNETES) {
        if ((weAreClusterA && targetIsClusterA) || (weAreClusterB && targetIsClusterB)) {
            // Same cluster - use local service
            targetHost = targetIsClusterA
                ? 'veramo-nf-a.nf-a-namespace.svc.cluster.local'
                : 'veramo-nf-b.nf-b-namespace.svc.cluster.local';
            targetUrl = `http://${targetHost}:3001/didcomm/send`;
        }
        else {
            // Different cluster - ServiceEntry intercepts and routes to external gateway
            // DNS provided by stub Service+Endpoints, routing by ServiceEntry
            targetHost = targetIsClusterA
                ? 'veramo-nf-a.nf-a-namespace.svc.cluster.local'
                : 'veramo-nf-b.nf-b-namespace.svc.cluster.local';
            // Send directly to the cross-cluster hostname - ServiceEntry handles routing
            targetUrl = `http://${targetHost}:3001/didcomm/send`;
        }
    }
    else {
        // Docker Compose mode
        targetUrl = MY_DID.includes('cluster-a')
            ? 'http://envoy-proxy-nf-a:8080/didcomm/send'
            : 'http://envoy-proxy-nf-b:8080/didcomm/send';
        targetHost = targetIsClusterA
            ? 'veramo-nf-a.nf-a-namespace.svc.cluster.local'
            : 'veramo-nf-b.nf-b-namespace.svc.cluster.local';
    }
    console.log(`\n📤 Sending DIDComm message`);
    console.log(`   From: ${MY_DID}`);
    console.log(`   To: ${targetDid}`);
    console.log(`   Type: ${message.type}`);
    console.log(`   Mode: ${PACKING_MODE}`);
    console.log(`   Route: ${targetUrl}`);
    // Pack message (encrypted for V1, signed for V4a)
    const packedMessage = await (0, didcomm_encryption_js_1.packDIDCommMessage)(agent, message, targetDid, MY_DID);
    // Only verify JWE format for encrypted mode
    if (PACKING_MODE === 'encrypted') {
        (0, didcomm_encryption_js_1.verifyEncryption)(packedMessage);
    }
    // Payload indicates packing mode for receiver
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
                if (res.statusCode === 200) {
                    console.log('✅ DIDComm message sent via Envoy');
                    resolve();
                }
                else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', (error) => {
            console.error(`❌ Envoy send failed: ${error.message}`);
            reject(error);
        });
        req.write(payload);
        req.end();
    });
}
/**
 * Handle incoming DIDComm message from Envoy
 */
async function handleIncomingMessage(messageOrEncrypted) {
    // Unpack message (decrypt for V1/encrypted, verify signature for V4a/signed)
    let message;
    if (messageOrEncrypted.packed && messageOrEncrypted.message) {
        const mode = messageOrEncrypted.mode || 'encrypted';
        if (mode === 'encrypted') {
            console.log(`\n📨 Received encrypted DIDComm message (V1)`);
        }
        else {
            console.log(`\n📨 Received signed DIDComm message (V4a)`);
        }
        message = await (0, didcomm_encryption_js_1.unpackDIDCommMessage)(agent, messageOrEncrypted.message);
    }
    else if (messageOrEncrypted.encrypted && messageOrEncrypted.message) {
        // Legacy format support
        console.log(`\n📨 Received encrypted DIDComm message`);
        message = await (0, didcomm_encryption_js_1.unpackDIDCommMessage)(agent, messageOrEncrypted.message);
    }
    else {
        message = messageOrEncrypted;
    }
    console.log(`   Type: ${message.type}`);
    console.log(`   From: ${message.from}`);
    // Save incoming message to database for veramo explore
    try {
        await agent.dataStoreSaveMessage({
            message: {
                id: message.id || `msg-${Date.now()}`,
                type: message.type,
                from: message.from,
                to: message.to?.[0] || MY_DID,
                createdAt: new Date().toISOString(),
                data: message.body
            }
        });
        console.log(`   💾 Message saved to database`);
    }
    catch (e) {
        console.log(`   ⚠️  Could not save message: ${e.message}`);
    }
    const credentials = await loadCredentials();
    switch (message.type) {
        case didcomm_messages_js_1.DIDCOMM_MESSAGE_TYPES.VP_AUTH_REQUEST: {
            // Phase 1: Received VP Auth Request
            const authReq = message;
            const session = sessionManager.createSession(authReq.from, authReq.to[0], authReq.id);
            const vpWithPD = await wrapper.handleVPAuthRequest(authReq, MY_DID, credentials, MY_PD);
            sessionManager.updateSession(session.sessionId, { responderPdSent: true });
            return vpWithPD;
        }
        case didcomm_messages_js_1.DIDCOMM_MESSAGE_TYPES.VP_WITH_PD: {
            // Phase 2: Received VP with PD (as initiator)
            const vpWithPDMsg = message;
            console.log(`\n📨 Phase 2: Received VP_WITH_PD`);
            console.log(`   From: ${vpWithPDMsg.from}`);
            console.log(`   To: ${vpWithPDMsg.to?.[0] || 'undefined'}`);
            // Debug: Show all active sessions
            const allSessions = sessionManager.getAllSessions();
            console.log(`   Active sessions: ${allSessions.length}`);
            // Try to find session - use MY_DID as fallback if to is undefined
            const toDid = vpWithPDMsg.to?.[0] || MY_DID;
            let existingSession = sessionManager.getSessionByDids(vpWithPDMsg.from, toDid);
            // Fallback: try with MY_DID explicitly
            if (!existingSession) {
                existingSession = sessionManager.getSessionByDids(MY_DID, vpWithPDMsg.from);
            }
            if (!existingSession) {
                console.error(`❌ No session found for: ${vpWithPDMsg.from} <-> ${toDid}`);
                throw new Error('No active session found');
            }
            console.log(`   Found session: ${existingSession.sessionId}`);
            const vpResponse = await wrapper.handleVPWithPD(vpWithPDMsg, credentials, MY_DID, MY_PD);
            sessionManager.markResponderVpReceived(existingSession.sessionId);
            return vpResponse;
        }
        case didcomm_messages_js_1.DIDCOMM_MESSAGE_TYPES.VP_RESPONSE: {
            // Phase 2: Received VP Response
            const vpRespMsg = message;
            const session2 = sessionManager.getSessionByDids(vpRespMsg.from, vpRespMsg.to[0]);
            if (!session2)
                throw new Error('No active session found');
            const authConfirmation = await wrapper.handleVPResponse(vpRespMsg);
            sessionManager.markInitiatorVpReceived(session2.sessionId);
            sessionManager.markAuthenticated(session2.sessionId);
            console.log(`✅ Session authenticated: ${session2.sessionId}`);
            return authConfirmation;
        }
        case didcomm_messages_js_1.DIDCOMM_MESSAGE_TYPES.AUTH_CONFIRMATION: {
            // Phase 2 End: Received "Authorized"
            const authConf = message;
            const session3 = sessionManager.getSessionByDids(authConf.from, authConf.to[0]);
            if (session3) {
                sessionManager.markAuthenticated(session3.sessionId);
                console.log(`✅ Authentication complete: ${session3.sessionId}`);
            }
            await wrapper.handleAuthConfirmation(authConf);
            // Phase 3: Send queued service request
            const senderDid = authConf.from;
            const pendingRequest = pendingServiceRequests.get(senderDid);
            if (pendingRequest) {
                console.log(`\n📤 Phase 3: Sending queued SERVICE_REQUEST`);
                const serviceRequest = (0, didcomm_messages_js_1.createServiceRequest)(MY_DID, senderDid, pendingRequest.service, pendingRequest.action, pendingRequest.params);
                pendingServiceRequests.delete(senderDid);
                await sendDIDCommMessage(serviceRequest, senderDid);
            }
            return null;
        }
        case didcomm_messages_js_1.DIDCOMM_MESSAGE_TYPES.SERVICE_REQUEST: {
            // Phase 3: Service Request from authenticated peer
            const serviceReq = message;
            const serviceSession = sessionManager.getSessionByDids(serviceReq.from, serviceReq.to[0]);
            if (!serviceSession || serviceSession.status !== 'authenticated') {
                console.error(`❌ SERVICE_REQUEST rejected: Not authenticated`);
                return (0, didcomm_messages_js_1.createServiceResponse)(MY_DID, serviceReq.from, 'error', undefined, 'Not authenticated. Please complete VP exchange first.');
            }
            console.log(`\n🔧 Processing SERVICE_REQUEST from authenticated peer`);
            // Call NF container for business logic
            try {
                const nfResponse = await callNFService(serviceReq.body.service, serviceReq.body.action, serviceReq.body.params);
                return (0, didcomm_messages_js_1.createServiceResponse)(MY_DID, serviceReq.from, 'success', nfResponse);
            }
            catch (error) {
                return (0, didcomm_messages_js_1.createServiceResponse)(MY_DID, serviceReq.from, 'error', undefined, error.message);
            }
        }
        case didcomm_messages_js_1.DIDCOMM_MESSAGE_TYPES.SERVICE_RESPONSE: {
            // Phase 3: Service Response received
            const serviceResp = message;
            console.log(`\n📥 Received SERVICE_RESPONSE`);
            console.log(`   Status: ${serviceResp.body.status}`);
            // Forward response to NF container
            await sendResponseToNF({
                type: 'service_response',
                from: serviceResp.from,
                status: serviceResp.body.status,
                data: serviceResp.body.data,
                error: serviceResp.body.error
            });
            return null;
        }
        default:
            console.log(`⚠️ Unknown message type: ${message.type}`);
            return null;
    }
}
/**
 * HTTP Server
 */
function createHTTPServer() {
    return http_1.default.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        // Health check
        if (req.url === '/health' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', service: 'veramo-sidecar', did: MY_DID }));
            return;
        }
        // DIDComm receive (from Envoy)
        if (req.url === '/didcomm/receive' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', async () => {
                try {
                    const message = JSON.parse(body);
                    const response = await handleIncomingMessage(message);
                    if (response) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(response));
                    }
                    else {
                        res.writeHead(204);
                        res.end();
                    }
                }
                catch (error) {
                    console.error('Error processing DIDComm:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // DIDComm send (from Envoy mesh)
        if (req.url === '/didcomm/send' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', async () => {
                try {
                    const payload = JSON.parse(body);
                    const response = await handleIncomingMessage(payload);
                    if (response) {
                        const senderDid = response.to?.[0] || THEIR_DID;
                        await sendDIDCommMessage(response, senderDid);
                    }
                    res.writeHead(200);
                    res.end();
                }
                catch (error) {
                    console.error('Error processing DIDComm:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // Service request from NF container (starts the flow)
        // NF_A → Veramo_NF_A: Service Request
        if (req.url === '/nf/service-request' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', async () => {
                try {
                    const { targetDid, service, action, params } = JSON.parse(body);
                    const target = targetDid || THEIR_DID;
                    console.log(`\n🚀 Received Service Request from NF container`);
                    console.log(`   Target: ${target}`);
                    console.log(`   Service: ${service}`);
                    // Check if authenticated
                    const session = sessionManager.getSessionByDids(MY_DID, target);
                    if (!session || session.status !== 'authenticated') {
                        // Not authenticated - start VP Auth flow
                        console.log(`\n🔐 Not authenticated - Starting VP Auth Flow`);
                        // Queue the service request
                        pendingServiceRequests.set(target, {
                            service, action, params,
                            timestamp: Date.now()
                        });
                        // Create session and send VP_AUTH_REQUEST
                        const newSession = sessionManager.createSession(MY_DID, target, `challenge-${Date.now()}`);
                        const authRequest = (0, didcomm_messages_js_1.createVPAuthRequest)(MY_DID, target, MY_PD, 'Authentication required for service access');
                        sessionManager.updateSession(newSession.sessionId, { initiatorPdSent: true });
                        await sendDIDCommMessage(authRequest, target);
                        res.writeHead(202, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            status: 'authenticating',
                            message: 'VP Authentication initiated. Service request queued.',
                            sessionId: newSession.sessionId
                        }));
                        return;
                    }
                    // Authenticated - send service request directly
                    console.log(`\n📤 Sending SERVICE_REQUEST (authenticated)`);
                    const serviceRequest = (0, didcomm_messages_js_1.createServiceRequest)(MY_DID, target, service, action, params);
                    await sendDIDCommMessage(serviceRequest, target);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, messageId: serviceRequest.id }));
                }
                catch (error) {
                    console.error('Error handling NF service request:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // Session status
        if (req.url === '/session/status' && req.method === 'GET') {
            const sessions = sessionManager.getAllSessions();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                myDid: MY_DID,
                sessions: sessions.map(s => ({
                    sessionId: s.sessionId,
                    status: s.status,
                    authenticated: s.status === 'authenticated'
                }))
            }, null, 2));
            return;
        }
        // 404
        res.writeHead(404);
        res.end('Not Found');
    });
}
/**
 * Main
 */
async function main() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║       Veramo Sidecar - DIDComm Handler (Separated)             ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    await initializeAgent();
    const server = createHTTPServer();
    server.listen(VERAMO_PORT, () => {
        console.log('');
        console.log('🚀 Veramo Sidecar running');
        console.log(`   Port: ${VERAMO_PORT}`);
        console.log(`   DID: ${MY_DID}`);
        console.log(`   NF Port: ${NF_PORT} (localhost)`);
        console.log('');
        console.log('📍 Endpoints:');
        console.log(`   GET  /health                 - Health check`);
        console.log(`   POST /didcomm/receive        - Receive DIDComm (from Envoy)`);
        console.log(`   POST /didcomm/send           - Send DIDComm (from Envoy mesh)`);
        console.log(`   POST /nf/service-request     - Service request (from NF container)`);
        console.log(`   GET  /session/status         - Session status`);
        console.log('');
        console.log('✅ Ready to handle DIDComm messages');
        console.log('');
    });
}
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
