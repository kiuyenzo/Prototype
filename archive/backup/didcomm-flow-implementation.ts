/**
 * DIDComm Mutual Authentication Flow Implementation
 *
 * Verwendet Veramo SDR (Selective Disclosure Request) für Presentation Exchange
 *
 * Phase 1: Initial Request (NF_A → NF_B)
 * Phase 2: Mutual Authentication (VP Exchange)
 * Phase 3: Authorized Service Communication
 */

import { IAgent, IDIDManager, IKeyManager, IDataStore, IMessageHandler } from '@veramo/core'
import { ICredentialPlugin, ISelectiveDisclosure } from '@veramo/credential-w3c'
import { IDIDComm } from '@veramo/did-comm'

// Session State Management
interface SessionState {
  sessionId: string
  peerDID: string
  status: 'pending' | 'authenticating' | 'authorized' | 'expired'
  createdAt: Date
  lastActivity: Date
  vpReceived?: any
  sdrSent?: any
  sdrReceived?: any
}

const sessions = new Map<string, SessionState>()

// ============================================================================
// NF_A: Initiator Logic
// ============================================================================

/**
 * Phase 1: NF_A initiiert Service Request
 *
 * Flow:
 * 1. NF_A (App) ruft diese Funktion mit Service Request
 * 2. Erstellt SDR (Selective Disclosure Request) mit Presentation Definition
 * 3. Packt als DIDComm Message (authcrypt)
 * 4. Sendet an NF_B
 */
export async function initiateServiceRequest(
  agent: IAgent,
  nfBDID: string,
  serviceRequest: any
): Promise<{ sessionId: string; message: string }> {

  console.log('[NF_A] Phase 1: Initiating service request to', nfBDID)

  // 1. Resolve DID Document of NF_B
  const didDocument = await agent.resolveDid({ didUrl: nfBDID })
  console.log('[NF_A] Resolved DID Document:', didDocument.didDocument?.id)

  // 2. Eigene DID holen
  const myIdentifiers = await agent.didManagerFind()
  const myDID = myIdentifiers[0].did

  // 3. Create Selective Disclosure Request (Presentation Definition)
  // Dies fordert spezifische Claims von NF_B an
  const sdr = await agent.createSelectiveDisclosureRequest({
    data: {
      issuer: myDID,
      subject: nfBDID,
      tag: 'nf-authentication-request',
      claims: [
        {
          claimType: 'VerifiableCredential',
          claimValue: 'NetworkFunctionCredential',
          issuers: [
            { did: 'did:web:issuer.example.com', url: 'https://issuer.example.com/.well-known/did.json' }
          ],
          reason: 'Network Function Authentication Required',
          essential: true
        },
        {
          claimType: 'role',
          reason: 'Verify NF role and permissions',
          essential: true
        },
        {
          claimType: 'capabilities',
          reason: 'Verify NF capabilities',
          essential: false
        }
      ]
    }
  })

  console.log('[NF_A] Created SDR:', sdr.jwt)

  // 4. Session erstellen
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  sessions.set(sessionId, {
    sessionId,
    peerDID: nfBDID,
    status: 'pending',
    createdAt: new Date(),
    lastActivity: new Date(),
    sdrSent: sdr
  })

  // 5. Pack DIDComm Message mit SDR + Service Request
  const message = await agent.packDIDCommMessage({
    packing: 'authcrypt', // E2E Verschlüsselung
    message: {
      type: 'https://didcomm.org/present-proof/3.0/request-presentation',
      from: myDID,
      to: [nfBDID],
      id: sessionId,
      body: {
        goal_code: 'nf-authentication',
        will_confirm: true,
        formats: [{
          attach_id: 'sdr-request',
          format: 'dif/presentation-exchange/definitions@v1.0'
        }],
        attachments: [{
          id: 'sdr-request',
          media_type: 'application/json',
          data: {
            json: sdr
          }
        }, {
          id: 'service-request',
          media_type: 'application/json',
          data: {
            json: serviceRequest
          }
        }]
      }
    }
  })

  console.log('[NF_A] Packed DIDComm message (authcrypt)')

  // 6. Send via DIDComm (über Istio mTLS Transport)
  const result = await agent.sendDIDCommMessage({
    messageId: sessionId,
    packedMessage: message,
    recipientDidUrl: nfBDID
  })

  console.log('[NF_A] Sent DIDComm message to NF_B')

  return { sessionId, message: result.id }
}

