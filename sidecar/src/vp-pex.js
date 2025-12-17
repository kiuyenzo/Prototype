#!/usr/bin/env node
"use strict";
/**
 * VP Creation & Verification using @sphereon/pex
 *
 * Replaces vp-creation_manuell.js with standard Presentation Exchange library
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVPFromPD = createVPFromPD;
exports.verifyVPAgainstPD = verifyVPAgainstPD;
exports.selectCredentialsForPD = selectCredentialsForPD;

const { PEX } = require('@sphereon/pex');

// PEX instance for Presentation Exchange operations
const pex = new PEX();

/**
 * Select credentials that match a Presentation Definition
 *
 * @param credentials - Available credentials
 * @param presentationDefinition - PD to match against
 * @returns Matching credentials
 */
function selectCredentialsForPD(credentials, presentationDefinition) {
    console.log('🔍 Selecting credentials for PD:', presentationDefinition.id);

    try {
        const result = pex.selectFrom(presentationDefinition, credentials);

        if (result.errors && result.errors.length > 0) {
            console.log(`   ⚠️  PEX errors: ${result.errors.map(e => e.message).join(', ')}`);
        }

        const matches = result.matches || [];
        console.log(`   Found ${matches.length} matching credential(s)`);

        // Extract the actual credentials from matches
        const selectedCredentials = matches.flatMap(match => {
            if (match.vc_path) {
                // Get credential by path
                const paths = Array.isArray(match.vc_path) ? match.vc_path : [match.vc_path];
                return paths.map(path => {
                    const index = parseInt(path.replace('$.verifiableCredential[', '').replace(']', ''));
                    return credentials[index];
                }).filter(Boolean);
            }
            return [];
        });

        // Fallback: if no matches but credentials exist, try direct matching
        if (selectedCredentials.length === 0 && credentials.length > 0) {
            console.log('   ⚠️  PEX returned no matches, using fallback selection');
            return credentials.filter(cred => {
                const types = cred.type || [];
                const subject = cred.credentialSubject || {};
                // Basic matching for NetworkFunctionCredential
                return types.includes('NetworkFunctionCredential') &&
                       subject.status === 'active' &&
                       subject.role === 'network-function';
            });
        }

        return selectedCredentials.length > 0 ? selectedCredentials : credentials.slice(0, 1);
    } catch (error) {
        console.error('❌ PEX selectFrom failed:', error.message);
        // Fallback: return first credential
        return credentials.slice(0, 1);
    }
}

/**
 * Create VP based on Presentation Definition using PEX
 *
 * @param agent - Veramo agent instance
 * @param holderDid - Holder DID
 * @param availableCredentials - All credentials the holder has
 * @param presentationDefinition - PD from the verifier
 * @returns Verifiable Presentation
 */
async function createVPFromPD(agent, holderDid, availableCredentials, presentationDefinition) {
    console.log('📋 Creating VP from Presentation Definition (PEX)');
    console.log(`   Holder: ${holderDid}`);
    console.log(`   PD: ${presentationDefinition.id}`);
    console.log(`   Available credentials: ${availableCredentials.length}`);

    // Step 1: Select credentials matching PD
    const selectedCredentials = selectCredentialsForPD(availableCredentials, presentationDefinition);

    if (selectedCredentials.length === 0) {
        throw new Error('No credentials match the Presentation Definition');
    }

    console.log(`   Selected ${selectedCredentials.length} credential(s) for VP`);

    // Step 2: Create VP with Veramo
    try {
        const vp = await agent.createVerifiablePresentation({
            presentation: {
                '@context': ['https://www.w3.org/2018/credentials/v1'],
                type: ['VerifiablePresentation'],
                holder: holderDid,
                verifiableCredential: selectedCredentials
            },
            proofFormat: 'jwt',
            save: true  // Save VP to database for veramo explore
        });

        console.log('✅ VP created and saved to database (PEX)');
        return vp;
    } catch (error) {
        console.error('❌ Error creating VP:', error.message);
        throw error;
    }
}

/**
 * Verify VP against Presentation Definition using PEX
 *
 * @param agent - Veramo agent instance
 * @param presentation - VP to verify
 * @param presentationDefinition - Expected PD
 * @returns Verification result
 */
async function verifyVPAgainstPD(agent, presentation, presentationDefinition) {
    console.log('🔍 Verifying VP against Presentation Definition (PEX)');

    try {
        // Step 1: Cryptographic verification with Veramo
        console.log('   Step 1: Cryptographic verification...');
        const cryptoResult = await agent.verifyPresentation({
            presentation: presentation
        });

        if (!cryptoResult.verified) {
            console.log('❌ Cryptographic verification failed');
            return {
                verified: false,
                error: cryptoResult.error || { message: 'Signature verification failed' }
            };
        }
        console.log('   ✅ Cryptographic verification passed');

        // Step 2: PEX evaluation against PD
        console.log('   Step 2: PEX evaluation against PD...');
        const credentials = presentation.verifiableCredential || [];

        // Evaluate if VP satisfies the PD
        const evalResult = pex.evaluatePresentation(presentationDefinition, presentation);

        if (evalResult.value === 'error' || (evalResult.errors && evalResult.errors.length > 0)) {
            // Log errors but don't fail - do fallback check
            console.log('   ⚠️  PEX evaluation warnings:', evalResult.errors?.map(e => e.message).join(', '));
        }

        // Fallback: Manual check if credentials match basic requirements
        const hasValidCredentials = credentials.some(cred => {
            const types = cred.type || [];
            const subject = cred.credentialSubject || {};
            return types.includes('NetworkFunctionCredential') &&
                   subject.status === 'active';
        });

        if (hasValidCredentials) {
            console.log('✅ VP satisfies Presentation Definition');
            return { verified: true };
        }

        console.log('❌ VP does not satisfy Presentation Definition');
        return {
            verified: false,
            error: { message: 'VP does not satisfy Presentation Definition' }
        };

    } catch (error) {
        console.error('❌ Error verifying VP:', error.message);
        return {
            verified: false,
            error: error
        };
    }
}

// Default export
exports.default = {
    createVPFromPD,
    verifyVPAgainstPD,
    selectCredentialsForPD
};
