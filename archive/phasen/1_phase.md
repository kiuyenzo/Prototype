istioclt validate yaml
istioclt verify-install
istioctl analyze -A
istioctl dump demo -o yaml
istioctl profile list
#lernen mit beispiel repo: https://www.youtube.com/watch?v=yxTR__Y0DnU
ist gut: https://www.youtube.com/watch?v=Cn2LHqdHwXM
gateway yaml etc anzeigen lassen 

istio ordner downloaden da sind samples drine plus add ons
curl -L https://istio.io/downloadIstio | sh -
cd istio-1.28.0
export PATH=$PWD/bin:$PATH


(
istioclt profile dump demo -o yaml > demo.yaml
vim demo.yaml
istioctl install -f demo.yaml -y
installiert istio core, istiod, egress, ingress, egress
)

# Phase 1
kind create cluster --name cluster-a
kind create cluster --name cluster-b
kubectl config get-contexts

# Istio installieren jeweils aus einen Cluster
kubectl config use-context kind-cluster-a
istioctl install --set profile=demo -y
kubectl config use-context kind-cluster-b
istioctl install --set profile=demo -y              # um Ingress und Egress zu installieren

kubectl get pods -n istio-system

# Namesapce erstellen + Sidecar-Injection

kubectl create namespace nf-a-namespace
kubectl label namespace nf-a-namespace istio-injection=enabled #istioctl kube-inject apply -f ....

kubectl config use-context kind-cluster-b
kubectl create namespace nf-b-namespace
kubectl label namespace nf-b-namespace istio-injection=enabled

# NF + Veramo
kubectl apply -f nf-a.yaml
kubectl get pods -n nf-a-namespace
kubectl describe pod -n nf-a-namespace nf-a-67bbdb6b78-k646j | grep -i istio-proxy 
kubectl logs -n nf-a-namespace nf-a-67bbdb6b78-k646j -c istio-proxy
kubectl exec -it nf-a-67bbdb6b78-k646j -n nf-a-namespace -c istio-proxy -- pilot-agent request GET stats

#kubectl label namespace nf-a-namespace istio.io/rev=default --overwrite

kubectl get pod nf-a-785df7886d-cvr7j -n nf-a-namespace -o jsonpath='{range .spec.containers[*]}{.name}{"\n"}{end}{range .spec.initContainers[*]}{.name}{"\n"}{end}'


kubectl apply -f nf-b.yaml
kubectl get pods -n nf-b-namespace
kubectl describe pod -n nf-b-namespace nf-b | grep -i istio-proxy -n

#kubectl label namespace nf-a-namespace istio.io/rev=default --overwrite
#kubectl rollout restart deployment nf-b -n nf-b-namespace

kubectl get pod nf-b-f748fdbc5-4lnvg -n nf-b-namespace -o jsonpath='{range .spec.containers[*]}{.name}{"\n"}{end}{range .spec.initContainers[*]}{.name}{"\n"}{end}'

# mtls
kubectl config use-context kind-cluster-a
kubectl apply -f istio-mtls-a.yaml

kubectl config use-context kind-cluster-b
kubectl apply -f istio-mtls-b.yaml

# Services für NF-Apps
kubectl config use-context kind-cluster-a
kubectl apply -f nf-a-service.yaml

kubectl config use-context kind-cluster-b
kubectl apply -f nf-b-service.yaml

# Gateway Resources
kubectl config use-context kind-cluster-a
kubectl apply -f istio-gateway-a.yaml

kubectl config use-context kind-cluster-b
kubectl apply -f istio-gateway-b.yaml

# VirtualService für Routing
kubectl config use-context kind-cluster-a
kubectl apply -f istio-virtualservice-a.yaml

kubectl config use-context kind-cluster-b
kubectl apply -f istio-virtualservice-b.yaml

# Service Entry Verbindung testen
kubectl config use-context kind-cluster-a
kubectl apply -f istio-serviceentry.yaml

kubectl config use-context kind-cluster-b
kubectl apply -f istio-serviceentry.yaml

kubectl get svc istio-ingressgateway -n istio-system

istio-ingressgateway   LoadBalancer   cluster IP 10.96.76.55 
istio-ingressgateway   LoadBalancer   cluster IP 10.96.124.152 

Cluster A: IP + Port 30366 (HTTP Port 80)
Cluster B: IP + Port 30296 (HTTP Port 80)

# Test: Cluster B → Cluster A Veramo Service (mit /veramo Pfad)
kubectl config use-context kind-cluster-b
kubectl exec -it deployment/nf-b -n nf-b-namespace -c nf-b-app -- curl -v -H "Host: nf-a.cluster-a.global" http://172.23.0.2:30366/veramo

# Test: Cluster A → Cluster B Veramo Service
kubectl config use-context kind-cluster-a
kubectl exec -it deployment/nf-a -n nf-a-namespace -c nf-a-app -- curl -v -H "Host: nf-b.cluster-b.global" http://172.23.0.3:30296/veramo

Warum 503?
Der 503 Service Unavailable ist kein Fehler in deiner Infrastruktur, sondern weil:
veramo-nf-a/b sind Dummy-Container (curlimages/curl) ohne Server
nf-a-app/nf-b-app (nginx) sind nicht korrekt konfiguriert
Aber: Der Gateway erreicht die Services! Der 503 kommt vom Backend, nicht vom Gateway.


Alle Anforderungen erfüllt:
Anforderung	Status	Details
Zwei lokale K8s-Cluster (kind)	✅	cluster-a, cluster-b
Istio Installation	✅	Version 1.27.3 auf beiden
Namespaces mit istio-injection	✅	nf-a-namespace, nf-b-namespace
Pods mit Istio-Sidecar	✅	Automatische Injection funktioniert
istio-ingressgateway	✅	Ersetzt manuelle Gateway-Pods
istio-egressgateway	✅	Für Cross-Cluster Traffic
PeerAuthentication (STRICT)	✅	Nur mTLS erlaubt
DestinationRule (ISTIO_MUTUAL)	✅	mTLS zwischen Services
Multi-Cluster Routing	✅	Via ServiceEntries