/**
 * Phase 2a: NF_A empfängt VP_B + PD_B von NF_B
 *
 * Flow:
 * 1. Empfange DIDComm Message von NF_B
 * 2. Unpack Message
 * 3. Validiere VP_B gegen ursprünglichen SDR
 * 4. Resolve Issuer DID
 * 5. Verify VP_B Signatur
 * 6. Erstelle eigenen VP_A basierend auf PD_B
 * 7. Sende VP_A zurück
 */
export async function handlePresentationFromNFB(
  agent: IAgent,
  packedMessage: any
): Promise<void> {

  console.log('[NF_A] Phase 2a: Received presentation from NF_B')

  // 1. Unpack DIDComm Message
  const message = await agent.unpackDIDCommMessage({
    message: packedMessage
  })

  const sessionId = message.id
  const session = sessions.get(sessionId)

  if (!session) {
    throw new Error('Session not found')
  }

  session.status = 'authenticating'
  session.lastActivity = new Date()

  // 2. Extract VP_B und PD_B
  const vpB = message.data.attachments.find((a: any) => a.id === 'presentation')?.data.json
  const pdB = message.data.attachments.find((a: any) => a.id === 'sdr-request')?.data.json

  console.log('[NF_A] Received VP_B from:', message.from)

  // 3. Validate VP_B against original SDR
  const validationResult = await agent.validatePresentationAgainstSdr({
    presentation: vpB,
    sdr: session.sdrSent
  })

  if (!validationResult.valid) {
    console.error('[NF_A] VP_B validation failed:', validationResult.error)
    session.status = 'expired'
    throw new Error('Presentation validation failed')
  }

  console.log('[NF_A] VP_B validation successful')

  // 4. Resolve Issuer DID from VP_B
  const issuerDID = vpB.verifiableCredential[0].issuer.id || vpB.verifiableCredential[0].issuer
  const issuerDidDoc = await agent.resolveDid({ didUrl: issuerDID })

  console.log('[NF_A] Resolved Issuer DID:', issuerDidDoc.didDocument?.id)

  // 5. Verify VP_B Signature
  const verifyResult = await agent.verifyPresentation({
    presentation: vpB,
    fetchRemoteContexts: true
  })

  if (!verifyResult.verified) {
    console.error('[NF_A] VP_B verification failed')
    session.status = 'expired'
    throw new Error('VP_B verification failed')
  }

  console.log('[NF_A] VP_B verified successfully')
  session.vpReceived = vpB

  // 6. Create VP_A based on PD_B (SDR from NF_B)
  const myIdentifiers = await agent.didManagerFind()
  const myDID = myIdentifiers[0].did

  // Hole passende VCs für den SDR von NF_B
  const credentialsForSdr = await agent.getVerifiableCredentialsForSdr({
    sdr: pdB
  })

  console.log('[NF_A] Found', credentialsForSdr.length, 'credentials matching PD_B')

  // Erstelle VP_A
  const vpA = await agent.createVerifiablePresentation({
    presentation: {
      holder: myDID,
      verifiableCredential: credentialsForSdr,
      type: ['VerifiablePresentation']
    },
    proofFormat: 'jwt',
    challenge: pdB.challenge,
    domain: pdB.domain
  })

  console.log('[NF_A] Created VP_A')

  // 7. Pack und send VP_A
  const responseMessage = await agent.packDIDCommMessage({
    packing: 'authcrypt',
    message: {
      type: 'https://didcomm.org/present-proof/3.0/presentation',
      from: myDID,
      to: [message.from],
      id: `${sessionId}-response`,
      thid: sessionId, // thread ID
      body: {
        goal_code: 'nf-authentication-response',
        formats: [{
          attach_id: 'presentation',
          format: 'dif/presentation-exchange/submission@v1.0'
        }],
        attachments: [{
          id: 'presentation',
          media_type: 'application/json',
          data: {
            json: vpA
          }
        }]
      }
    }
  })

  await agent.sendDIDCommMessage({
    messageId: `${sessionId}-response`,
    packedMessage: responseMessage,
    recipientDidUrl: message.from
  })

  console.log('[NF_A] Sent VP_A to NF_B')
}

/**
 * Phase 3: NF_A empfängt "Authorized" Bestätigung von NF_B
 * und kann nun Service Requests senden
 */
