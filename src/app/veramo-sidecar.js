#!/usr/bin/env node

"use strict";

const http = require('http');
const { createAgent } = require('@veramo/core');
const { DIDResolverPlugin } = require('@veramo/did-resolver');
const { CredentialPlugin } = require('@veramo/credential-w3c');
const { KeyManager } = require('@veramo/key-manager');
const { DIDManager } = require('@veramo/did-manager');
const { KeyStore, DIDStore, DataStore, DataStoreORM, PrivateKeyStore, migrations, Entities } = require('@veramo/data-store');
const { KeyManagementSystem, SecretBox } = require('@veramo/kms-local');
const { WebDIDProvider } = require('@veramo/did-provider-web');
const { Resolver } = require('did-resolver');
const { getResolver } = require('web-did-resolver');
const { DIDComm, DIDCommMessageHandler } = require('@veramo/did-comm');
const { MessageHandler } = require('@veramo/message-handler');
const { DataSource } = require('typeorm');
const { DIDCommVPWrapper } = require('../didcomm/vp-wrapper.js');
const { DIDCOMM_MESSAGE_TYPES, createVPAuthRequest, createServiceRequest, createServiceResponse } = require('../didcomm/messages.js');
const { SessionManager } = require('../services/session-manager.js');
const { PRESENTATION_DEFINITION_A, PRESENTATION_DEFINITION_B } = require('../credentials/vp_definitions.js');
const { AuditLogger, AUDIT_EVENTS } = require('../services/audit-logger.js');
const { HealthMetrics } = require('../services/health-metrics.js');
const { PolicyEngine } = require('../services/policy-engine.js');

const DB_PATH = process.env.DB_PATH || './database.sqlite';
const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY || '';
const VERAMO_PORT = process.env.VERAMO_PORT || 3001, NF_PORT = process.env.NF_PORT || 3000;
const MY_DID = process.env.MY_DID || '', PACKING_MODE = process.env.DIDCOMM_PACKING_MODE || 'encrypted';
const isNFA = MY_DID.includes('nf-a');
const MY_PD = isNFA ? PRESENTATION_DEFINITION_A : PRESENTATION_DEFINITION_B;
const THEIR_DID = isNFA ? 'did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b' : 'did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a';

let agent, wrapper, sessionManager;
const pendingServiceRequests = new Map();

const auditLogger = new AuditLogger({ serviceName: 'veramo-sidecar', ownDid: MY_DID });
const healthMetrics = new HealthMetrics({ serviceName: 'veramo-sidecar', ownDid: MY_DID });
const policyEngine = new PolicyEngine();

const packMode = () => ({ encrypted: 'authcrypt', signed: 'jws', none: 'none' }[PACKING_MODE] || 'authcrypt');
const packMsg = async (a, m, to, from) => (await a.packDIDCommMessage({ packing: packMode(), message: { ...m, from, to: [to] } })).message;
const unpackMsg = async (a, p) => (await a.unpackDIDCommMessage({ message: p })).message;

async function initializeAgent() {
    console.log(`[INIT] Veramo [DID: ${MY_DID.split(':').pop()}, Mode: ${PACKING_MODE}]`);
    const db = new DataSource({ type: 'better-sqlite3', database: DB_PATH, synchronize: false, migrationsRun: true, migrations, logging: false, entities: Entities });
    await db.initialize();
    agent = createAgent({
        plugins: [
            new KeyManager({ store: new KeyStore(db), kms: { local: new KeyManagementSystem(new PrivateKeyStore(db, new SecretBox(DB_ENCRYPTION_KEY))) } }),
            new DIDManager({ store: new DIDStore(db), defaultProvider: 'did:web', providers: { 'did:web': new WebDIDProvider({ defaultKms: 'local' }) } }),
            new DIDResolverPlugin({ resolver: new Resolver({ ...getResolver() }) }),
            new CredentialPlugin(), new DataStore(db), new DataStoreORM(db), new DIDComm(), new MessageHandler({ messageHandlers: [new DIDCommMessageHandler()] })
        ]
    });
    wrapper = new DIDCommVPWrapper(agent);
    sessionManager = new SessionManager();
}

async function loadCredentials() {
    return (await agent.dataStoreORMGetVerifiableCredentials({ where: [{ column: 'subject', value: [MY_DID] }] }))
        .filter(c => c.verifiableCredential.type.includes('NetworkFunctionCredential'))
        .map(c => c.verifiableCredential);
}

async function callNFService(service, action, params) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ service, action, params });
        const req = http.request({ hostname: 'localhost', port: NF_PORT, path: '/service', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => res.statusCode === 200 ? resolve(JSON.parse(d)) : reject(new Error(d))); });
        req.on('error', reject); req.write(payload); req.end();
    });
}

