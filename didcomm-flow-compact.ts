/**
 * KOMPAKTE DIDComm Mutual Authentication Flow
 *
 * Vereinfachungen:
 * - DIDs sind öffentlich (GitHub) → kein explizites Resolve nötig
 * - VCs sind in DataStore → Veramo findet sie automatisch
 * - SDR wird vereinfacht (Veramo macht das meiste automatisch)
 */

import { IAgent } from '@veramo/core'

// Packing Mode aus Environment
const PACKING = process.env.DIDCOMM_PACKING_MODE === 'encrypted' ? 'authcrypt' : 'jws'

// Session State (minimal)
interface Session {
  id: string
  peer: string
  status: 'pending' | 'authorized'
  created: Date
}

const sessions = new Map<string, Session>()

// ============================================================================
// Shared Helpers
// ============================================================================

async function getMyDID(agent: IAgent): Promise<string> {
  const identifiers = await agent.didManagerFind()
  return identifiers[0].did
}

async function packAndSend(agent: IAgent, type: string, from: string, to: string, body: any, id?: string, thid?: string) {
  const message = await agent.packDIDCommMessage({
    packing: PACKING,
    message: { type, from, to: [to], id: id || `msg-${Date.now()}`, thid, body }
  })

  await agent.sendDIDCommMessage({
    messageId: message.id || id,
    packedMessage: message,
    recipientDidUrl: to
  })

  return message.id
}

// ============================================================================
// NF_A: Initiator (Compact)
// ============================================================================

/**
 * Phase 1: NF_A → NF_B Initial Request
 *
 * Vereinfacht: Keine explizite SDR-Erstellung, Veramo macht VP automatisch
 */
export async function initiateRequest(
  agent: IAgent,
  peerDID: string,
  serviceRequest: any
): Promise<string> {
  const myDID = await getMyDID(agent)
  const sessionId = `session-${Date.now()}`

  // Session erstellen
  sessions.set(sessionId, {
    id: sessionId,
    peer: peerDID,
    status: 'pending',
    created: new Date()
  })

  // Hole eigene VCs aus DataStore (Veramo findet sie automatisch)
  const credentials = await agent.dataStoreORMGetVerifiableCredentials({
    where: [{ column: 'subjectDid', value: [myDID] }]
  })

  // Erstelle VP mit allen eigenen Credentials
  const vp = await agent.createVerifiablePresentation({
    presentation: {
      holder: myDID,
      verifiableCredential: credentials.map(c => c.verifiableCredential),
      type: ['VerifiablePresentation']
    },
    proofFormat: 'jwt'
  })

  // Sende Request mit VP + Service Request
  await packAndSend(
    agent,
    'https://didcomm.org/present-proof/3.0/request-presentation',
    myDID,
    peerDID,
    {
      presentation: vp,
      serviceRequest
    },
    sessionId
  )

  console.log(`[NF_A] Sent request to ${peerDID}`)
  return sessionId
}

/**
 * Phase 2: NF_A empfängt VP_B + sendet VP_A
 */
export async function handlePeerPresentation(
  agent: IAgent,
  message: any
): Promise<void> {
  const myDID = await getMyDID(agent)
  const sessionId = message.thid || message.id
  const session = sessions.get(sessionId)

  if (!session) throw new Error('Session not found')

  // Verify VP_B
  const vpB = message.body.presentation
  const verified = await agent.verifyPresentation({
    presentation: vpB,
    fetchRemoteContexts: true
  })

  if (!verified.verified) {
    throw new Error('VP verification failed')
  }

  console.log('[NF_A] VP_B verified ✓')

  // Hole eigene VCs
  const credentials = await agent.dataStoreORMGetVerifiableCredentials({
    where: [{ column: 'subjectDid', value: [myDID] }]
  })

  // Erstelle VP_A
  const vpA = await agent.createVerifiablePresentation({
    presentation: {
      holder: myDID,
      verifiableCredential: credentials.map(c => c.verifiableCredential),
      type: ['VerifiablePresentation']
    },
    proofFormat: 'jwt'
  })

  // Sende VP_A zurück
  await packAndSend(
    agent,
    'https://didcomm.org/present-proof/3.0/presentation',
    myDID,
    message.from,
    { presentation: vpA },
    `${sessionId}-response`,
    sessionId
  )

  console.log('[NF_A] Sent VP_A')
}

