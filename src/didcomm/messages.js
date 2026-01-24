"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.DIDCOMM_MESSAGE_TYPES = void 0;
exports.createVPAuthRequest = createVPAuthRequest;
exports.createVPWithPD = createVPWithPD;
exports.createVPResponse = createVPResponse;
exports.createAuthConfirmation = createAuthConfirmation;
exports.createServiceRequest = createServiceRequest;
exports.createServiceResponse = createServiceResponse;
exports.createErrorMessage = createErrorMessage;

exports.DIDCOMM_MESSAGE_TYPES = {
    VP_AUTH_REQUEST: 'https://didcomm.org/present-proof/3.0/request-presentation',
    VP_WITH_PD: 'https://didcomm.org/present-proof/3.0/presentation-with-definition',
    VP_RESPONSE: 'https://didcomm.org/present-proof/3.0/presentation',
    AUTH_CONFIRMATION: 'https://didcomm.org/present-proof/3.0/ack',
    SERVICE_REQUEST: 'https://didcomm.org/service/1.0/request',
    SERVICE_RESPONSE: 'https://didcomm.org/service/1.0/response',
    ERROR: 'https://didcomm.org/present-proof/3.0/problem-report'
};

const msg = (type, from, to, body) => ({ type, id: `${Date.now()}-${Math.random().toString(36).substring(2,11)}`, from, to: [to], created_time: Date.now(), body });

function createVPAuthRequest(from, to, presentationDefinition, comment) {
    return msg(exports.DIDCOMM_MESSAGE_TYPES.VP_AUTH_REQUEST, from, to, { presentation_definition: presentationDefinition, comment });
}

function createVPWithPD(from, to, verifiablePresentation, presentationDefinition, comment) {
    return msg(exports.DIDCOMM_MESSAGE_TYPES.VP_WITH_PD, from, to, { verifiable_presentation: verifiablePresentation, presentation_definition: presentationDefinition, comment });
}

function createVPResponse(from, to, verifiablePresentation, comment) {
    return msg(exports.DIDCOMM_MESSAGE_TYPES.VP_RESPONSE, from, to, { verifiable_presentation: verifiablePresentation, comment });
}

function createAuthConfirmation(from, to, status, sessionToken, comment) {
    return msg(exports.DIDCOMM_MESSAGE_TYPES.AUTH_CONFIRMATION, from, to, { status, session_token: sessionToken, comment });
}

function createServiceRequest(from, to, service, action, params, sessionToken) {
    return msg(exports.DIDCOMM_MESSAGE_TYPES.SERVICE_REQUEST, from, to, { service, action, params, session_token: sessionToken });
}

function createServiceResponse(from, to, status, data, error) {
    return msg(exports.DIDCOMM_MESSAGE_TYPES.SERVICE_RESPONSE, from, to, { status, data, error });
}

function createErrorMessage(from, to, code, comment) {
    return msg(exports.DIDCOMM_MESSAGE_TYPES.ERROR, from, to, { code, comment });
}

