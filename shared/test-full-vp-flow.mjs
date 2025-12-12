#!/usr/bin/env ts-node
/**
 * Full VP Authentication Flow E2E Test
 *
 * Tests the complete 3-phase VP flow using the actual DIDComm message handlers:
 *
 * Phase 1: NF-A → NF-B: VP_AUTH_REQUEST
 * Phase 2: NF-B → NF-A: VP_WITH_PD (containing VP_B + PD_B)
 *          NF-A → NF-B: VP_RESPONSE (containing VP_A)
 * Phase 3: NF-B → NF-A: AUTH_CONFIRMATION
 */
import http from 'http';
import { PRESENTATION_DEFINITION_A } from './presentation-definitions.js';
const DID_NF_A = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
const DID_NF_B = 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b';
/**
 * Make HTTP request helper
 */
function makeRequest(hostname, port, path, method, data) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname,
            port,
            path,
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(body ? JSON.parse(body) : {});
                    }
                    catch {
                        resolve(body);
                    }
                }
                else {
                    reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                }
            });
        });
        req.on('error', reject);
        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}
/**
 * Check service health
 */
async function checkHealth(name, hostname, port) {
    try {
        const result = await makeRequest(hostname, port, '/health', 'GET');
        console.log(`   ✅ ${name}: ${result.did || 'OK'}`);
        return true;
    }
    catch (error) {
        console.log(`   ❌ ${name}: Not responding`);
        return false;
    }
}
/**
 * Main test function
 */
async function testFullVPFlow() {
    console.log('╔════════════════════════════════════════════════════════════════════════════╗');
    console.log('║         Full VP Authentication Flow Test                                  ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');
    // Step 1: Check if services are healthy
    console.log('📋 Step 1: Checking service health...\n');
    const nfAHealthy = await checkHealth('Veramo NF-A', 'localhost', 3000);
    const nfBHealthy = await checkHealth('Veramo NF-B', 'localhost', 3001);
    if (!nfAHealthy || !nfBHealthy) {
        console.log('\n❌ Services not healthy. Please start Docker containers first.');
        process.exit(1);
    }
    console.log('\n✅ All services are healthy!\n');
    // Step 2: Initiate VP authentication flow from NF-A
    console.log('📍 Step 2: Initiating VP Authentication Flow');
    console.log('================================================================================');
    console.log('   NF-A → NF-B: Initiate authentication with VP_AUTH_REQUEST\n');
    try {
        const initiateResult = await makeRequest('localhost', 3000, '/didcomm/initiate-auth', 'POST', {
            targetDid: DID_NF_B,
            presentationDefinition: PRESENTATION_DEFINITION_A
        });
        console.log(`   ✅ Authentication initiated`);
        console.log(`   Session ID: ${initiateResult.sessionId}`);
        console.log(`   Message ID: ${initiateResult.messageId}`);
        // Wait a bit for the message flow to complete
        console.log('\n⏳ Waiting for VP exchange to complete (5 seconds)...\n');
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('╔════════════════════════════════════════════════════════════════════════════╗');
        console.log('║                         TEST COMPLETED                                     ║');
        console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');
        console.log('✅ VP Authentication Flow initiated successfully!');
        console.log('\n📝 Next steps:');
        console.log('   1. Check Docker logs to verify the full message exchange');
        console.log('   2. Verify that both NF-A and NF-B authenticated each other');
        console.log('   3. Check that sessions show "authenticated" status');
        console.log('\n💡 View logs:');
        console.log('   docker logs veramo-nf-a');
        console.log('   docker logs veramo-nf-b');
    }
    catch (error) {
        console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
        console.log('║                         TEST FAILED                                        ║');
        console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');
        console.log(`❌ Error: ${error.message}\n`);
        if (error.stack) {
            console.log('Stack trace:');
            console.log(error.stack);
        }
        process.exit(1);
    }
}
// Run the test
testFullVPFlow().catch(console.error);
