#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIDCommVPWrapper = void 0;
exports.performMutualAuthentication = performMutualAuthentication;
const vp_pex_js_1 = require("../credentials/vp-pex.js");
const didcomm_messages_js_1 = require("./messages.js");

class DIDCommVPWrapper {
    constructor(agent) {
        this.messageQueue = [];
        this.contexts = new Map();
        this.agent = agent;
    }
    async initiateVPAuthRequest(ourDid, theirDid, presentationDefinition) {
        console.log(`[PHASE1] VP Auth Request to ${theirDid.split(':').pop()}`);
        const context = { ourDid, theirDid, ourPresentationDefinition: presentationDefinition, authenticated: false, messageLog: [] };
        this.contexts.set(theirDid, context);
        const message = (0, didcomm_messages_js_1.createVPAuthRequest)(ourDid, theirDid, presentationDefinition, 'Please provide VP');
        context.messageLog.push(message);
        this.messageQueue.push(message);
        return message;
    }
    async handleVPAuthRequest(message, ourDid, credentials, ourPresentationDefinition) {
        console.log(`[PHASE2] VP Auth Request from ${message.from?.split(':').pop()}`);
        if (!message.from) throw new Error('VP Auth Request must have a from field');
        const context = { ourDid, theirDid: message.from, ourPresentationDefinition, theirPresentationDefinition: message.body.presentation_definition, authenticated: false, messageLog: [message] };
        this.contexts.set(message.from, context);
        try {
            const vp = await (0, vp_pex_js_1.createVPFromPD)(this.agent, ourDid, credentials, message.body.presentation_definition, message.from);
            context.ourVP = vp;
            const responseMessage = (0, didcomm_messages_js_1.createVPWithPD)(ourDid, message.from, vp, ourPresentationDefinition, 'VP + PD');
            context.messageLog.push(responseMessage);
            this.messageQueue.push(responseMessage);
            return responseMessage;
        } catch (error) {
            const errorMessage = (0, didcomm_messages_js_1.createErrorMessage)(ourDid, message.from, 'vp_creation_failed', error.message);
            this.messageQueue.push(errorMessage);
            throw error;
        }
    }
    async handleVPWithPD(message, credentials, ourDid, ourPresentationDefinition) {
        console.log(`[PHASE2] Handling VP_WITH_PD from ${message.from?.split(':').pop()}`);
        if (!message.from) throw new Error('VP with PD message must have a from field');
        let context = this.contexts.get(message.from);
        if (!context && ourDid && ourPresentationDefinition) {
            context = { ourDid, theirDid: message.from, ourPresentationDefinition, theirPresentationDefinition: message.body.presentation_definition, authenticated: false, messageLog: [] };
            this.contexts.set(message.from, context);
        }
        if (!context) throw new Error(`No context found for ${message.from}`);
        context.messageLog.push(message);
        try {
            const verificationResult = await (0, vp_pex_js_1.verifyVPAgainstPD)(this.agent, message.body.verifiable_presentation, context.ourPresentationDefinition);
            if (!verificationResult.verified) throw new Error(`VP verification failed: ${verificationResult.error}`);
            context.theirVP = message.body.verifiable_presentation;
            context.theirPresentationDefinition = message.body.presentation_definition;
            try { await this.agent.dataStoreSaveVerifiablePresentation({ verifiablePresentation: message.body.verifiable_presentation }); } catch (e) { /* ignore */ }
            const ourVP = await (0, vp_pex_js_1.createVPFromPD)(this.agent, context.ourDid, credentials, message.body.presentation_definition, message.from);
            context.ourVP = ourVP;
            const responseMessage = (0, didcomm_messages_js_1.createVPResponse)(context.ourDid, message.from, ourVP, 'VP Response');
            context.messageLog.push(responseMessage);
            this.messageQueue.push(responseMessage);
            return responseMessage;
        } catch (error) {
            const errorMessage = (0, didcomm_messages_js_1.createErrorMessage)(context.ourDid, message.from, 'vp_verification_failed', error.message);
            this.messageQueue.push(errorMessage);
            throw error;
        }
    }
    async handleVPResponse(message) {
        console.log(`[PHASE2-FINAL] VP Response from ${message.from?.split(':').pop()}`);
        if (!message.from) throw new Error('VP Response must have a from field');
        const context = this.contexts.get(message.from);
        if (!context) throw new Error(`No context found for ${message.from}`);
        context.messageLog.push(message);
        try {
            const verificationResult = await (0, vp_pex_js_1.verifyVPAgainstPD)(this.agent, message.body.verifiable_presentation, context.ourPresentationDefinition);
            if (!verificationResult.verified) throw new Error(`VP verification failed: ${verificationResult.error}`);
            context.theirVP = message.body.verifiable_presentation;
            try { await this.agent.dataStoreSaveVerifiablePresentation({ verifiablePresentation: message.body.verifiable_presentation }); } catch (e) { /* ignore */ }
            context.authenticated = true;
            const sessionToken = this.generateSessionToken(context);
            context.sessionToken = sessionToken;
            const confirmationMessage = (0, didcomm_messages_js_1.createAuthConfirmation)(context.ourDid, message.from, 'OK', sessionToken, 'Authenticated');
            context.messageLog.push(confirmationMessage);
            this.messageQueue.push(confirmationMessage);
            console.log('[AUTH] Mutual authentication successful!');
            return confirmationMessage;
        } catch (error) {
            const rejectionMessage = (0, didcomm_messages_js_1.createAuthConfirmation)(context.ourDid, message.from, 'REJECTED', undefined, error.message);
            this.messageQueue.push(rejectionMessage);
            throw error;
        }
    }
    async handleAuthConfirmation(message) {
        console.log(`[PHASE3] Auth Confirmation [${message.body.status}]`);
        if (!message.from) throw new Error('Auth Confirmation must have a from field');
        const context = this.contexts.get(message.from);
        if (!context) throw new Error(`No context found for ${message.from}`);
        context.messageLog.push(message);
        if (message.body.status === 'OK') {
            context.authenticated = true;
            context.sessionToken = message.body.session_token;
        } else {
            throw new Error(`Authentication rejected: ${message.body.comment}`);
        }
    }
    async sendServiceRequest(theirDid, service, action, params) {
        const context = this.contexts.get(theirDid);
        if (!context) throw new Error(`No context found for ${theirDid}`);
        if (!context.authenticated) throw new Error('Not authenticated');
        const requestMessage = (0, didcomm_messages_js_1.createServiceRequest)(context.ourDid, theirDid, service, action, params, context.sessionToken);
        context.messageLog.push(requestMessage);
        this.messageQueue.push(requestMessage);
        return requestMessage;
    }
    getContext(did) { return this.contexts.get(did); }
    isAuthenticated(did) { return this.contexts.get(did)?.authenticated ?? false; }
    getPendingMessages() { const m = [...this.messageQueue]; this.messageQueue = []; return m; }

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

async function performMutualAuthentication(agentA, agentB, didA, didB, credentialsA, credentialsB, pdA, pdB) {
    const wrapperA = new DIDCommVPWrapper(agentA);
    const wrapperB = new DIDCommVPWrapper(agentB);
    try {
        const authRequest = await wrapperA.initiateVPAuthRequest(didA, didB, pdA);
        const vpWithPD = await wrapperB.handleVPAuthRequest(authRequest, didB, credentialsB, pdB);
        const vpResponse = await wrapperA.handleVPWithPD(vpWithPD, credentialsA);
        const authConfirmation = await wrapperB.handleVPResponse(vpResponse);
        await wrapperA.handleAuthConfirmation(authConfirmation);
        return { nfAAuthenticated: wrapperA.isAuthenticated(didB), nfBAuthenticated: wrapperB.isAuthenticated(didA), sessionToken: authConfirmation.body.session_token };
    } catch (error) {
        return { nfAAuthenticated: false, nfBAuthenticated: false, error: error.message };
    }
}