/**
 * Phase 3: NF_A empfängt Authorized
 */
export async function handleAuthorized(message: any): Promise<void> {
  const sessionId = message.thid
  const session = sessions.get(sessionId)

  if (!session) throw new Error('Session not found')

  session.status = 'authorized'
  console.log(`[NF_A] Session ${sessionId} AUTHORIZED ✓`)
}

/**
 * Send Service Request (wenn authorized)
 */
export async function sendServiceRequest(
  agent: IAgent,
  sessionId: string,
  request: any
): Promise<void> {
  const session = sessions.get(sessionId)
  if (!session || session.status !== 'authorized') {
    throw new Error('Session not authorized')
  }

  const myDID = await getMyDID(agent)

  await packAndSend(
    agent,
    'https://example.com/nf-service-request',
    myDID,
    session.peer,
    request,
    `${sessionId}-service-${Date.now()}`,
    sessionId
  )

  console.log('[NF_A] Service request sent')
}

// ============================================================================
// NF_B: Responder (Compact)
// ============================================================================

/**
 * Phase 1: NF_B empfängt Initial Request
 */
export async function handleInitialRequest(
  agent: IAgent,
  message: any
): Promise<void> {
  const myDID = await getMyDID(agent)
  const sessionId = message.id

  // Session erstellen
  sessions.set(sessionId, {
    id: sessionId,
    peer: message.from,
    status: 'pending',
    created: new Date()
  })

  // Verify VP_A
  const vpA = message.body.presentation
  const verified = await agent.verifyPresentation({
    presentation: vpA,
    fetchRemoteContexts: true
  })

  if (!verified.verified) {
    throw new Error('VP_A verification failed')
  }

  console.log('[NF_B] VP_A verified ✓')

  // Hole eigene VCs
  const credentials = await agent.dataStoreORMGetVerifiableCredentials({
    where: [{ column: 'subjectDid', value: [myDID] }]
  })

  // Erstelle VP_B
  const vpB = await agent.createVerifiablePresentation({
    presentation: {
      holder: myDID,
      verifiableCredential: credentials.map(c => c.verifiableCredential),
      type: ['VerifiablePresentation']
    },
    proofFormat: 'jwt'
  })

  // Sende VP_B zurück
  await packAndSend(
    agent,
    'https://didcomm.org/present-proof/3.0/request-presentation',
    myDID,
    message.from,
    {
      presentation: vpB,
      needsYourVP: true  // Signal: Ich brauche auch dein VP
    },
    `${sessionId}-mutual`,
    sessionId
  )

  console.log('[NF_B] Sent VP_B, waiting for VP_A')
}

/**
 * Phase 2: NF_B empfängt VP_A von NF_A
 */
export async function handleFinalPresentation(
  agent: IAgent,
  message: any
): Promise<void> {
  const myDID = await getMyDID(agent)
  const sessionId = message.thid
  const session = sessions.get(sessionId)

  if (!session) throw new Error('Session not found')

  // Verify VP_A
  const vpA = message.body.presentation
  const verified = await agent.verifyPresentation({
    presentation: vpA,
    fetchRemoteContexts: true
  })

  if (!verified.verified) {
    throw new Error('VP_A verification failed')
  }

  console.log('[NF_B] VP_A verified ✓')
  console.log('[NF_B] MUTUAL AUTHENTICATION COMPLETE ✓')

  // Mark session as authorized
  session.status = 'authorized'

  // Send authorized confirmation
  await packAndSend(
    agent,
    'https://didcomm.org/present-proof/3.0/ack',
    myDID,
    message.from,
    {
      status: 'authorized',
      message: 'Mutual authentication successful'
    },
    `${sessionId}-authorized`,
    sessionId
  )

  console.log('[NF_B] Sent authorized confirmation')
}

