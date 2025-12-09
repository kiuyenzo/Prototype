/**
 * Presentation Exchange Implementation using @sphereon/pex
 *
 * This module implements the DIF Presentation Exchange specification
 * for credential selection and VP creation based on Presentation Definitions.
 *
 * Used for Phase 2 (Mutual Authentication) in the architecture.
 */

import { PEX } from '@sphereon/pex';
import {
  PresentationDefinitionV2,
  SelectResults,
  EvaluationResults
} from '@sphereon/pex-models';
import { IVerifyResult } from '@sphereon/ssi-types';

// Initialize PEX engine
const pex = new PEX();

/**
 * Select credentials that match a Presentation Definition
 *
 * This is the core of Presentation Exchange - automatically finding
 * which credentials satisfy the verifier's requirements.
 *
 * @param presentationDefinition - PD from the verifier
 * @param verifiableCredentials - Available VCs
 * @returns Selected credentials that match the PD
 */
export function selectCredentialsForPD(
  presentationDefinition: PresentationDefinitionV2,
  verifiableCredentials: any[]
): SelectResults {
  console.log('🔍 Selecting credentials using @sphereon/pex');
  console.log(`   PD: ${presentationDefinition.id}`);
  console.log(`   Available credentials: ${verifiableCredentials.length}`);

  try {
    // Use PEX to select matching credentials
    const selectResults = pex.selectFrom(
      presentationDefinition,
      verifiableCredentials
    );

    console.log(`   ✅ Selected ${selectResults.matches?.length || 0} matching credentials`);

    if (selectResults.errors && selectResults.errors.length > 0) {
      console.log('   ⚠️  Selection warnings:');
      selectResults.errors.forEach(err => {
        console.log(`      - ${err.message}`);
      });
    }

    return selectResults;
  } catch (error: any) {
    console.error('   ❌ Error selecting credentials:', error.message);
    throw error;
  }
}

/**
 * Create a Verifiable Presentation from selected credentials
 *
 * @param presentationDefinition - PD to satisfy
 * @param selectedCredentials - Credentials selected by selectCredentialsForPD
 * @param holderDID - DID of the holder creating the VP
 * @returns Verifiable Presentation
 */
export function createVPFromSelectedCredentials(
  presentationDefinition: PresentationDefinitionV2,
  selectedCredentials: any[],
  holderDID: string
): any {
  console.log('📝 Creating VP from selected credentials');
  console.log(`   Holder: ${holderDID}`);
  console.log(`   Credentials: ${selectedCredentials.length}`);

  try {
    // Create VP using PEX
    const vp = pex.presentationFrom(
      presentationDefinition,
      selectedCredentials,
      {
        holderDID: holderDID
      }
    );

    console.log('   ✅ VP created successfully');
    return vp;
  } catch (error: any) {
    console.error('   ❌ Error creating VP:', error.message);
    throw error;
  }
}

/**
 * Verify that a VP satisfies a Presentation Definition
 *
 * This checks if the VP contains the right credentials with the right claims.
 *
 * @param presentationDefinition - PD to check against
 * @param verifiablePresentation - VP to verify
 * @returns Evaluation result
 */
export function evaluateVPAgainstPD(
  presentationDefinition: PresentationDefinitionV2,
  verifiablePresentation: any
): EvaluationResults {
  console.log('🔍 Evaluating VP against Presentation Definition');
  console.log(`   PD: ${presentationDefinition.id}`);

  try {
    // Evaluate VP using PEX
    const evaluationResults = pex.evaluatePresentation(
      presentationDefinition,
      verifiablePresentation
    );

    if (evaluationResults.value) {
      console.log('   ✅ VP satisfies Presentation Definition');
    } else {
      console.log('   ❌ VP does NOT satisfy Presentation Definition');
      if (evaluationResults.errors && evaluationResults.errors.length > 0) {
        console.log('   Errors:');
        evaluationResults.errors.forEach(err => {
          console.log(`      - ${err.message}`);
        });
      }
    }

    return evaluationResults;
  } catch (error: any) {
    console.error('   ❌ Error evaluating VP:', error.message);
    throw error;
  }
}

/**
 * Complete flow: Select credentials and create VP
 *
 * This is the main function you'll use in your auth flow.
 *
 * @param presentationDefinition - PD from verifier
 * @param availableCredentials - All VCs the holder has
 * @param holderDID - Holder DID
 * @returns VP ready to send
 */
export function createVPFromPD(
  presentationDefinition: PresentationDefinitionV2,
  availableCredentials: any[],
  holderDID: string
): any {
  console.log('📋 Complete PEX flow: Select + Create VP');
  console.log('='.repeat(60));

  // Step 1: Select matching credentials
  const selectResults = selectCredentialsForPD(
    presentationDefinition,
    availableCredentials
  );

  if (!selectResults.matches || selectResults.matches.length === 0) {
    throw new Error('No credentials match the Presentation Definition');
  }

  // Extract the actual credentials from matches
  const selectedCredentials = selectResults.matches
    .map(match => match.vc)
    .filter(vc => vc !== undefined);

  // Step 2: Create VP from selected credentials
  const vp = createVPFromSelectedCredentials(
    presentationDefinition,
    selectedCredentials,
    holderDID
  );

  console.log('='.repeat(60));
  console.log('✅ VP created and ready to send');

  return vp;
}

/**
 * Verify VP against PD
 *
 * Complete verification: Check if VP satisfies the PD requirements
 *
 * @param presentationDefinition - Expected PD
 * @param verifiablePresentation - VP to verify
 * @returns True if valid, false otherwise
 */
export function verifyVPAgainstPD(
  presentationDefinition: PresentationDefinitionV2,
  verifiablePresentation: any
): boolean {
  console.log('🔐 Complete PEX verification');
  console.log('='.repeat(60));

  try {
    const evaluationResults = evaluateVPAgainstPD(
      presentationDefinition,
      verifiablePresentation
    );

    console.log('='.repeat(60));

    if (evaluationResults.value) {
      console.log('✅ VP verification successful');
      return true;
    } else {
      console.log('❌ VP verification failed');
      return false;
    }
  } catch (error: any) {
    console.error('❌ Verification error:', error.message);
    return false;
  }
}

/**
 * Validate a Presentation Definition
 *
 * Check if a PD is well-formed before using it
 *
 * @param presentationDefinition - PD to validate
 * @returns Validation result
 */
export function validatePresentationDefinition(
  presentationDefinition: PresentationDefinitionV2
): { valid: boolean; errors?: string[] } {
  console.log('🔍 Validating Presentation Definition');

  try {
    const validation = pex.validateDefinition(presentationDefinition);

    if (validation.length === 0) {
      console.log('   ✅ PD is valid');
      return { valid: true };
    } else {
      console.log('   ❌ PD validation errors:');
      validation.forEach(err => {
        console.log(`      - ${err.message}`);
      });
      return {
        valid: false,
        errors: validation.map(e => e.message)
      };
    }
  } catch (error: any) {
    console.error('   ❌ Validation error:', error.message);
    return { valid: false, errors: [error.message] };
  }
}

// Export for use in other modules
export default {
  selectCredentialsForPD,
  createVPFromSelectedCredentials,
  evaluateVPAgainstPD,
  createVPFromPD,
  verifyVPAgainstPD,
  validatePresentationDefinition
};
