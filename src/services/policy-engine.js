"use strict";

const fs = require('fs');
const path = require('path');

const DEFAULT_POLICIES = {
    "nudm-sdm": {
        "description": "Unified Data Management - Subscriber Data Management",
        "allowedRoles": ["AMF", "SMF", "AUSF", "network-function"],
        "requiredCredentialTypes": ["NetworkFunctionCredential"],
        "allowedActions": ["am-data", "sm-data", "nssai"],
        "rateLimit": 100,
        "requireMutualAuth": true
    },
    "nausf-auth": {
        "description": "Authentication Service",
        "allowedRoles": ["AMF", "SEAF", "network-function"],
        "requiredCredentialTypes": ["NetworkFunctionCredential"],
        "allowedActions": ["authenticate", "deregister"],
        "rateLimit": 50,
        "requireMutualAuth": true
    },
    "nnrf-disc": {
        "description": "NF Discovery Service",
        "allowedRoles": ["AMF", "SMF", "UDM", "AUSF", "network-function"],
        "requiredCredentialTypes": ["NetworkFunctionCredential"],
        "allowedActions": ["discover", "register"],
        "rateLimit": 200,
        "requireMutualAuth": false
    },
    "*": {
        "description": "Default policy for unknown services",
        "allowedRoles": ["network-function"],
        "requiredCredentialTypes": ["NetworkFunctionCredential"],
        "allowedActions": ["*"],
        "rateLimit": 10,
        "requireMutualAuth": true
    }
};

class PolicyEngine {
    constructor(options = {}) {
        this.policies = {};
        this.policySource = 'default';

        if (options.policies) {
            this.policies = options.policies;
            this.policySource = 'options';
        } else if (process.env.POLICY_CONFIG) {
            try {
                this.policies = JSON.parse(process.env.POLICY_CONFIG);
                this.policySource = 'environment';
            } catch (e) {
                console.log('[POLICY] Failed to parse POLICY_CONFIG, using defaults');
                this.policies = DEFAULT_POLICIES;
            }
        } else if (options.policyPath && fs.existsSync(options.policyPath)) {
            try {
                this.policies = JSON.parse(fs.readFileSync(options.policyPath, 'utf8'));
                this.policySource = 'file';
            } catch (e) {
                console.log('[POLICY] Failed to load policy file, using defaults');
                this.policies = DEFAULT_POLICIES;
            }
        } else {
            this.policies = DEFAULT_POLICIES;
        }

        this.rateLimitState = new Map();

        console.log(`[POLICY] Loaded ${Object.keys(this.policies).length} policies from ${this.policySource}`);
    }

    evaluate(context) {
        const {
            requesterDid, requesterRoles = [], requesterCredentialTypes = [], targetService, action, isAuthenticated = false
        } = context;

        const result = {
            allowed: false,
            reason: null,
            policyId: null,
            evaluatedAt: new Date().toISOString()
        };
        const policy = this.policies[targetService] || this.policies['*'];
        if (!policy) {
            result.reason = 'No matching policy found';
            return result;
        }
        result.policyId = targetService in this.policies ? targetService : '*';
        if (policy.requireMutualAuth && !isAuthenticated) {
            result.reason = 'Mutual authentication required but not completed';
            return result;
        }
        const hasRequiredCredentials = policy.requiredCredentialTypes.every(
            type => requesterCredentialTypes.includes(type)
        );
        if (!hasRequiredCredentials) {
            result.reason = `Missing required credential types: ${policy.requiredCredentialTypes.join(', ')}`;
            return result;
        }
        const hasAllowedRole = requesterRoles.some(
            role => policy.allowedRoles.includes(role) || policy.allowedRoles.includes('*')
        );
        if (!hasAllowedRole) {
            result.reason = `Role not authorized. Required: ${policy.allowedRoles.join(', ')}`;
            return result;
        }
        const actionAllowed = policy.allowedActions.includes(action) || policy.allowedActions.includes('*');
        if (!actionAllowed) {
            result.reason = `Action '${action}' not permitted for service '${targetService}'`;
            return result;
        }
        if (policy.rateLimit) {
            const rateLimitResult = this.checkRateLimit(requesterDid, targetService, policy.rateLimit);
            if (!rateLimitResult.allowed) {
                result.reason = `Rate limit exceeded: ${rateLimitResult.current}/${policy.rateLimit} requests per minute`;
                return result;
            }
        }
        result.allowed = true;
        result.reason = 'Access granted by policy';
        return result;
    }

    checkRateLimit(requesterDid, service, limit) {
        const key = `${requesterDid}:${service}`;
        const now = Date.now();
        const windowMs = 60000; 

        if (!this.rateLimitState.has(key)) {
            this.rateLimitState.set(key, { count: 1, windowStart: now });
            return { allowed: true, current: 1, limit };
        }

        const state = this.rateLimitState.get(key);
        if (now - state.windowStart > windowMs) {
            state.count = 1;
            state.windowStart = now;
        } else {
            state.count++;
        }

        return {
            allowed: state.count <= limit,
            current: state.count,
            limit
        };
    }

    extractContextFromVP(vp) {
        const credentials = vp?.verifiableCredential || [];
        const roles = [];
        const credentialTypes = [];

        for (const cred of credentials) {
            const types = cred.type || [];
            types.forEach(t => {
                if (!credentialTypes.includes(t) && t !== 'VerifiableCredential') {
                    credentialTypes.push(t);
                }
            });

            const role = cred.credentialSubject?.role;
            if (role && !roles.includes(role)) {
                roles.push(role);
            }
            const nfType = cred.credentialSubject?.nfType;
            if (nfType && !roles.includes(nfType)) {
                roles.push(nfType);
            }
        }
        return { roles, credentialTypes };
    }

    getPolicy(service) {
        return this.policies[service] || this.policies['*'] || null;
    }

    getAllPolicies() {
        return {
            source: this.policySource,
            policies: this.policies
        };
    }

    reloadPolicies(policyPath) {
        if (policyPath && fs.existsSync(policyPath)) {
            try {
                this.policies = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
                this.policySource = 'file-reloaded';
                console.log(`[POLICY] Reloaded ${Object.keys(this.policies).length} policies`);
                return true;
            } catch (e) {
                console.error('[POLICY] Failed to reload policies:', e.message);
                return false;
            }
        }
        return false;
    }
}

module.exports = { PolicyEngine, DEFAULT_POLICIES };
