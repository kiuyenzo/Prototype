#!/usr/bin/env ts-node
"use strict";
/**
 * DIDComm VP Wrapper
 *
 * This module wraps the existing VP creation and verification logic
 * with DIDComm messaging for transport between Network Functions.
 *
 * Architecture Integration:
 * Veramo_NF_A ↔ Envoy_Proxy_NF_A ↔ ... ↔ Veramo_NF_B
 *
 * This wrapper handles the Veramo_NF_A ↔ Veramo_NF_B communication layer.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIDCommVPWrapper = void 0;
exports.performMutualAuthentication = performMutualAuthentication;
const vp_creation_manuell_js_1 = require("./vp-pex.js"); // Uses @sphereon/pex
const didcomm_messages_js_1 = require("./didcomm-messages.js");
/**
 * DIDComm VP Wrapper Class
 *
 * Handles VP exchange over DIDComm messages
 */
class DIDCommVPWrapper {
    constructor(agent) {
        this.messageQueue = [];
        this.contexts = new Map();
        this.agent = agent;
    }
    /**
     * Phase 1: Initiate VP Authentication Request
     *
     * Architecture:
     * NF_A → Veramo_NF_A → Envoy_Proxy_NF_A: DIDComm[VP_Auth_Request + PD_A]
     *
     * @param ourDid - Our DID (e.g., did:web:...:did-nf-a)
     * @param theirDid - Their DID (e.g., did:web:...:did-nf-b)
     * @param presentationDefinition - PD_A that they must satisfy
     * @returns VP Auth Request message
     */
    async initiateVPAuthRequest(ourDid, theirDid, presentationDefinition) {
        console.log('\n🚀 Phase 1: Initiating VP Authentication Request');
        console.log(`   From: ${ourDid}`);
        console.log(`   To: ${theirDid}`);
        console.log(`   PD: ${presentationDefinition.id}`);
        // Create exchange context
        const context = {
            ourDid,
            theirDid,
            ourPresentationDefinition: presentationDefinition,
            authenticated: false,
            messageLog: []
        };
        this.contexts.set(theirDid, context);
        // Create DIDComm message
        const message = (0, didcomm_messages_js_1.createVPAuthRequest)(ourDid, theirDid, presentationDefinition, 'Please provide a Verifiable Presentation matching this definition');
        context.messageLog.push(message);
        this.messageQueue.push(message);
        console.log(`✅ VP Auth Request created (ID: ${message.id})`);
        return message;
    }
    /**
     * Phase 2: Handle incoming VP Auth Request and respond with VP + PD
     *
     * Architecture:
     * Veramo_NF_B receives: DIDComm[VP_Auth_Request + PD_A]
     * Veramo_NF_B → Veramo_NF_B: Create VP_B based on PD_A
     * Veramo_NF_B → Envoy_Proxy_NF_B: DIDComm[VP_B + PD_B]
     *
     * @param message - Incoming VP Auth Request
     * @param ourDid - Our DID
     * @param credentials - Our credentials to create VP from
     * @param ourPresentationDefinition - PD_B for them to satisfy
     * @returns VP with PD message
     */
    async handleVPAuthRequest(message, ourDid, credentials, ourPresentationDefinition) {
        console.log('\n📨 Phase 2: Handling VP Auth Request');
        console.log(`   From: ${message.from}`);
        console.log(`   To: ${ourDid}`);
        console.log(`   Their PD: ${message.body.presentation_definition.id}`);
        if (!message.from) {
            throw new Error('VP Auth Request must have a from field');
        }
        // Create exchange context
        const context = {
            ourDid,
            theirDid: message.from,
            ourPresentationDefinition,
            theirPresentationDefinition: message.body.presentation_definition,
            authenticated: false,
            messageLog: [message]
        };
        this.contexts.set(message.from, context);
        try {
            // Create VP matching their Presentation Definition
            console.log('   Creating VP_B matching their PD...');
            const vp = await (0, vp_creation_manuell_js_1.createVPFromPD)(this.agent, ourDid, credentials, message.body.presentation_definition);
            context.ourVP = vp;
            // Create response message with our VP and our PD
            const responseMessage = (0, didcomm_messages_js_1.createVPWithPD)(ourDid, message.from, vp, ourPresentationDefinition, 'Here is my VP matching your PD, and my PD for you to satisfy');
            context.messageLog.push(responseMessage);
            this.messageQueue.push(responseMessage);
            console.log(`✅ VP with PD created (ID: ${responseMessage.id})`);
            return responseMessage;
        }
        catch (error) {
            console.error('❌ Error handling VP Auth Request:', error.message);
            const errorMessage = (0, didcomm_messages_js_1.createErrorMessage)(ourDid, message.from, 'vp_creation_failed', `Failed to create VP: ${error.message}`);
            this.messageQueue.push(errorMessage);
            throw error;
        }
    }
    /**
     * Phase 2 (continued): Handle incoming VP with PD, verify, and respond with our VP
     *
     * Architecture:
     * Veramo_NF_A receives: DIDComm[VP_B + PD_B]
     * Veramo_NF_A → Veramo_NF_A: Resolve IssuerDID from VP_B (did:web)
     * Veramo_NF_A → Veramo_NF_A: Verify VP_B
     * Veramo_NF_A → Veramo_NF_A: Create VP_A based on PD_B
     * Veramo_NF_A → Envoy_Proxy_NF_A: DIDComm[VP_A]
     *
     * @param message - Incoming VP with PD message
     * @param credentials - Our credentials to create VP from
     * @param ourDid - Optional: Our DID (if no context exists)
     * @param ourPresentationDefinition - Optional: Our PD (if no context exists)
     * @returns VP Response message
     */
    async handleVPWithPD(message, credentials, ourDid, ourPresentationDefinition) {
        console.log('\n🔍 Phase 2 (continued): Handling VP with PD');
        console.log(`   From: ${message.from}`);
        console.log(`   Verifying their VP_B...`);
        if (!message.from) {
            throw new Error('VP with PD message must have a from field');
        }
        let context = this.contexts.get(message.from);
        // If no context exists, create one (for stateless HTTP scenarios)
        if (!context && ourDid && ourPresentationDefinition) {
            console.log('   ⚠️  No existing context, creating new one');
            context = {
                ourDid,
                theirDid: message.from,
                ourPresentationDefinition,
                theirPresentationDefinition: message.body.presentation_definition,
                authenticated: false,
                messageLog: []
            };
            this.contexts.set(message.from, context);
        }
        if (!context) {
            throw new Error(`No context found for ${message.from} and no ourDid/PD provided`);
        }
        context.messageLog.push(message);
        try {
            // Verify their VP against the PD we sent
            console.log('   Verifying VP_B against our PD_A...');
            const verificationResult = await (0, vp_creation_manuell_js_1.verifyVPAgainstPD)(this.agent, message.body.verifiable_presentation, context.ourPresentationDefinition);
            if (!verificationResult.verified) {
                throw new Error(`VP verification failed: ${verificationResult.error}`);
            }
            console.log('   ✅ VP_B verified successfully');
            context.theirVP = message.body.verifiable_presentation;
            context.theirPresentationDefinition = message.body.presentation_definition;
            // Save received VP to database for veramo explore
            try {
                await this.agent.dataStoreSaveVerifiablePresentation({ verifiablePresentation: message.body.verifiable_presentation });
                console.log('   💾 VP_B saved to database');
            } catch (e) { console.log('   ⚠️  Could not save VP_B:', e.message); }
            // Create our VP matching their PD
            console.log('   Creating VP_A matching their PD_B...');
            const ourVP = await (0, vp_creation_manuell_js_1.createVPFromPD)(this.agent, context.ourDid, credentials, message.body.presentation_definition);
            context.ourVP = ourVP;
            // Create response message
            const responseMessage = (0, didcomm_messages_js_1.createVPResponse)(context.ourDid, message.from, ourVP, 'Here is my VP matching your PD');
            context.messageLog.push(responseMessage);
            this.messageQueue.push(responseMessage);
            console.log(`✅ VP Response created (ID: ${responseMessage.id})`);
            return responseMessage;
        }
        catch (error) {
            console.error('❌ Error handling VP with PD:', error.message);
            const errorMessage = (0, didcomm_messages_js_1.createErrorMessage)(context.ourDid, message.from, 'vp_verification_failed', `Failed to verify or create VP: ${error.message}`);
            this.messageQueue.push(errorMessage);
            throw error;
        }
    }
    /**
     * Phase 2 (final): Handle incoming VP Response and confirm authentication
     *
     * Architecture:
     * Veramo_NF_B receives: DIDComm[VP_A]
     * Veramo_NF_B → Veramo_NF_B: Resolve Issuer DID from VP_A (did:web)
     * Veramo_NF_B → Veramo_NF_B: Verify VP_A
     * Envoy_Proxy_NF_B ← Veramo_NF_B: DIDComm[Authorized]
     *
     * @param message - Incoming VP Response
     * @returns Auth Confirmation message
     */
    async handleVPResponse(message) {
        console.log('\n✅ Phase 2 (final): Handling VP Response');
        console.log(`   From: ${message.from}`);
        console.log(`   Verifying their VP_A...`);
        if (!message.from) {
            throw new Error('VP Response message must have a from field');
        }
        const context = this.contexts.get(message.from);
        if (!context) {
            throw new Error(`No context found for ${message.from}`);
        }
        context.messageLog.push(message);
        try {
            // Verify their VP against our PD
            console.log('   Verifying VP_A against our PD_B...');
            const verificationResult = await (0, vp_creation_manuell_js_1.verifyVPAgainstPD)(this.agent, message.body.verifiable_presentation, context.ourPresentationDefinition);
            if (!verificationResult.verified) {
                throw new Error(`VP verification failed: ${verificationResult.error}`);
            }
            console.log('   ✅ VP_A verified successfully');
            context.theirVP = message.body.verifiable_presentation;
            // Save received VP to database for veramo explore
            try {
                await this.agent.dataStoreSaveVerifiablePresentation({ verifiablePresentation: message.body.verifiable_presentation });
                console.log('   💾 VP_A saved to database');
            } catch (e) { console.log('   ⚠️  Could not save VP_A:', e.message); }
            context.authenticated = true;
            // Generate session token for subsequent requests
            const sessionToken = this.generateSessionToken(context);
            context.sessionToken = sessionToken;
            // Create confirmation message
            const confirmationMessage = (0, didcomm_messages_js_1.createAuthConfirmation)(context.ourDid, message.from, 'OK', sessionToken, 'Mutual authentication successful');
            context.messageLog.push(confirmationMessage);
            this.messageQueue.push(confirmationMessage);
            console.log('🎉 Mutual authentication successful!');
            console.log(`   Session Token: ${sessionToken.substring(0, 20)}...`);
            return confirmationMessage;
        }
        catch (error) {
            console.error('❌ Error handling VP Response:', error.message);
            // Send rejection
            const rejectionMessage = (0, didcomm_messages_js_1.createAuthConfirmation)(context.ourDid, message.from, 'REJECTED', undefined, `VP verification failed: ${error.message}`);
            this.messageQueue.push(rejectionMessage);
            throw error;
        }
    }
    /**
     * Phase 3: Handle Authentication Confirmation from other party
     *
     * Architecture:
     * Veramo_NF_A receives: DIDComm[Authorized]
     *
     * @param message - Incoming Auth Confirmation
     */
    async handleAuthConfirmation(message) {
        console.log('\n📬 Phase 3: Handling Auth Confirmation');
        console.log(`   From: ${message.from}`);
        console.log(`   Status: ${message.body.status}`);
        if (!message.from) {
            throw new Error('Auth Confirmation message must have a from field');
        }
        const context = this.contexts.get(message.from);
        if (!context) {
            throw new Error(`No context found for ${message.from}`);
        }
        context.messageLog.push(message);
        if (message.body.status === 'OK') {
            context.authenticated = true;
            context.sessionToken = message.body.session_token;
            console.log('   ✅ Authentication confirmed');
            console.log(`   Session Token: ${message.body.session_token?.substring(0, 20)}...`);
        }
        else {
            console.log('   ❌ Authentication rejected');
            console.log(`   Reason: ${message.body.comment}`);
            throw new Error(`Authentication rejected: ${message.body.comment}`);
        }
    }
    /**
     * Phase 3: Send Service Request after successful authentication
     *
     * @param theirDid - Target DID
     * @param service - Service name
     * @param action - Action to perform
     * @param params - Service parameters
     * @returns Service Request message
     */
    async sendServiceRequest(theirDid, service, action, params) {
        console.log('\n📤 Phase 3: Sending Service Request');
        console.log(`   Service: ${service}`);
        console.log(`   Action: ${action}`);
        const context = this.contexts.get(theirDid);
        if (!context) {
            throw new Error(`No context found for ${theirDid}`);
        }
        if (!context.authenticated) {
            throw new Error('Cannot send service request: not authenticated');
        }
        const requestMessage = (0, didcomm_messages_js_1.createServiceRequest)(context.ourDid, theirDid, service, action, params, context.sessionToken);
        context.messageLog.push(requestMessage);
        this.messageQueue.push(requestMessage);
        console.log(`✅ Service Request created (ID: ${requestMessage.id})`);
        return requestMessage;
    }
    /**
     * Get exchange context for a DID
     */
    getContext(did) {
        return this.contexts.get(did);
    }
    /**
     * Check if authenticated with a DID
     */
    isAuthenticated(did) {
        const context = this.contexts.get(did);
        return context?.authenticated ?? false;
    }
    /**
     * Get all pending messages (for sending via transport layer)
     */
    getPendingMessages() {
        const messages = [...this.messageQueue];
        this.messageQueue = [];
        return messages;
    }
    /**
     * Generate a session token for authenticated sessions
     */
    generateSessionToken(context) {
        const tokenData = {
            ourDid: context.ourDid,
            theirDid: context.theirDid,
            timestamp: Date.now(),
            random: Math.random().toString(36).substring(2)
        };
        return Buffer.from(JSON.stringify(tokenData)).toString('base64');
    }
}
exports.DIDCommVPWrapper = DIDCommVPWrapper;
/**
 * Perform complete mutual authentication flow
 *
 * This orchestrates the entire flow:
 * Phase 1: NF-A sends VP_Auth_Request
 * Phase 2: NF-B sends VP_B + PD_B, NF-A verifies and sends VP_A
 * Phase 3: NF-B verifies VP_A and confirms authentication
 *
 * @param agentA - Veramo agent for NF-A
 * @param agentB - Veramo agent for NF-B
 * @param didA - DID of NF-A
 * @param didB - DID of NF-B
 * @param credentialsA - Credentials for NF-A
 * @param credentialsB - Credentials for NF-B
 * @param pdA - Presentation Definition from NF-A
 * @param pdB - Presentation Definition from NF-B
 * @returns Mutual authentication result
 */
