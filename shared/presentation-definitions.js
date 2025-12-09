/**
 * Presentation Definitions for Mutual Authentication
 *
 * PD_A: What NF-A requests from NF-B
 * PD_B: What NF-B requests from NF-A
 */
/**
 * PD_A: NF-A requests proof that NF-B is an authorized Network Function
 * This will be sent in the initial VP_Auth_Request
 */
export const PRESENTATION_DEFINITION_A = {
    id: 'pd-nf-auth-request-a',
    input_descriptors: [
        {
            id: 'network-function-credential',
            name: 'Network Function Credential',
            purpose: 'Verify that the holder is an authorized network function',
            constraints: {
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
                        path: ['$.credentialSubject.status'],
                        filter: {
                            type: 'string',
                            const: 'active'
                        }
                    }
                ]
            }
        }
    ]
};
/**
 * PD_B: NF-B requests proof that NF-A is an authorized Network Function
 * This will be sent as part of VP_B response
 */
export const PRESENTATION_DEFINITION_B = {
    id: 'pd-nf-auth-request-b',
    input_descriptors: [
        {
            id: 'network-function-credential',
            name: 'Network Function Credential',
            purpose: 'Verify that the holder is an authorized network function',
            constraints: {
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
                        path: ['$.credentialSubject.status'],
                        filter: {
                            type: 'string',
                            const: 'active'
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
            }
        }
    ]
};
/**
 * Example: More restrictive PD that requires specific cluster
 */
export const PRESENTATION_DEFINITION_SPECIFIC_CLUSTER = {
    id: 'pd-cluster-specific',
    input_descriptors: [
        {
            id: 'cluster-credential',
            name: 'Cluster-Specific Credential',
            purpose: 'Verify cluster membership',
            constraints: {
                fields: [
                    {
                        path: ['$.credentialSubject.clusterId'],
                        filter: {
                            type: 'string',
                            const: 'cluster-a'
                        }
                    }
                ]
            }
        }
    ]
};
