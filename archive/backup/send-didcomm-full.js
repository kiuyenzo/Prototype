#!/usr/bin/env node
// Use the configured Veramo agent from agent.yml

const { createObjects } = require('/usr/local/lib/node_modules/@veramo/cli/build/lib/objectCreator.js');
const fs = require('fs');
const http = require('http');

const FROM_DID = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
const TO_DID = 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b';
const NF_B_MESSAGING_ENDPOINT = 'http://172.23.0.3:30132/messaging';

async function main() {
  try {
    console.log('📄 Loading agent configuration from agent.yml...');
    const config = fs.readFileSync('/app/agent.yml', 'utf8');

    console.log('🔧 Creating Veramo agent...');
    const objects = await createObjects(config, { debug: false });
    const agent = objects.agent;

    console.log('✅ Agent created successfully');
    console.log('');

    console.log('🔍 Resolving DIDs...');
    console.log('FROM:', FROM_DID);
    console.log('TO:', TO_DID);

    const fromDoc = await agent.resolveDid({ didUrl: FROM_DID });
    const toDoc = await agent.resolveDid({ didUrl: TO_DID });

    console.log('✅ Both DIDs resolved');
    console.log('');

    console.log('📦 Creating and packing DIDComm message...');
    const message = {
      type: 'https://didcomm.org/basicmessage/2.0/message',
      from: FROM_DID,
      to: [TO_DID],
      id: `test-${Date.now()}`,
      body: {
        content: 'Hello from NF-A! This is a cross-cluster DIDComm test.'
      }
    };

    console.log('Message:', JSON.stringify(message, null, 2));
    console.log('');

    // Try to pack the message
    console.log('🔐 Packing message with authcrypt...');
    const packed = await agent.packDIDCommMessage({
      packing: 'authcrypt',
      message
    });

    console.log('✅ Message packed successfully');
    console.log('Packed message size:', packed.message.length, 'bytes');
    console.log('');

    console.log('📨 Sending to NF-B:', NF_B_MESSAGING_ENDPOINT);
    const response = await sendMessage(NF_B_MESSAGING_ENDPOINT, packed.message);

    console.log('✅ Message sent!');
    console.log('Response:', response);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

function sendMessage(url, message) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/didcomm-encrypted+json',
        'Content-Length': Buffer.byteLength(message)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(message);
    req.end();
  });
}

main();
