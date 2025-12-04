#!/bin/bash
# Anwendung aller YAML-Dateien auf AWS EKS Cluster
# Führen Sie dieses Skript aus, nachdem beide Cluster ACTIVE sind

set -e  # Exit bei Fehler

echo "======================================"
echo "AWS EKS - YAML Deployment Script"
echo "======================================"

AWS_REGION="eu-central-1"

# Farben
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# ====================================
# SCHRITT 1: Kubeconfig aktualisieren
# ====================================

echo -e "\n${GREEN}=== Schritt 1: Kubeconfig Setup ===${NC}"

echo -e "${BLUE}→ Verbinde mit AWS Cluster-A...${NC}"
aws eks update-kubeconfig --region ${AWS_REGION} --name cluster-a --alias aws-cluster-a

echo -e "${BLUE}→ Verbinde mit AWS Cluster-B...${NC}"
aws eks update-kubeconfig --region ${AWS_REGION} --name cluster-b --alias aws-cluster-b

echo -e "${GREEN}✓ Kubeconfig aktualisiert${NC}"
echo -e "\n${BLUE}Verfügbare Kontexte:${NC}"
kubectl config get-contexts | grep aws-cluster

# ====================================
# SCHRITT 2: Istio Installation
# ====================================

echo -e "\n${GREEN}=== Schritt 2: Istio installieren ===${NC}"

# Cluster A
echo -e "\n${BLUE}→ Installiere Istio in Cluster-A...${NC}"
kubectl config use-context aws-cluster-a
istioctl install --set profile=demo -y

echo -e "${BLUE}→ Warte auf Istio Pods in Cluster-A...${NC}"
kubectl wait --for=condition=ready pod -l app=istiod -n istio-system --timeout=300s
kubectl wait --for=condition=ready pod -l app=istio-ingressgateway -n istio-system --timeout=300s
echo -e "${GREEN}✓ Istio in Cluster-A ready${NC}"

# Cluster B
echo -e "\n${BLUE}→ Installiere Istio in Cluster-B...${NC}"
kubectl config use-context aws-cluster-b
istioctl install --set profile=demo -y

echo -e "${BLUE}→ Warte auf Istio Pods in Cluster-B...${NC}"
kubectl wait --for=condition=ready pod -l app=istiod -n istio-system --timeout=300s
kubectl wait --for=condition=ready pod -l app=istio-ingressgateway -n istio-system --timeout=300s
echo -e "${GREEN}✓ Istio in Cluster-B ready${NC}"

# ====================================
# SCHRITT 3: Namespaces + Sidecar Injection
# ====================================

echo -e "\n${GREEN}=== Schritt 3: Namespaces erstellen ===${NC}"

# Cluster A
echo -e "\n${BLUE}→ Setup nf-a-namespace...${NC}"
kubectl config use-context aws-cluster-a
kubectl create namespace nf-a-namespace
kubectl label namespace nf-a-namespace istio-injection=enabled
echo -e "${GREEN}✓ nf-a-namespace ready${NC}"

# Cluster B
echo -e "\n${BLUE}→ Setup nf-b-namespace...${NC}"
kubectl config use-context aws-cluster-b
kubectl create namespace nf-b-namespace
kubectl label namespace nf-b-namespace istio-injection=enabled
echo -e "${GREEN}✓ nf-b-namespace ready${NC}"

# ====================================
# SCHRITT 4: NF Deployments (Ihre YAMLs!)
# ====================================

echo -e "\n${GREEN}=== Schritt 4: Deploy NF Applications ===${NC}"

# Cluster A - NF-A
echo -e "\n${BLUE}→ Deploy nf-a (aus cluster-a/nf-a.yaml)...${NC}"
kubectl config use-context aws-cluster-a
kubectl apply -f cluster-a/nf-a.yaml
echo -e "${GREEN}✓ nf-a.yaml applied${NC}"

# Cluster B - NF-B
echo -e "\n${BLUE}→ Deploy nf-b (aus cluster-b/nf-b.yaml)...${NC}"
kubectl config use-context aws-cluster-b
kubectl apply -f cluster-b/nf-b.yaml
echo -e "${GREEN}✓ nf-b.yaml applied${NC}"

# Warten auf Pods
echo -e "\n${BLUE}→ Warte auf Pods (3/3 ready: nf-app + veramo + istio-proxy)...${NC}"
kubectl config use-context aws-cluster-a
kubectl wait --for=condition=ready pod -l app=nf-a -n nf-a-namespace --timeout=300s
echo -e "${GREEN}✓ nf-a Pod ready (3/3 containers)${NC}"

kubectl config use-context aws-cluster-b
kubectl wait --for=condition=ready pod -l app=nf-b -n nf-b-namespace --timeout=300s
echo -e "${GREEN}✓ nf-b Pod ready (3/3 containers)${NC}"

# ====================================
# SCHRITT 5: Services
# ====================================

echo -e "\n${GREEN}=== Schritt 5: Kubernetes Services ===${NC}"

