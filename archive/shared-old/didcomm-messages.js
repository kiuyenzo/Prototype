#!/usr/bin/env ts-node
"use strict";
/**
 * DIDComm Message Type Definitions for VP Exchange
 *
 * This module defines the message types used in the mutual authentication flow
 * between Network Functions using Verifiable Presentations and Presentation Exchange.
 *
 * Flow:
 * 1. VP_AUTH_REQUEST: NF-A requests authentication from NF-B with PD_A
 * 2. VP_WITH_PD: NF-B responds with VP_B matching PD_A, plus PD_B for NF-A
 * 3. VP_RESPONSE: NF-A responds with VP_A matching PD_B
 * 4. AUTH_CONFIRMATION: NF-B confirms mutual authentication succeeded
 * 5. SERVICE_REQUEST/RESPONSE: Authorized communication after mutual auth
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIDCOMM_MESSAGE_TYPES = void 0;
exports.createVPAuthRequest = createVPAuthRequest;
exports.createVPWithPD = createVPWithPD;
exports.createVPResponse = createVPResponse;
exports.createAuthConfirmation = createAuthConfirmation;
exports.createServiceRequest = createServiceRequest;
exports.createServiceResponse = createServiceResponse;
exports.createErrorMessage = createErrorMessage;
/**
 * DIDComm Message Protocol URIs
 * Based on DIDComm Messaging v2 and Present Proof Protocol v3
 */
exports.DIDCOMM_MESSAGE_TYPES = {
    // Phase 1: Initial Authentication Request
    VP_AUTH_REQUEST: 'https://didcomm.org/present-proof/3.0/request-presentation',
    // Phase 2: VP Exchange with Presentation Definitions
    VP_WITH_PD: 'https://didcomm.org/present-proof/3.0/presentation-with-definition',
    VP_RESPONSE: 'https://didcomm.org/present-proof/3.0/presentation',
    // Phase 3: Mutual Authentication Confirmation
    AUTH_CONFIRMATION: 'https://didcomm.org/present-proof/3.0/ack',
    // Phase 3: Authorized Service Communication
    SERVICE_REQUEST: 'https://didcomm.org/service/1.0/request',
    SERVICE_RESPONSE: 'https://didcomm.org/service/1.0/response',
    // Error handling
    ERROR: 'https://didcomm.org/present-proof/3.0/problem-report'
};
/**
 * Helper function to create a VP Authentication Request message
 */
function createVPAuthRequest(from, to, presentationDefinition, comment) {
    return {
        type: exports.DIDCOMM_MESSAGE_TYPES.VP_AUTH_REQUEST,
        id: generateMessageId(),
        from,
        to: [to],
        created_time: Date.now(),
        body: {
            presentation_definition: presentationDefinition,
            comment
        }
    };
}
/**
 * Helper function to create a VP with PD message
 */
function createVPWithPD(from, to, verifiablePresentation, presentationDefinition, comment) {
    return {
        type: exports.DIDCOMM_MESSAGE_TYPES.VP_WITH_PD,
        id: generateMessageId(),
        from,
        to: [to],
        created_time: Date.now(),
        body: {
            verifiable_presentation: verifiablePresentation,
            presentation_definition: presentationDefinition,
            comment
        }
    };
}
/**
 * Helper function to create a VP Response message
 */
function createVPResponse(from, to, verifiablePresentation, comment) {
    return {
        type: exports.DIDCOMM_MESSAGE_TYPES.VP_RESPONSE,
        id: generateMessageId(),
        from,
        to: [to],
        created_time: Date.now(),
        body: {
            verifiable_presentation: verifiablePresentation,
            comment
        }
    };
}
/**
 * Helper function to create an Authentication Confirmation message
 */
function createAuthConfirmation(from, to, status, sessionToken, comment) {
    return {
        type: exports.DIDCOMM_MESSAGE_TYPES.AUTH_CONFIRMATION,
        id: generateMessageId(),
        from,
        to: [to],
        created_time: Date.now(),
        body: {
            status,
            session_token: sessionToken,
            comment
        }
    };
}
/**
 * Helper function to create a Service Request message
 */
function createServiceRequest(from, to, service, action, params, sessionToken) {
    return {
        type: exports.DIDCOMM_MESSAGE_TYPES.SERVICE_REQUEST,
        id: generateMessageId(),
        from,
        to: [to],
        created_time: Date.now(),
        body: {
            service,
            action,
            params,
            session_token: sessionToken
        }
    };
}
/**
 * Helper function to create a Service Response message
 */
function createServiceResponse(from, to, status, data, error) {
    return {
        type: exports.DIDCOMM_MESSAGE_TYPES.SERVICE_RESPONSE,
        id: generateMessageId(),
        from,
        to: [to],
        created_time: Date.now(),
        body: {
            status,
            data,
            error
        }
    };
}
/**
 * Helper function to create an Error message
 */
function createErrorMessage(from, to, code, comment) {
    return {
        type: exports.DIDCOMM_MESSAGE_TYPES.ERROR,
        id: generateMessageId(),
        from,
        to: [to],
        created_time: Date.now(),
        body: {
            code,
            comment
        }
    };
}
/**
 * Generate a unique message ID
 */
function generateMessageId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}
