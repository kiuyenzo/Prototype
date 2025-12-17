/**
 * DIDComm Mutual Authentication - MINIMAL VERSION
 * ~200 lines, Happy Path only
 */

import { IAgent } from '@veramo/core'

// Session Store
const sessions = new Map<string, any>()

// ============================================================================
// NF_A: Initiator
// ============================================================================

export async function nfaInitiate(agent: IAgent, peerDID: string, serviceReq: any) {
  const myDID = (await agent.didManagerFind())[0].did
  const sessionId = `s-${Date.now()}`

  // Create SDR (PD_A)
  const sdr = await agent.createSelectiveDisclosureRequest({
    data: {
      issuer: myDID,
      subject: peerDID,
      claims: [{
        claimType: 'VerifiableCredential',
        essential: true
      }]
    }
  })

  sessions.set(sessionId, { peerDID, status: 'pending', sdr })

  // Pack & Send
  const msg = await agent.packDIDCommMessage({
    packing: 'authcrypt',
    message: {
      type: 'https://didcomm.org/present-proof/3.0/request-presentation',
      from: myDID,
      to: [peerDID],
      id: sessionId,
      body: {
        attachments: [
          { id: 'sdr', data: { json: sdr } },
          { id: 'service-req', data: { json: serviceReq } }
        ]
      }
    }
  })

  await agent.sendDIDCommMessage({
    messageId: sessionId,
    packedMessage: msg,
    recipientDidUrl: peerDID
  })

  return sessionId
}

export async function nfaHandleVPB(agent: IAgent, packed: any) {
  const msg = await agent.unpackDIDCommMessage({ message: packed })
  const session = sessions.get(msg.id)
  const vpB = msg.data.attachments.find((a: any) => a.id === 'vp')?.data.json
  const pdB = msg.data.attachments.find((a: any) => a.id === 'sdr')?.data.json

  // Validate VP_B
  await agent.validatePresentationAgainstSdr({
    presentation: vpB,
    sdr: session.sdr
  })

  await agent.verifyPresentation({ presentation: vpB })

  // Create VP_A
  const myDID = (await agent.didManagerFind())[0].did
  const creds = await agent.getVerifiableCredentialsForSdr({ sdr: pdB })
  const vpA = await agent.createVerifiablePresentation({
    presentation: {
      holder: myDID,
      verifiableCredential: creds
    },
    proofFormat: 'jwt'
  })

  // Send VP_A
  const response = await agent.packDIDCommMessage({
    packing: 'authcrypt',
    message: {
      type: 'https://didcomm.org/present-proof/3.0/presentation',
      from: myDID,
      to: [msg.from],
      id: `${msg.id}-resp`,
      thid: msg.id,
      body: { attachments: [{ id: 'vp', data: { json: vpA } }] }
    }
  })

  await agent.sendDIDCommMessage({
    messageId: response.id,
    packedMessage: response,
    recipientDidUrl: msg.from
  })
}

export async function nfaHandleAuthorized(agent: IAgent, packed: any) {
  const msg = await agent.unpackDIDCommMessage({ message: packed })
  const session = sessions.get(msg.thid)
  session.status = 'authorized'
}

export async function nfaSendService(agent: IAgent, sessionId: string, req: any) {
  const session = sessions.get(sessionId)
  if (session.status !== 'authorized') throw new Error('Not authorized')

  const myDID = (await agent.didManagerFind())[0].did
  const msg = await agent.packDIDCommMessage({
    packing: 'authcrypt',
    message: {
      type: 'https://example.com/service-request',
      from: myDID,
      to: [session.peerDID],
      id: `${sessionId}-srv`,
      thid: sessionId,
      body: req
    }
  })

  return agent.sendDIDCommMessage({
    messageId: msg.id,
    packedMessage: msg,
    recipientDidUrl: session.peerDID
  })
}

// ============================================================================
// NF_B: Responder
// ============================================================================

