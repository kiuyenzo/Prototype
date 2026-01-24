"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.PRESENTATION_DEFINITION_B = exports.PRESENTATION_DEFINITION_A = void 0;

const NF_CREDENTIAL_CONSTRAINTS = {
    fields: [
        {
            path: ['$.type'],
            filter: {
                type: 'string',
                pattern: 'NetworkFunctionCredential|VerifiableCredential'
            }
        },
        {
            path: ['$.credentialSubject.role'],
            filter: {
                type: 'string',
                const: 'network-function'
            }
        },
        {
            path: ['$.credentialSubject.clusterId'],
            filter: {
                type: 'string',
                pattern: 'cluster-.*'
            }
        }
    ]
};

exports.PRESENTATION_DEFINITION_A = {
    id: 'pd-nf-auth-request-a',
    input_descriptors: [
        {
            id: 'network-function-credential',
            name: 'Network Function Credential',
            purpose: 'Verify that NF-B is an authorized network function with valid cluster ID',
            constraints: NF_CREDENTIAL_CONSTRAINTS
        }
    ]
};

exports.PRESENTATION_DEFINITION_B = {
    id: 'pd-nf-auth-request-b',
    input_descriptors: [
        {
            id: 'network-function-credential',
            name: 'Network Function Credential',
            purpose: 'Verify that NF-A is an authorized network function with valid cluster ID',
            constraints: NF_CREDENTIAL_CONSTRAINTS
        }
    ]
};
