#!/usr/bin/env node
const http = require('http');

const data = JSON.stringify({
  data: {
    from: 'did:web:localhost',  // Using existing DID from NF-A
    to: 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b',
    type: 'https://didcomm.org/basicmessage/2.0/message',
    id: 'test-' + Date.now(),
    body: {
      content: 'Hello from NF-A!'
    }
  }
});

const options = {
  hostname: 'localhost',
  port: 7001,
  path: '/agent/sendDIDCommMessage',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'Authorization': 'Bearer test123'
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    console.log('RESPONSE:');
    try {
      console.log(JSON.stringify(JSON.parse(responseData), null, 2));
    } catch (e) {
      console.log(responseData);
    }
  });
});

req.on('error', (error) => {
  console.error('ERROR:', error.message);
});

req.write(data);
req.end();
