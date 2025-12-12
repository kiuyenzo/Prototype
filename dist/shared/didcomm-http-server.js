#!/usr/bin/env ts-node
/**
 * DIDComm HTTP/2 Transport Server
 *
 * This server provides HTTP endpoints for sending/receiving DIDComm messages
 * and integrates with Envoy Proxies.
 *
 * Architecture:
 * Veramo_NF_A ↔ HTTP Server ↔ Envoy_Proxy_NF_A ↔ Envoy_Gateway_A ↔ ... ↔ Veramo_NF_B
 */
import http from 'http';
import { createAgent } from '@veramo/core';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import { CredentialPlugin } from '@veramo/credential-w3c';
import { KeyManager } from '@veramo/key-manager';
import { DIDManager } from '@veramo/did-manager';
import { KeyStore, DIDStore, PrivateKeyStore, DataStore, DataStoreORM } from '@veramo/data-store';
import { KeyManagementSystem, SecretBox } from '@veramo/kms-local';
import { WebDIDProvider } from '@veramo/did-provider-web';
import { Resolver } from 'did-resolver';
import { getResolver as webDidResolver } from 'web-did-resolver';
import { DataSource } from 'typeorm';
import { Entities, migrations } from '@veramo/data-store';
import { DIDCommVPWrapper } from './didcomm-vp-wrapper.js';
import { DIDCOMM_MESSAGE_TYPES } from './didcomm-messages.js';
import { PRESENTATION_DEFINITION_A, PRESENTATION_DEFINITION_B } from './presentation-definitions.js';
import { SessionManager } from './session-manager.js';
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
const MY_PD = isNFA ? PRESENTATION_DEFINITION_A : PRESENTATION_DEFINITION_B;
const THEIR_PD = isNFA ? PRESENTATION_DEFINITION_B : PRESENTATION_DEFINITION_A;
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
    const dbConnection = new DataSource({
        type: 'sqlite',
        database: DB_PATH,
        synchronize: false,
        migrationsRun: true,
        migrations,
        logging: false,
        entities: Entities,
    });
    await dbConnection.initialize();
    agent = createAgent({
        plugins: [
            new KeyManager({
                store: new KeyStore(dbConnection),
                kms: {
                    local: new KeyManagementSystem(new PrivateKeyStore(dbConnection, new SecretBox(DB_ENCRYPTION_KEY))),
                },
            }),
            new DIDManager({
                store: new DIDStore(dbConnection),
                defaultProvider: 'did:web',
                providers: {
                    'did:web': new WebDIDProvider({
                        defaultKms: 'local',
                    }),
                },
            }),
            new DIDResolverPlugin({
                resolver: new Resolver({
                    ...webDidResolver(),
                }),
            }),
            new CredentialPlugin(),
            new DataStore(dbConnection),
            new DataStoreORM(dbConnection),
        ],
    });
    wrapper = new DIDCommVPWrapper(agent);
    sessionManager = new SessionManager();
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
        const nfCredentials = credentials.filter((cred) => cred.verifiableCredential.type.includes('NetworkFunctionCredential'));
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
async function handleIncomingMessage(message) {
    console.log(`\n📨 Received DIDComm message: ${message.type}`);
    console.log(`   From: ${message.from}`);
    console.log(`   ID: ${message.id}`);
    const credentials = await loadCredentials();
    try {
        switch (message.type) {
            case DIDCOMM_MESSAGE_TYPES.VP_AUTH_REQUEST:
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
            case DIDCOMM_MESSAGE_TYPES.VP_WITH_PD:
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
            case DIDCOMM_MESSAGE_TYPES.VP_RESPONSE:
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
            case DIDCOMM_MESSAGE_TYPES.AUTH_CONFIRMATION:
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
 * Send DIDComm message via HTTP to Envoy Proxy
 */
async function sendDIDCommMessage(message, targetDid) {
    const envoyProxyUrl = 'http://envoy-proxy-nf-a:8080/didcomm/send'; // Will be routed by Envoy
    console.log(`\n📤 Sending DIDComm message to ${targetDid}`);
    console.log(`   Type: ${message.type}`);
    console.log(`   ID: ${message.id}`);
    const payload = JSON.stringify(message);
    return new Promise((resolve, reject) => {
        const req = http.request(envoyProxyUrl, {
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
    const server = http.createServer(async (req, res) => {
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
