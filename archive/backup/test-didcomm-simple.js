#!/usr/bin/env node
// Simple DIDComm test using the configured Veramo agent

const fs = require('fs');
const http = require('http');

const FROM_DID = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
const TO_DID = 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b';

// Call the local agent API to send a DIDComm message
const payload = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'sendDIDCommMessage',
  params: {
    data: {
      from: FROM_DID,
      to: TO_DID,
      type: 'https://didcomm.org/basicmessage/2.0/message',
      id: `test-${Date.now()}`,
      body: {
        content: 'Hello from NF-A!'
      }
    },
    save: false
  }
});

const options = {
  hostname: 'localhost',
  port: 7001,
  path: '/agent',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Authorization': 'Bearer test123'
  }
};

console.log('Sending DIDComm message...');
console.log(`FROM: ${FROM_DID}`);
console.log(`TO: ${TO_DID}`);

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS: ${JSON.stringify(res.headers)}`);

  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('RESPONSE:', data);
    try {
      const json = JSON.parse(data);
      console.log('Parsed:', JSON.stringify(json, null, 2));
    } catch (e) {
      console.log('Could not parse as JSON');
    }
  });
});

req.on('error', (e) => {
  console.error(`ERROR: ${e.message}`);
});

req.write(payload);
req.end();
