#!/usr/bin/env ts-node
"use strict";
/**
 * DIDComm HTTP Transport Server
 *
 * This server provides HTTP endpoints for sending/receiving DIDComm messages
 * and integrates with Envoy Proxies.
 *
 * Architecture:
 * Veramo_NF_A ↔ HTTP/1.1 ↔ Envoy_Proxy_NF_A ↔ HTTP/2+mTLS ↔ Envoy_Gateway_A ↔ ... ↔ Veramo_NF_B
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
const didcomm_vp_wrapper_js_1 = require("../shared/didcomm-vp-wrapper.js");
const didcomm_messages_js_1 = require("../shared/didcomm-messages.js");
const presentation_definitions_js_1 = require("../shared/presentation-definitions.js");
const session_manager_js_1 = require("../shared/session-manager.js");
const didcomm_encryption_js_1 = require("../shared/didcomm-encryption.js");
const did_resolver_cache_js_1 = require("../shared/did-resolver-cache.js");
// Configuration from environment
const DID = process.env.DID_NF_A || process.env.DID_NF_B || '';
const DB_PATH = process.env.DB_PATH || './database.sqlite';
const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || '';
const PORT = process.env.PORT || 3000;
// Determine which NF this is
const isNFA = DID.includes('nf-a');
const MY_DID = isNFA
    ? 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a'
    : 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b';
const THEIR_DID = isNFA
    ? 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b'
    : 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
const MY_PD = isNFA ? presentation_definitions_js_1.PRESENTATION_DEFINITION_A : presentation_definitions_js_1.PRESENTATION_DEFINITION_B;
const THEIR_PD = isNFA ? presentation_definitions_js_1.PRESENTATION_DEFINITION_B : presentation_definitions_js_1.PRESENTATION_DEFINITION_A;
let agent;
let wrapper;
let sessionManager;
// Pending service requests waiting for authentication (per target DID)
// Key: targetDid, Value: { service, action, params, timestamp }
const pendingServiceRequests = new Map();
/**
 * Initialize Veramo agent with database
 */
async function initializeAgent() {
    console.log('🔧 Initializing Veramo Agent...');
    console.log(`   DID: ${MY_DID}`);
    console.log(`   DB: ${DB_PATH}`);
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
                    'did:web': new did_provider_web_1.WebDIDProvider({
                        defaultKms: 'local',
                    }),
                },
            }),
            new did_resolver_1.DIDResolverPlugin({
                resolver: new did_resolver_2.Resolver({
                    ...(0, web_did_resolver_1.getResolver)(),
                }),
            }),
            new credential_w3c_1.CredentialPlugin(),
            new data_store_1.DataStore(dbConnection),
            new data_store_1.DataStoreORM(dbConnection),
            new did_comm_1.DIDComm(), // E2E Encryption support
            new message_handler_1.MessageHandler({
                messageHandlers: [], // No additional handlers needed for now
            }),
        ],
    });
    wrapper = new didcomm_vp_wrapper_js_1.DIDCommVPWrapper(agent);
    sessionManager = new session_manager_js_1.SessionManager();
    // Skip pre-caching - DID resolution will happen on first use (from GitHub)
    // (0, did_resolver_cache_js_1.precacheDIDs)();
    console.log('✅ Veramo Agent initialized');
    console.log('✅ Session Manager initialized');
}
/**
 * Load credentials from database
 */
async function loadCredentials() {
    try {
        const credentials = await agent.dataStoreORMGetVerifiableCredentials({
            where: [
                { column: 'subject', value: [MY_DID] }
            ]
        });
        console.log(`📥 Loaded ${credentials.length} credential(s) for ${MY_DID}`);
        const nfCredentials = credentials.filter((cred) => cred.verifiableCredential.type.includes('NetworkFunctionCredential'));
        console.log(`   Found ${nfCredentials.length} NetworkFunctionCredential(s)`);
        return nfCredentials.map((cred) => cred.verifiableCredential);
    }
    catch (error) {
        console.error(`Error loading credentials:`, error.message);
        return [];
    }
}
/**
 * Handle service request from authenticated peer (Phase 3)
 * This simulates actual NF service functionality
 */
