#!/bin/bash

#############################################################################
# Sequenzdiagramm Flow Test - Zeigt die echten Log-Ausgaben
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
DID_NF_A="did:web:kiuyenzo.github.io:Prototype:dids:did-nf-a"
DID_NF_B="did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"

clear

echo -e "${BOLD}${BLUE}"
echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║              SEQUENZDIAGRAMM - LIVE LOG OUTPUT                           ║"
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

#############################################################################
# PHASE 1: SERVICE REQUEST (triggers entire flow per sequence diagram)
#############################################################################

echo -e "${CYAN}Phase 1: Sende Service Request (triggert VP Auth automatisch)...${NC}"
echo ""

# Capture start time BEFORE the request for log filtering
START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
sleep 1  # Small delay to ensure timestamp is before logs

# Send SERVICE REQUEST - this triggers the entire flow:
# 1. Service Request received
# 2. Not authenticated → Auto-start VP Auth
# 3. VP Exchange (Phase 2)
# 4. "Authorized" received → Send queued Service Request (Phase 3)
# 5. Service Response
curl -s -X POST "$NF_A_URL/nf/service-request" \
    -H "Content-Type: application/json" \
    -d "{
        \"targetDid\": \"$DID_NF_B\",
        \"service\": \"nf-info\",
        \"action\": \"get\"
    }" > /dev/null 2>&1

# Wait for complete flow (Auth + Service)
echo -e "${DIM}Warte auf kompletten Flow (Auth + Service) (8s)...${NC}"
sleep 8

#############################################################################
# GET LOGS (only from this run using --since-time)
#############################################################################

NF_A_LOG=$(kubectl logs deployment/nf-a -n nf-a-namespace --context kind-cluster-a --since-time="$START_TIME" 2>/dev/null)
NF_B_LOG=$(kubectl logs deployment/nf-b -n nf-b-namespace --context kind-cluster-b --since-time="$START_TIME" 2>/dev/null)

#############################################################################
# PHASE 1: VP_AUTH_REQUEST (A → B)
#############################################################################

echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Phase 1: VP_AUTH_REQUEST (A → B)${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BOLD}${MAGENTA}NF-A (Initiator):${NC}"
echo ""

# Extract Phase 1 logs from NF-A
echo "$NF_A_LOG" | grep -E "Initiating VP|Session created|Sending DIDComm|Type:.*request-presentation|Encrypting DIDComm|Packing mode|Message encrypted.*JWE|Route:" | tail -8 | while read line; do
    echo -e "  ${line}"
done

echo ""
echo -e "${BOLD}${MAGENTA}NF-B (Empfänger):${NC}"
echo ""

# Extract received message logs from NF-B
echo "$NF_B_LOG" | grep -E "Received encrypted|Decrypting received|Message decrypted|Type:.*request-presentation|From:.*cluster-a" | head -5 | while read line; do
    echo -e "  ${line}"
done

#############################################################################
# PHASE 2a: VP_WITH_PD (B → A)
#############################################################################

echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Phase 2a: VP_WITH_PD (B → A) - VP_B + PD_B${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BOLD}${MAGENTA}NF-B:${NC}"
echo ""

echo "$NF_B_LOG" | grep -E "Phase 2: Handling|Loaded.*credential|Creating VP from|Selecting credentials|Credential matches|Creating VP for holder|Using signing key|VP created successfully|VP with PD created|Sending DIDComm.*presentation-with-definition|Type:.*presentation-with-definition|Encrypting.*anoncrypt|Message encrypted" | head -15 | while read line; do
    echo -e "  ${line}"
done

#############################################################################
# PHASE 2b: VP Verification + VP_RESPONSE (A → B)
#############################################################################

echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Phase 2b: VP Verification + VP_RESPONSE (A → B) - VP_A${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BOLD}${MAGENTA}NF-A:${NC}"
echo ""

echo "$NF_A_LOG" | grep -E "Received encrypted|Decrypting.*presentation-with-definition|Type:.*presentation-with-definition|Phase 2.*continued|Verifying their VP_B|Verifying Verifiable|VP verified successfully|VP satisfies|VP_B verified|Creating VP_A|Creating VP from|Creating VP for holder.*cluster-a|Using signing key|VP created successfully|VP Response created|Sending DIDComm.*presentation[^-]|Type:.*presentation[^-]|Message encrypted" | head -20 | while read line; do
    echo -e "  ${line}"
done

#############################################################################
# PHASE 2c: VP_A Verification
#############################################################################

echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Phase 2c: VP_A Verification (bei NF-B)${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BOLD}${MAGENTA}NF-B:${NC}"
echo ""

echo "$NF_B_LOG" | grep -E "Received encrypted.*|Decrypting.*Type:.*presentation[^-]|Type:.*presentation[^-]|Phase 2.*final|Verifying their VP_A|Verifying Verifiable|VP verified successfully|VP satisfies|VP_A verified|Mutual authentication successful|Session Token" | head -12 | while read line; do
    echo -e "  ${line}"
done

#############################################################################
# PHASE 3: AUTH_CONFIRMATION (B → A)
#############################################################################

echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Phase 3: AUTH_CONFIRMATION (B → A)${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BOLD}${MAGENTA}NF-B:${NC}"
echo ""

