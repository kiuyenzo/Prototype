#!/usr/bin/env ts-node
/**
 * NF Service - Business Logic Container
 *
 * This container handles ONLY business logic.
 * All DIDComm, VP, and identity operations are handled by the Veramo sidecar.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────┐
 * │ Pod                                                      │
 * │  ┌──────────────┐  localhost:3001  ┌─────────────────┐  │
 * │  │  NF Service  │ ───────────────→ │ Veramo Sidecar  │  │
 * │  │  (Port 3000) │ ←─────────────── │  (Port 3001)    │  │
 * │  │  Business    │   Service Req    │  DIDComm/VP     │  │
 * │  │  Logic Only  │   Service Res    │  Handler        │  │
 * │  └──────────────┘                  └─────────────────┘  │
 * └─────────────────────────────────────────────────────────┘
 *
 * Endpoints:
 * - POST /service      - Called by Veramo for business logic
 * - POST /response     - Called by Veramo to deliver async responses
 * - POST /request      - Called by external (initiates service flow via Veramo)
 * - GET  /health       - Health check
 */

import http from 'http';

const NF_PORT = process.env.NF_PORT || 3000;
const VERAMO_PORT = process.env.VERAMO_PORT || 3001;
const NF_NAME = process.env.NF_NAME || 'NF';
const MY_DID = process.env.MY_DID || '';

const isNFA = MY_DID.includes('nf-a');

// Store for async responses
const responseCallbacks = new Map<string, (data: any) => void>();

/**
 * Business Logic Handler
 * This is called by Veramo sidecar when a SERVICE_REQUEST arrives
 */
function handleServiceRequest(service: string, action: string, params: any): any {
  console.log(`\n🔧 NF Business Logic Handler`);
  console.log(`   Service: ${service}`);
  console.log(`   Action: ${action}`);
  console.log(`   Params: ${JSON.stringify(params || {})}`);

  switch (service) {
    case 'nf-info':
      return {
        nfType: isNFA ? 'NF-A' : 'NF-B',
        did: MY_DID,
        capabilities: ['authentication', 'data-query', 'subscription'],
        timestamp: new Date().toISOString()
      };

    case 'data-query':
      return {
        query: params?.query || 'default',
        results: [
          { id: 1, name: 'Sample Data 1', value: 100 },
          { id: 2, name: 'Sample Data 2', value: 200 }
        ],
        totalCount: 2,
        executedBy: MY_DID,
        timestamp: new Date().toISOString()
      };

    case 'subscription':
      if (action === 'subscribe') {
        return {
          subscriptionId: `sub-${Date.now()}`,
          topic: params?.topic || 'default',
          status: 'active',
          timestamp: new Date().toISOString()
        };
      } else if (action === 'unsubscribe') {
        return {
          subscriptionId: params?.subscriptionId,
          status: 'cancelled',
          timestamp: new Date().toISOString()
        };
      }
      break;

    case 'echo':
      return {
        echo: params,
        receivedAt: new Date().toISOString(),
        processedBy: MY_DID
      };

    default:
      throw new Error(`Unknown service: ${service}`);
  }

  throw new Error(`Unknown action: ${action} for service: ${service}`);
}

/**
 * Send service request to Veramo sidecar
 * This initiates the DIDComm flow
 */
async function sendServiceRequestToVeramo(
  targetDid: string,
  service: string,
  action: string,
  params: any
): Promise<any> {
  console.log(`\n📤 Sending service request to Veramo sidecar`);
  console.log(`   Target: ${targetDid}`);
  console.log(`   Service: ${service}`);

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ targetDid, service, action, params });

    const req = http.request({
      hostname: 'localhost',
      port: VERAMO_PORT,
      path: '/nf/service-request',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 202) {
          console.log(`✅ Request sent to Veramo`);
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Veramo returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error(`❌ Veramo call failed: ${error.message}`);
      reject(error);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * HTTP Server
 */
function createHTTPServer(): http.Server {
  return http.createServer(async (req, res) => {
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
    // This is: Veramo_NF_B → NF_B: Service Request
    if (req.url === '/service' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => body += chunk);
      req.on('end', () => {
        try {
          const { service, action, params } = JSON.parse(body);
          const result = handleServiceRequest(service, action, params);

          console.log(`✅ Business logic completed`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (error: any) {
          console.error(`❌ Business logic error: ${error.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }

    // Response endpoint - called by Veramo sidecar to deliver async responses
    // This is: Veramo_NF_A → NF_A: Service_Response
    if (req.url === '/response' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);

          console.log(`\n📥 Received response from Veramo sidecar`);
          console.log(`   Type: ${data.type}`);
          console.log(`   Status: ${data.status}`);
          if (data.data) {
            console.log(`   Data: ${JSON.stringify(data.data)}`);
          }
          if (data.error) {
            console.log(`   Error: ${data.error}`);
          }

          // Store or process the response
          // In a real NF, this would trigger application-specific logic

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true }));
        } catch (error: any) {
          console.error(`❌ Response handling error: ${error.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }

    // Request endpoint - external trigger to initiate service flow
    // This is: External → NF_A → Veramo_NF_A: Service Request
    if (req.url === '/request' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => body += chunk);
      req.on('end', async () => {
        try {
          const { targetDid, service, action, params } = JSON.parse(body);

          console.log(`\n🚀 External service request received`);
          console.log(`   Target: ${targetDid}`);
          console.log(`   Service: ${service}`);

          // Forward to Veramo sidecar
          const result = await sendServiceRequestToVeramo(targetDid, service, action, params);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (error: any) {
          console.error(`❌ Request error: ${error.message}`);
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
}

/**
 * Main
 */
async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║          NF Service - Business Logic Container                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🔧 Configuration:`);
  console.log(`   Name: ${NF_NAME}`);
  console.log(`   DID: ${MY_DID}`);
  console.log(`   Veramo Sidecar: localhost:${VERAMO_PORT}`);
  console.log('');

  const server = createHTTPServer();

  server.listen(NF_PORT, () => {
    console.log('🚀 NF Service running');
    console.log(`   Port: ${NF_PORT}`);
    console.log('');
    console.log('📍 Endpoints:');
    console.log(`   GET  /health     - Health check`);
    console.log(`   POST /service    - Business logic (from Veramo)`);
    console.log(`   POST /response   - Async responses (from Veramo)`);
    console.log(`   POST /request    - External requests (to Veramo)`);
    console.log('');
    console.log('✅ Ready to handle business logic requests');
    console.log('');
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