async function handleServiceRequest(request) {
    const { service, action, params } = request.body;
    console.log(`\n🔧 NF Service Handler`);
    console.log(`   Service: ${service}`);
    console.log(`   Action: ${action}`);
    console.log(`   Params: ${JSON.stringify(params || {})}`);
    // Simulated NF services
    switch (service) {
        case 'nf-info':
            // Return NF information
            return (0, didcomm_messages_js_1.createServiceResponse)(MY_DID, request.from, 'success', {
                nfType: isNFA ? 'NF-A' : 'NF-B',
                did: MY_DID,
                capabilities: ['authentication', 'data-query', 'subscription'],
                timestamp: new Date().toISOString()
            });
        case 'data-query':
            // Simulated data query service
            const queryResult = {
                query: params?.query || 'default',
                results: [
                    { id: 1, name: 'Sample Data 1', value: 100 },
                    { id: 2, name: 'Sample Data 2', value: 200 }
                ],
                totalCount: 2,
                executedBy: MY_DID,
                timestamp: new Date().toISOString()
            };
            return (0, didcomm_messages_js_1.createServiceResponse)(MY_DID, request.from, 'success', queryResult);
        case 'subscription':
            // Simulated subscription service
            if (action === 'subscribe') {
                return (0, didcomm_messages_js_1.createServiceResponse)(MY_DID, request.from, 'success', {
                    subscriptionId: `sub-${Date.now()}`,
                    topic: params?.topic || 'default',
                    status: 'active',
                    subscribedBy: request.from,
                    timestamp: new Date().toISOString()
                });
            }
            else if (action === 'unsubscribe') {
                return (0, didcomm_messages_js_1.createServiceResponse)(MY_DID, request.from, 'success', {
                    subscriptionId: params?.subscriptionId,
                    status: 'cancelled',
                    timestamp: new Date().toISOString()
                });
            }
            break;
        case 'echo':
            // Simple echo service for testing
            return (0, didcomm_messages_js_1.createServiceResponse)(MY_DID, request.from, 'success', {
                echo: params,
                receivedAt: new Date().toISOString(),
                processedBy: MY_DID
            });
        default:
            return (0, didcomm_messages_js_1.createServiceResponse)(MY_DID, request.from, 'error', undefined, `Unknown service: ${service}`);
    }
    return (0, didcomm_messages_js_1.createServiceResponse)(MY_DID, request.from, 'error', undefined, `Unknown action: ${action} for service: ${service}`);
}
/**
 * Handle incoming DIDComm message
 */
