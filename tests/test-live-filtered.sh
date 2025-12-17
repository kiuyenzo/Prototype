#!/bin/bash

#############################################################################
# LIVE Filtered Log Test - Zeigt nur wichtige Logs in 3 Phasen
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

# Filter pattern for important messages
FILTER='Phase|VP|Sending|Received|encrypted|verified|authenticated|Session|SERVICE|Error|error|Creating|Resolve|DID|Fetching|did.json'

# Phase tracking
PHASE1_SHOWN=false
PHASE2_SHOWN=false
PHASE3_SHOWN=false

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
echo "║              E2E FLOW TEST - 3 Phasen Live                               ║"
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

echo -e "${GREEN}✓ Beide Cluster erreichbar${NC}"
echo ""

#############################################################################
# START LIVE LOG STREAMS (FILTERED WITH PHASE DETECTION)
#############################################################################

echo -e "${DIM}(Press Ctrl+C to stop)${NC}"
echo ""

# Start time for filtering
START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Temp files for phase tracking
PHASE_FILE=$(mktemp)
echo "0" > "$PHASE_FILE"

# Function to format log with phase detection
format_log() {
    local prefix=$1
    local color=$2

    while IFS= read -r line; do
        current_phase=$(cat "$PHASE_FILE")

        # Detect Phase 1: Service Request triggers VP Auth
        if [[ "$line" == *"SERVICE_REQUEST received"* ]] && [[ "$current_phase" == "0" ]]; then
            echo "1" > "$PHASE_FILE"
            echo ""
            echo -e "${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo -e "${BOLD}${YELLOW}  PHASE 1: Service Request → VP Auth Trigger${NC}"
            echo -e "${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        fi

        # Detect Phase 2: VP Exchange (when NF-B handles VP Auth Request)
        if [[ "$line" == *"Phase 2: Handling VP Auth Request"* ]] && [[ "$current_phase" == "1" ]]; then
            echo "2" > "$PHASE_FILE"
            echo ""
            echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo -e "${BOLD}${GREEN}  PHASE 2: Mutual VP Authentication (VP Exchange)${NC}"
            echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        fi

        # Detect Phase 3: Auth Confirmation or already authenticated service traffic
        if [[ "$line" == *"Phase 3: Handling Auth Confirmation"* ]] || [[ "$line" == *"Phase 3: Sending queued"* ]]; then
            if [[ "$current_phase" == "2" ]]; then
                echo "3" > "$PHASE_FILE"
                echo ""
                echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo -e "${BOLD}${CYAN}  PHASE 3: Authorized Service Traffic${NC}"
                echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            fi
        fi

        # Detect already authenticated session (skip to phase 3)
        if [[ "$line" == *"authenticated session exists"* ]] && [[ "$current_phase" == "1" ]]; then
            echo "3" > "$PHASE_FILE"
            echo ""
            echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo -e "${BOLD}${CYAN}  (Session already authenticated - skipping Phase 2)${NC}"
            echo -e "${BOLD}${CYAN}  PHASE 3: Authorized Service Traffic${NC}"
            echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        fi

        # Print the log line
        echo -e "${color}[${prefix}]${NC} $line"

        # Detect completion (works for both phase 2->3 and already authenticated)
        if [[ "$line" == *"SERVICE_RESPONSE"* ]] && [[ "$current_phase" == "3" ]]; then
            echo ""
            echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo -e "${BOLD}${GREEN}  ✅ E2E FLOW COMPLETE${NC}"
            echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        fi
    done
}

# Start background log streams with phase detection
(
    kubectl logs -f deployment/nf-a -n nf-a-namespace --context kind-cluster-a --since-time="$START_TIME" 2>/dev/null | \
    grep --line-buffered -E "$FILTER" | \
    format_log "NF-A" "$MAGENTA"
) &
LOG_A_PID=$!

(
    kubectl logs -f deployment/nf-b -n nf-b-namespace --context kind-cluster-b --since-time="$START_TIME" 2>/dev/null | \
    grep --line-buffered -E "$FILTER" | \
    format_log "NF-B" "$CYAN"
) &
LOG_B_PID=$!

# Give logs a moment to start
sleep 1

#############################################################################
# SEND SERVICE REQUEST
#############################################################################

echo -e "${BOLD}${BLUE}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${BLUE}  Sending Service Request...${NC}"
echo -e "${BOLD}${BLUE}═══════════════════════════════════════════════════════════════════════════${NC}"

curl -s -X POST "$NF_A_URL/didcomm/service" \
    -H "Content-Type: application/json" \
    -d "{
        \"targetDid\": \"$DID_NF_B\",
        \"service\": \"nf-info\",
        \"action\": \"get\"
    }" > /dev/null 2>&1

# Wait for user to stop
wait

# Cleanup temp file
rm -f "$PHASE_FILE"