export async function handleAuthorizedConfirmation(
  agent: IAgent,
  packedMessage: any
): Promise<void> {

  console.log('[NF_A] Phase 3: Received authorized confirmation')

  const message = await agent.unpackDIDCommMessage({
    message: packedMessage
  })

  const sessionId = message.thid
  const session = sessions.get(sessionId)

  if (!session) {
    throw new Error('Session not found')
  }

  session.status = 'authorized'
  session.lastActivity = new Date()

  console.log('[NF_A] Session', sessionId, 'is now AUTHORIZED')
  console.log('[NF_A] Ready to send service requests to', session.peerDID)
}

/**
 * Send Service Request (nur wenn authorized)
 */
export async function sendServiceRequest(
  agent: IAgent,
  sessionId: string,
  serviceRequest: any
): Promise<any> {

  const session = sessions.get(sessionId)

  if (!session || session.status !== 'authorized') {
    throw new Error('Session not authorized')
  }

  console.log('[NF_A] Sending service request via authorized session')

  const myIdentifiers = await agent.didManagerFind()
  const myDID = myIdentifiers[0].did

  const message = await agent.packDIDCommMessage({
    packing: 'authcrypt',
    message: {
      type: 'https://example.com/nf-service-request',
      from: myDID,
      to: [session.peerDID],
      id: `${sessionId}-service-${Date.now()}`,
      thid: sessionId,
      body: serviceRequest
    }
  })

  const result = await agent.sendDIDCommMessage({
    messageId: message.id,
    packedMessage: message,
    recipientDidUrl: session.peerDID
  })

  session.lastActivity = new Date()

  console.log('[NF_A] Service request sent')
  return result
}

// ============================================================================
// NF_B: Responder Logic
// ============================================================================

/**
 * Phase 1: NF_B empfängt Initial Request von NF_A
 *
 * Flow:
 * 1. Empfange DIDComm Message
 * 2. Unpack und extrahiere SDR (PD_A)
 * 3. Validiere Request
 * 4. Hole passende VCs für PD_A
 * 5. Erstelle VP_B
 * 6. Erstelle eigenen SDR (PD_B) für NF_A
 * 7. Sende VP_B + PD_B zurück
 */
export async function handleInitialRequestFromNFA(
  agent: IAgent,
  packedMessage: any
): Promise<void> {

  console.log('[NF_B] Phase 1: Received initial request from NF_A')

  // 1. Unpack DIDComm Message
  const message = await agent.unpackDIDCommMessage({
    message: packedMessage
  })

  const sessionId = message.id
  const sdrFromA = message.data.attachments.find((a: any) => a.id === 'sdr-request')?.data.json
  const serviceRequest = message.data.attachments.find((a: any) => a.id === 'service-request')?.data.json

  console.log('[NF_B] Received SDR from NF_A:', message.from)

  // 2. Session erstellen
  sessions.set(sessionId, {
    sessionId,
    peerDID: message.from,
    status: 'authenticating',
    createdAt: new Date(),
    lastActivity: new Date(),
    sdrReceived: sdrFromA
  })

  // 3. Hole VCs die PD_A erfüllen
  const credentialsForSdr = await agent.getVerifiableCredentialsForSdr({
    sdr: sdrFromA
  })

  console.log('[NF_B] Found', credentialsForSdr.length, 'credentials matching PD_A')

  if (credentialsForSdr.length === 0) {
    throw new Error('No credentials available to satisfy PD_A')
  }

  // 4. Erstelle VP_B
  const myIdentifiers = await agent.didManagerFind()
  const myDID = myIdentifiers[0].did

  const vpB = await agent.createVerifiablePresentation({
    presentation: {
      holder: myDID,
      verifiableCredential: credentialsForSdr,
      type: ['VerifiablePresentation']
    },
    proofFormat: 'jwt',
    challenge: sdrFromA.challenge,
    domain: sdrFromA.domain
  })

  console.log('[NF_B] Created VP_B')

  // 5. Erstelle eigenen SDR (PD_B) für NF_A
  const sdrForA = await agent.createSelectiveDisclosureRequest({
    data: {
      issuer: myDID,
      subject: message.from,
      tag: 'nf-authentication-response',
      claims: [
        {
          claimType: 'VerifiableCredential',
          claimValue: 'NetworkFunctionCredential',
          issuers: [
            { did: 'did:web:issuer.example.com', url: 'https://issuer.example.com/.well-known/did.json' }
          ],
          reason: 'Mutual Authentication Required',
          essential: true
        },
        {
          claimType: 'role',
          reason: 'Verify requester role',
          essential: true
        }
      ]
    }
  })

  console.log('[NF_B] Created SDR for NF_A')

  // 6. Pack und send VP_B + PD_B
  const responseMessage = await agent.packDIDCommMessage({
    packing: 'authcrypt',
    message: {
      type: 'https://didcomm.org/present-proof/3.0/request-presentation',
      from: myDID,
      to: [message.from],
      id: `${sessionId}-mutual-auth`,
      thid: sessionId,
      body: {
        goal_code: 'nf-mutual-authentication',
        will_confirm: true,
        formats: [{
          attach_id: 'presentation',
          format: 'dif/presentation-exchange/submission@v1.0'
        }, {
          attach_id: 'sdr-request',
          format: 'dif/presentation-exchange/definitions@v1.0'
        }],
        attachments: [{
          id: 'presentation',
          media_type: 'application/json',
          data: {
            json: vpB
          }
        }, {
          id: 'sdr-request',
          media_type: 'application/json',
          data: {
            json: sdrForA
          }
        }]
      }
    }
  })

  await agent.sendDIDCommMessage({
    messageId: `${sessionId}-mutual-auth`,
    packedMessage: responseMessage,
    recipientDidUrl: message.from
  })

  console.log('[NF_B] Sent VP_B + PD_B to NF_A')
}

