#!/usr/bin/env node

/**
 * Script to create a Verifiable Credential for NF-A using Veramo agent
 * Usage: node create-vc-nf-a.js
 */

const { createAgent } = require('@veramo/core');
const { CredentialPlugin } = require('@veramo/credential-w3c');
const { DIDResolverPlugin } = require('@veramo/did-resolver');
const { getResolver: webDidResolver } = require('web-did-resolver');
const { Resolver } = require('did-resolver');

// Configuration
const ISSUER_DID = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-issuer-a';
const SUBJECT_DID = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';

async function createCredential() {
  console.log('Creating Verifiable Credential...');
  console.log('Issuer:', ISSUER_DID);
  console.log('Subject:', SUBJECT_DID);
  console.log('');

  try {
    // Setup agent (simplified - you should use your existing agent config)
    const agent = createAgent({
      plugins: [
        new DIDResolverPlugin({
          resolver: new Resolver({
            ...webDidResolver()
          })
        }),
        new CredentialPlugin()
      ]
    });

    // Create the credential
    const verifiableCredential = await agent.createVerifiableCredential({
      credential: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential', 'NetworkFunctionCredential'],
        issuer: { id: ISSUER_DID },
        issuanceDate: new Date().toISOString(),
        credentialSubject: {
          id: SUBJECT_DID,
          role: 'network-function',
          clusterId: 'cluster-a',
          status: 'active',
          capabilities: ['messaging', 'verification'],
          issuedAt: new Date().toISOString()
        }
      },
      proofFormat: 'jwt',
      save: true
    });

    console.log('✅ Credential created successfully!');
    console.log('');
    console.log('Credential JWT:');
    console.log(verifiableCredential.proof.jwt);
    console.log('');
    console.log('Credential Details:');
    console.log(JSON.stringify(verifiableCredential, null, 2));

  } catch (error) {
    console.error('❌ Error creating credential:', error.message);
    process.exit(1);
  }
}

// Run the script
createCredential()
  .then(() => {
    console.log('');
    console.log('To verify: veramo credential list');
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
