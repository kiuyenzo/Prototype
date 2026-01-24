Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;

class SessionManager {
    constructor(sessionTimeoutMs = 300000) {
        this.sessions = new Map();
        this.sessionTimeout = sessionTimeoutMs;
    }
    
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
        console.log(`[SESSION] ${sessionId} [${initiatorDid.split(':').pop()} to ${responderDid.split(':').pop()}]`);
        return session;
    }

    getSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session && session.expiresAt < Date.now()) {
            this.sessions.delete(sessionId);
            return undefined;
        }
        return session;
    }

    getSessionByDids(did1, did2) {
        return this.getSession(this.generateSessionId(did1, did2)) || this.getSession(this.generateSessionId(did2, did1));
    }

    updateSession(sessionId, updates) {
        const session = this.getSession(sessionId);
        if (!session) return false;
        Object.assign(session, updates, { updatedAt: Date.now() });
        return true;
    }

    markResponderVpReceived(sessionId) {
        return this.updateSession(sessionId, { responderVpReceived: true, status: 'vp_exchanged' });
    }

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