# Cluster A
echo -e "\n${BLUE}→ Deploy Services in Cluster-A...${NC}"
kubectl config use-context aws-cluster-a
kubectl apply -f cluster-a/nf-a-service.yaml
echo -e "${GREEN}✓ nf-a-service.yaml applied${NC}"

# Cluster B
echo -e "\n${BLUE}→ Deploy Services in Cluster-B...${NC}"
kubectl config use-context aws-cluster-b
kubectl apply -f cluster-b/nf-b-service.yaml
echo -e "${GREEN}✓ nf-b-service.yaml applied${NC}"

# ====================================
# SCHRITT 6: mTLS Konfiguration
# ====================================

echo -e "\n${GREEN}=== Schritt 6: mTLS aktivieren ===${NC}"

# Cluster A
echo -e "\n${BLUE}→ Apply istio-mtls-a.yaml...${NC}"
kubectl config use-context aws-cluster-a
kubectl apply -f cluster-a/istio-mtls-a.yaml
echo -e "${GREEN}✓ mTLS in Cluster-A aktiviert (STRICT mode)${NC}"

# Cluster B
echo -e "\n${BLUE}→ Apply istio-mtls-b.yaml...${NC}"
kubectl config use-context aws-cluster-b
kubectl apply -f cluster-b/istio-mtls-b.yaml
echo -e "${GREEN}✓ mTLS in Cluster-B aktiviert (STRICT mode)${NC}"

# ====================================
# SCHRITT 7: Istio Gateways
# ====================================

echo -e "\n${GREEN}=== Schritt 7: Istio Gateways ===${NC}"

# Cluster A
echo -e "\n${BLUE}→ Deploy Gateways in Cluster-A...${NC}"
kubectl config use-context aws-cluster-a
kubectl apply -f cluster-a/istio-gateway-a.yaml
kubectl apply -f cluster-a/istio-gateway-didcomm-passthrough.yaml
echo -e "${GREEN}✓ Gateways in Cluster-A deployed${NC}"

# Cluster B
echo -e "\n${BLUE}→ Deploy Gateways in Cluster-B...${NC}"
kubectl config use-context aws-cluster-b
kubectl apply -f cluster-b/istio-gateway-b.yaml
kubectl apply -f cluster-b/istio-gateway-didcomm-passthrough.yaml
echo -e "${GREEN}✓ Gateways in Cluster-B deployed${NC}"

# ====================================
# SCHRITT 8: VirtualServices
# ====================================

echo -e "\n${GREEN}=== Schritt 8: VirtualServices ===${NC}"

# Cluster A
echo -e "\n${BLUE}→ Deploy VirtualServices in Cluster-A...${NC}"
kubectl config use-context aws-cluster-a
kubectl apply -f cluster-a/istio-virtualservice-a.yaml
kubectl apply -f cluster-a/istio-virtualservice-didcomm.yaml
echo -e "${GREEN}✓ VirtualServices in Cluster-A deployed${NC}"

# Cluster B
echo -e "\n${BLUE}→ Deploy VirtualServices in Cluster-B...${NC}"
kubectl config use-context aws-cluster-b
kubectl apply -f cluster-b/istio-virtualservice-b.yaml
kubectl apply -f cluster-b/istio-virtualservice-didcomm.yaml
echo -e "${GREEN}✓ VirtualServices in Cluster-B deployed${NC}"

# ====================================
# SCHRITT 9: DestinationRules
# ====================================

echo -e "\n${GREEN}=== Schritt 9: DestinationRules ===${NC}"

# Cluster A
echo -e "\n${BLUE}→ Apply istio-destinationrule-didcomm.yaml in Cluster-A...${NC}"
kubectl config use-context aws-cluster-a
kubectl apply -f cluster-a/istio-destinationrule-didcomm.yaml
echo -e "${GREEN}✓ DestinationRule in Cluster-A applied${NC}"

# Cluster B
echo -e "\n${BLUE}→ Apply istio-destinationrule-didcomm.yaml in Cluster-B...${NC}"
kubectl config use-context aws-cluster-b
kubectl apply -f cluster-b/istio-destinationrule-didcomm.yaml
echo -e "${GREEN}✓ DestinationRule in Cluster-B applied${NC}"

# ====================================
# SCHRITT 10: Authorization Policies
# ====================================

echo -e "\n${GREEN}=== Schritt 10: Zero Trust Policies ===${NC}"

# Cluster A
echo -e "\n${BLUE}→ Apply istio-authz-policy-didcomm.yaml in Cluster-A...${NC}"
kubectl config use-context aws-cluster-a
kubectl apply -f cluster-a/istio-authz-policy-didcomm.yaml
echo -e "${GREEN}✓ AuthorizationPolicy in Cluster-A applied${NC}"

# Cluster B
echo -e "\n${BLUE}→ Apply istio-authz-policy-didcomm.yaml in Cluster-B...${NC}"
kubectl config use-context aws-cluster-b
kubectl apply -f cluster-b/istio-authz-policy-didcomm.yaml
echo -e "${GREEN}✓ AuthorizationPolicy in Cluster-B applied${NC}"

