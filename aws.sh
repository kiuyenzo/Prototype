# 1. AWS CLI installieren
brew install awscli

# 2. AWS konfigurieren
aws configure
# AWS Access Key ID: [Ihre Key]
# AWS Secret Access Key: [Ihr Secret]
# Default region: eu-central-1  # oder us-east-1

# 3. eksctl installieren (EKS CLI Tool)
brew tap weaveworks/tap
brew install weaveworks/tap/eksctl

# 4. Cluster A erstellen
eksctl create cluster \
  --name cluster-test \
  --region eu-central-1 \
  --nodegroup-name nf-test \
  --node-type t2.micro \
  --nodes 2 \
  --nodes-min 1 \
  --nodes-max 3 \
  --managed

# 5. Cluster B erstellen
eksctl create cluster \
  --name cluster-b \
  --region eu-central-1 \
  --nodegroup-name nf-b-nodes \
  --node-type t3.small \
  --nodes 2 \
  --nodes-min 1 \
  --nodes-max 3 \
  --managed

# 6. Kontexte überprüfen
kubectl config get-contexts

# Beide gleichzeitig löschen (schneller)
eksctl delete cluster --name cluster-a --region eu-central-1 &
eksctl delete cluster --name cluster-b --region eu-central-1 &
eksctl delete cluster --name cluster-test --region eu-central-1

