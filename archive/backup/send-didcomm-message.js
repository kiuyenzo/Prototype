// Send DIDComm message from NF-A to NF-B using Veramo agent
const { createAgent } = require('@veramo/core');
const { MessageHandler } = require('@veramo/message-handler');
const { DIDComm, DIDCommMessageHandler } = require('@veramo/did-comm');
const { KeyManager } = require('@veramo/key-manager');
const { DIDManager } = require('@veramo/did-manager');
const { DIDResolverPlugin } = require('@veramo/did-resolver');
const { Resolver } = require('@veramo/core');
const { getResolver: webDidResolver } = require('web-did-resolver');

// Create a minimal agent for sending DIDComm messages
const agent = createAgent({
  plugins: [
    new KeyManager({
      store: { /* in-memory store for this test */ },
      kms: {}
    }),
    new DIDManager({
      store: { /* in-memory store */ },
      defaultProvider: 'did:web',
      providers: {}
    }),
    new DIDResolverPlugin({
      resolver: new Resolver({
        ...webDidResolver()
      })
    }),
    new MessageHandler({
      messageHandlers: [new DIDCommMessageHandler()]
    }),
    new DIDComm()
  ]
});

async function sendMessage() {
  const from = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
  const to = 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b';

  try {
    console.log(`Sending DIDComm message from ${from} to ${to}...`);

    const result = await agent.sendDIDCommMessage({
      data: {
        from,
        to,
        type: 'https://didcomm.org/basicmessage/2.0/message',
        id: `test-${Date.now()}`,
        body: {
          content: 'Hello from NF-A via Veramo DIDComm!'
        }
      },
      save: false
    });

    console.log('Message sent successfully!');
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error sending message:', error.message);
    console.error(error.stack);
  }
}

sendMessage();
