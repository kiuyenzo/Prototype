# Prototype Setup Guide

This guide explains how to set up the SSI-enabled NFV prototype on a new machine.

## Prerequisites

- Docker Desktop installed and running
- `kubectl` installed
- `kind` (Kubernetes in Docker) installed
- Python 3 installed

## Initial Setup

### 1. Create Kind Clusters

```bash
# Create Cluster-A
kind create cluster --name cluster-a --config cluster-a/kind-config.yaml

# Create Cluster-B
kind create cluster --name cluster-b --config cluster-b/kind-config.yaml
```

### 2. Install Istio on Both Clusters

```bash
# Install Istio CLI
curl -L https://istio.io/downloadIstio | sh -
export PATH=$PWD/istio-1.x.x/bin:$PATH

# Install Istio on Cluster-A
kubectl config use-context kind-cluster-a
istioctl install --set profile=default -y
kubectl label namespace default istio-injection=enabled

# Install Istio on Cluster-B
kubectl config use-context kind-cluster-b
istioctl install --set profile=default -y
kubectl label namespace default istio-injection=enabled
```

### 3. Deploy Network Functions

```bash
# Deploy NF-A
kubectl config use-context kind-cluster-a
kubectl apply -f cluster-a/nf-a.yaml
kubectl apply -f cluster-a/istio-gateway-a.yaml
kubectl apply -f cluster-a/istio-messaging-route.yaml
kubectl apply -f cluster-a/istio-authz-policy-gateway.yaml

# Deploy NF-B
kubectl config use-context kind-cluster-b
kubectl apply -f cluster-b/nf-b.yaml
kubectl apply -f cluster-b/istio-gateway-b.yaml
kubectl apply -f cluster-b/istio-messaging-route.yaml
kubectl apply -f cluster-b/istio-authz-policy-gateway.yaml
```

### 4. Update DID Documents with Current Cluster IPs

**IMPORTANT:** Kind assigns dynamic IPs to cluster nodes. You must run this script after creating the clusters:

```bash
./update-did-endpoints.sh
```

This script will:
- Detect the current Docker network IPs of both clusters
- Get the NodePort assignments for Istio Gateways
- Update the `serviceEndpoint` in both DID documents

**Example output:**
```
Found cluster IPs:
  Cluster-A: 172.23.0.2
  Cluster-B: 172.23.0.3

Found NodePorts:
  Cluster-A Gateway: 31829
  Cluster-B Gateway: 30132

✅ Updated cluster-a/did-nf-a/did.json: http://172.23.0.2:31829/messaging
✅ Updated cluster-b/did-nf-b/did.json: http://172.23.0.3:30132/messaging
```

## Testing

### Test Bidirectional DIDComm Communication

```bash
./test-bidirectional-didcomm.sh
```

Expected output:
```
=== 🔄 Bidirectional Cross-Cluster DIDComm Test ===

=== 📤 Test 1: Cluster-A → Cluster-B ===
✅ Message packed in A (793 bytes)
✅ Message delivered to B (routing works)

=== 📤 Test 2: Cluster-B → Cluster-A ===
✅ Message packed in B (793 bytes)
✅ Message delivered to A (routing works)

=== ✅ Bidirectional Test Complete! ===
```

## Understanding the Architecture

### Service Endpoint Configuration

The prototype uses **NodePort-based service endpoints** with Docker network IPs:

```json
{
  "service": [{
    "serviceEndpoint": "http://172.23.0.2:31829/messaging"
  }]
}
```

**Why this approach?**
- ✅ Simple and reliable for local multi-cluster setup
- ✅ No external DNS or LoadBalancer required
- ✅ Demonstrates the core SSI concepts

**Production alternatives** (documented in thesis):
- LoadBalancer services with public IPs/domains
- Istio Multi-Cluster Mesh with global DNS
- CNF-specific ingress controllers

### Key Components

1. **Veramo Agents**: DIDComm v2 agents running as sidecars
2. **Istio Service Mesh**: Traffic management and security
3. **did:web DIDs**: Web-based decentralized identifiers
4. **Persistent Keys**: Stored in Kubernetes Secrets

## Troubleshooting

### Cluster IPs Changed
If you recreate the clusters or they get new IPs, simply run:
```bash
./update-did-endpoints.sh
```

### Port Conflicts
If NodePorts are already in use, delete and recreate the Istio Gateway:
```bash
kubectl delete svc -n istio-system istio-ingressgateway
kubectl apply -f cluster-a/istio-gateway-a.yaml
```

### Pod Not Starting
Check pod status and logs:
```bash
kubectl get pods -n nf-a-namespace
kubectl logs -n nf-a-namespace <pod-name> -c veramo-nf-a
```

## Cleanup

```bash
kind delete cluster --name cluster-a
kind delete cluster --name cluster-b
```

## Notes for Master Thesis

This prototype demonstrates:
- ✅ Cross-cluster DIDComm v2 communication
- ✅ did:web-based service discovery
- ✅ Istio Service Mesh integration
- ✅ Persistent cryptographic key management
- ✅ Zero-trust security policies

The dynamic IP handling (via `update-did-endpoints.sh`) showcases the flexibility of the did:web method while maintaining a practical local setup.
