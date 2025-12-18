"use strict";
/**
 * SDR (Selective Disclosure Request) Definitions
 *
 * Alternative to PEX/Presentation Definitions using Veramo's native SDR
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SDR_SPECIFIC_CLUSTER = exports.SDR_B = exports.SDR_A = void 0;

/**
 * SDR_A: NF-A requests proof that NF-B is an authorized Network Function
 */
exports.SDR_A = {
    issuer: undefined, // Any issuer accepted
    claims: [
        {
            claimType: 'role',
            claimValue: 'network-function',
            isEssential: true
        }
    ]
};

/**
 * SDR_B: NF-B requests proof that NF-A is an authorized Network Function
 * More restrictive - also requires clusterId
 */
exports.SDR_B = {
    issuer: undefined,
    claims: [
        {
            claimType: 'role',
            claimValue: 'network-function',
            isEssential: true
        },
        {
            claimType: 'clusterId',
            // No specific value - just needs to exist
            isEssential: true
        }
    ]
};

/**
 * SDR for specific cluster membership
 */
exports.SDR_SPECIFIC_CLUSTER = {
    issuer: undefined,
    claims: [
        {
            claimType: 'clusterId',
            claimValue: 'cluster-a',
            isEssential: true
        }
    ]
};
