#!/usr/bin/env node

"use strict";
class HealthMetrics {
    constructor(options = {}) {
        this.serviceName = options.serviceName || 'veramo-sidecar';
        this.ownDid = options.ownDid || process.env.MY_DID || 'unknown';
        this.startTime = Date.now();

        this.counters = {
            vpAuthRequestsSent: 0,
            vpAuthRequestsReceived: 0,
            vpExchangesCompleted: 0,
            vpExchangesFailed: 0,
            vpVerificationsSuccess: 0,
            vpVerificationsFailed: 0,
            serviceRequestsGranted: 0,
            serviceRequestsDenied: 0,
            sessionsCreated: 0,
            sessionsAuthenticated: 0,
            policyEvaluations: 0,
            policyViolations: 0
        };

        this.gauges = {
            activeSessions: 0
        };

        this.lastEvents = {
            lastAuthRequest: null,
            lastServiceRequest: null,
            lastError: null
        };
    }

    incVpAuthRequestSent() { this.counters.vpAuthRequestsSent++; }
    incVpAuthRequestReceived() { this.counters.vpAuthRequestsReceived++; }
    incVpExchangeCompleted() { this.counters.vpExchangesCompleted++; }
    incVpExchangeFailed() { this.counters.vpExchangesFailed++; }
    incVpVerificationSuccess() { this.counters.vpVerificationsSuccess++; }
    incVpVerificationFailed() { this.counters.vpVerificationsFailed++; }
    incServiceRequestGranted() { this.counters.serviceRequestsGranted++; }
    incServiceRequestDenied() { this.counters.serviceRequestsDenied++; }
    incSessionCreated() { this.counters.sessionsCreated++; }
    incSessionAuthenticated() { this.counters.sessionsAuthenticated++; }
    incPolicyEvaluation() { this.counters.policyEvaluations++; }
    incPolicyViolation() { this.counters.policyViolations++; }

    setActiveSessions(count) { this.gauges.activeSessions = count; }

    recordAuthRequest(peerDid) {
        this.lastEvents.lastAuthRequest = {
            timestamp: new Date().toISOString(),
            peerDid: peerDid?.split(':').pop()
        };
    }

    recordServiceRequest(peerDid, service) {
        this.lastEvents.lastServiceRequest = {
            timestamp: new Date().toISOString(),
            peerDid: peerDid?.split(':').pop(),
            service
        };
    }

    recordError(error) {
        this.lastEvents.lastError = {
            timestamp: new Date().toISOString(),
            message: error?.message || String(error)
        };
    }

    getHealth() {
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);
        return {
            status: 'healthy',
            service: this.serviceName,
            did: this.ownDid,
            uptime: uptime,
            uptimeHuman: this.formatUptime(uptime),
            activeSessions: this.gauges.activeSessions,
            timestamp: new Date().toISOString()
        };
    }


    getHealthDetailed(sessionManager) {
        const health = this.getHealth();
        if (sessionManager) {
            const sessions = sessionManager.getAllSessions();
            health.sessions = {
                total: sessions.length,
                authenticated: sessions.filter(s => s.status === 'authenticated').length,
                pending: sessions.filter(s => s.status !== 'authenticated').length
            };
        }
        health.lastEvents = this.lastEvents;
        return health;
    }


    formatUptime(seconds) {
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (d > 0) return `${d}d ${h}h ${m}m`;
        if (h > 0) return `${h}h ${m}m ${s}s`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }
}

module.exports = { HealthMetrics };
