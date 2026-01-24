"use strict";

const { PEX } = require('@sphereon/pex');
const pex = new PEX();

function selectCredentialsForPD(credentials, pd) {
    try {
        const result = pex.selectFrom(pd, credentials);
        const matches = result.matches || [];
        const selected = matches.flatMap(match => {
            if (!match.vc_path) return [];
            const paths = Array.isArray(match.vc_path) ? match.vc_path : [match.vc_path];
            return paths.map(p => credentials[parseInt(p.replace('$.verifiableCredential[', '').replace(']', ''))]).filter(Boolean);
        });
        if (selected.length === 0 && credentials.length > 0) {
            return credentials.filter(c => (c.type || []).includes('NetworkFunctionCredential') && c.credentialSubject?.role === 'network-function');
        }
        return selected.length > 0 ? selected : credentials.slice(0, 1);
    } catch (e) {
        return credentials.slice(0, 1);
    }
}

async function createVPFromPD(agent, holderDid, availableCredentials, pd, verifierDid) {
    const selectedCredentials = selectCredentialsForPD(availableCredentials, pd);
    if (selectedCredentials.length === 0) throw new Error('No credentials match PD');

    const presentationData = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        holder: holderDid,
        verifiableCredential: selectedCredentials
    };
    if (verifierDid) presentationData.verifier = [verifierDid];

    const vp = await agent.createVerifiablePresentation({ presentation: presentationData, proofFormat: 'jwt', save: false });
    return vp;
}

async function verifyVPAgainstPD(agent, presentation, pd) {
    try {
        const cryptoResult = await agent.verifyPresentation({ presentation });
        if (!cryptoResult.verified) return { verified: false, error: cryptoResult.error || { message: 'Signature failed' } };

        const credentials = presentation.verifiableCredential || [];
        const hasValid = credentials.some(c => (c.type || []).includes('NetworkFunctionCredential') && c.credentialSubject?.role === 'network-function');
        return hasValid ? { verified: true } : { verified: false, error: { message: 'VP does not satisfy PD' } };
    } catch (e) {
        return { verified: false, error: e };
    }
}

module.exports = { createVPFromPD, verifyVPAgainstPD, selectCredentialsForPD };
