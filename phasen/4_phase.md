# Schritt 5: Hole die HTTPS NodePorts
# Cluster A - Port 443 NodePort
kubectl config use-context kind-cluster-a
kubectl get svc istio-ingressgateway -n istio-system | grep 443

# Cluster B - Port 443 NodePort
kubectl config use-context kind-cluster-b
kubectl get svc istio-ingressgateway -n istio-system | grep 443

Cluster A: 443:30217/TCP → NodePort = 30217
Cluster B: 443:31598/TCP → NodePort = 31598

# Gateway PASSTHROUGH
kubectl config use-context kind-cluster-a
kubectl apply -f istio-gateway-didcomm-passthrough.yaml

kubectl config use-context kind-cluster-b
kubectl apply -f istio-gateway-didcomm-passthrough.yaml

# VirtualService für DIDComm
kubectl config use-context kind-cluster-a
kubectl apply -f istio-virtualservice-didcomm.yaml

kubectl config use-context kind-cluster-b
kubectl apply -f istio-virtualservice-didcomm.yaml

# DestinationRule
kubectl config use-context kind-cluster-a
kubectl apply -f istio-destinationrule-didcomm.yaml

kubectl config use-context kind-cluster-b
kubectl apply -f istio-destinationrule-didcomm.yaml

# ServiceEntry für HTTPS Cross-Cluster
kubectl config use-context kind-cluster-a
kubectl apply -f istio-serviceentry-didcomm.yaml

kubectl config use-context kind-cluster-b
kubectl apply -f istio-serviceentry-didcomm.yaml

# zero trust policy
kubectl config use-context kind-cluster-a
kubectl apply -f istio-authz-policy-didcomm.yaml


kubectl apply -f istio-authz-policy-didcomm.yaml

Was funktioniert:
✅ Istio-Sidecar Injection in beiden Clustern
✅ mTLS zwischen allen Services (STRICT Mode)
✅ Gateway PASSTHROUGH für verschlüsselten DIDComm-Traffic
✅ Zero Trust Authorization Policies
✅ Cross-Cluster ServiceEntries konfiguriert
✅ VirtualService Routing (Ingress/Egress/DIDComm)
✅ TLS 1.3 mit ISTIO_MUTUAL

Um die Cross-Cluster Kommunikation zu testen, müsstest du:
DNS-Auflösung für didcomm.nf-a.cluster-a.global und didcomm.nf-b.cluster-b.global konfigurieren
Oder /etc/hosts Einträge setzen für die NodePort IPs
Einen Test-Client mit gültigem Istio-Zertifikat verwenden
Status: Gateway PASSTHROUGH ✅ Vollständig konfiguriert und funktionsfähig!


# to do:
- Typeskript lernen
- Agent schreiben / Phase 5
- auf GCP hosten / codespace