async function performMutualAuthentication(agentA, agentB, didA, didB, credentialsA, credentialsB, pdA, pdB) {
    console.log('\n🔐 Starting Mutual Authentication Flow\n');
    console.log('================================================================================');
    const wrapperA = new DIDCommVPWrapper(agentA);
    const wrapperB = new DIDCommVPWrapper(agentB);
    try {
        // Phase 1: NF-A initiates VP Auth Request
        console.log('\n📍 PHASE 1: Initial Service Request & Auth-Anfrage');
        console.log('================================================================================');
        const authRequest = await wrapperA.initiateVPAuthRequest(didA, didB, pdA);
        // Phase 2: NF-B handles request and responds with VP_B + PD_B
        console.log('\n📍 PHASE 2: Mutual Authentication (Presentation Exchange) / VP Austausch');
        console.log('================================================================================');
        const vpWithPD = await wrapperB.handleVPAuthRequest(authRequest, didB, credentialsB, pdB);
        // Phase 2 (continued): NF-A handles VP_B, verifies, and sends VP_A
        const vpResponse = await wrapperA.handleVPWithPD(vpWithPD, credentialsA);
        // Phase 2 (final): NF-B handles VP_A and confirms authentication
        const authConfirmation = await wrapperB.handleVPResponse(vpResponse);
        // Phase 3: NF-A receives and handles auth confirmation
        await wrapperA.handleAuthConfirmation(authConfirmation);
        console.log('\n📍 PHASE 3: Authorized Communication / Service Traffic');
        console.log('================================================================================');
        console.log('✅ Both parties authenticated');
        console.log(`   Session Token: ${authConfirmation.body.session_token?.substring(0, 20)}...`);
        return {
            nfAAuthenticated: wrapperA.isAuthenticated(didB),
            nfBAuthenticated: wrapperB.isAuthenticated(didA),
            sessionToken: authConfirmation.body.session_token
        };
    }
    catch (error) {
        console.error('\n❌ Mutual authentication failed:', error.message);
        return {
            nfAAuthenticated: false,
            nfBAuthenticated: false,
            error: error.message
        };
    }
}
