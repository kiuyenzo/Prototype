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
const didcomm_vp_wrapper_js_1 = require("./didcomm-vp-wrapper.js");
const didcomm_messages_js_1 = require("./didcomm-messages.js");
const presentation_definitions_js_1 = require("./presentation-definitions.js");
const session_manager_js_1 = require("./session-manager.js");
const didcomm_encryption_js_1 = require("./didcomm-encryption.js");
const did_resolver_cache_js_1 = require("./did-resolver-cache.js");
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
    // Pre-cache DID documents for E2E encryption
    (0, did_resolver_cache_js_1.precacheDIDs)();
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
                return authConfirmation;
            case didcomm_messages_js_1.DIDCOMM_MESSAGE_TYPES.AUTH_CONFIRMATION:
                // Phase 4: Final confirmation - mark as authenticated
                const authConf = message;
                const session3 = sessionManager.getSessionByDids(authConf.from, authConf.to[0]);
                if (session3) {
                    sessionManager.markAuthenticated(session3.sessionId);
                    console.log(`✅ Authentication complete for session: ${session3.sessionId}`);
                }
                await wrapper.handleAuthConfirmation(authConf);
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
        // Kubernetes multi-cluster routing: use NodePort for cross-cluster, ClusterIP for local
        const isTargetClusterA = targetDid.includes('cluster-a');
        const isLocalClusterA = MY_DID.includes('cluster-a');
        // Check if this is cross-cluster communication
        if (isTargetClusterA !== isLocalClusterA) {
            // Cross-cluster: use NodePort on Docker network
            if (isTargetClusterA) {
                localEnvoyProxy = 'http://172.23.0.2:31829'; // Cluster-A NodePort
            }
            else {
                localEnvoyProxy = 'http://172.23.0.3:30132'; // Cluster-B NodePort
            }
        }
        else {
            // Same cluster: use Kubernetes ClusterIP service
            if (targetDid.includes('cluster-a')) {
                localEnvoyProxy = 'http://veramo-nf-a.nf-a-namespace.svc.cluster.local:3000';
            }
            else if (targetDid.includes('cluster-b')) {
                localEnvoyProxy = 'http://veramo-nf-b.nf-b-namespace.svc.cluster.local:3001';
            }
            else {
                throw new Error(`Unknown target DID: ${targetDid}`);
            }
        }
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
    return new Promise((resolve, reject) => {
        const req = http_1.default.request(localEnvoyProxy + '/didcomm/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'X-Target-DID': targetDid
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
        // DIDComm send endpoint (for testing)
        if (req.url === '/didcomm/send' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', async () => {
                try {
                    const message = JSON.parse(body);
                    await sendDIDCommMessage(message, THEIR_DID);
                    res.writeHead(200);
                    res.end();
                }
                catch (error) {
                    console.error('Error sending DIDComm message:', error);
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
        console.log('');
        console.log('✅ Ready to handle DIDComm messages');
        console.log('');
    });
}
// Run the server
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