async function sendResponseToNF(data) {
    return new Promise(resolve => {
        const payload = JSON.stringify(data);
        const req = http.request({ hostname: 'localhost', port: NF_PORT, path: '/response', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, res => { res.on('data', () => {}); res.on('end', () => resolve()); });
        req.on('error', () => resolve()); req.write(payload); req.end();
    });
}

async function sendDIDCommMessage(message, targetDid) {
    const targetIsA = targetDid.includes('did-nf-a');
    const targetHost = targetIsA ? process.env.CLUSTER_A_IP : process.env.CLUSTER_B_IP;
    const targetPort = targetIsA ? process.env.CLUSTER_A_PORT : process.env.CLUSTER_B_PORT;
    const targetService = targetIsA ? 'veramo-nf-a.nf-a-namespace.svc.cluster.local' : 'veramo-nf-b.nf-b-namespace.svc.cluster.local';
    const useK8s = process.env.USE_KUBERNETES === 'true';
    console.log(`[SEND] ${message.type.split('/').pop()} to ${targetDid.split(':').pop()} via ${useK8s ? targetHost + ':' + targetPort : 'envoy'}`);

    try { await agent.dataStoreSaveMessage({ message: { id: message.id, type: message.type, from: MY_DID, to: targetDid, createdAt: new Date().toISOString(), data: message } }); } catch (e) { console.log('[DB] Save outgoing message failed:', e.message); }
    const payload = JSON.stringify({ packed: true, mode: PACKING_MODE, message: await packMsg(agent, message, targetDid, MY_DID) });
    return new Promise((resolve, reject) => {
        const options = useK8s
            ? { hostname: targetHost, port: parseInt(targetPort), path: '/didcomm/send', method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'Host': targetService } }
            : { hostname: `envoy-proxy-nf-${isNFA ? 'a' : 'b'}`, port: 8080, path: '/didcomm/send', method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } };
        const req = http.request(options, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => res.statusCode >= 200 && res.statusCode < 300 ? resolve() : reject(new Error(d || `HTTP ${res.statusCode}`))); });
        req.on('error', reject); req.write(payload); req.end();
    });
}

async function handleIncomingMessage(msgData) {
    let message = (msgData.packed || msgData.encrypted) && msgData.message ? await unpackMsg(agent, msgData.message) : msgData;
    console.log(`[MSG] ${message.type.split('/').pop()} from ${message.from?.split(':').pop()}`);
    try { await agent.dataStoreSaveMessage({ message: { id: message.id || `msg-${Date.now()}`, type: message.type, from: message.from, to: message.to?.[0] || MY_DID, createdAt: new Date().toISOString(), data: message.body } }); } catch (e) { console.log('[DB] Save incoming message failed:', e.message); }
    const credentials = await loadCredentials();
    const MT = DIDCOMM_MESSAGE_TYPES;

    switch (message.type) {
        case MT.VP_AUTH_REQUEST: {
            auditLogger.logAuthRequest('received', message.from, message.id);
            healthMetrics.incVpAuthRequestReceived();
            const session = sessionManager.createSession(message.from, message.to[0], message.id);
            healthMetrics.incSessionCreated();
            const vpWithPD = await wrapper.handleVPAuthRequest(message, MY_DID, credentials, MY_PD);
            sessionManager.updateSession(session.sessionId, { responderPdSent: true });
            auditLogger.logVpExchange('initiated', message.from, session.sessionId);
            return vpWithPD;
        }
        case MT.VP_WITH_PD: {
            const session = sessionManager.getSessionByDids(message.from, message.to?.[0] || MY_DID) || sessionManager.getSessionByDids(MY_DID, message.from);
            if (!session) throw new Error('No session');
            try {
                const vpResponse = await wrapper.handleVPWithPD(message, credentials, MY_DID, MY_PD);
                sessionManager.markResponderVpReceived(session.sessionId);
                auditLogger.logVpVerification(message.from, true);
                healthMetrics.incVpVerificationSuccess();
                return vpResponse;
            } catch (vpError) {
                auditLogger.logVpVerification(message.from, false, vpError.message);
                healthMetrics.recordError(vpError);
                throw vpError;
            }
        }
        case MT.VP_RESPONSE: {
            const session = sessionManager.getSessionByDids(message.from, message.to[0]);
            if (!session) throw new Error('No session');
            try {
                const result = await wrapper.handleVPResponse(message);
                sessionManager.markInitiatorVpReceived(session.sessionId);
                sessionManager.markAuthenticated(session.sessionId);
                auditLogger.logVpExchange('completed', message.from, session.sessionId, true);
                auditLogger.logVpVerification(message.from, true);
                auditLogger.logSessionEvent(AUDIT_EVENTS.SESSION_AUTHENTICATED, session.sessionId, message.from, 'authenticated');
                healthMetrics.incVpExchangeCompleted();
                healthMetrics.incSessionAuthenticated();
                return result;
            } catch (vpError) {
                auditLogger.logVpVerification(message.from, false, vpError.message);
                healthMetrics.recordError(vpError);
                throw vpError;
            }
        }
        case MT.AUTH_CONFIRMATION: {
            const session = sessionManager.getSessionByDids(message.from, message.to[0]);
            if (session) {
                sessionManager.markAuthenticated(session.sessionId);
                auditLogger.logSessionEvent(AUDIT_EVENTS.SESSION_AUTHENTICATED, session.sessionId, message.from, 'authenticated');
                healthMetrics.incSessionAuthenticated();
            }
            await wrapper.handleAuthConfirmation(message);
            const pending = pendingServiceRequests.get(message.from);
            if (pending) {
                pendingServiceRequests.delete(message.from);
                await sendDIDCommMessage(createServiceRequest(MY_DID, message.from, pending.service, pending.action, pending.params), message.from);
            }
            return null;
        }
        case MT.SERVICE_REQUEST: {
            const session = sessionManager.getSessionByDids(message.from, message.to[0]);
            const policyResult = policyEngine.evaluate({
                requesterDid: message.from,
                requesterRoles: session?.peerRoles || ['network-function'],
                requesterCredentialTypes: ['NetworkFunctionCredential'],
                targetService: message.body.service,
                action: message.body.action,
                isAuthenticated: session?.status === 'authenticated'
            });
            healthMetrics.incPolicyEvaluation();
            auditLogger.logPolicyEvaluation(message.from, message.body.service, policyResult.allowed ? 'granted' : 'denied', policyResult.policyId);
            if (!policyResult.allowed) {
                healthMetrics.incPolicyViolation();
                healthMetrics.incServiceRequestDenied();
                auditLogger.logServiceAccess(message.from, message.body.service, message.body.action, false, policyResult.reason);
                return createServiceResponse(MY_DID, message.from, 'error', undefined, policyResult.reason);
            }
            healthMetrics.incServiceRequestGranted();
            auditLogger.logServiceAccess(message.from, message.body.service, message.body.action, true);
            try { return createServiceResponse(MY_DID, message.from, 'success', await callNFService(message.body.service, message.body.action, message.body.params)); }
            catch (e) { return createServiceResponse(MY_DID, message.from, 'error', undefined, e.message); }
        }
        case MT.SERVICE_RESPONSE:
            await sendResponseToNF({ type: 'service_response', from: message.from, status: message.body.status, data: message.body.data, error: message.body.error });
            return null;
        default: return null;
    }
}

