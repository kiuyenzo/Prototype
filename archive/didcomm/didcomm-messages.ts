#!/usr/bin/env ts-node
/**
 * DIDComm Message Type Definitions for VP Exchange
 *
 * This module defines the message types used in the mutual authentication flow
 * between Network Functions using Verifiable Presentations and Presentation Exchange.
 *
 * Flow:
 * 1. VP_AUTH_REQUEST: NF-A requests authentication from NF-B with PD_A
 * 2. VP_WITH_PD: NF-B responds with VP_B matching PD_A, plus PD_B for NF-A
 * 3. VP_RESPONSE: NF-A responds with VP_A matching PD_B
 * 4. AUTH_CONFIRMATION: NF-B confirms mutual authentication succeeded
 * 5. SERVICE_REQUEST/RESPONSE: Authorized communication after mutual auth
 */

import { PresentationDefinition } from '../shared/presentation-definitions.js';

/**
 * DIDComm Message Protocol URIs
 * Based on DIDComm Messaging v2 and Present Proof Protocol v3
 */
export const DIDCOMM_MESSAGE_TYPES = {
  // Phase 1: Initial Authentication Request
  VP_AUTH_REQUEST: 'https://didcomm.org/present-proof/3.0/request-presentation',

  // Phase 2: VP Exchange with Presentation Definitions
  VP_WITH_PD: 'https://didcomm.org/present-proof/3.0/presentation-with-definition',
  VP_RESPONSE: 'https://didcomm.org/present-proof/3.0/presentation',

  // Phase 3: Mutual Authentication Confirmation
  AUTH_CONFIRMATION: 'https://didcomm.org/present-proof/3.0/ack',

  // Phase 3: Authorized Service Communication
  SERVICE_REQUEST: 'https://didcomm.org/service/1.0/request',
  SERVICE_RESPONSE: 'https://didcomm.org/service/1.0/response',

  // Error handling
  ERROR: 'https://didcomm.org/present-proof/3.0/problem-report'
} as const;

/**
 * Base DIDComm Message structure
 */
export interface DIDCommMessage {
  type: string;
  id: string;
  from?: string;
  to?: string[];
  created_time?: number;
  expires_time?: number;
  body: Record<string, any>;
  attachments?: any[];
}

/**
 * Phase 1: VP Authentication Request Message
 *
 * Sent by NF-A to NF-B to initiate mutual authentication.
 * Contains the Presentation Definition that NF-B must satisfy.
 */
export interface VPAuthRequestMessage extends DIDCommMessage {
  type: typeof DIDCOMM_MESSAGE_TYPES.VP_AUTH_REQUEST;
  body: {
    comment?: string;
    presentation_definition: PresentationDefinition;
  };
}

/**
 * Phase 2: VP with Presentation Definition Message
 *
 * Sent by NF-B to NF-A in response to VP_AUTH_REQUEST.
 * Contains:
 * - VP_B: Verifiable Presentation matching PD_A
 * - PD_B: Presentation Definition for NF-A to satisfy
 */
export interface VPWithPDMessage extends DIDCommMessage {
  type: typeof DIDCOMM_MESSAGE_TYPES.VP_WITH_PD;
  body: {
    verifiable_presentation: any; // VP in JWT or JSON-LD format
    presentation_definition: PresentationDefinition;
    comment?: string;
  };
}

/**
 * Phase 2: VP Response Message
 *
 * Sent by NF-A to NF-B after verifying VP_B.
 * Contains VP_A matching PD_B.
 */
export interface VPResponseMessage extends DIDCommMessage {
  type: typeof DIDCOMM_MESSAGE_TYPES.VP_RESPONSE;
  body: {
    verifiable_presentation: any; // VP in JWT or JSON-LD format
    comment?: string;
  };
}

/**
 * Phase 3: Authentication Confirmation Message
 *
 * Sent by NF-B to NF-A after successful VP verification.
 * Confirms mutual authentication is complete.
 */
export interface AuthConfirmationMessage extends DIDCommMessage {
  type: typeof DIDCOMM_MESSAGE_TYPES.AUTH_CONFIRMATION;
  body: {
    status: 'OK' | 'REJECTED';
    comment?: string;
    session_token?: string; // Optional session token for subsequent requests
  };
}

/**
 * Phase 3: Service Request Message
 *
 * Sent after successful mutual authentication.
 * Contains the actual service request payload.
 */
export interface ServiceRequestMessage extends DIDCommMessage {
  type: typeof DIDCOMM_MESSAGE_TYPES.SERVICE_REQUEST;
  body: {
    service: string; // Service name (e.g., 'credential-issuance', 'data-query')
    action: string; // Action to perform
    params?: Record<string, any>; // Service-specific parameters
    session_token?: string; // Session token from AUTH_CONFIRMATION
  };
}

