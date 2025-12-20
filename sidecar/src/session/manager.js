"use strict";
/**
 * Session Manager for DIDComm VP Authentication Flow
 * Manages authentication sessions between network functions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;

class SessionManager {
    constructor(sessionTimeoutMs = 300000) {
        this.sessions = new Map();
        this.sessionTimeout = sessionTimeoutMs;
    }

    /** Create a new session for VP exchange */
    createSession(initiatorDid, responderDid, challenge) {
        const sessionId = this.generateSessionId(initiatorDid, responderDid);
        const now = Date.now();
        const session = {
            sessionId, initiatorDid, responderDid, status: 'initiated',
            createdAt: now, updatedAt: now, expiresAt: now + this.sessionTimeout,
            initiatorVpReceived: false, responderVpReceived: false,
            initiatorPdSent: false, responderPdSent: false, challenge
        };
        this.sessions.set(sessionId, session);
        console.log(`📝 Session: ${sessionId} [${initiatorDid.split(':').pop()} ↔ ${responderDid.split(':').pop()}]`);
        return session;
    }

    /** Get session by ID */
    getSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session && session.expiresAt < Date.now()) {
            this.sessions.delete(sessionId);
            return undefined;
        }
        return session;
    }

    /** Get session by DIDs (finds existing session) */
    getSessionByDids(did1, did2) {
        return this.getSession(this.generateSessionId(did1, did2)) || this.getSession(this.generateSessionId(did2, did1));
    }

    /** Update session status */
    updateSession(sessionId, updates) {
        const session = this.getSession(sessionId);
        if (!session) return false;
        Object.assign(session, updates, { updatedAt: Date.now() });
        return true;
    }

    /** Mark that responder's VP was received */
    markResponderVpReceived(sessionId) {
        return this.updateSession(sessionId, { responderVpReceived: true, status: 'vp_exchanged' });
    }

    /** Mark that initiator's VP was received */
    markInitiatorVpReceived(sessionId) {
        const session = this.getSession(sessionId);
        if (!session) return false;
        return this.updateSession(sessionId, { initiatorVpReceived: true, status: session.responderVpReceived ? 'authenticated' : 'vp_exchanged' });
    }

    markAuthenticated(sessionId) { return this.updateSession(sessionId, { status: 'authenticated' }); }
    markFailed(sessionId, error) { return this.updateSession(sessionId, { status: 'failed', error }); }
    isAuthenticated(sessionId) { return this.getSession(sessionId)?.status === 'authenticated'; }
    areAuthenticated(did1, did2) { return this.getSessionByDids(did1, did2)?.status === 'authenticated'; }
    deleteSession(sessionId) { return this.sessions.delete(sessionId); }

    /** Generate session ID from DIDs */
    generateSessionId(did1, did2) {
        const dids = [did1, did2].sort();
        return `session-${this.hashString(dids.join('|'))}`;
    }

    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    /** Cleanup expired sessions */
    cleanupExpiredSessions() {
        const now = Date.now();
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.expiresAt < now) this.sessions.delete(sessionId);
        }
    }

    getAllSessions() { return Array.from(this.sessions.values()); }
    getSessionCount() { return this.sessions.size; }
}
exports.SessionManager = SessionManager;
