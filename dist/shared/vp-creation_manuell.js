#!/usr/bin/env ts-node
/**
 * Verifiable Presentation Creation with Presentation Exchange
 *
 * This module handles:
 * 1. Creating VPs from VCs based on Presentation Definitions
 * 2. Verifying VPs against Presentation Definitions
 * 3. Selective Disclosure of credentials
 */
/**
 * Create a Verifiable Presentation from credentials
 *
 * @param agent - Veramo agent instance
 * @param holderDid - DID of the holder creating the VP
 * @param credentials - Array of Verifiable Credentials to include
 * @param presentationDefinition - Optional PD for selective disclosure
 * @returns Verifiable Presentation
 */
export async function createVerifiablePresentation(agent, holderDid, credentials, presentationDefinition) {
    try {
        console.log(`📝 Creating VP for holder: ${holderDid}`);
        console.log(`   Including ${credentials.length} credential(s)`);
        // Find the first key that can sign (has private key)
        const identifier = await agent.didManagerGet({ did: holderDid });
        let signingKey = null;
        for (const key of identifier.keys) {
            try {
                // Test if we can sign with this key
                await agent.keyManagerSign({
                    keyRef: key.kid,
                    data: 'test'
                });
                signingKey = key.kid;
                console.log(`   Using signing key: ${signingKey.substring(0, 60)}...`);
                break;
            }
            catch (error) {
                // Key can't sign, try next
                continue;
            }
        }
        if (!signingKey) {
            throw new Error(`No signing key found for ${holderDid}`);
        }
        // Create the presentation with explicit key reference
        const verifiablePresentation = await agent.createVerifiablePresentation({
            presentation: {
                '@context': ['https://www.w3.org/2018/credentials/v1'],
                type: ['VerifiablePresentation'],
                holder: holderDid,
                verifiableCredential: credentials
            },
            proofFormat: 'jwt',
            keyRef: signingKey,
            save: false
        });
        console.log('✅ VP created successfully');
        console.log(`   VP ID: ${verifiablePresentation.id || 'N/A'}`);
        return verifiablePresentation;
    }
    catch (error) {
        console.error('❌ Error creating VP:', error.message);
        throw error;
    }
}
/**
 * Verify a Verifiable Presentation
 *
 * @param agent - Veramo agent instance
 * @param presentation - The VP to verify
 * @returns Verification result
 */
export async function verifyVerifiablePresentation(agent, presentation) {
    try {
        console.log('🔍 Verifying Verifiable Presentation...');
        const result = await agent.verifyPresentation({
            presentation: presentation
        });
        if (result.verified) {
            console.log('✅ VP verified successfully');
        }
        else {
            console.log('❌ VP verification failed');
            console.log('   Error:', result.error);
        }
        return result;
    }
    catch (error) {
        console.error('❌ Error verifying VP:', error.message);
        return {
            verified: false,
            error: error
        };
    }
}
/**
 * Select credentials that match a Presentation Definition
 *
 * This implements basic Presentation Exchange logic
 *
 * @param credentials - Available credentials
 * @param presentationDefinition - PD to match against
 * @returns Matching credentials
 */
export function selectCredentialsForPD(credentials, presentationDefinition) {
    console.log('🔍 Selecting credentials for PD:', presentationDefinition.id);
    const matchingCredentials = [];
    for (const inputDescriptor of presentationDefinition.input_descriptors) {
        console.log(`   Checking descriptor: ${inputDescriptor.id}`);
        for (const credential of credentials) {
            if (matchesInputDescriptor(credential, inputDescriptor)) {
                console.log(`   ✅ Credential matches: ${credential.credentialSubject.id}`);
                matchingCredentials.push(credential);
                break; // One credential per descriptor
            }
        }
    }
    console.log(`   Found ${matchingCredentials.length} matching credential(s)`);
    return matchingCredentials;
}
/**
 * Check if a credential matches an input descriptor
 *
 * @param credential - Credential to check
 * @param descriptor - Input descriptor from PD
 * @returns True if matches
 */
function matchesInputDescriptor(credential, descriptor) {
    for (const field of descriptor.constraints.fields) {
        if (!matchesField(credential, field)) {
            return false;
        }
    }
    return true;
}
/**
 * Check if a credential field matches a constraint
 *
 * @param credential - Credential to check
 * @param field - Field constraint
 * @returns True if matches
 */
function matchesField(credential, field) {
    for (const path of field.path) {
        const value = getValueByPath(credential, path);
        if (field.filter) {
            if (field.filter.const && value !== field.filter.const) {
                return false;
            }
            if (field.filter.pattern) {
                const regex = new RegExp(field.filter.pattern);
                // Handle both string values and arrays (e.g., credential types)
                if (Array.isArray(value)) {
                    // For arrays, check if any element matches the pattern
                    if (!value.some(v => regex.test(String(v)))) {
                        return false;
                    }
                }
                else {
                    if (!regex.test(String(value))) {
                        return false;
                    }
                }
            }
        }
    }
    return true;
}
/**
 * Get value from object by JSONPath
 *
 * @param obj - Object to query
 * @param path - JSONPath (simplified, e.g., "$.credentialSubject.role")
 * @returns Value or undefined
 */
function getValueByPath(obj, path) {
    // Remove leading "$." from JSONPath
    const cleanPath = path.replace(/^\$\./, '');
    const parts = cleanPath.split('.');
    let current = obj;
    for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
            current = current[part];
        }
        else {
            return undefined;
        }
    }
    return current;
}
/**
 * Create VP based on Presentation Definition
 * This is the main function for Presentation Exchange flow
 *
 * @param agent - Veramo agent instance
 * @param holderDid - Holder DID
 * @param availableCredentials - All credentials the holder has
 * @param presentationDefinition - PD from the verifier
 * @returns VP containing selected credentials
 */
export async function createVPFromPD(agent, holderDid, availableCredentials, presentationDefinition) {
    console.log('📋 Creating VP from Presentation Definition');
    // Step 1: Select credentials that match PD
    const selectedCredentials = selectCredentialsForPD(availableCredentials, presentationDefinition);
    if (selectedCredentials.length === 0) {
        throw new Error('No credentials match the Presentation Definition');
    }
    // Step 2: Create VP with selected credentials
    const vp = await createVerifiablePresentation(agent, holderDid, selectedCredentials, presentationDefinition);
    return vp;
}
/**
 * Verify VP against Presentation Definition
 *
 * @param agent - Veramo agent instance
 * @param presentation - VP to verify
 * @param presentationDefinition - Expected PD
 * @returns Verification result
 */
export async function verifyVPAgainstPD(agent, presentation, presentationDefinition) {
    console.log('🔍 Verifying VP against Presentation Definition');
    // Step 1: Verify the VP cryptographically
    const cryptoResult = await verifyVerifiablePresentation(agent, presentation);
    if (!cryptoResult.verified) {
        return cryptoResult;
    }
    // Step 2: Check if VP satisfies the PD
    const credentials = presentation.verifiableCredential || [];
    const selectedCredentials = selectCredentialsForPD(credentials, presentationDefinition);
    if (selectedCredentials.length === 0) {
        return {
            verified: false,
            error: {
                message: 'VP does not satisfy Presentation Definition'
            }
        };
    }
    console.log('✅ VP satisfies Presentation Definition');
    return { verified: true };
}
// Export for use in other modules
export default {
    createVerifiablePresentation,
    verifyVerifiablePresentation,
    selectCredentialsForPD,
    createVPFromPD,
    verifyVPAgainstPD
};