/**
 * Phase 3: Service Response Message
 *
 * Response to SERVICE_REQUEST.
 */
export interface ServiceResponseMessage extends DIDCommMessage {
  type: typeof DIDCOMM_MESSAGE_TYPES.SERVICE_RESPONSE;
  body: {
    status: 'success' | 'error';
    data?: any; // Service response data
    error?: string; // Error message if status is 'error'
  };
}

/**
 * Error/Problem Report Message
 *
 * Sent when an error occurs during the VP exchange.
 */
export interface ErrorMessage extends DIDCommMessage {
  type: typeof DIDCOMM_MESSAGE_TYPES.ERROR;
  body: {
    code: string; // Error code
    comment: string; // Human-readable error description
    escalate_to?: string; // Optional DID to escalate the issue to
  };
}

/**
 * Union type of all message types
 */
export type DIDCommVPMessage =
  | VPAuthRequestMessage
  | VPWithPDMessage
  | VPResponseMessage
  | AuthConfirmationMessage
  | ServiceRequestMessage
  | ServiceResponseMessage
  | ErrorMessage;

/**
 * Helper function to create a VP Authentication Request message
 */
export function createVPAuthRequest(
  from: string,
  to: string,
  presentationDefinition: PresentationDefinition,
  comment?: string
): VPAuthRequestMessage {
  return {
    type: DIDCOMM_MESSAGE_TYPES.VP_AUTH_REQUEST,
    id: generateMessageId(),
    from,
    to: [to],
    created_time: Date.now(),
    body: {
      presentation_definition: presentationDefinition,
      comment
    }
  };
}

/**
 * Helper function to create a VP with PD message
 */
export function createVPWithPD(
  from: string,
  to: string,
  verifiablePresentation: any,
  presentationDefinition: PresentationDefinition,
  comment?: string
): VPWithPDMessage {
  return {
    type: DIDCOMM_MESSAGE_TYPES.VP_WITH_PD,
    id: generateMessageId(),
    from,
    to: [to],
    created_time: Date.now(),
    body: {
      verifiable_presentation: verifiablePresentation,
      presentation_definition: presentationDefinition,
      comment
    }
  };
}

/**
 * Helper function to create a VP Response message
 */
export function createVPResponse(
  from: string,
  to: string,
  verifiablePresentation: any,
  comment?: string
): VPResponseMessage {
  return {
    type: DIDCOMM_MESSAGE_TYPES.VP_RESPONSE,
    id: generateMessageId(),
    from,
    to: [to],
    created_time: Date.now(),
    body: {
      verifiable_presentation: verifiablePresentation,
      comment
    }
  };
}

/**
 * Helper function to create an Authentication Confirmation message
 */
export function createAuthConfirmation(
  from: string,
  to: string,
  status: 'OK' | 'REJECTED',
  sessionToken?: string,
  comment?: string
): AuthConfirmationMessage {
  return {
    type: DIDCOMM_MESSAGE_TYPES.AUTH_CONFIRMATION,
    id: generateMessageId(),
    from,
    to: [to],
    created_time: Date.now(),
    body: {
      status,
      session_token: sessionToken,
      comment
    }
  };
}

/**
 * Helper function to create a Service Request message
 */
export function createServiceRequest(
  from: string,
  to: string,
  service: string,
  action: string,
  params?: Record<string, any>,
  sessionToken?: string
): ServiceRequestMessage {
  return {
    type: DIDCOMM_MESSAGE_TYPES.SERVICE_REQUEST,
    id: generateMessageId(),
    from,
    to: [to],
    created_time: Date.now(),
    body: {
      service,
      action,
      params,
      session_token: sessionToken
    }
  };
}

/**
 * Helper function to create a Service Response message
 */
export function createServiceResponse(
  from: string,
  to: string,
  status: 'success' | 'error',
  data?: any,
  error?: string
): ServiceResponseMessage {
  return {
    type: DIDCOMM_MESSAGE_TYPES.SERVICE_RESPONSE,
    id: generateMessageId(),
    from,
    to: [to],
    created_time: Date.now(),
    body: {
      status,
      data,
      error
    }
  };
}

/**
 * Helper function to create an Error message
 */
export function createErrorMessage(
  from: string,
  to: string,
  code: string,
  comment: string
): ErrorMessage {
  return {
    type: DIDCOMM_MESSAGE_TYPES.ERROR,
    id: generateMessageId(),
    from,
    to: [to],
    created_time: Date.now(),
    body: {
      code,
      comment
    }
  };
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}
