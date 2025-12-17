#!/bin/bash

#############################################################################
# LIVE Log Test - Zeigt Logs in Echtzeit während des Flows
#############################################################################

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

# Konfiguration
NF_A_URL="http://localhost:30451"
NF_B_URL="http://localhost:30452"
DID_NF_B="did:web:kiuyenzo.github.io:Prototype:cluster-b:did-nf-b"

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Stopping log streams...${NC}"
    kill $LOG_A_PID $LOG_B_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

clear

echo -e "${BOLD}${BLUE}"
echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║              LIVE LOG STREAM - VP Auth + Service Flow                    ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

#############################################################################
# PRE-CHECK
#############################################################################

NF_A_OK=$(curl -s "$NF_A_URL/health" 2>/dev/null | grep -c "ok")
NF_B_OK=$(curl -s "$NF_B_URL/health" 2>/dev/null | grep -c "ok")

if [ "$NF_A_OK" -eq 0 ] || [ "$NF_B_OK" -eq 0 ]; then
    echo -e "${RED}Cluster nicht erreichbar! Port-Forwarding starten:${NC}"
    echo "  kubectl port-forward svc/veramo-nf-a 30451:3000 -n nf-a-namespace --context kind-cluster-a &"
    echo "  kubectl port-forward svc/veramo-nf-b 30452:3001 -n nf-b-namespace --context kind-cluster-b &"
    exit 1
fi

echo -e "${GREEN}Beide Cluster erreichbar${NC}"
echo ""

#############################################################################
# START LIVE LOG STREAMS
#############################################################################

echo -e "${BOLD}${CYAN}Starting live log streams...${NC}"
echo -e "${DIM}(Press Ctrl+C to stop)${NC}"
echo ""

# Start time for filtering
START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Start background log streams with colors
(
    kubectl logs -f deployment/nf-a -n nf-a-namespace --context kind-cluster-a --since-time="$START_TIME" 2>/dev/null | \
    while IFS= read -r line; do
        echo -e "${MAGENTA}[NF-A]${NC} $line"
    done
) &
LOG_A_PID=$!

(
    kubectl logs -f deployment/nf-b -n nf-b-namespace --context kind-cluster-b --since-time="$START_TIME" 2>/dev/null | \
    while IFS= read -r line; do
        echo -e "${CYAN}[NF-B]${NC} $line"
    done
) &
LOG_B_PID=$!

# Give logs a moment to start
sleep 1

#############################################################################
# SEND SERVICE REQUEST
#############################################################################

echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Sending Service Request (triggers VP Auth + Service)${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo ""

curl -s -X POST "$NF_A_URL/didcomm/service" \
    -H "Content-Type: application/json" \
    -d "{
        \"targetDid\": \"$DID_NF_B\",
        \"service\": \"nf-info\",
        \"action\": \"get\"
    }" > /dev/null 2>&1

echo -e "${GREEN}Request sent! Watching logs...${NC}"
echo -e "${DIM}(Flow should complete in ~3-5 seconds)${NC}"
echo ""

# Wait for user to stop or timeout
wait
