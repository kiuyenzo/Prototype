"use strict";
/**
 * VP Creation & Verification using Veramo SDR
 *
 * Alternative to vp-pex.js - uses Veramo's native Selective Disclosure Request
 * instead of @sphereon/pex
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVPFromSDR = createVPFromSDR;
exports.verifyVPAgainstSDR = verifyVPAgainstSDR;
exports.selectCredentialsForSDR = selectCredentialsForSDR;

/**
 * Select credentials that match an SDR
 *
 * @param agent - Veramo agent
 * @param sdr - Selective Disclosure Request
 * @returns Matching credentials
 */
async function selectCredentialsForSDR(agent, sdr) {
    console.log('🔍 Selecting credentials for SDR');

    try {
        // Get all credentials from the agent
        const allCredentials = await agent.dataStoreORMGetVerifiableCredentials({});

        // Filter credentials that match SDR claims
        const matchingCredentials = allCredentials.filter(credRecord => {
            const cred = credRecord.verifiableCredential;
            const subject = cred.credentialSubject || {};

            // Check all essential claims
            return sdr.claims.every(claim => {
                if (!claim.isEssential) return true;

                const hasType = subject[claim.claimType] !== undefined;
                const matchesValue = !claim.claimValue || subject[claim.claimType] === claim.claimValue;

                return hasType && matchesValue;
            });
        });

        console.log(`   Found ${matchingCredentials.length} matching credential(s)`);
        return matchingCredentials.map(cr => cr.verifiableCredential);

    } catch (error) {
        console.error('❌ SDR credential selection failed:', error.message);
        return [];
    }
}

/**
 * Create VP based on SDR
 *
 * @param agent - Veramo agent instance
 * @param holderDid - Holder DID
 * @param availableCredentials - Available credentials (passed from caller)
 * @param sdr - Selective Disclosure Request
 * @param verifierDid - DID of the verifier (optional)
 * @returns Verifiable Presentation
 */
async function createVPFromSDR(agent, holderDid, availableCredentials, sdr, verifierDid) {
    console.log('📋 Creating VP from SDR');
    console.log(`   Holder: ${holderDid}`);
    console.log(`   Verifier: ${verifierDid || '(not specified)'}`);
    console.log(`   Available credentials: ${availableCredentials.length}`);

    // Log SDR requirements
    console.log('   📝 SDR Requirements:');
    sdr.claims.forEach((claim, i) => {
        const valueStr = claim.claimValue ? `= "${claim.claimValue}"` : '(any value)';
        console.log(`      [${i+1}] ${claim.claimType} ${valueStr} ${claim.isEssential ? '(essential)' : '(optional)'}`);
    });

    // Step 1: Filter credentials matching SDR
    console.log('   🔎 Checking credentials against SDR...');
    const selectedCredentials = availableCredentials.filter((cred, idx) => {
        const subject = cred.credentialSubject || {};
        console.log(`      Credential ${idx+1}: subject.id=${subject.id || 'N/A'}`);

        const matches = sdr.claims.every(claim => {
            if (!claim.isEssential) return true;
            const hasType = subject[claim.claimType] !== undefined;
            const actualValue = subject[claim.claimType];
            const matchesValue = !claim.claimValue || actualValue === claim.claimValue;
            const result = hasType && matchesValue;
            console.log(`         ${claim.claimType}: has=${hasType}, value="${actualValue}", expected="${claim.claimValue || '*'}" → ${result ? '✓' : '✗'}`);
            return result;
        });
        console.log(`      → ${matches ? '✅ MATCH' : '❌ NO MATCH'}`);
        return matches;
    });

    if (selectedCredentials.length === 0) {
        throw new Error('No credentials match the SDR');
    }

    console.log(`   Selected ${selectedCredentials.length} credential(s) for VP`);

    // Step 2: Create VP with Veramo
    try {
        const presentationData = {
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            type: ['VerifiablePresentation'],
            holder: holderDid,
            verifiableCredential: selectedCredentials
        };

        if (verifierDid) {
            presentationData.verifier = [verifierDid];
        }

        const vp = await agent.createVerifiablePresentation({
            presentation: presentationData,
            proofFormat: 'jwt',
            save: true
        });

        console.log('✅ VP created (SDR)');
        return vp;

    } catch (error) {
        console.error('❌ Error creating VP:', error.message);
        throw error;
    }
}

/**
 * Verify VP against SDR
 *
 * @param agent - Veramo agent instance
 * @param presentation - VP to verify
 * @param sdr - Expected SDR
 * @returns Verification result
 */
async function verifyVPAgainstSDR(agent, presentation, sdr) {
    console.log('🔍 Verifying VP against SDR');

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

        // Step 2: Check if credentials satisfy SDR claims
        console.log('   Step 2: SDR claim validation...');
        const credentials = presentation.verifiableCredential || [];

        const satisfiesSDR = credentials.some(cred => {
            const subject = cred.credentialSubject || {};

            return sdr.claims.every(claim => {
                if (!claim.isEssential) return true;

                const hasType = subject[claim.claimType] !== undefined;
                const matchesValue = !claim.claimValue || subject[claim.claimType] === claim.claimValue;

                return hasType && matchesValue;
            });
        });

        if (satisfiesSDR) {
            console.log('✅ VP satisfies SDR');
            return { verified: true };
        }

        console.log('❌ VP does not satisfy SDR');
        return {
            verified: false,
            error: { message: 'VP does not satisfy SDR claims' }
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
    createVPFromSDR,
    verifyVPAgainstSDR,
    selectCredentialsForSDR
};