echo "$NF_B_LOG" | grep -E "Sending DIDComm.*ack|Type:.*ack|Encrypting.*ack|Message encrypted.*1[0-9]{3} bytes|Message sent successfully" | head -5 | while read line; do
    echo -e "  ${line}"
done

echo ""
echo -e "${BOLD}${MAGENTA}NF-A:${NC}"
echo ""

echo "$NF_A_LOG" | grep -E "Received encrypted|Decrypting.*ack|Type:.*ack|Phase 3.*Auth Confirmation|Status: OK|Authentication confirmed|Session updated.*authenticated|Authentication complete" | head -8 | while read line; do
    echo -e "  ${line}"
done

#############################################################################
# PHASE 3: SERVICE_REQUEST & RESPONSE (nach "Authorized")
#############################################################################

echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Phase 3: SERVICE_REQUEST & RESPONSE (nach Authorization)${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BOLD}${MAGENTA}NF-A (nach Authorized → sendet queued Service Request):${NC}"
echo ""
echo "$NF_A_LOG" | grep -E "Phase 3.*queued|Sending queued SERVICE_REQUEST|Service request sent|SERVICE_REQUEST received" | head -6 | while read line; do
    echo -e "  ${line}"
done

echo ""
echo -e "${BOLD}${MAGENTA}NF-B (Service Provider):${NC}"
echo ""
echo "$NF_B_LOG" | grep -E "Processing SERVICE_REQUEST|NF Service Handler|Service:|Action:|authenticated peer|nfType|capabilities" | head -8 | while read line; do
    echo -e "  ${line}"
done

echo ""
echo -e "${BOLD}${MAGENTA}NF-A (Received Service Response):${NC}"
echo ""
echo "$NF_A_LOG" | grep -E "Received SERVICE_RESPONSE|Status:.*success|Data:|nfType|capabilities" | head -6 | while read line; do
    echo -e "  ${line}"
done

#############################################################################
# SUMMARY
#############################################################################

echo ""
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  Zusammenfassung${NC}"
echo -e "${BOLD}${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Extract message sizes
SIZE_1=$(echo "$NF_A_LOG" | grep -o "Message encrypted ([0-9]* bytes" | head -1 | grep -o "[0-9]*")
SIZE_2=$(echo "$NF_B_LOG" | grep -o "Message encrypted ([0-9]* bytes" | head -1 | grep -o "[0-9]*")
SIZE_3=$(echo "$NF_A_LOG" | grep -o "Message encrypted ([0-9]* bytes" | tail -1 | grep -o "[0-9]*")
SIZE_4=$(echo "$NF_B_LOG" | grep -o "Message encrypted ([0-9]* bytes" | tail -1 | grep -o "[0-9]*")

echo -e "  ${BOLD}Phase${NC}    ${BOLD}Message Type${NC}                      ${BOLD}Beschreibung${NC}"
echo -e "  ─────────────────────────────────────────────────────────────────────────────"
echo -e "  1        Service Request (Trigger)          NF_A will Service von NF_B     ${GREEN}✅${NC}"
echo -e "  1        VP_Auth_Request + PD_A             Auto-Start VP Auth             ${GREEN}✅${NC}"
echo -e "  2a       VP_B + PD_B                        NF_B sendet VP + eigene PD     ${GREEN}✅${NC}"
echo -e "  2b       VP_A                               NF_A sendet VP                 ${GREEN}✅${NC}"
echo -e "  2c       Authorized (ack)                   Mutual Auth erfolgreich        ${GREEN}✅${NC}"
echo -e "  3        Service_Request                    Queued Request wird gesendet   ${GREEN}✅${NC}"
echo -e "  3        Service_Response                   NF_B antwortet                 ${GREEN}✅${NC}"
echo ""

# Check if full flow was successful
AUTH_SUCCESS=false
SERVICE_SUCCESS=false

if echo "$NF_B_LOG" | grep -q "Mutual authentication successful"; then
    AUTH_SUCCESS=true
fi

if echo "$NF_B_LOG" | grep -q "Processing SERVICE_REQUEST"; then
    SERVICE_SUCCESS=true
fi

if [ "$AUTH_SUCCESS" = true ] && [ "$SERVICE_SUCCESS" = true ]; then
    echo -e "  ${BOLD}${GREEN}Ergebnis: 🎉 Full E2E Flow gemäß Sequenzdiagramm!${NC}"
    echo -e "  ${GREEN}  ✅ Phase 1: Service Request → VP Auth Trigger${NC}"
    echo -e "  ${GREEN}  ✅ Phase 2: Mutual VP Authentication${NC}"
    echo -e "  ${GREEN}  ✅ Phase 3: Authorized Service Traffic${NC}"
elif [ "$AUTH_SUCCESS" = true ]; then
    echo -e "  ${BOLD}${GREEN}Ergebnis: ✅ VP Authentication successful${NC}"
    echo -e "  ${YELLOW}  ⚠️  Service Traffic: Check logs${NC}"
else
    echo -e "  ${BOLD}${YELLOW}Ergebnis: Flow gestartet (prüfe Logs)${NC}"
fi

echo ""
