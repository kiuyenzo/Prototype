# ngrok Setup for Public DID Endpoints

This guide explains how to set up public HTTPS endpoints for your DIDs using ngrok, enabling real did:web resolution.

## Why ngrok?

For did:web resolution to work, the DID documents must be accessible via HTTPS from GitHub Pages, and the `serviceEndpoint` URLs must be publicly reachable. Since your Kubernetes clusters run locally with private IPs, ngrok provides public tunnels.

## Prerequisites

1. **ngrok account** (free tier is sufficient)
   - Sign up at https://ngrok.com
   - Get your auth token

2. **Install ngrok:**
   ```bash
   brew install ngrok/ngrok/ngrok
   ```

3. **Authenticate:**
   ```bash
   ngrok config add-authtoken <your-token>
   ```

## Quick Start

### 1. Start ngrok tunnels

```bash
./setup-ngrok-endpoints.sh
```

This script will:
- ✅ Create public HTTPS tunnels for both clusters
- ✅ Update DID documents with ngrok URLs
- ✅ Display public URLs

**Example output:**
```
=== ✅ ngrok tunnels active! ===

Public URLs:
  Cluster-A: https://abc123.ngrok.io/messaging
  Cluster-B: https://def456.ngrok.io/messaging

✅ Updated cluster-a/did-nf-a/did.json
   serviceEndpoint: https://abc123.ngrok.io/messaging
```

### 2. Publish DIDs to GitHub

```bash
git add cluster-a/did-nf-a/did.json cluster-b/did-nf-b/did.json
git commit -m "Update DID documents with ngrok public endpoints"
git push origin main
```

### 3. Enable GitHub Pages (first time only)

1. Go to https://github.com/kiuyenzo/Prototype/settings/pages
2. Source: **Deploy from branch**
3. Branch: **main** / **(root)**
4. Click **Save**

### 4. Wait for deployment

GitHub Pages takes ~2-3 minutes to deploy. You can check status at:
https://github.com/kiuyenzo/Prototype/deployments

### 5. Test DID resolution

```bash
veramo did resolve did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a
```

**Expected output:**
```json
{
  "didDocument": {
    "id": "did:web:kiuyenzo.github.io:Prototype:cluster-a:did-nf-a",
    "service": [{
      "serviceEndpoint": "https://abc123.ngrok.io/messaging"
    }]
  }
}
```

## Testing Cross-Cluster with did:web Resolution

Once ngrok is running and GitHub Pages is deployed, you can test with dynamic endpoint resolution:

```bash
# This will now resolve DIDs from GitHub Pages and use ngrok URLs
./5_test-bidirectional-didcomm.sh
```

## Important Notes

### ⚠️ Keep ngrok running

The ngrok tunnels **must stay active** while:
- Running tests
- Demonstrating to others
- During thesis defense (if live demo)

If you close the terminal or stop ngrok:
- The public URLs become unreachable
- DID resolution still works (GitHub Pages is up)
- But the service endpoints return connection errors

### 🔄 Restore local IPs

When you stop ngrok (Ctrl+C), the script automatically restores local IPs:
```bash
# Automatically runs on Ctrl+C
./5_update-did-endpoints.sh
```

### 📝 ngrok URL persistence

**Free tier:** URLs change on restart
**Paid tier:** You can get static domains

For thesis:
- Use free tier for testing/development
- For final demo, start ngrok and commit those URLs
- Take screenshots with stable URLs during one session

## Workflow for Thesis Demo

### Preparation (one time):

1. Start ngrok: `./setup-ngrok-endpoints.sh`
2. Note the public URLs
3. Commit and push DIDs
4. Wait for GitHub Pages
5. Verify DID resolution works

### During demo/defense:

1. Ensure ngrok is still running (same URLs)
2. Run tests: `./5_test-bidirectional-didcomm.sh`
3. Show Kiali: `./5_open-kiali.sh`
4. Demonstrate DID resolution: `veramo did resolve did:web:...`

## Troubleshooting

### ngrok tunnels not starting

```bash
# Check ngrok is authenticated
ngrok config check

# View detailed logs
cat /tmp/ngrok-a.log
cat /tmp/ngrok-b.log
```

### DID resolution fails

```bash
# Verify GitHub Pages is deployed
curl https://kiuyenzo.github.io/Prototype/cluster-a/did-nf-a/did.json

# Check ngrok tunnel is accessible
curl https://abc123.ngrok.io/messaging
```

### URLs changed after restart

If you restart ngrok, the URLs will be different:
1. Run `./setup-ngrok-endpoints.sh` again
2. Commit and push updated DIDs
3. Wait 2-3 minutes for GitHub Pages

## Alternative: Static ngrok Domains (Paid)

If you upgrade to ngrok Pro ($8/month), you can get static domains:

```bash
ngrok http 31829 --domain=cluster-a-nf.ngrok.app
ngrok http 30132 --domain=cluster-b-nf.ngrok.app
```

Benefits:
- URLs never change
- One-time DID commit
- More professional for thesis

## For Your Thesis

### Architecture Diagram

Include this flow:
```
External User
    ↓
  GitHub Pages (did:web resolution)
    ↓
  DID Document with ngrok serviceEndpoint
    ↓
  ngrok Tunnel (HTTPS → HTTP)
    ↓
  Istio Gateway (NodePort)
    ↓
  Veramo Agent (DIDComm processing)
```

### Discussion Section

> **Production vs. Prototype Endpoints:**
>
> The prototype uses ngrok tunnels to provide public HTTPS endpoints for did:web resolution. This demonstrates the full did:web lifecycle while maintaining a local development environment.
>
> In production NFV deployments, the service endpoints would be:
> - Cloud LoadBalancer IPs with DNS names
> - Kubernetes Ingress with TLS certificates
> - CNF-specific ingress controllers
>
> The ngrok approach validates the did:web method's flexibility while remaining practical for research purposes.

## Summary

✅ **Use ngrok for:**
- Full did:web resolution testing
- Allowing others to verify your setup
- Professional thesis demonstration

❌ **Don't need ngrok for:**
- Basic local testing (use `./5_update-did-endpoints.sh`)
- Development iteration
- If you're okay with hardcoded endpoints

**Recommendation:** Set up ngrok before thesis submission/defense for maximum impact!
