# DIDComm v2 Prototype for 5G Network Functions

This prototype demonstrates how Verifiable Presentations (VPs) over DIDComm v2 can be used for mutual authentication of cloud-native 5G network functions. It was developed as part of a master's thesis and presents an alternative to OAuth2-based authentication in 5G Service Based Interfaces (SBI).

---

## 1. Overview

The prototype consists of two Kubernetes clusters, each hosting a simulated 5G network function. Cluster-A contains NF-A (simulating an AMF), while Cluster-B contains NF-B (simulating a UDM). The network functions mutually authenticate each other through a three-phase VP exchange before exchanging any data.

Communication occurs via DIDComm v2, a standardized messaging protocol for decentralized identities. Each network function possesses its own Decentralized Identifier (DID) and a Verifiable Credential that confirms its role in the network.

The prototype supports two security modes: In "Encrypted" mode, all DIDComm messages are end-to-end encrypted using authcrypt. In "Signed" mode, messages are only signed while transport encryption is provided by mTLS.

---

## 2. Prerequisites

Before you can run the prototype, the following tools must be installed on your system. On macOS, the easiest way to install them is via Homebrew.

**Docker** is required to build containers and run the Kubernetes clusters. Install Docker Desktop with `brew install --cask docker` and start the application. Make sure Docker is running before proceeding.

**kubectl** is the command-line tool for interacting with Kubernetes clusters. Install it with `brew install kubectl`.

**kind** (Kubernetes in Docker) allows you to run local Kubernetes clusters inside Docker containers. This is how we simulate our two-cluster environment. Install it with `brew install kind`.

**istioctl** is the CLI tool for Istio, the service mesh we use for mTLS and traffic management between the clusters. Install it with `brew install istioctl`.

**Node.js** is required for the application logic. The prototype uses Veramo, a JavaScript framework for decentralized identities, along with other npm packages for DIDComm messaging and Presentation Exchange. Install Node.js with `brew install node`. Version 18 or higher is required.

**jq** is a command-line tool for processing JSON data. It is used in the setup scripts to parse cluster information. Install it with `brew install jq`.

To verify that all tools are correctly installed, run the following commands:

```bash
docker --version
kubectl version --client
kind --version
istioctl version --client
node --version
jq --version
```

Each command should output a version number without errors.

---

## 3. Installation and Setup

### 3.1 Clone the Repository

First, clone the repository to your local machine:

```bash
git clone https://github.com/kiuyenzo/Prototype.git
cd Prototype
```

### 3.2 Install Dependencies

The prototype uses several Node.js packages that need to be installed. These include Veramo for DID and credential management, the DIDComm library for secure messaging, Sphereon PEX for Presentation Exchange, and various cryptographic libraries. All dependencies are defined in `package.json`.

Install all dependencies by running:

```bash
npm install
```

This command downloads and installs Veramo and all other required packages. The process may take a few minutes as there are many dependencies to resolve. Once completed, you will have a `node_modules` folder containing all the libraries needed to run the prototype.

### 3.3 Create the Kubernetes Clusters

The setup script creates two separate Kubernetes clusters and configures the entire infrastructure. Run it with:

```bash
./scripts/setup/setup-clusters.sh
```

This script performs several steps automatically. First, it creates a Docker network that allows the two clusters to communicate with each other. Then it creates two KinD clusters named cluster-a and cluster-b. Into both clusters, it installs Istio as a service mesh, which handles mTLS between the gateways.

Next, the script generates TLS certificates for gateway-to-gateway communication. These certificates are signed by a local Certificate Authority and stored as Kubernetes Secrets. Finally, the script configures cross-cluster communication by creating ServiceEntries and DestinationRules that enable traffic routing between the clusters.

The entire process takes approximately 5-10 minutes, depending on your internet connection speed and machine performance.

### 3.4 Deploy the Application

After the clusters have been created, you can deploy the application:

```bash
./scripts/deploy/build-and-deploy.sh
```

This script first compiles the TypeScript source code to JavaScript. Then it builds two Docker images: one for the NF-Service (containing the business logic) and one for the Veramo-Sidecar (containing the DIDComm and VP logic). These images are loaded into both KinD clusters.

The script then applies the Kubernetes manifests: Deployments for the pods, Gateways for incoming traffic, ServiceEntries for cross-cluster communication, and SecurityPolicies for authorization. Depending on the configured security mode, the corresponding mTLS configuration is also applied.

Finally, the script creates Verifiable Credentials inside both pods. These credentials certify that each network function is an authorized component in the network. The credentials are issued by a trusted issuer and stored in the local SQLite database of each pod.

### 3.5 Verify the Deployment

After deployment, you should verify that all pods are running correctly:

```bash
kubectl --context kind-cluster-a get pods -n nf-a-namespace
kubectl --context kind-cluster-b get pods -n nf-b-namespace
```