/**
 * Phase 3: NF_B empfängt Service Request
 */
export async function handleServiceRequest(
  agent: IAgent,
  message: any,
  businessLogic: (request: any) => Promise<any>
): Promise<void> {
  const myDID = await getMyDID(agent)
  const sessionId = message.thid
  const session = sessions.get(sessionId)

  if (!session || session.status !== 'authorized') {
    throw new Error('Session not authorized')
  }

  console.log('[NF_B] Processing authorized service request')

  // Execute business logic
  const response = await businessLogic(message.body)

  // Send response
  await packAndSend(
    agent,
    'https://example.com/nf-service-response',
    myDID,
    message.from,
    response,
    `${message.id}-response`,
    sessionId
  )

  console.log('[NF_B] Service response sent')
}

// ============================================================================
// Unified Message Router (für beide NFs)
// ============================================================================

export async function handleDIDCommMessage(
  agent: IAgent,
  packedMessage: any,
  role: 'initiator' | 'responder',
  businessLogic?: (request: any) => Promise<any>
): Promise<void> {

  // Unpack message
  const message = await agent.unpackDIDCommMessage({ message: packedMessage })

  console.log(`[${role === 'initiator' ? 'NF_A' : 'NF_B'}] Received: ${message.type}`)

  // Route based on message type
  switch (message.type) {
    case 'https://didcomm.org/present-proof/3.0/request-presentation':
      if (role === 'initiator') {
        // NF_A empfängt VP_B
        await handlePeerPresentation(agent, message)
      } else {
        // NF_B empfängt Initial Request
        await handleInitialRequest(agent, message)
      }
      break

    case 'https://didcomm.org/present-proof/3.0/presentation':
      if (role === 'responder') {
        // NF_B empfängt VP_A
        await handleFinalPresentation(agent, message)
      }
      break

    case 'https://didcomm.org/present-proof/3.0/ack':
      if (role === 'initiator') {
        // NF_A empfängt authorized confirmation
        await handleAuthorized(message)
      }
      break

    case 'https://example.com/nf-service-request':
      if (role === 'responder' && businessLogic) {
        // NF_B empfängt service request
        await handleServiceRequest(agent, message, businessLogic)
      }
      break

    case 'https://example.com/nf-service-response':
      if (role === 'initiator') {
        // NF_A empfängt service response
        console.log('[NF_A] Service response:', message.body)
      }
      break

    default:
      console.warn('Unknown message type:', message.type)
  }
}

// ============================================================================
// Utilities
// ============================================================================

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId)
}

export function cleanupSessions(maxAge: number = 3600000): void {
  const now = Date.now()
  for (const [id, session] of sessions.entries()) {
    if (now - session.created.getTime() > maxAge) {
      sessions.delete(id)
    }
  }
}

// ============================================================================
// Simple Usage Example
// ============================================================================

/*

// NF_A Usage:
const sessionId = await initiateRequest(
  agent,
  'did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b',
  { action: 'getData', params: {} }
)

// Wait for messages via webhook/endpoint
app.post('/didcomm', async (req, res) => {
  await handleDIDCommMessage(agent, req.body, 'initiator')
  res.send('OK')
})

// When authorized, send actual service request
await sendServiceRequest(agent, sessionId, {
  query: 'getUserData',
  userId: '123'
})


// NF_B Usage:
app.post('/didcomm', async (req, res) => {
  await handleDIDCommMessage(
    agent,
    req.body,
    'responder',
    async (request) => {
      // Your business logic
      return { result: 'data', timestamp: Date.now() }
    }
  )
  res.send('OK')
})

*/