async function handleIncomingMessage(messageOrEncrypted) {
    // Check if message is encrypted
    let message;
    if (messageOrEncrypted.encrypted && messageOrEncrypted.message) {
        // Decrypt E2E encrypted message
        console.log(`\n📨 Received encrypted DIDComm message`);
        message = await (0, didcomm_encryption_js_1.unpackDIDCommMessage)(agent, messageOrEncrypted.message);
    }
    else {
        // Plain message (backwards compatibility)
        message = messageOrEncrypted;
    }
    console.log(`   Type: ${message.type}`);
    console.log(`   From: ${message.from}`);
    console.log(`   ID: ${message.id}`);
    const credentials = await loadCredentials();
    try {
        switch (message.type) {
            case didcomm_messages_js_1.DIDCOMM_MESSAGE_TYPES.VP_AUTH_REQUEST:
                // Phase 1: Create session and handle VP Auth Request
                const authReq = message;
                const session = sessionManager.createSession(authReq.from, authReq.to[0], authReq.id // Use message ID as challenge
                );
                const vpWithPD = await wrapper.handleVPAuthRequest(authReq, MY_DID, credentials, MY_PD);
                // Mark that we're sending our PD
                sessionManager.updateSession(session.sessionId, {
                    responderPdSent: true
                });
                return vpWithPD;
            case didcomm_messages_js_1.DIDCOMM_MESSAGE_TYPES.VP_WITH_PD:
                // Phase 2: Process VP and send our VP
                const vpWithPDMsg = message;
                const existingSession = sessionManager.getSessionByDids(vpWithPDMsg.from, vpWithPDMsg.to[0]);
                if (!existingSession) {
                    console.error('❌ No session found for VP_WITH_PD');
                    throw new Error('No active session found');
                }
                const vpResponse = await wrapper.handleVPWithPD(vpWithPDMsg, credentials, MY_DID, MY_PD);
                // Mark that we received responder's VP
                sessionManager.markResponderVpReceived(existingSession.sessionId);
                return vpResponse;
            case didcomm_messages_js_1.DIDCOMM_MESSAGE_TYPES.VP_RESPONSE:
                // Phase 3: Verify VP and confirm authentication
                const vpRespMsg = message;
                const session2 = sessionManager.getSessionByDids(vpRespMsg.from, vpRespMsg.to[0]);
                if (!session2) {
                    console.error('❌ No session found for VP_RESPONSE');
                    throw new Error('No active session found');
                }
                const authConfirmation = await wrapper.handleVPResponse(vpRespMsg);
                // Mark that we received initiator's VP
                sessionManager.markInitiatorVpReceived(session2.sessionId);
                // Mark session as authenticated on responder side (mutual auth complete after VP verification)
                sessionManager.markAuthenticated(session2.sessionId);
                console.log(`✅ Session authenticated (responder): ${session2.sessionId}`);
                return authConfirmation;
            case didcomm_messages_js_1.DIDCOMM_MESSAGE_TYPES.AUTH_CONFIRMATION:
                // Phase 2 Ende: "Authorized" erhalten - Session als authentifiziert markieren
                const authConf = message;
                const session3 = sessionManager.getSessionByDids(authConf.from, authConf.to[0]);
                if (session3) {
                    sessionManager.markAuthenticated(session3.sessionId);
                    console.log(`✅ Authentication complete for session: ${session3.sessionId}`);
                }
                await wrapper.handleAuthConfirmation(authConf);
                // Phase 3: Nach "Authorized" - sende den gespeicherten Service Request
                const senderDid = authConf.from;
                const pendingRequest = pendingServiceRequests.get(senderDid);
                if (pendingRequest) {
                    console.log(`\n📤 Phase 3: Sending queued SERVICE_REQUEST after authorization`);
                    console.log(`   Service: ${pendingRequest.service}`);
                    console.log(`   Action: ${pendingRequest.action}`);
                    const serviceRequest = (0, didcomm_messages_js_1.createServiceRequest)(MY_DID, senderDid, pendingRequest.service, pendingRequest.action, pendingRequest.params);
                    pendingServiceRequests.delete(senderDid);
                    // Service Request asynchron senden
                    sendDIDCommMessage(serviceRequest, senderDid).catch(err => {
                        console.error(`Error sending queued service request: ${err.message}`);
                    });
                    console.log(`✅ Service request sent to ${senderDid}`);
                }
                return null; // No response needed
            case didcomm_messages_js_1.DIDCOMM_MESSAGE_TYPES.SERVICE_REQUEST:
                // Phase 3 (Post-Auth): Handle service request from authenticated peer
                const serviceReq = message;
                const serviceSession = sessionManager.getSessionByDids(serviceReq.from, serviceReq.to[0]);
                // Check if sender is authenticated
                if (!serviceSession || serviceSession.status !== 'authenticated') {
                    console.error(`❌ SERVICE_REQUEST rejected: Not authenticated`);
                    console.log(`   From: ${serviceReq.from}`);
                    console.log(`   Session: ${serviceSession?.sessionId || 'none'}`);
                    console.log(`   Status: ${serviceSession?.status || 'no session'}`);
                    return (0, didcomm_messages_js_1.createServiceResponse)(MY_DID, serviceReq.from, 'error', undefined, 'Not authenticated. Please complete VP exchange first.');
                }
                console.log(`\n🔧 Processing SERVICE_REQUEST from authenticated peer`);
                console.log(`   Service: ${serviceReq.body.service}`);
                console.log(`   Action: ${serviceReq.body.action}`);
                console.log(`   Session: ${serviceSession.sessionId}`);
                // Handle the service request (simulated NF service)
                const serviceResponse = await handleServiceRequest(serviceReq);
                return serviceResponse;
            case didcomm_messages_js_1.DIDCOMM_MESSAGE_TYPES.SERVICE_RESPONSE:
                // Phase 3 (Post-Auth): Handle service response
                const serviceResp = message;
                console.log(`\n📥 Received SERVICE_RESPONSE`);
                console.log(`   Status: ${serviceResp.body.status}`);
                if (serviceResp.body.data) {
                    console.log(`   Data: ${JSON.stringify(serviceResp.body.data)}`);
                }
                if (serviceResp.body.error) {
                    console.log(`   Error: ${serviceResp.body.error}`);
                }
                // Store or process the response as needed
                return null; // No response needed
            default:
                console.log(`⚠️  Unknown message type: ${message.type}`);
                return null;
        }
    }
    catch (error) {
        console.error(`❌ Error handling message: ${error.message}`);
        // Try to mark session as failed
        const failedSession = sessionManager.getSessionByDids(message.from, message.to[0]);
        if (failedSession) {
            sessionManager.markFailed(failedSession.sessionId, error.message);
        }
        throw error;
    }
}
/**
 * Send DIDComm message via local Envoy Proxy
 * The Envoy mesh will route it to the correct destination
 */
