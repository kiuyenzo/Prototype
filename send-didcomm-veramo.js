#!/usr/bin/env node
// Direct Veramo DIDComm test using your did:web DIDs

const { createAgent } = require('@veramo/core');
const { DIDComm } = require('@veramo/did-comm');
const { DIDResolverPlugin } = require('@veramo/did-resolver');
const { Resolver } = require('did-resolver');
const { getResolver: getWebResolver } = require('web-did-resolver');
const https = require('https');
const http = require('http');

const FROM_DID = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
const TO_DID = 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b';
const NF_B_ENDPOINT = 'http://172.23.0.3:30132/messaging'; // Istio ingress gateway

// Create minimal agent with DIDComm plugin
const agent = createAgent({
  plugins: [
    new DIDResolverPlugin({
      resolver: new Resolver({
        ...getWebResolver()
      })
    }),
    new DIDComm()
  ]
});

async function sendDIDCommMessage() {
  try {
    console.log('🔍 Resolving sender DID:', FROM_DID);
    const fromDidDoc = await agent.resolveDid({ didUrl: FROM_DID });
    console.log('✅ Sender DID resolved:', fromDidDoc.didDocument?.id);

    console.log('\n🔍 Resolving recipient DID:', TO_DID);
    const toDidDoc = await agent.resolveDid({ didUrl: TO_DID });
    console.log('✅ Recipient DID resolved:', toDidDoc.didDocument?.id);

    console.log('\n📦 Packing DIDComm message...');
    const message = {
      type: 'https://didcomm.org/basicmessage/2.0/message',
      from: FROM_DID,
      to: [TO_DID],
      id: `msg-${Date.now()}`,
      body: {
        content: 'Hello from NF-A via Veramo DIDComm!'
      }
    };

    const packedMessage = await agent.packDIDCommMessage({
      packing: 'authcrypt',
      message
    });

    console.log('✅ Message packed (encrypted)');
    console.log('Packed message length:', packedMessage.message.length, 'bytes');

    console.log('\n📨 Sending to NF-B endpoint:', NF_B_ENDPOINT);

    const result = await sendToEndpoint(NF_B_ENDPOINT, packedMessage.message);
    console.log('✅ Message sent successfully!');
    console.log('Response:', result);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

function sendToEndpoint(url, message) {
  return new Promise((resolve, reject) => {
    const postData = message;
    const urlObj = new URL(url);
    const lib = urlObj.protocol === 'https:' ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/didcomm-encrypted+json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

sendDIDCommMessage();