/**
 * Phase 2b: NF_B empfängt VP_A von NF_A
 *
 * Flow:
 * 1. Empfange VP_A
 * 2. Validiere gegen eigenen SDR (PD_B)
 * 3. Verify VP_A Signatur
 * 4. Markiere Session als "authorized"
 * 5. Sende Bestätigung
 */
export async function handlePresentationFromNFA(
  agent: IAgent,
  packedMessage: any
): Promise<void> {

  console.log('[NF_B] Phase 2b: Received VP_A from NF_A')

  // 1. Unpack
  const message = await agent.unpackDIDCommMessage({
    message: packedMessage
  })

  const sessionId = message.thid
  const session = sessions.get(sessionId)

  if (!session) {
    throw new Error('Session not found')
  }

  const vpA = message.data.attachments.find((a: any) => a.id === 'presentation')?.data.json

  // 2. Validate VP_A against our SDR (PD_B)
  const validationResult = await agent.validatePresentationAgainstSdr({
    presentation: vpA,
    sdr: session.sdrSent
  })

  if (!validationResult.valid) {
    console.error('[NF_B] VP_A validation failed')
    session.status = 'expired'
    throw new Error('VP_A validation failed')
  }

  console.log('[NF_B] VP_A validation successful')

  // 3. Resolve Issuer DID
  const issuerDID = vpA.verifiableCredential[0].issuer.id || vpA.verifiableCredential[0].issuer
  const issuerDidDoc = await agent.resolveDid({ didUrl: issuerDID })

  console.log('[NF_B] Resolved Issuer DID:', issuerDidDoc.didDocument?.id)

  // 4. Verify VP_A
  const verifyResult = await agent.verifyPresentation({
    presentation: vpA,
    fetchRemoteContexts: true
  })

  if (!verifyResult.verified) {
    console.error('[NF_B] VP_A verification failed')
    session.status = 'expired'
    throw new Error('VP_A verification failed')
  }

  console.log('[NF_B] VP_A verified successfully')
  console.log('[NF_B] MUTUAL AUTHENTICATION COMPLETE')

  // 5. Mark session as authorized
  session.status = 'authorized'
  session.lastActivity = new Date()
  session.vpReceived = vpA

  // 6. Send "Authorized" confirmation
  const myIdentifiers = await agent.didManagerFind()
  const myDID = myIdentifiers[0].did

  const confirmMessage = await agent.packDIDCommMessage({
    packing: 'authcrypt',
    message: {
      type: 'https://didcomm.org/present-proof/3.0/ack',
      from: myDID,
      to: [message.from],
      id: `${sessionId}-authorized`,
      thid: sessionId,
      body: {
        status: 'authorized',
        message: 'Mutual authentication successful'
      }
    }
  })

  await agent.sendDIDCommMessage({
    messageId: `${sessionId}-authorized`,
    packedMessage: confirmMessage,
    recipientDidUrl: message.from
  })

  console.log('[NF_B] Sent authorized confirmation to NF_A')
}