async function sendDIDCommMessage(message, targetDid) {
    // Determine routing endpoint (Envoy for Docker, Kubernetes Service for K8s)
    const USE_KUBERNETES = process.env.USE_KUBERNETES === 'true';
    let localEnvoyProxy;
    if (USE_KUBERNETES) {
        // Always route through local Istio Gateway (Sidecar → Gateway_A → Gateway_B → Sidecar)
        // The Gateway will route to the correct destination based on Host header
        localEnvoyProxy = 'http://istio-ingressgateway.istio-system.svc.cluster.local:80';
    }
    else {
        // Docker/Envoy routing: via local Envoy proxy
        if (MY_DID.includes('cluster-a')) {
            localEnvoyProxy = 'http://envoy-proxy-nf-a:8080';
        }
        else if (MY_DID.includes('cluster-b')) {
            localEnvoyProxy = 'http://envoy-proxy-nf-b:8080';
        }
        else {
            throw new Error(`Unknown local DID: ${MY_DID}`);
        }
    }
    // Determine target cluster for routing
    let targetCluster;
    if (targetDid.includes('cluster-a')) {
        targetCluster = 'cluster-a';
    }
    else if (targetDid.includes('cluster-b')) {
        targetCluster = 'cluster-b';
    }
    else {
        throw new Error(`Unknown target DID: ${targetDid}`);
    }
    console.log(`\n📤 Sending DIDComm message`);
    console.log(`   From: ${MY_DID}`);
    console.log(`   To: ${targetDid}`);
    console.log(`   Type: ${message.type}`);
    console.log(`   ID: ${message.id}`);
    console.log(`   Route: ${localEnvoyProxy} → Envoy Mesh → ${targetCluster}`);
    // Encrypt message with recipient's public key (E2E encryption)
    const encryptedMessage = await (0, didcomm_encryption_js_1.packDIDCommMessage)(agent, message, targetDid, MY_DID);
    // Verify encryption worked
    (0, didcomm_encryption_js_1.verifyEncryption)(encryptedMessage);
    const payload = JSON.stringify({
        encrypted: true,
        message: encryptedMessage
    });
    console.log(`📦 Payload size: ${Buffer.byteLength(payload)} bytes (${(Buffer.byteLength(payload) / 1024).toFixed(2)} KB)`);
    // Determine target host for Gateway routing
    let targetHost;
    if (targetDid.includes('cluster-a')) {
        targetHost = 'veramo-nf-a.nf-a-namespace.svc.cluster.local';
    }
    else if (targetDid.includes('cluster-b')) {
        targetHost = 'veramo-nf-b.nf-b-namespace.svc.cluster.local';
    }
    else {
        targetHost = 'unknown';
    }
    return new Promise((resolve, reject) => {
        const req = http_1.default.request(localEnvoyProxy + '/didcomm/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'X-Target-DID': targetDid,
                'Host': targetHost // Gateway uses this to route
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    console.log('✅ Message sent successfully');
                    resolve();
                }
                else {
                    console.error(`❌ Failed to send message: ${res.statusCode}`);
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', (error) => {
            console.error(`❌ Error sending message: ${error.message}`);
            reject(error);
        });
        req.write(payload);
        req.end();
    });
}
/**
 * HTTP Server to receive DIDComm messages
 */