# ====================================
# SCHRITT 11: LoadBalancer IPs holen
# ====================================

echo -e "\n${GREEN}=== Schritt 11: LoadBalancer Informationen ===${NC}"

echo -e "\n${BLUE}→ Hole LoadBalancer DNS von Cluster-A...${NC}"
kubectl config use-context aws-cluster-a
sleep 30  # Warte auf LoadBalancer Provisionierung
CLUSTER_A_LB=$(kubectl get svc istio-ingressgateway -n istio-system -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')

if [ -z "$CLUSTER_A_LB" ]; then
    echo -e "${YELLOW}⚠ LoadBalancer noch nicht bereit, warte 30 Sekunden...${NC}"
    sleep 30
    CLUSTER_A_LB=$(kubectl get svc istio-ingressgateway -n istio-system -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
fi

echo -e "${GREEN}Cluster-A LoadBalancer: ${CLUSTER_A_LB}${NC}"

echo -e "\n${BLUE}→ Hole LoadBalancer DNS von Cluster-B...${NC}"
kubectl config use-context aws-cluster-b
CLUSTER_B_LB=$(kubectl get svc istio-ingressgateway -n istio-system -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')

if [ -z "$CLUSTER_B_LB" ]; then
    echo -e "${YELLOW}⚠ LoadBalancer noch nicht bereit, warte 30 Sekunden...${NC}"
    sleep 30
    CLUSTER_B_LB=$(kubectl get svc istio-ingressgateway -n istio-system -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
fi

echo -e "${GREEN}Cluster-B LoadBalancer: ${CLUSTER_B_LB}${NC}"

# Speichern
cat > aws-loadbalancer-info.txt <<EOF
CLUSTER_A_LB=${CLUSTER_A_LB}
CLUSTER_B_LB=${CLUSTER_B_LB}

# Für ServiceEntry verwenden:
# Cluster-A zeigt auf Cluster-B: address: ${CLUSTER_B_LB}
# Cluster-B zeigt auf Cluster-A: address: ${CLUSTER_A_LB}
# Port: 443 (nicht 31598/30217!)
EOF

echo -e "\n${GREEN}✓ LoadBalancer Info gespeichert in: aws-loadbalancer-info.txt${NC}"

# ====================================
# SCHRITT 12: ServiceEntry (WARNUNG)
# ====================================

echo -e "\n${YELLOW}=== Schritt 12: ServiceEntry - MANUELLE ANPASSUNG NÖTIG! ===${NC}"
echo ""
echo -e "${RED}⚠ WICHTIG: ServiceEntry-Dateien müssen angepasst werden!${NC}"
echo ""
echo -e "${BLUE}Aktuell in Ihren YAMLs (für KinD):${NC}"
echo "  cluster-a/istio-serviceentry-didcomm.yaml:"
echo "    address: 172.23.0.3  # ← Docker IP"
echo "    https: 31598         # ← NodePort"
echo ""
echo -e "${GREEN}Muss geändert werden zu (für AWS):${NC}"
echo "  cluster-a/istio-serviceentry-didcomm.yaml:"
echo "    resolution: DNS      # ← Von STATIC zu DNS"
echo "    address: ${CLUSTER_B_LB}"
echo "    https: 443           # ← LoadBalancer Port"
echo ""
echo -e "${BLUE}Führen Sie aus:${NC}"
echo "  1. Bearbeiten Sie cluster-a/istio-serviceentry-didcomm.yaml"
echo "  2. Bearbeiten Sie cluster-b/istio-serviceentry-didcomm.yaml"
echo "  3. Dann:"
echo "     kubectl config use-context aws-cluster-a"
echo "     kubectl apply -f cluster-a/istio-serviceentry-didcomm.yaml"
echo "     kubectl config use-context aws-cluster-b"
echo "     kubectl apply -f cluster-b/istio-serviceentry-didcomm.yaml"

# ====================================
# ZUSAMMENFASSUNG
# ====================================

echo -e "\n${GREEN}======================================"
echo "Deployment Zusammenfassung"
echo "======================================${NC}"

echo -e "\n${BLUE}Cluster-A Status:${NC}"
kubectl config use-context aws-cluster-a
kubectl get pods -n nf-a-namespace
echo ""
kubectl get svc -n istio-system istio-ingressgateway

echo -e "\n${BLUE}Cluster-B Status:${NC}"
kubectl config use-context aws-cluster-b
kubectl get pods -n nf-b-namespace
echo ""
kubectl get svc -n istio-system istio-ingressgateway

echo -e "\n${GREEN}✓✓✓ Deployment abgeschlossen! ✓✓✓${NC}"
echo -e "\n${YELLOW}Nächste Schritte:${NC}"
echo "  1. Passen Sie die ServiceEntry-Dateien an (siehe Schritt 12)"
echo "  2. Testen Sie die Verbindung zwischen Clustern"
echo "  3. Überprüfen Sie: cat aws-loadbalancer-info.txt"