Each pod should show the status "Running" and display 3/3 containers ready. The three containers are: the NF-Service (business logic on port 3000), the Veramo-Sidecar (DIDComm handler on port 3001), and the automatically injected Istio-Proxy (for mTLS).

If a pod fails to start or shows an error status, refer to the Troubleshooting section at the end of this guide.

---

## 4. Running Tests

To verify that the prototype is functioning correctly, you can run the functional test:

```bash
./tests/final/test-functional-correctness.sh
```

This test simulates a complete authentication and service call flow. NF-A sends a request to NF-B, which triggers a three-phase VP exchange. First, NF-A sends a VP-Auth-Request containing a Presentation Definition that specifies what credentials it requires from NF-B. NF-B responds with its own VP and includes its own Presentation Definition. NF-A then sends its VP in response. After successful mutual verification, the channel is authenticated and the actual service request is transmitted.

The test outputs which steps were successful and whether the entire flow completed correctly.

---

## 5. Security Modes

The prototype supports two different security modes that represent different trust models.

### Encrypted Mode

In Encrypted mode, all DIDComm messages are end-to-end encrypted using authcrypt (JWE). This means that only the sender and recipient can read the message contents - even the Istio proxies and gateways only see encrypted ciphertext.

This mode implements a Zero Trust model all the way to the network function: Even if an attacker gained access to the cluster's internal network, they would not be able to read the communication.

Communication between pod and gateway occurs over plain TCP (without mTLS) since encryption is already handled at the application layer. Between the gateways, mTLS is still used to protect against external attackers.

### Signed Mode

In Signed mode, DIDComm messages are only signed (JWS) but not encrypted. Confidentiality is instead provided by mTLS on all network segments - both between pod and gateway, and between the gateways.

This mode implements a Zero Trust model outside the cluster: Within the cluster, we trust the mTLS infrastructure, but the integrity and authenticity of messages is ensured by DIDComm signatures at the application layer.

### Switching Modes

To switch the security mode, open the file `deploy/cluster-a/deployment.yaml` and change the value of the `DIDCOMM_PACKING_MODE` environment variable:

```yaml
- name: DIDCOMM_PACKING_MODE
  value: "encrypted"    # or "signed"
```

After making the change, redeploy the application:

```bash
./scripts/deploy/build-and-deploy.sh
```

The deploy script automatically detects the configured mode and applies the corresponding mTLS configuration.

---

## 6. Architecture

The prototype uses a sidecar architecture. Each pod contains three containers:

The **NF-Service** (port 3000) contains the business logic of the network function. It exposes REST endpoints that simulate 5G APIs like nudm-sdm. When an outgoing request needs to be made, it delegates to the Veramo-Sidecar.

The **Veramo-Sidecar** (port 3001) handles all DIDComm and VP-related operations. It manages the pod's DID, creates and verifies Verifiable Presentations, and handles DIDComm messaging. It serves as the "identity layer" of the network function.

The **Istio-Proxy** is automatically added through Istio's sidecar injection. It handles mTLS between pods and to the gateway, and enables traffic management and observability.

Communication between clusters occurs through Istio Ingress Gateways. These gateways terminate incoming traffic and route it to the appropriate pods. mTLS is always used between the gateways.

---

## 7. Troubleshooting

If you encounter problems, here are some common issues and their solutions.

If pods show the status "ImagePullBackOff", the Docker images were not correctly loaded into the cluster. Manually run the image load commands:

```bash
kind load docker-image veramo-sidecar:sidecar --name cluster-a
kind load docker-image nf-service:sidecar --name cluster-a
kind load docker-image veramo-sidecar:sidecar --name cluster-b
kind load docker-image nf-service:sidecar --name cluster-b
```

If cross-cluster communication is not working, check whether the cluster IPs were correctly detected. The IPs are dynamically assigned and may change when clusters are restarted. In this case, run the setup script again.

To completely reset everything and start from scratch:

```bash
kind delete cluster --name cluster-a
kind delete cluster --name cluster-b
docker network rm kind
./scripts/setup/setup-clusters.sh
./scripts/deploy/build-and-deploy.sh
```

---

## 8. Project Structure

The repository is organized as follows:

The `src/` folder contains the application code. The file `nf-service.js` contains the business logic, while `veramo-sidecar.js` contains the DIDComm logic. The `lib/` subfolder contains modules for credentials, DIDComm messaging, and session management.

The `deploy/` folder contains all Kubernetes manifests. Each cluster has its own subfolder with Deployment, Gateway, Infrastructure, and Security configurations. The `mtls-config/` folder contains the different mTLS configurations for the security modes.

The `dids/` folder contains the DID documents that are hosted on GitHub Pages. These contain the public keys of the network functions.

The `scripts/` folder contains the setup and deploy scripts. The `tests/` folder contains test scripts for functional, security, and performance testing.

---

## License

MIT