function createHTTPServer() {
    const server = http_1.default.createServer(async (req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        // Health check endpoint
        if (req.url === '/health' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', did: MY_DID }));
            return;
        }
        // TEST ENDPOINT: Gateway Visibility Test
        // Shows what the gateway would see (packed message format)
        if (req.url === '/test/gateway-visibility' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', async () => {
                try {
                    const { targetDid, secretData } = JSON.parse(body);
                    const target = targetDid || THEIR_DID;
                    // Create a test message with sensitive data
                    const testMessage = {
                        type: 'https://didcomm.org/test/1.0/gateway-visibility-test',
                        id: `test-${Date.now()}`,
                        from: MY_DID,
                        to: [target],
                        created_time: Date.now(),
                        body: {
                            // Default sensitive data if not provided
                            apiKey: secretData?.apiKey || 'sk-secret-api-key-12345',
                            password: secretData?.password || 'super-secret-password',
                            confidentialData: secretData?.confidentialData || 'CONFIDENTIAL-NF-DATA',
                            creditCard: secretData?.creditCard || '4111-1111-1111-1111',
                            testTimestamp: new Date().toISOString()
                        }
                    };
                    // Pack the message using current DIDCOMM_PACKING_MODE
                    const packingMode = process.env.DIDCOMM_PACKING_MODE || 'encrypted';
                    const packedMessage = await (0, didcomm_encryption_js_1.packDIDCommMessage)(agent, testMessage, target, MY_DID);
                    // Analyze what the gateway sees
                    let gatewayCanRead = true;
                    let format = 'unknown';
                    let visibleSecrets = [];
                    try {
                        const parsed = JSON.parse(packedMessage);
                        if (parsed.protected && parsed.ciphertext && parsed.tag) {
                            format = 'JWE (encrypted)';
                            gatewayCanRead = false;
                        }
                        else if (parsed.payload && parsed.signatures) {
                            format = 'JWS (signed only)';
                            // Check if secrets are in base64 payload
                            const payload = Buffer.from(parsed.payload, 'base64url').toString();
                            if (payload.includes('sk-secret') || payload.includes('super-secret')) {
                                visibleSecrets = ['apiKey', 'password', 'confidentialData', 'creditCard'];
                            }
                        }
                    }
                    catch {
                        // Plain JSON
                        format = 'Plain JSON';
                        if (packedMessage.includes('sk-secret') || packedMessage.includes('super-secret')) {
                            visibleSecrets = ['apiKey', 'password', 'confidentialData', 'creditCard'];
                        }
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        test: 'gateway-visibility',
                        packingMode: packingMode,
                        format: format,
                        gatewayCanReadPayload: gatewayCanRead,
                        visibleSecrets: visibleSecrets,
                        originalMessage: testMessage,
                        packedMessage: packedMessage,
                        packedMessagePreview: packedMessage.substring(0, 200) + '...',
                        analysis: {
                            v1Compliant: !gatewayCanRead,
                            v4aMode: gatewayCanRead,
                            securityRisk: gatewayCanRead ? 'HIGH - Gateway can read all data' : 'LOW - E2E encrypted'
                        }
                    }, null, 2));
                }
                catch (error) {
                    console.error('Error in gateway visibility test:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // TEST ENDPOINT: Get current packing mode
        if (req.url === '/test/packing-mode' && req.method === 'GET') {
            const mode = process.env.DIDCOMM_PACKING_MODE || 'encrypted';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                packingMode: mode,
                description: mode === 'encrypted' ? 'V1: E2E encrypted (JWE)' :
                    mode === 'signed' ? 'V4a: Signed only (JWS)' :
                        'V4a: Plain (no encryption)',
                gatewayCanRead: mode !== 'encrypted'
            }));
            return;
        }
        // DIDComm receive endpoint
        if (req.url === '/didcomm/receive' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', async () => {
                try {
                    const message = JSON.parse(body);
                    // Handle the message
                    const response = await handleIncomingMessage(message);
                    if (response) {
                        // Send response back
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(response));
                    }
                    else {
                        res.writeHead(204); // No Content
                        res.end();
                    }
                }
                catch (error) {
                    console.error('Error processing DIDComm message:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // DIDComm send endpoint (routes encrypted messages from mesh to local receive handler)
        if (req.url === '/didcomm/send' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', async () => {
                try {
                    const payload = JSON.parse(body);
                    // This endpoint receives encrypted messages from the mesh
                    // We need to decrypt and process them locally
                    const response = await handleIncomingMessage(payload);
                    // If there's a response, send it back as a separate DIDComm message
                    if (response) {
                        // Extract sender DID from the decrypted message to send response back
                        const senderDid = response.to?.[0] || THEIR_DID;
                        await sendDIDCommMessage(response, senderDid);
                    }
                    res.writeHead(200);
                    res.end();
                }
                catch (error) {
                    console.error('Error processing DIDComm message:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // Initiate VP authentication flow (creates session on initiator side)
        if (req.url === '/didcomm/initiate-auth' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', async () => {
                try {
                    const { targetDid, presentationDefinition } = JSON.parse(body);
                    console.log(`\n🚀 Initiating VP authentication flow`);
                    console.log(`   Target: ${targetDid}`);
                    console.log(`   Our DID: ${MY_DID}`);
                    // Create session on initiator side
                    const session = sessionManager.createSession(MY_DID, // Initiator
                    targetDid, // Responder
                    `challenge-${Date.now()}`);
                    // Create VP_AUTH_REQUEST message
                    const authRequest = (0, didcomm_messages_js_1.createVPAuthRequest)(MY_DID, targetDid, presentationDefinition || MY_PD, 'Please authenticate yourself for service access');
                    // Mark that we sent the PD
                    sessionManager.updateSession(session.sessionId, {
                        initiatorPdSent: true
                    });
                    // Send the request
                    await sendDIDCommMessage(authRequest, targetDid);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: true,
                        sessionId: session.sessionId,
                        messageId: authRequest.id
                    }));
                }
                catch (error) {
                    console.error('Error initiating auth:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // Send service request to peer - AUTO-TRIGGERS VP Auth if not authenticated (Phase 1 trigger)
        // This matches the sequence diagram: Service Request → VP Auth → Service Traffic
        if (req.url === '/didcomm/service' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', async () => {
                try {
                    const { targetDid, service, action, params } = JSON.parse(body);
                    const target = targetDid || THEIR_DID;
                    console.log(`\n🚀 SERVICE_REQUEST received (Phase 1: Initial Service Request)`);
                    console.log(`   Target: ${target}`);
                    console.log(`   Service: ${service}`);
                    console.log(`   Action: ${action}`);
                    // Check if we're authenticated with the target
                    const session = sessionManager.getSessionByDids(MY_DID, target);
                    if (!session || session.status !== 'authenticated') {
                        // NOT AUTHENTICATED - Start VP Auth flow automatically (as per sequence diagram)
                        console.log(`\n🔐 Not authenticated with ${target} - Starting VP Auth Flow automatically`);
                        // Store the pending service request
                        pendingServiceRequests.set(target, {
                            service,
                            action,
                            params,
                            timestamp: Date.now()
                        });
                        console.log(`   📦 Service request queued, waiting for authentication`);
                        // Create session on initiator side
                        const newSession = sessionManager.createSession(MY_DID, target, `challenge-${Date.now()}`);
                        // Create VP_AUTH_REQUEST message
                        const authRequest = (0, didcomm_messages_js_1.createVPAuthRequest)(MY_DID, target, MY_PD, 'Authentication required for service access');
                        // Mark that we sent the PD
                        sessionManager.updateSession(newSession.sessionId, {
                            initiatorPdSent: true
                        });
                        // Send the auth request
                        await sendDIDCommMessage(authRequest, target);
                        res.writeHead(202, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            status: 'authenticating',
                            message: 'VP Authentication initiated. Service request will be sent after successful authentication.',
                            sessionId: newSession.sessionId,
                            pendingService: { service, action }
                        }));
                        return;
                    }
                    // AUTHENTICATED - Send service request directly
                    console.log(`\n📤 Sending SERVICE_REQUEST (authenticated session exists)`);
                    const serviceRequest = (0, didcomm_messages_js_1.createServiceRequest)(MY_DID, target, service, action, params);
                    await sendDIDCommMessage(serviceRequest, target);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: true,
                        messageId: serviceRequest.id,
                        service,
                        action
                    }));
                }
                catch (error) {
                    console.error('Error sending service request:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // Get session status endpoint
        if (req.url === '/session/status' && req.method === 'GET') {
            const sessions = sessionManager.getAllSessions();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                myDid: MY_DID,
                sessionCount: sessions.length,
                sessions: sessions.map(s => ({
                    sessionId: s.sessionId,
                    initiator: s.initiatorDid,
                    responder: s.responderDid,
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
    return server;
}
/**
 * Start the server
 */
async function main() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║          DIDComm HTTP/2 Transport Server                      ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    await initializeAgent();
    const server = createHTTPServer();
    server.listen(PORT, () => {
        console.log('');
        console.log('🚀 Server running');
        console.log(`   Port: ${PORT}`);
        console.log(`   DID: ${MY_DID}`);
        console.log('');
        console.log('📍 Endpoints:');
        console.log(`   GET  http://localhost:${PORT}/health`);
        console.log(`   POST http://localhost:${PORT}/didcomm/receive`);
        console.log(`   POST http://localhost:${PORT}/didcomm/send`);
        console.log(`   POST http://localhost:${PORT}/didcomm/initiate-auth  (Phase 1-2: VP Auth)`);
        console.log(`   POST http://localhost:${PORT}/didcomm/service        (Phase 3: Service Traffic)`);
        console.log(`   GET  http://localhost:${PORT}/session/status`);
        console.log('');
        console.log('✅ Ready to handle DIDComm messages (Phase 1-3)');
        console.log('');
    });
}
// Run the server
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