export async function nfbHandleRequest(agent: IAgent, packed: any) {
  const msg = await agent.unpackDIDCommMessage({ message: packed })
  const sdrA = msg.data.attachments.find((a: any) => a.id === 'sdr')?.data.json

  const myDID = (await agent.didManagerFind())[0].did
  const creds = await agent.getVerifiableCredentialsForSdr({ sdr: sdrA })

  // Create VP_B
  const vpB = await agent.createVerifiablePresentation({
    presentation: {
      holder: myDID,
      verifiableCredential: creds
    },
    proofFormat: 'jwt'
  })

  // Create SDR (PD_B)
  const sdrB = await agent.createSelectiveDisclosureRequest({
    data: {
      issuer: myDID,
      subject: msg.from,
      claims: [{ claimType: 'VerifiableCredential', essential: true }]
    }
  })

  sessions.set(msg.id, { peerDID: msg.from, status: 'auth', sdr: sdrB })

  // Send VP_B + PD_B
  const response = await agent.packDIDCommMessage({
    packing: 'authcrypt',
    message: {
      type: 'https://didcomm.org/present-proof/3.0/request-presentation',
      from: myDID,
      to: [msg.from],
      id: `${msg.id}-mutual`,
      thid: msg.id,
      body: {
        attachments: [
          { id: 'vp', data: { json: vpB } },
          { id: 'sdr', data: { json: sdrB } }
        ]
      }
    }
  })

  await agent.sendDIDCommMessage({
    messageId: response.id,
    packedMessage: response,
    recipientDidUrl: msg.from
  })
}

export async function nfbHandleVPA(agent: IAgent, packed: any) {
  const msg = await agent.unpackDIDCommMessage({ message: packed })
  const session = sessions.get(msg.thid)
  const vpA = msg.data.attachments.find((a: any) => a.id === 'vp')?.data.json

  // Validate VP_A
  await agent.validatePresentationAgainstSdr({
    presentation: vpA,
    sdr: session.sdr
  })

  await agent.verifyPresentation({ presentation: vpA })

  session.status = 'authorized'

  // Send Authorized
  const myDID = (await agent.didManagerFind())[0].mid
  const ack = await agent.packDIDCommMessage({
    packing: 'authcrypt',
    message: {
      type: 'https://didcomm.org/present-proof/3.0/ack',
      from: myDID,
      to: [msg.from],
      id: `${msg.thid}-ack`,
      thid: msg.thid,
      body: { status: 'authorized' }
    }
  })

  await agent.sendDIDCommMessage({
    messageId: ack.id,
    packedMessage: ack,
    recipientDidUrl: msg.from
  })
}

export async function nfbHandleService(
  agent: IAgent,
  packed: any,
  businessLogic: (req: any) => Promise<any>
) {
  const msg = await agent.unpackDIDCommMessage({ message: packed })
  const session = sessions.get(msg.thid)
  if (session.status !== 'authorized') throw new Error('Not authorized')

  const result = await businessLogic(msg.body)

  const myDID = (await agent.didManagerFind())[0].did
  const response = await agent.packDIDCommMessage({
    packing: 'authcrypt',
    message: {
      type: 'https://example.com/service-response',
      from: myDID,
      to: [msg.from],
      id: `${msg.id}-resp`,
      thid: msg.thid,
      body: result
    }
  })

  await agent.sendDIDCommMessage({
    messageId: response.id,
    packedMessage: response,
    recipientDidUrl: msg.from
  })
}

// ============================================================================
// Router
// ============================================================================

export async function route(
  agent: IAgent,
  packed: any,
  isNFA: boolean,
  bizLogic?: (req: any) => Promise<any>
) {
  const msg = await agent.unpackDIDCommMessage({ message: packed })

  if (msg.type === 'https://didcomm.org/present-proof/3.0/request-presentation') {
    return isNFA ? nfaHandleVPB(agent, packed) : nfbHandleRequest(agent, packed)
  }
  if (msg.type === 'https://didcomm.org/present-proof/3.0/presentation') {
    return nfbHandleVPA(agent, packed)
  }
  if (msg.type === 'https://didcomm.org/present-proof/3.0/ack') {
    return nfaHandleAuthorized(agent, packed)
  }
  if (msg.type === 'https://example.com/service-request' && bizLogic) {
    return nfbHandleService(agent, packed, bizLogic)
  }
}
