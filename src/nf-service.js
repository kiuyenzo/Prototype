#!/usr/bin/env ts-node
"use strict";
/**
 * NF Service - Business Logic Container (Port 3000)
 * Pod: [NF:3000] ↔ [Veramo:3001] - NF handles business logic only
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const NF_PORT = process.env.NF_PORT || 3000;
const VERAMO_PORT = process.env.VERAMO_PORT || 3001;
const NF_NAME = process.env.NF_NAME || 'NF';
const MY_DID = process.env.MY_DID || '';
const isNFA = MY_DID.includes('nf-a');

/** 5G NRF Discovery Response (3GPP TS 29.510) */
const getNRFResponse = () => ({
    nfInstances: [{
        nfInstanceId: isNFA ? 'nf-a-instance-001' : 'nf-b-instance-001',
        nfType: isNFA ? 'AMF' : 'SMF', nfStatus: 'REGISTERED', heartBeatTimer: 60,
        fqdn: isNFA ? 'nf-a.cluster-a.local' : 'nf-b.cluster-b.local',
        ipv4Addresses: [isNFA ? '10.244.0.10' : '10.244.1.10'],
        priority: 0, capacity: 100, load: 25,
        nfServices: [{ serviceInstanceId: 'service-001', serviceName: isNFA ? 'namf-comm' : 'nsmf-pdusession', versions: [{ apiVersionInUri: 'v1', apiFullVersion: '1.0.0' }], scheme: 'https', nfServiceStatus: 'REGISTERED', fqdn: isNFA ? 'nf-a.cluster-a.local' : 'nf-b.cluster-b.local', ipEndPoints: [{ ipv4Address: isNFA ? '10.244.0.10' : '10.244.1.10', port: 443 }] }],
        plmnList: [{ mcc: '262', mnc: '01' }], allowedPlmns: [{ mcc: '262', mnc: '02' }],
        allowedNfTypes: ['AMF', 'SMF', 'UPF', 'AUSF'], locality: isNFA ? 'cluster-a' : 'cluster-b'
    }],
    searchId: `search-${Date.now()}`, numNfInstComplete: 1, validityPeriod: 3600, nrfSupportedFeatures: '0'
});

/** Business Logic Handler */
function handleServiceRequest(service, action, params) {
    console.log(`🔧 NF: ${service}/${action}`);
    switch (service) {
        case 'nf-info':
            return { nfType: isNFA ? 'NF-A' : 'NF-B', did: MY_DID, capabilities: ['authentication', 'data-query', 'subscription'], timestamp: new Date().toISOString() };
        case 'data-query':
            return { query: params?.query || 'default', results: [{ id: 1, name: 'Sample Data 1', value: 100 }, { id: 2, name: 'Sample Data 2', value: 200 }], totalCount: 2, executedBy: MY_DID, timestamp: new Date().toISOString() };
        case 'subscription':
            if (action === 'subscribe') return { subscriptionId: `sub-${Date.now()}`, topic: params?.topic || 'default', status: 'active', timestamp: new Date().toISOString() };
            if (action === 'unsubscribe') return { subscriptionId: params?.subscriptionId, status: 'cancelled', timestamp: new Date().toISOString() };
            break;
        case 'echo':
            return { echo: params, receivedAt: new Date().toISOString(), processedBy: MY_DID };
        case 'nnrf-disc':
        case 'nf-discovery':
            return getNRFResponse();
        default:
            throw new Error(`Unknown service: ${service}`);
    }
    throw new Error(`Unknown action: ${action} for service: ${service}`);
}
/** Send service request to Veramo sidecar */
async function sendServiceRequestToVeramo(targetDid, service, action, params) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ targetDid, service, action, params });
        const req = http_1.default.request({
            hostname: 'localhost', port: VERAMO_PORT, path: '/nf/service-request', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200 || res.statusCode === 202) resolve(JSON.parse(data));
                else reject(new Error(`Veramo returned ${res.statusCode}: ${data}`));
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}
/** HTTP Server */
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
            res.end(JSON.stringify({
                status: 'ok',
                service: 'nf-service',
                name: NF_NAME,
                did: MY_DID
            }));
            return;
        }
        // Service endpoint - called by Veramo sidecar for business logic
        if (req.url === '/service' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', () => {
                try {
                    const { service, action, params } = JSON.parse(body);
                    const result = handleServiceRequest(service, action, params);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } catch (error) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // Response endpoint - called by Veramo sidecar to deliver async responses
        if (req.url === '/response' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    console.log(`📥 Response: ${data.status}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ received: true }));
                } catch (error) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // Request endpoint - external trigger to initiate service flow
        if (req.url === '/request' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', async () => {
                try {
                    const { targetDid, service, action, params } = JSON.parse(body);
                    const result = await sendServiceRequestToVeramo(targetDid, service, action, params);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } catch (error) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // 5G NRF Discovery REST Endpoint (3GPP TS 29.510)
        if (req.url?.startsWith('/nnrf-disc/v1/nf-instances') && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getNRFResponse()));
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
    const server = createHTTPServer();
    server.listen(NF_PORT, () => {
        console.log(`🚀 NF Service running on :${NF_PORT} [${NF_NAME}]`);
    });
}
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
