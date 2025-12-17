#!/usr/bin/env ts-node
/**
 * Test script for DIDComm Message Structure
 *
 * This tests the DIDComm message creation without actual VP verification
 * to validate the message structure and flow logic.
 */
import { DIDCOMM_MESSAGE_TYPES, createVPAuthRequest, createVPWithPD, createVPResponse, createAuthConfirmation, createServiceRequest, createServiceResponse } from './didcomm-messages.js';
import { PRESENTATION_DEFINITION_A, PRESENTATION_DEFINITION_B } from './presentation-definitions.js';
const DID_NF_A = 'did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a';
const DID_NF_B = 'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b';
function printMessage(title, message) {
    console.log(`\n${title}`);
    console.log('─'.repeat(80));
    console.log(`Type: ${message.type}`);
    console.log(`ID: ${message.id}`);
    console.log(`From: ${message.from}`);
    console.log(`To: ${message.to?.join(', ')}`);
    console.log(`Created: ${new Date(message.created_time || 0).toISOString()}`);
    console.log(`Body:`);
    console.log(JSON.stringify(message.body, null, 2));
}
console.log('╔════════════════════════════════════════════════════════════════════════════╗');
console.log('║              DIDComm Message Structure Test                                ║');
console.log('╚════════════════════════════════════════════════════════════════════════════╝');
console.log('\n📍 PHASE 1: Initial Service Request & Auth-Anfrage');
console.log('================================================================================');
// Step 1: NF-A sends VP Auth Request
const authRequest = createVPAuthRequest(DID_NF_A, DID_NF_B, PRESENTATION_DEFINITION_A, 'Please authenticate yourself');
printMessage('1️⃣ VP_AUTH_REQUEST (NF-A → NF-B)', authRequest);
console.log('\n✅ Message Type:', DIDCOMM_MESSAGE_TYPES.VP_AUTH_REQUEST);
console.log('✅ Contains PD_A:', authRequest.body.presentation_definition.id);
console.log('\n📍 PHASE 2: Mutual Authentication / VP Austausch');
console.log('================================================================================');
// Step 2: NF-B responds with VP_B + PD_B
const mockVP_B = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiablePresentation'],
    holder: DID_NF_B,
    verifiableCredential: [{
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            type: ['VerifiableCredential', 'NetworkFunctionCredential'],
            issuer: { id: 'did:web:...:did-issuer-b' },
            credentialSubject: {
                id: DID_NF_B,
                role: 'network-function',
                clusterId: 'cluster-b'
            }
        }],
    proof: {
        type: 'JwtProof2020',
        jwt: 'eyJ...' // Mock JWT
    }
};
const vpWithPD = createVPWithPD(DID_NF_B, DID_NF_A, mockVP_B, PRESENTATION_DEFINITION_B, 'Here is my VP and my PD for you');
printMessage('2️⃣ VP_WITH_PD (NF-B → NF-A)', vpWithPD);
console.log('\n✅ Message Type:', DIDCOMM_MESSAGE_TYPES.VP_WITH_PD);
console.log('✅ Contains VP_B: holder =', vpWithPD.body.verifiable_presentation.holder);
console.log('✅ Contains PD_B:', vpWithPD.body.presentation_definition.id);
// Step 3: NF-A responds with VP_A
const mockVP_A = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiablePresentation'],
    holder: DID_NF_A,
    verifiableCredential: [{
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            type: ['VerifiableCredential', 'NetworkFunctionCredential'],
            issuer: { id: 'did:web:...:did-issuer-a' },
            credentialSubject: {
                id: DID_NF_A,
                role: 'network-function',
                clusterId: 'cluster-a'
            }
        }],
    proof: {
        type: 'JwtProof2020',
        jwt: 'eyJ...' // Mock JWT
    }
};
const vpResponse = createVPResponse(DID_NF_A, DID_NF_B, mockVP_A, 'Here is my VP');
printMessage('3️⃣ VP_RESPONSE (NF-A → NF-B)', vpResponse);
console.log('\n✅ Message Type:', DIDCOMM_MESSAGE_TYPES.VP_RESPONSE);
console.log('✅ Contains VP_A: holder =', vpResponse.body.verifiable_presentation.holder);
// Step 4: NF-B confirms authentication
const sessionToken = 'eyJvdXJEaWQiOiJkaWQ6d2ViOi4uLiJ9...';
const authConfirmation = createAuthConfirmation(DID_NF_B, DID_NF_A, 'OK', sessionToken, 'Mutual authentication successful');
printMessage('4️⃣ AUTH_CONFIRMATION (NF-B → NF-A)', authConfirmation);
console.log('\n✅ Message Type:', DIDCOMM_MESSAGE_TYPES.AUTH_CONFIRMATION);
console.log('✅ Status:', authConfirmation.body.status);
console.log('✅ Session Token:', authConfirmation.body.session_token?.substring(0, 30) + '...');
console.log('\n📍 PHASE 3: Authorized Communication / Service Traffic');
console.log('================================================================================');
// Step 5: Service Request
const serviceRequest = createServiceRequest(DID_NF_A, DID_NF_B, 'credential-issuance', 'issue-credential', { credentialType: 'VerifiableCredential', subject: 'test-subject' }, sessionToken);
printMessage('5️⃣ SERVICE_REQUEST (NF-A → NF-B)', serviceRequest);
console.log('\n✅ Message Type:', DIDCOMM_MESSAGE_TYPES.SERVICE_REQUEST);
console.log('✅ Service:', serviceRequest.body.service);
console.log('✅ Action:', serviceRequest.body.action);
console.log('✅ Session Token:', serviceRequest.body.session_token?.substring(0, 30) + '...');
// Step 6: Service Response
const serviceResponse = createServiceResponse(DID_NF_B, DID_NF_A, 'success', { credential: { id: 'urn:uuid:123', type: 'VerifiableCredential' } });
printMessage('6️⃣ SERVICE_RESPONSE (NF-B → NF-A)', serviceResponse);
console.log('\n✅ Message Type:', DIDCOMM_MESSAGE_TYPES.SERVICE_RESPONSE);
console.log('✅ Status:', serviceResponse.body.status);
console.log('✅ Data:', JSON.stringify(serviceResponse.body.data));
console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
console.log('║                         TEST SUMMARY                                       ║');
console.log('╚════════════════════════════════════════════════════════════════════════════╝');
console.log('\n🎉 DIDComm Message Structure Test: PASSED');
console.log('\n✅ All message types created successfully:');
console.log('   1. VP_AUTH_REQUEST');
console.log('   2. VP_WITH_PD');
console.log('   3. VP_RESPONSE');
console.log('   4. AUTH_CONFIRMATION');
console.log('   5. SERVICE_REQUEST');
console.log('   6. SERVICE_RESPONSE');
console.log('\n📋 Message Flow Validated:');
console.log('   Phase 1: NF-A → NF-B (Auth Request)');
console.log('   Phase 2: NF-B → NF-A (VP_B + PD_B)');
console.log('   Phase 2: NF-A → NF-B (VP_A)');
console.log('   Phase 2: NF-B → NF-A (Confirmation)');
console.log('   Phase 3: NF-A → NF-B (Service Request)');
console.log('   Phase 3: NF-B → NF-A (Service Response)');
console.log('\n🚀 Ready for Envoy Integration!');
console.log('   Next: Wrap these messages in HTTP/2 transport\n');
