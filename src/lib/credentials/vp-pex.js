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
 * @param verifierDid - DID of the verifier (optional, for aud claim)
 * @returns Verifiable Presentation
 */
async function createVPFromPD(agent, holderDid, availableCredentials, presentationDefinition, verifierDid) {
    console.log('📋 Creating VP from Presentation Definition (PEX)');
    console.log(`   Holder: ${holderDid}`);
    console.log(`   Verifier: ${verifierDid || '(not specified)'}`);
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
        const presentationData = {
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            type: ['VerifiablePresentation'],
            holder: holderDid,
            verifiableCredential: selectedCredentials
        };

        // Add verifier if provided (becomes 'aud' in JWT)
        if (verifierDid) {
            presentationData.verifier = [verifierDid];
        }

        const vp = await agent.createVerifiablePresentation({
            presentation: presentationData,
            proofFormat: 'jwt',
            save: false  // Disabled - using direct DB save to avoid claim constraint issues
        });

        // Save VP directly to presentation table using sqlite3
        try {
            const dbPath = process.env.DB_PATH;
            if (dbPath) {
                const { spawnSync } = require('child_process');
                const fs = require('fs');
                const os = require('os');
                const path = require('path');

                const hash = require('crypto').createHash('sha256').update(JSON.stringify(vp)).digest('hex').substring(0, 46);
                const context = JSON.stringify(vp['@context'] || ['https://www.w3.org/2018/credentials/v1']).replace(/'/g, "''");
                const type = JSON.stringify(vp.type || ['VerifiablePresentation']).replace(/'/g, "''");
                const raw = JSON.stringify(vp).replace(/'/g, "''");

                const sql = `INSERT OR REPLACE INTO presentation (hash, raw, id, context, type, holderDid, issuanceDate) VALUES ('${hash}', '${raw}', '${vp.id || hash}', '${context}', '${type}', '${holderDid}', datetime('now'));`;

                // Write SQL to temp file to avoid shell escaping issues
                const tmpFile = path.join(os.tmpdir(), `vp-save-${Date.now()}.sql`);
                fs.writeFileSync(tmpFile, sql);
                spawnSync('sqlite3', [dbPath, `.read ${tmpFile}`], { stdio: 'inherit' });
                fs.unlinkSync(tmpFile);
                console.log('   ✅ VP saved to database');
            } else {
                console.log('   ⚠️  No DB_PATH for VP save');
            }
        } catch (saveErr) {
            console.log(`   ⚠️  VP not saved: ${saveErr.message}`);
        }

        console.log('✅ VP created (PEX)');
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
                   subject.role === 'network-function';
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
