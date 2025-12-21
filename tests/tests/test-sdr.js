#!/usr/bin/env node
"use strict";
/**
 * Test SDR (Selective Disclosure Request) Flow
 *
 * Run: node sidecar/tests/test-sdr.js
 */

const { createVPFromSDR, verifyVPAgainstSDR } = require('../src/credentials/sdr/vp-sdr.js');
const { SDR_A, SDR_B } = require('../src/credentials/sdr/definitions.js');

// Mock agent for testing (replace with real Veramo agent)
const mockAgent = {
    dataStoreORMGetVerifiableCredentials: async () => {
        // Simulated credentials from database
        return [{
            verifiableCredential: {
                '@context': ['https://www.w3.org/2018/credentials/v1'],
                type: ['VerifiableCredential', 'NetworkFunctionCredential'],
                credentialSubject: {
                    id: 'did:web:example.com:nf-a',
                    role: 'network-function',
                    clusterId: 'cluster-a'
                },
                issuer: { id: 'did:web:example.com:issuer' },
                proof: { type: 'JwtProof2020', jwt: 'eyJ...' }
            }
        }];
    },

    createVerifiablePresentation: async ({ presentation }) => {
        return {
            ...presentation,
            proof: { type: 'JwtProof2020', jwt: 'vp-jwt-token' }
        };
    },

    verifyPresentation: async () => {
        return { verified: true };
    }
};

async function testSDRFlow() {
    console.log('🧪 Testing SDR Flow\n');
    console.log('=====================================\n');

    // Test 1: Create VP from SDR_A
    console.log('Test 1: Create VP from SDR_A');
    console.log('-----------------------------');
    const mockCredentials = [{
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential', 'NetworkFunctionCredential'],
        credentialSubject: {
            id: 'did:web:example.com:nf-a',
            role: 'network-function',
            clusterId: 'cluster-a'
        }
    }];
    try {
        const vp = await createVPFromSDR(
            mockAgent,
            'did:web:example.com:nf-a',
            mockCredentials,  // credentials parameter added
            SDR_A,
            'did:web:example.com:nf-b'
        );
        console.log('VP created:', JSON.stringify(vp, null, 2).substring(0, 200) + '...\n');
    } catch (e) {
        console.error('Failed:', e.message, '\n');
    }

    // Test 2: Verify VP against SDR_B
    console.log('Test 2: Verify VP against SDR_B');
    console.log('--------------------------------');
    const testVP = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        verifiableCredential: [{
            credentialSubject: {
                role: 'network-function',
                clusterId: 'cluster-a'
            }
        }]
    };
    const result = await verifyVPAgainstSDR(mockAgent, testVP, SDR_B);
    console.log('Verification result:', result, '\n');

    // Test 3: Verify VP that doesn't match SDR
    console.log('Test 3: Verify VP with wrong role');
    console.log('----------------------------------');
    const badVP = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        verifiableCredential: [{
            credentialSubject: {
                role: 'wrong-role',
                clusterId: 'cluster-a'
            }
        }]
    };
    const badResult = await verifyVPAgainstSDR(mockAgent, badVP, SDR_A);
    console.log('Verification result (should fail):', badResult, '\n');

    console.log('=====================================');
    console.log('🏁 SDR Tests Complete\n');
}

testSDRFlow().catch(console.error);
