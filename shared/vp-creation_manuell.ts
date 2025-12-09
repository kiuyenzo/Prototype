#!/usr/bin/env ts-node
/**
 * Verifiable Presentation Creation with Presentation Exchange
 *
 * This module handles:
 * 1. Creating VPs from VCs based on Presentation Definitions
 * 2. Verifying VPs against Presentation Definitions
 * 3. Selective Disclosure of credentials
 */

import { createAgent, IAgent, IDataStore, IDIDManager, IKeyManager, IResolver } from '@veramo/core';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import { CredentialPlugin, ICredentialIssuer, ICredentialVerifier } from '@veramo/credential-w3c';
import { SelectiveDisclosure } from '@veramo/selective-disclosure';
import { Resolver } from 'did-resolver';
import { getResolver as webDidResolver } from 'web-did-resolver';
import { PresentationDefinition } from './presentation-definitions.js';

// Agent type with all required plugins
type Agent = IAgent<
  IDIDManager &
  IKeyManager &
  IDataStore &
  IResolver &
  ICredentialIssuer &
  ICredentialVerifier &
  SelectiveDisclosure
>;

/**
 * Create a Verifiable Presentation from credentials
 *
 * @param agent - Veramo agent instance
 * @param holderDid - DID of the holder creating the VP
 * @param credentials - Array of Verifiable Credentials to include
 * @param presentationDefinition - Optional PD for selective disclosure
 * @returns Verifiable Presentation
 */
export async function createVerifiablePresentation(
  agent: Agent,
  holderDid: string,
  credentials: any[],
  presentationDefinition?: PresentationDefinition
): Promise<any> {
  try {
    console.log(`📝 Creating VP for holder: ${holderDid}`);
    console.log(`   Including ${credentials.length} credential(s)`);

    // Create the presentation
    const verifiablePresentation = await agent.createVerifiablePresentation({
      presentation: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        holder: holderDid,
        verifiableCredential: credentials
      },
      proofFormat: 'jwt',
      save: false
    });

    console.log('✅ VP created successfully');
    console.log(`   VP ID: ${verifiablePresentation.id || 'N/A'}`);

    return verifiablePresentation;
  } catch (error: any) {
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
export async function verifyVerifiablePresentation(
  agent: Agent,
  presentation: any
): Promise<{ verified: boolean; error?: any }> {
  try {
    console.log('🔍 Verifying Verifiable Presentation...');

    const result = await agent.verifyPresentation({
      presentation: presentation
    });

    if (result.verified) {
      console.log('✅ VP verified successfully');
    } else {
      console.log('❌ VP verification failed');
      console.log('   Error:', result.error);
    }

    return result;
  } catch (error: any) {
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
export function selectCredentialsForPD(
  credentials: any[],
  presentationDefinition: PresentationDefinition
): any[] {
  console.log('🔍 Selecting credentials for PD:', presentationDefinition.id);

  const matchingCredentials: any[] = [];

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
function matchesInputDescriptor(credential: any, descriptor: any): boolean {
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
function matchesField(credential: any, field: any): boolean {
  for (const path of field.path) {
    const value = getValueByPath(credential, path);

    if (field.filter) {
      if (field.filter.const && value !== field.filter.const) {
        return false;
      }
      if (field.filter.pattern) {
        const regex = new RegExp(field.filter.pattern);
        if (!regex.test(String(value))) {
          return false;
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
function getValueByPath(obj: any, path: string): any {
  // Remove leading "$." from JSONPath
  const cleanPath = path.replace(/^\$\./, '');
  const parts = cleanPath.split('.');

  let current = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
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
export async function createVPFromPD(
  agent: Agent,
  holderDid: string,
  availableCredentials: any[],
  presentationDefinition: PresentationDefinition
): Promise<any> {
  console.log('📋 Creating VP from Presentation Definition');

  // Step 1: Select credentials that match PD
  const selectedCredentials = selectCredentialsForPD(
    availableCredentials,
    presentationDefinition
  );

  if (selectedCredentials.length === 0) {
    throw new Error('No credentials match the Presentation Definition');
  }

  // Step 2: Create VP with selected credentials
  const vp = await createVerifiablePresentation(
    agent,
    holderDid,
    selectedCredentials,
    presentationDefinition
  );

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
export async function verifyVPAgainstPD(
  agent: Agent,
  presentation: any,
  presentationDefinition: PresentationDefinition
): Promise<{ verified: boolean; error?: any }> {
  console.log('🔍 Verifying VP against Presentation Definition');

  // Step 1: Verify the VP cryptographically
  const cryptoResult = await verifyVerifiablePresentation(agent, presentation);

  if (!cryptoResult.verified) {
    return cryptoResult;
  }

  // Step 2: Check if VP satisfies the PD
  const credentials = presentation.verifiableCredential || [];
  const selectedCredentials = selectCredentialsForPD(
    credentials,
    presentationDefinition
  );

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
