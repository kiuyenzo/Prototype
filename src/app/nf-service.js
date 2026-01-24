"use strict";

const http = require('http');
const NF_PORT = process.env.NF_PORT || 3000;
const VERAMO_PORT = process.env.VERAMO_PORT || 3001;
const NF_NAME = process.env.NF_NAME || 'NF';
const MY_DID = process.env.MY_DID || '';
const isNFA = MY_DID.includes('nf-a');
const BASELINE_TARGET_HOST = process.env.BASELINE_TARGET_HOST || (isNFA ? 'cluster-b.external' : 'cluster-a.external');
const BASELINE_TARGET_PORT = process.env.BASELINE_TARGET_PORT || (isNFA ? '31696' : '31392');

const subscriberDatabase = {
    'imsi-262011234567890': {
        supi: 'imsi-262011234567890',
        gpsi: 'msisdn-491701234567',
        amData: {
            gpsis: ['msisdn-491701234567'],
            subscribedUeAmbr: { uplink: '100 Mbps', downlink: '200 Mbps' },
            nssai: {
                defaultSingleNssais: [{ sst: 1, sd: '000001' }],
                singleNssais: [{ sst: 1, sd: '000001' }, { sst: 2, sd: '000002' }]
            }
        },
        smfSelectionData: {
            subscribedSnssaiInfos: {
                '01-000001': { dnnInfos: [{ dnn: 'internet', defaultDnnIndicator: true }] }
            }
        }
    }
};

const getSubscriberData = (supi, dataType) => {
    const subscriber = subscriberDatabase[supi];
    if (!subscriber) return { error: 'USER_NOT_FOUND', message: `Subscriber ${supi} not found` };
    switch (dataType) {
        case 'am-data': return subscriber.amData;
        case 'smf-select-data': return subscriber.smfSelectionData;
        case 'nssai': return subscriber.amData.nssai;
        case 'all': return subscriber;
        default: return subscriber.amData;
    }
};

function handleServiceRequest(service, action, params) {
    console.log(`[NF] ${service}/${action}`);
    if (service === 'nudm-sdm' || service === 'subscriber-data') {
        return getSubscriberData(params?.supi || 'imsi-262011234567890', params?.dataType || action || 'am-data');
    }
    throw new Error(`Unknown service: ${service}`);
}

async function sendBaselineRequest(service, action, params) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const payload = JSON.stringify({ service, action, params, sender: NF_NAME, timestamp: startTime });
        const req = http.request({
            hostname: BASELINE_TARGET_HOST, port: parseInt(BASELINE_TARGET_PORT),
            path: '/baseline/process', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                const latency = Date.now() - startTime;
                if (res.statusCode === 200) {
                    try { resolve({ ...JSON.parse(data), _baseline: { mode: 'B', latencyMs: latency } }); }
                    catch (e) { resolve({ raw: data, _baseline: { mode: 'B', latencyMs: latency } }); }
                } else reject(new Error(`Baseline failed: ${res.statusCode}`));
            });
        });
        req.on('error', (err) => reject(err));
        req.write(payload);
        req.end();
    });
}

async function sendServiceRequestToVeramo(targetDid, service, action, params) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ targetDid, service, action, params });
        const req = http.request({
            hostname: 'localhost', port: VERAMO_PORT, path: '/nf/service-request', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200 || res.statusCode === 202) resolve(JSON.parse(data));
                else reject(new Error(`Veramo ${res.statusCode}: ${data}`));
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function createHTTPServer() {
    return http.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

        const json = (data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
        const parseBody = () => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(JSON.parse(b))); });

        try {
            if (req.url === '/health') return json({ status: 'ok', service: 'nf-service', name: NF_NAME, did: MY_DID });

            if (req.url === '/service' && req.method === 'POST') {
                const { service, action, params } = await parseBody();
                return json(handleServiceRequest(service, action, params));
            }
            if (req.url === '/response' && req.method === 'POST') {
                const data = await parseBody();
                console.log(`[RESPONSE] ${data.status}`);
                return json({ received: true });
            }
            if (req.url === '/baseline/request' && req.method === 'POST') {
                const { service, action, params } = await parseBody();
                console.log(`[BASELINE-B] ${service}/${action}`);
                return json(await sendBaselineRequest(service, action, params));
            }
            if (req.url === '/baseline/process' && req.method === 'POST') {
                const { service, action, params, sender, timestamp } = await parseBody();
                console.log(`[BASELINE-B] from ${sender}: ${service}/${action}`);
                return json({ ...handleServiceRequest(service, action, params), _baseline: { mode: 'B', processedBy: NF_NAME, processTimeMs: Date.now() - timestamp } });
            }
            if (req.url === '/request' && req.method === 'POST') {
                const { targetDid, service, action, params } = await parseBody();
                return json(await sendServiceRequestToVeramo(targetDid, service, action, params));
            }
            const udmMatch = req.url?.match(/^\/nudm-sdm\/v2\/([^\/]+)(?:\/(am-data|smf-select-data|nssai))?$/);
            if (udmMatch && req.method === 'GET') {
                const data = getSubscriberData(udmMatch[1], udmMatch[2] || 'all');
                return data.error ? json({ status: 404, cause: data.error }, 404) : json(data);
            }
            res.writeHead(404); res.end('Not Found');
        } catch (error) {
            json({ error: error.message }, 500);
        }
    });
}

createHTTPServer().listen(NF_PORT, () => console.log(`[START] NF Service :${NF_PORT} [${NF_NAME}]`));
