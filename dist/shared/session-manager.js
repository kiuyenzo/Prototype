/**
 * Session Manager for DIDComm VP Authentication Flow
 *
 * Manages authentication sessions between network functions.
 * Tracks the state of the mutual authentication process.
 */
export class SessionManager {
    constructor(sessionTimeoutMs = 300000) {
        this.sessions = new Map();
        this.sessionTimeout = sessionTimeoutMs;
        // Cleanup expired sessions every minute
        setInterval(() => this.cleanupExpiredSessions(), 60000);
    }
    /**
     * Create a new session for VP exchange
     */
    createSession(initiatorDid, responderDid, challenge) {
        const sessionId = this.generateSessionId(initiatorDid, responderDid);
        const now = Date.now();
        const session = {
            sessionId,
            initiatorDid,
            responderDid,
            status: 'initiated',
            createdAt: now,
            updatedAt: now,
            expiresAt: now + this.sessionTimeout,
            initiatorVpReceived: false,
            responderVpReceived: false,
            initiatorPdSent: false,
            responderPdSent: false,
            challenge
        };
        this.sessions.set(sessionId, session);
        console.log(`📝 Session created: ${sessionId}`);
        console.log(`   Initiator: ${initiatorDid}`);
        console.log(`   Responder: ${responderDid}`);
        return session;
    }
    /**
     * Get session by ID
     */
    getSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session && session.expiresAt < Date.now()) {
            console.log(`⏰ Session expired: ${sessionId}`);
            this.sessions.delete(sessionId);
            return undefined;
        }
        return session;
    }
    /**
     * Get session by DIDs (finds existing session)
     */
    getSessionByDids(did1, did2) {
        // Try both directions
        const sessionId1 = this.generateSessionId(did1, did2);
        const sessionId2 = this.generateSessionId(did2, did1);
        return this.getSession(sessionId1) || this.getSession(sessionId2);
    }
    /**
     * Update session status
     */
    updateSession(sessionId, updates) {
        const session = this.getSession(sessionId);
        if (!session) {
            console.log(`❌ Session not found: ${sessionId}`);
            return false;
        }
        Object.assign(session, updates, { updatedAt: Date.now() });
        console.log(`🔄 Session updated: ${sessionId}`);
        console.log(`   Status: ${session.status}`);
        return true;
    }
    /**
     * Mark that responder's VP was received
     */
    markResponderVpReceived(sessionId) {
        return this.updateSession(sessionId, {
            responderVpReceived: true,
            status: 'vp_exchanged'
        });
    }
    /**
     * Mark that initiator's VP was received
     */
    markInitiatorVpReceived(sessionId) {
        const session = this.getSession(sessionId);
        if (!session)
            return false;
        // If both VPs are received, mark as authenticated
        const status = session.responderVpReceived ? 'authenticated' : 'vp_exchanged';
        return this.updateSession(sessionId, {
            initiatorVpReceived: true,
            status
        });
    }
    /**
     * Mark session as authenticated
     */
    markAuthenticated(sessionId) {
        return this.updateSession(sessionId, {
            status: 'authenticated'
        });
    }
    /**
     * Mark session as failed
     */
    markFailed(sessionId, error) {
        return this.updateSession(sessionId, {
            status: 'failed',
            error
        });
    }
    /**
     * Check if session is authenticated
     */
    isAuthenticated(sessionId) {
        const session = this.getSession(sessionId);
        return session?.status === 'authenticated';
    }
    /**
     * Check if DIDs are authenticated
     */
    areAuthenticated(did1, did2) {
        const session = this.getSessionByDids(did1, did2);
        return session?.status === 'authenticated';
    }
    /**
     * Delete session
     */
    deleteSession(sessionId) {
        const deleted = this.sessions.delete(sessionId);
        if (deleted) {
            console.log(`🗑️  Session deleted: ${sessionId}`);
        }
        return deleted;
    }
    /**
     * Generate session ID from DIDs
     */
    generateSessionId(did1, did2) {
        // Create deterministic session ID from DIDs (sorted for consistency)
        const dids = [did1, did2].sort();
        return `session-${this.hashString(dids.join('|'))}`;
    }
    /**
     * Simple hash function for session IDs
     */
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36);
    }
    /**
     * Cleanup expired sessions
     */
    cleanupExpiredSessions() {
        const now = Date.now();
        let cleanedCount = 0;
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.expiresAt < now) {
                this.sessions.delete(sessionId);
                cleanedCount++;
            }
        }
        if (cleanedCount > 0) {
            console.log(`🧹 Cleaned up ${cleanedCount} expired session(s)`);
        }
    }
    /**
     * Get all sessions (for debugging)
     */
    getAllSessions() {
        return Array.from(this.sessions.values());
    }
    /**
     * Get session count
     */
    getSessionCount() {
        return this.sessions.size;
    }
}
