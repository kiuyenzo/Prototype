# DIDComm Prototype for 5G Network Functions in Cloud-Native

## Project Overview

This prototype demonstrates the use of Decentralized Identifiers (DID) and Verifiable Credentials (VC) over DIDComm v2 for mutual authentication between cloud-native 5G network functions. Developed as part of a master’s thesis, its architecture is inspired by the interaction model of the 5G core network.

The setup consists of two Kubernetes clusters hosting simulated 5G network functions that authenticate each other via a Verifiable Presentation exchange before any data transfer. Communication is handled using DIDComm v2, with each network function identified by its own DID and associated VC. Veramo is used for DID management, credential handling, and DIDComm messaging, while Istio provides mTLS and service mesh–based traffic management between the clusters.

# Setup and Requirements

## Installation

The following tools must be installed:

| Tool | Purpose |
|------|---------|
| Docker | https://docs.docker.com/get-docker/ |
| Kubernetes | https://kubernetes.io/docs/tasks/tools/ |
| Kind | https://kind.sigs.k8s.io/docs/user/quick-start/#installation |
| Istio | https://istio.io/latest/docs/setup/install/istioctl/ |
| Veramo CLI | https://veramo.io/docs/veramo_agent/cli_tool |
| Node.js  | https://nodejs.org/ |
| jq | https://jqlang.org/download/ |


Install Node.js dependencies:
```bash
npm install
```

Create clusters and deploy:
```bash
./setup.sh
```


## Security Modes

The prototype supports two DIDComm message protection modes:

| Mode | DIDComm | Pod-Gateway | Gateway-Gateway |
|------|---------|-------------|-----------------|
| `encrypted` | authcrypt | TCP | mTLS |
| `signed` | JWS | mTLS | mTLS |

To switch between modes:

```bash
./scripts/switch-mode.sh signed  
./scripts/switch-mode.sh encrypted  
```

# Pre-Provisioned Credentials

DID and VC are preconfigured and ready for demonstration purposes. The corresponding DID documents are hosted on GitHub Pages, an example DID for Network Function A:
```bash
https://kiuyenzo.github.io/Prototype/dids/did-nf-a/did.json
```


# Testing

To test the functionality of the prototype run:

```bash
./tests/prototype-functional.sh
```

After execution, the Veramo CLI can be used to explore the database. Navigate to data/db-nf-a or data/db-nf-b and run:

```bash
veramo explore
```

To reset the database:

```bash
./tests/prototype-functional.sh --reset
```