/**
 * Phase 3: NF_B empfängt Service Request von NF_A
 *
 * Flow:
 * 1. Prüfe ob Session authorized ist
 * 2. Unpack Service Request
 * 3. Rufe NF_B Business Logic
 * 4. Sende Response zurück
 */
export async function handleServiceRequest(
  agent: IAgent,
  packedMessage: any,
  nfBusinessLogic: (request: any) => Promise<any>
): Promise<void> {

  console.log('[NF_B] Phase 3: Received service request')

  // 1. Unpack
  const message = await agent.unpackDIDCommMessage({
    message: packedMessage
  })

  const sessionId = message.thid
  const session = sessions.get(sessionId)

  if (!session || session.status !== 'authorized') {
    throw new Error('Session not authorized')
  }

  console.log('[NF_B] Session is authorized, processing request')

  // 2. Extract service request
  const serviceRequest = message.body

  // 3. Call NF_B business logic
  const serviceResponse = await nfBusinessLogic(serviceRequest)

  console.log('[NF_B] Business logic executed, sending response')

  // 4. Pack und send response
  const myIdentifiers = await agent.didManagerFind()
  const myDID = myIdentifiers[0].did

  const responseMessage = await agent.packDIDCommMessage({
    packing: 'authcrypt',
    message: {
      type: 'https://example.com/nf-service-response',
      from: myDID,
      to: [message.from],
      id: `${message.id}-response`,
      thid: sessionId,
      body: serviceResponse
    }
  })

  await agent.sendDIDCommMessage({
    messageId: responseMessage.id,
    packedMessage: responseMessage,
    recipientDidUrl: message.from
  })

  session.lastActivity = new Date()

  console.log('[NF_B] Service response sent')
}

// ============================================================================
// Message Router (für beide NFs)
// ============================================================================

/**
 * Haupt-Message-Handler der eingehende DIDComm Messages routet
 */
export async function handleIncomingDIDCommMessage(
  agent: IAgent,
  packedMessage: any,
  isNFA: boolean,
  nfBusinessLogic?: (request: any) => Promise<any>
): Promise<void> {

  // Unpack um Type zu bestimmen
  const message = await agent.unpackDIDCommMessage({
    message: packedMessage
  })

  console.log(`[${isNFA ? 'NF_A' : 'NF_B'}] Received message type:`, message.type)

  switch (message.type) {
    case 'https://didcomm.org/present-proof/3.0/request-presentation':
      if (isNFA) {
        // NF_A empfängt VP_B + PD_B
        await handlePresentationFromNFB(agent, packedMessage)
      } else {
        // NF_B empfängt Initial Request
        await handleInitialRequestFromNFA(agent, packedMessage)
      }
      break

    case 'https://didcomm.org/present-proof/3.0/presentation':
      if (!isNFA) {
        // NF_B empfängt VP_A
        await handlePresentationFromNFA(agent, packedMessage)
      }
      break

    case 'https://didcomm.org/present-proof/3.0/ack':
      if (isNFA) {
        // NF_A empfängt authorized confirmation
        await handleAuthorizedConfirmation(agent, packedMessage)
      }
      break

    case 'https://example.com/nf-service-request':
      if (!isNFA && nfBusinessLogic) {
        // NF_B empfängt service request
        await handleServiceRequest(agent, packedMessage, nfBusinessLogic)
      }
      break

    case 'https://example.com/nf-service-response':
      if (isNFA) {
        // NF_A empfängt service response
        console.log('[NF_A] Received service response:', message.body)
        // Weiterleitung an NF_A App
      }
      break

    default:
      console.warn('Unknown message type:', message.type)
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Session Cleanup (löscht abgelaufene Sessions)
 */
export function cleanupExpiredSessions(maxAge: number = 3600000): void {
  const now = new Date()

  for (const [sessionId, session] of sessions.entries()) {
    const age = now.getTime() - session.lastActivity.getTime()

    if (age > maxAge) {
      console.log('Cleaning up expired session:', sessionId)
      sessions.delete(sessionId)
    }
  }
}

/**
 * Get Session Status
 */
export function getSessionStatus(sessionId: string): SessionState | undefined {
  return sessions.get(sessionId)
}
