#!/usr/bin/env node
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

// Baseline B: Direct NF-to-NF communication (no DIDComm, mTLS only)
const BASELINE_TARGET_HOST = process.env.BASELINE_TARGET_HOST || (isNFA ? 'cluster-b.external' : 'cluster-a.external');
const BASELINE_TARGET_PORT = process.env.BASELINE_TARGET_PORT || (isNFA ? '31696' : '31392');

/**
 * 5G UDM Subscriber Data (3GPP TS 29.503 - Nudm_SDM)
 * NF-B acts as UDM providing subscriber data
 */
const subscriberDatabase = {
    'imsi-262011234567890': {
        supi: 'imsi-262011234567890',
        gpsi: 'msisdn-491701234567',
        subscriberName: 'Max Mustermann',
        amData: {
            gpsis: ['msisdn-491701234567'],
            subscribedUeAmbr: { uplink: '100 Mbps', downlink: '200 Mbps' },
            nssai: {
                defaultSingleNssais: [
                    { sst: 1, sd: '000001' },
                    { sst: 2, sd: '000002' }
                ],
                singleNssais: [
                    { sst: 1, sd: '000001' },
                    { sst: 2, sd: '000002' },
                    { sst: 3, sd: '000003' }
                ]
            },
            ratRestrictions: ['NR', 'EUTRA'],
            coreNetworkTypeRestrictions: ['5GC']
        },
        smfSelectionData: {
            subscribedSnssaiInfos: {
                '01-000001': { dnnInfos: [{ dnn: 'internet', defaultDnnIndicator: true }] },
                '02-000002': { dnnInfos: [{ dnn: 'ims', defaultDnnIndicator: false }] }
            }
        },
        authenticationData: {
            authenticationMethod: '5G_AKA',
            permanentKeyId: 'key-001'
        }
    }
};

/** Get UDM subscriber data by SUPI */
const getSubscriberData = (supi, dataType) => {
    const subscriber = subscriberDatabase[supi];
    if (!subscriber) {
        return { error: 'USER_NOT_FOUND', message: `Subscriber ${supi} not found` };
    }
    switch (dataType) {
        case 'am-data': return subscriber.amData;
        case 'smf-select-data': return subscriber.smfSelectionData;
        case 'nssai': return subscriber.amData.nssai;
        case 'all': return subscriber;
        default: return subscriber.amData;
    }
};

/** Business Logic Handler */
function handleServiceRequest(service, action, params) {
    console.log(`[NF] ${service}/${action}`);
    switch (service) {
        case 'nudm-sdm':
        case 'subscriber-data':
            const supi = params?.supi || 'imsi-262011234567890';
            const dataType = params?.dataType || action || 'am-data';
            return getSubscriberData(supi, dataType);
        default:
            throw new Error(`Unknown service: ${service}`);
    }
}
/**
 * Baseline B: Send direct HTTP request to remote NF (no DIDComm, mTLS only)
 * Used for performance comparison - bypasses Veramo sidecar entirely
 */
async function sendBaselineRequest(service, action, params) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const payload = JSON.stringify({ service, action, params, sender: NF_NAME, timestamp: startTime });
        const req = http_1.default.request({
            hostname: BASELINE_TARGET_HOST,
            port: parseInt(BASELINE_TARGET_PORT),
            path: '/baseline/process',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'X-Baseline-Mode': 'true',
                'X-Request-Start': startTime.toString()
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                const endTime = Date.now();
                const latency = endTime - startTime;
                if (res.statusCode === 200) {
                    try {
                        const result = JSON.parse(data);
                        resolve({
                            ...result,
                            _baseline: {
                                mode: 'B',
                                latencyMs: latency,
                                payloadSize: Buffer.byteLength(payload),
                                responseSize: Buffer.byteLength(data)
                            }
                        });
                    } catch (e) {
                        resolve({ raw: data, _baseline: { mode: 'B', latencyMs: latency } });
                    }
                } else {
                    reject(new Error(`Baseline request failed: ${res.statusCode} - ${data}`));
                }
            });
        });
        req.on('error', (err) => reject(new Error(`Baseline connection error: ${err.message}`)));
        req.write(payload);
        req.end();
    });
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
                    console.log(`[RESPONSE] ${data.status}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ received: true }));
                } catch (error) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
            return;
        }
        // ========================================================================
        // BASELINE B: Direct mTLS-only endpoints (no DIDComm, no VPs)
        // ========================================================================

        // Baseline request - initiates direct NF-to-NF call (bypasses Veramo)
        if (req.url === '/baseline/request' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', async () => {
                try {
                    const { service, action, params } = JSON.parse(body);
                    console.log(`[BASELINE-B] Initiating direct request: ${service}/${action}`);
                    const result = await sendBaselineRequest(service, action, params);
                    console.log(`[BASELINE-B] Response received in ${result._baseline?.latencyMs}ms`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } catch (error) {
                    console.error(`[BASELINE-B] Error: ${error.message}`);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message, mode: 'baseline-B' }));
                }
            });
            return;
        }

        // Baseline process - handles incoming direct requests from other NFs
        if (req.url === '/baseline/process' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', () => {
                try {
                    const { service, action, params, sender, timestamp } = JSON.parse(body);
                    console.log(`[BASELINE-B] Processing request from ${sender}: ${service}/${action}`);
                    const result = handleServiceRequest(service, action, params);
                    const processTime = Date.now() - timestamp;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        ...result,
                        _baseline: {
                            mode: 'B',
                            processedBy: NF_NAME,
                            processTimeMs: processTime
                        }
                    }));
                } catch (error) {
                    console.error(`[BASELINE-B] Process error: ${error.message}`);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message, mode: 'baseline-B' }));
                }
            });
            return;
        }

        // ========================================================================
        // END BASELINE B
        // ========================================================================

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
        // 5G UDM Subscriber Data Management REST Endpoints (3GPP TS 29.503 - Nudm_SDM)
        // GET /nudm-sdm/v2/{supi}/am-data - Access and Mobility Subscription Data
        // GET /nudm-sdm/v2/{supi}/smf-select-data - SMF Selection Subscription Data
        // GET /nudm-sdm/v2/{supi}/nssai - Subscribed S-NSSAIs
        const udmMatch = req.url?.match(/^\/nudm-sdm\/v2\/([^\/]+)\/(am-data|smf-select-data|nssai)$/);
        if (udmMatch && req.method === 'GET') {
            const [, supi, dataType] = udmMatch;
            const data = getSubscriberData(supi, dataType);
            if (data.error) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 404, cause: data.error, detail: data.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(data));
            }
            return;
        }
        // GET /nudm-sdm/v2/{supi} - All subscriber data
        const udmAllMatch = req.url?.match(/^\/nudm-sdm\/v2\/([^\/]+)$/);
        if (udmAllMatch && req.method === 'GET') {
            const [, supi] = udmAllMatch;
            const data = getSubscriberData(supi, 'all');
            if (data.error) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 404, cause: data.error, detail: data.message }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(data));
            }
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
        console.log(`[START] NF Service running on :${NF_PORT} [${NF_NAME}]`);
    });
}
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