const json = (res, data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const parseBody = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(JSON.parse(b))); });

function createHTTPServer() {
    return http.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
        try {
            if (req.url === '/health') {
                healthMetrics.setActiveSessions(sessionManager.getAllSessions().length);
                return json(res, healthMetrics.getHealth());
            }
            if (req.url === '/health/detailed') {
                healthMetrics.setActiveSessions(sessionManager.getAllSessions().length);
                return json(res, healthMetrics.getHealthDetailed(sessionManager));
            }
            if (req.url === '/policies') return json(res, policyEngine.getAllPolicies());
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
                    healthMetrics.incSessionCreated();
                    healthMetrics.incVpAuthRequestSent();
                    auditLogger.logAuthRequest('sent', target, newSession.sessionId);
                    await sendDIDCommMessage(createVPAuthRequest(MY_DID, target, MY_PD, 'Auth required'), target);
                    return json(res, { status: 'authenticating', sessionId: newSession.sessionId }, 202);
                }
                healthMetrics.recordServiceRequest(target, service);
                await sendDIDCommMessage(createServiceRequest(MY_DID, target, service, action, params), target);
                return json(res, { success: true });
            }
            if (req.url === '/session/status') return json(res, { myDid: MY_DID, sessions: sessionManager.getAllSessions().map(s => ({ id: s.sessionId, status: s.status })) });

            if (req.url === '/debug/pack-message' && req.method === 'POST') {
                const { targetDid, payload, mode } = await parseBody(req);
                const target = targetDid || THEIR_DID;
                const testMessage = { type: 'https://didcomm.org/test/1.0/visibility-test', id: `test-${Date.now()}`, body: payload || { test: 'visibility' } };
                const testMode = mode || PACKING_MODE;
                const testPacking = ({ encrypted: 'authcrypt', anon: 'anoncrypt', signed: 'jws', none: 'none' }[testMode] || 'authcrypt');
                const packed = (await agent.packDIDCommMessage({ packing: testPacking, message: { ...testMessage, from: MY_DID, to: [target] } })).message;
                return json(res, { mode: testMode, packingType: testPacking, packed });
            }
            res.writeHead(404); res.end('Not Found');
        } catch (error) {
            console.error('Error:', error.message);
            healthMetrics.recordError(error);
            json(res, { error: error.message }, 500);
        }
    });
}

initializeAgent().then(() => {
    createHTTPServer().listen(VERAMO_PORT, () => {
        console.log(`[START] Veramo :${VERAMO_PORT} [${MY_DID.split(':').pop()}]`);
        auditLogger.logSystemEvent(AUDIT_EVENTS.SYSTEM_STARTUP, { port: VERAMO_PORT, packingMode: PACKING_MODE });
    });
});
