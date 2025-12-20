"use strict";
/**
 * VP Creation & Verification using Veramo SDR
 * Alternative to vp-pex.js - uses Veramo's native Selective Disclosure Request
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVPFromSDR = createVPFromSDR;
exports.verifyVPAgainstSDR = verifyVPAgainstSDR;
exports.selectCredentialsForSDR = selectCredentialsForSDR;

/** Check if credential matches SDR claims */
const matchesSDR = (subject, sdr) => sdr.claims.every(claim =>
    !claim.isEssential || (subject[claim.claimType] !== undefined && (!claim.claimValue || subject[claim.claimType] === claim.claimValue))
);

/** Select credentials that match an SDR */
async function selectCredentialsForSDR(agent, sdr) {
    try {
        const allCredentials = await agent.dataStoreORMGetVerifiableCredentials({});
        const matching = allCredentials.filter(cr => matchesSDR(cr.verifiableCredential.credentialSubject || {}, sdr));
        console.log(`🔍 SDR: ${matching.length}/${allCredentials.length} credentials match`);
        return matching.map(cr => cr.verifiableCredential);
    } catch (error) {
        console.error('❌ SDR selection failed:', error.message);
        return [];
    }
}

/** Create VP based on SDR */
async function createVPFromSDR(agent, holderDid, availableCredentials, sdr, verifierDid) {
    console.log(`📋 VP from SDR: holder=${holderDid.split(':').pop()}, creds=${availableCredentials.length}`);

    const selectedCredentials = availableCredentials.filter(cred => matchesSDR(cred.credentialSubject || {}, sdr));
    if (selectedCredentials.length === 0) throw new Error('No credentials match the SDR');

    const presentationData = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        holder: holderDid,
        verifiableCredential: selectedCredentials,
        ...(verifierDid && { verifier: [verifierDid] })
    };

    const vp = await agent.createVerifiablePresentation({ presentation: presentationData, proofFormat: 'jwt', save: true });
    console.log(`✅ VP created with ${selectedCredentials.length} credential(s)`);
    return vp;
}

/** Verify VP against SDR */
async function verifyVPAgainstSDR(agent, presentation, sdr) {
    try {
        // Step 1: Cryptographic verification
        const cryptoResult = await agent.verifyPresentation({ presentation });
        if (!cryptoResult.verified) {
            console.log('❌ VP crypto verification failed');
            return { verified: false, error: cryptoResult.error || { message: 'Signature verification failed' } };
        }

        // Step 2: SDR claim validation
        const credentials = presentation.verifiableCredential || [];
        const satisfiesSDR = credentials.some(cred => matchesSDR(cred.credentialSubject || {}, sdr));

        console.log(satisfiesSDR ? '✅ VP verified against SDR' : '❌ VP does not satisfy SDR');
        return satisfiesSDR ? { verified: true } : { verified: false, error: { message: 'VP does not satisfy SDR claims' } };
    } catch (error) {
        console.error('❌ VP verification error:', error.message);
        return { verified: false, error };
    }
}

exports.default = { createVPFromSDR, verifyVPAgainstSDR, selectCredentialsForSDR };
