#!/usr/bin/env node
"use strict";
const fs = require('fs');
const path = require('path');

const AUDIT_EVENTS = {
    VP_AUTH_REQUEST_SENT: 'VP_AUTH_REQUEST_SENT',
    VP_AUTH_REQUEST_RECEIVED: 'VP_AUTH_REQUEST_RECEIVED',
    VP_EXCHANGE_INITIATED: 'VP_EXCHANGE_INITIATED',
    VP_EXCHANGE_COMPLETED: 'VP_EXCHANGE_COMPLETED',
    VP_VERIFICATION_SUCCESS: 'VP_VERIFICATION_SUCCESS',
    VP_VERIFICATION_FAILED: 'VP_VERIFICATION_FAILED',

    SESSION_CREATED: 'SESSION_CREATED',
    SESSION_AUTHENTICATED: 'SESSION_AUTHENTICATED',
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    SESSION_TERMINATED: 'SESSION_TERMINATED',

    SERVICE_REQUEST: 'SERVICE_REQUEST',
    SERVICE_RESPONSE: 'SERVICE_RESPONSE',
    SERVICE_ACCESS_GRANTED: 'SERVICE_ACCESS_GRANTED',
    SERVICE_ACCESS_DENIED: 'SERVICE_ACCESS_DENIED',

    POLICY_EVALUATION: 'POLICY_EVALUATION',
    POLICY_VIOLATION: 'POLICY_VIOLATION',

    SYSTEM_STARTUP: 'SYSTEM_STARTUP',
    SYSTEM_SHUTDOWN: 'SYSTEM_SHUTDOWN',
    HEALTH_CHECK: 'HEALTH_CHECK'
};

class AuditLogger {
    constructor(options = {}) {
        this.serviceName = options.serviceName || 'veramo-sidecar';
        this.ownDid = options.ownDid || process.env.MY_DID || 'unknown';
        this.logToFile = options.logToFile || false;
        this.logFilePath = options.logFilePath || '/tmp/audit.log';
        this.enabled = options.enabled !== false;
    }

    log(eventType, details = {}) {
        if (!this.enabled) return;

        const entry = {
            timestamp: new Date().toISOString(),
            service: this.serviceName,
            ownDid: this.ownDid.split(':').pop(),
            eventType: eventType,
            ...this.sanitizeDetails(details)
        };

        console.log(`[AUDIT] ${JSON.stringify(entry)}`);

        if (this.logToFile) {
            try {
                fs.appendFileSync(this.logFilePath, JSON.stringify(entry) + '\n');
            } catch (e) {
            }
        }
        return entry;
    }

    sanitizeDetails(details) {
        const sanitized = { ...details };

        if (sanitized.requesterDid) {
            sanitized.requesterDid = sanitized.requesterDid.split(':').pop();
        }
        if (sanitized.targetDid) {
            sanitized.targetDid = sanitized.targetDid.split(':').pop();
        }
        if (sanitized.peerDid) {
            sanitized.peerDid = sanitized.peerDid.split(':').pop();
        }
        delete sanitized.privateKey;
        delete sanitized.secretKey;
        delete sanitized.encryptionKey;
        return sanitized;
    }

    logAuthRequest(direction, peerDid, sessionId) {
        return this.log(
            direction === 'sent' ? AUDIT_EVENTS.VP_AUTH_REQUEST_SENT : AUDIT_EVENTS.VP_AUTH_REQUEST_RECEIVED,
            { peerDid, sessionId, direction }
        );
    }

    logVpExchange(phase, peerDid, sessionId, success = true) {
        return this.log(
            phase === 'initiated' ? AUDIT_EVENTS.VP_EXCHANGE_INITIATED : AUDIT_EVENTS.VP_EXCHANGE_COMPLETED,
            { peerDid, sessionId, success }
        );
    }

    logVpVerification(peerDid, success, reason = null) {
        return this.log(
            success ? AUDIT_EVENTS.VP_VERIFICATION_SUCCESS : AUDIT_EVENTS.VP_VERIFICATION_FAILED,
            { peerDid, success, reason }
        );
    }

    logSessionEvent(eventType, sessionId, peerDid, status) {
        return this.log(eventType, { sessionId, peerDid, status });
    }

    logServiceAccess(requesterDid, service, action, granted, reason = null) {
        return this.log(
            granted ? AUDIT_EVENTS.SERVICE_ACCESS_GRANTED : AUDIT_EVENTS.SERVICE_ACCESS_DENIED,
            { requesterDid, service, action, granted, reason }
        );
    }

    logPolicyEvaluation(requesterDid, service, result, policyId = null) {
        return this.log(AUDIT_EVENTS.POLICY_EVALUATION, {
            requesterDid, service, result, policyId
        });
    }

    logSystemEvent(eventType, details = {}) {
        return this.log(eventType, details);
    }
}

module.exports = { AuditLogger, AUDIT_EVENTS };
