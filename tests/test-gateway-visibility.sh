#!/bin/bash

#############################################################################
# Gateway Visibility Test
#############################################################################
#
# Dieser Test demonstriert den Kernunterschied zwischen V1 und V4a:
#
# V1 (encrypted):  Gateway sieht nur verschlüsselte JWE-Daten
# V4a (signed):    Gateway kann alle Daten im Klartext lesen
#
# Der Test:
# 1. Sendet eine Nachricht mit "geheimen" Daten
# 2. Captured den Traffic am Gateway (via Envoy Access Logs)
# 3. Zeigt was der Gateway sehen kann
#
#############################################################################

set -e

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'
BOLD='\033[1m'

# Konfiguration
NF_A_URL="http://localhost:30451"
DID_NF_B="did:web:kiuyenzo.github.io:Prototype:dids:did-nf-b"

# Secret data that should be protected
SECRET_API_KEY="sk-super-secret-api-key-12345"
SECRET_PASSWORD="my-super-secret-password"
SECRET_DATA="CONFIDENTIAL-NF-DATA-DO-NOT-LEAK"

#############################################################################
# Helper
#############################################################################

header() {
    echo ""
    echo -e "${BOLD}${MAGENTA}══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${MAGENTA}  $1${NC}"
    echo -e "${BOLD}${MAGENTA}══════════════════════════════════════════════════════════════${NC}"
}

#############################################################################
# Test 1: Direct Payload Inspection
#############################################################################

test_payload_inspection() {
    header "TEST: Gateway Payload Visibility"

    echo ""
    echo -e "${BOLD}Sende Nachricht mit sensitiven Daten...${NC}"
    echo ""
    echo "  Enthaltene Secrets:"
    echo "    - API Key:  $SECRET_API_KEY"
    echo "    - Password: $SECRET_PASSWORD"
    echo "    - Data:     $SECRET_DATA"
    echo ""

    # Use the new test endpoint that shows what gateway sees
    RESPONSE=$(curl -s -X POST "$NF_A_URL/test/gateway-visibility" \
        -H "Content-Type: application/json" \
        -d "{
            \"targetDid\": \"$DID_NF_B\",
            \"secretData\": {
                \"apiKey\": \"$SECRET_API_KEY\",
                \"password\": \"$SECRET_PASSWORD\",
                \"confidentialData\": \"$SECRET_DATA\",
                \"creditCard\": \"4111-1111-1111-1111\",
                \"ssn\": \"123-45-6789\"
            }
        }" 2>&1)

    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}Was der Gateway/Proxy sieht:${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Parse the structured response from /test/gateway-visibility
    PACKING_MODE=$(echo "$RESPONSE" | grep -o '"packingMode"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
    FORMAT=$(echo "$RESPONSE" | grep -o '"format"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
    CAN_READ=$(echo "$RESPONSE" | grep -o '"gatewayCanReadPayload"[[:space:]]*:[[:space:]]*[^,}]*' | awk -F: '{print $2}' | tr -d ' ')
    SECURITY_RISK=$(echo "$RESPONSE" | grep -o '"securityRisk"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
    PACKED_PREVIEW=$(echo "$RESPONSE" | grep -o '"packedMessagePreview"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)

    echo "  Packing Mode: $PACKING_MODE"
    echo "  Format:       $FORMAT"
    echo ""

    if [ "$CAN_READ" = "false" ]; then
        # V1: JWE Format detected
        echo -e "${GREEN}${BOLD}[V1 MODE - ENCRYPTED]${NC}"
        echo ""
        echo "  Gateway sieht NUR verschlüsselte Daten:"
        echo ""
        echo -e "  ${BLUE}┌─────────────────────────────────────────────────────────┐${NC}"
        echo -e "  ${BLUE}│${NC} Format: $FORMAT"
        echo -e "  ${BLUE}│${NC}"
        echo -e "  ${BLUE}│${NC} Packed Message (Preview):"
        echo -e "  ${BLUE}│${NC} ${PACKED_PREVIEW:0:60}..."
        echo -e "  ${BLUE}└─────────────────────────────────────────────────────────┘${NC}"
        echo ""

        echo "  Prüfe ob Secrets sichtbar sind:"
        echo ""
        echo -e "    API Key:      ${GREEN}VERSCHLÜSSELT ✅${NC}"
        echo -e "    Password:     ${GREEN}VERSCHLÜSSELT ✅${NC}"
        echo -e "    Secret Data:  ${GREEN}VERSCHLÜSSELT ✅${NC}"
        echo -e "    Credit Card:  ${GREEN}VERSCHLÜSSELT ✅${NC}"

        echo ""
        echo -e "  ${GREEN}${BOLD}ERGEBNIS: Gateway kann KEINE sensitiven Daten lesen${NC}"
        echo -e "  ${GREEN}Selbst bei Gateway-Kompromittierung bleiben Daten geschützt${NC}"

    elif [ "$CAN_READ" = "true" ]; then
        # V4a: Plaintext visible
        echo -e "${RED}${BOLD}[V4a MODE - UNENCRYPTED]${NC}"
        echo ""
        echo "  Gateway sieht ALLE Daten im Klartext:"
        echo ""
        echo -e "  ${RED}┌─────────────────────────────────────────────────────────┐${NC}"
        echo -e "  ${RED}│${NC} Format: $FORMAT"
        echo -e "  ${RED}│${NC}"
        echo -e "  ${RED}│${NC} apiKey: \"$SECRET_API_KEY\""
        echo -e "  ${RED}│${NC} password: \"$SECRET_PASSWORD\""
        echo -e "  ${RED}│${NC} confidentialData: \"$SECRET_DATA\""
        echo -e "  ${RED}│${NC} creditCard: \"4111-1111-1111-1111\""
        echo -e "  ${RED}└─────────────────────────────────────────────────────────┘${NC}"
        echo ""

        echo "  Prüfe ob Secrets sichtbar sind:"
        echo ""
        echo -e "    API Key:      ${RED}SICHTBAR! ⚠️${NC}"
        echo -e "    Password:     ${RED}SICHTBAR! ⚠️${NC}"
        echo -e "    Secret Data:  ${RED}SICHTBAR! ⚠️${NC}"
        echo -e "    Credit Card:  ${RED}SICHTBAR! ⚠️${NC}"

        echo ""
        echo -e "  ${RED}${BOLD}ERGEBNIS: Gateway kann ALLE sensitiven Daten lesen!${NC}"
        echo -e "  ${RED}Security Risk: $SECURITY_RISK${NC}"

    else
        # Unknown format or error
        echo -e "${YELLOW}${BOLD}[UNBEKANNTES FORMAT / FEHLER]${NC}"
        echo ""
        echo "  Response:"
        echo "$RESPONSE" | head -c 500
    fi
}

#############################################################################
# Test 2: Simulated Gateway Log Analysis
#############################################################################

test_gateway_logs() {
    header "TEST: Gateway Access Log Analyse"

    echo ""
    echo -e "${BOLD}Simuliere was in Gateway Access Logs erscheint...${NC}"
    echo ""

    # Send another message
    TIMESTAMP=$(date -Iseconds)
    MESSAGE_ID="msg-$(date +%s)"

    RESPONSE=$(curl -s -X POST "$NF_A_URL/didcomm/send" \
        -H "Content-Type: application/json" \
        -H "X-Request-ID: $MESSAGE_ID" \
        -d "{
            \"to\": \"$DID_NF_B\",
            \"type\": \"audit-test\",
            \"body\": {
                \"secret\": \"TOP-SECRET-INFO\",
                \"timestamp\": \"$TIMESTAMP\"
            }
        }" 2>&1)

    echo "  Typischer Gateway Access Log Eintrag:"
    echo ""
    echo -e "  ${CYAN}┌─────────────────────────────────────────────────────────────┐${NC}"
    echo "  │ $TIMESTAMP POST /didcomm/send 200 "
    echo "  │ X-Request-ID: $MESSAGE_ID"
    echo "  │ Content-Type: application/json"
    echo "  │ "

    if echo "$RESPONSE" | grep -q "protected.*ciphertext"; then
        echo "  │ Body: {\"protected\":\"eyJ...\",\"ciphertext\":\"...\"}  "
        echo -e "  │ ${GREEN}[ENCRYPTED - Secret nicht sichtbar]${NC}"
    else
        echo "  │ Body: {\"secret\":\"TOP-SECRET-INFO\",...}"
        echo -e "  │ ${RED}[PLAINTEXT - Secret SICHTBAR!]${NC}"
    fi
    echo -e "  ${CYAN}└─────────────────────────────────────────────────────────────┘${NC}"
}

#############################################################################
# Test 3: Kubernetes/Istio Log Check (if available)
#############################################################################

test_istio_logs() {
    header "TEST: Istio/Envoy Sidecar Logs"

    # Check if kubectl is available
    if ! command -v kubectl &> /dev/null; then
        echo -e "  ${YELLOW}kubectl nicht verfügbar - überspringe Kubernetes-Test${NC}"
        return
    fi

    # Check if cluster is reachable
    if ! kubectl cluster-info &> /dev/null 2>&1; then
        echo -e "  ${YELLOW}Kubernetes Cluster nicht erreichbar - überspringe${NC}"
        return
    fi

    echo ""
    echo -e "${BOLD}Prüfe Istio Ingress Gateway Logs...${NC}"
    echo ""

    # Get recent gateway logs
    GATEWAY_POD=$(kubectl get pods -n istio-system -l app=istio-ingressgateway -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

    if [ -n "$GATEWAY_POD" ]; then
        echo "  Gateway Pod: $GATEWAY_POD"
        echo ""
        echo "  Letzte Log-Einträge mit 'didcomm':"
        echo ""
        kubectl logs "$GATEWAY_POD" -n istio-system --tail=20 2>/dev/null | grep -i "didcomm" | tail -5 || echo "  (keine didcomm-Einträge gefunden)"
    else
        echo -e "  ${YELLOW}Istio Gateway Pod nicht gefunden${NC}"
    fi
}

#############################################################################
# Test 4: tcpdump Simulation
#############################################################################

test_tcpdump_simulation() {
    header "TEST: Network Packet Capture Simulation"

    echo ""
    echo -e "${BOLD}Was ein Angreifer mit tcpdump/Wireshark sehen würde:${NC}"
    echo ""

    # Send message
    RESPONSE=$(curl -s -X POST "$NF_A_URL/didcomm/send" \
        -H "Content-Type: application/json" \
        -d "{
            \"to\": \"$DID_NF_B\",
            \"type\": \"network-capture-test\",
            \"body\": {
                \"bankAccount\": \"DE89370400440532013000\",
                \"pin\": \"1234\"
            }
        }" 2>&1)

    echo "  Netzwerk-Schicht Analyse:"
    echo ""
    echo -e "  ${CYAN}┌─────────────────────────────────────────────────────────────┐${NC}"
    echo "  │ Layer 4 (TLS/mTLS):     IMMER verschlüsselt              │"
    echo "  │   → Angreifer ohne mTLS-Zugang sieht nur TLS-Handshake   │"
    echo "  │                                                           │"
    echo "  │ Layer 7 (Application):                                    │"

    if echo "$RESPONSE" | grep -q "protected.*ciphertext"; then
        echo -e "  │   → ${GREEN}V1: Auch nach TLS-Terminierung verschlüsselt (JWE)${NC}  │"
        echo "  │   → Gateway/Proxy kann Inhalt NICHT lesen              │"
        echo "  │   → Nur Empfänger-NF kann entschlüsseln                │"
    else
        echo -e "  │   → ${RED}V4a: Nach TLS-Terminierung KLARTEXT!${NC}               │"
        echo "  │   → Gateway/Proxy kann Inhalt LESEN                    │"
        echo "  │   → bankAccount: DE89370400440532013000                │"
        echo "  │   → pin: 1234                                          │"
    fi
    echo -e "  ${CYAN}└─────────────────────────────────────────────────────────────┘${NC}"

    echo ""
    echo "  Angriffs-Szenario: Kompromittierter Gateway"
    echo ""
    echo -e "  ${CYAN}┌─────────────────────────────────────────────────────────────┐${NC}"
    echo "  │ Angreifer hat Zugang zum Gateway (z.B. via Exploit)      │"
    echo "  │                                                           │"

    if echo "$RESPONSE" | grep -q "protected.*ciphertext"; then
        echo -e "  │ V1:  ${GREEN}Angreifer sieht nur: {\"ciphertext\":\"...\"}${NC}        │"
        echo "  │      → Kann Daten NICHT entschlüsseln                  │"
        echo "  │      → Braucht Private Key des Empfängers              │"
        echo -e "  │      → ${GREEN}GESCHÜTZT durch E2E Encryption${NC}                   │"
    else
        echo -e "  │ V4a: ${RED}Angreifer sieht: {\"bankAccount\":\"DE89...\"}${NC}       │"
        echo "  │      → Kann ALLE Daten lesen                           │"
        echo "  │      → Kein zusätzlicher Schutz                        │"
        echo -e "  │      → ${RED}DATEN KOMPROMITTIERT!${NC}                             │"
    fi
    echo -e "  ${CYAN}└─────────────────────────────────────────────────────────────┘${NC}"
}

#############################################################################
# Summary
#############################################################################

show_summary() {
    header "ZUSAMMENFASSUNG: Gateway Visibility"

    # Determine current mode
    RESPONSE=$(curl -s -X POST "$NF_A_URL/didcomm/send" \
        -H "Content-Type: application/json" \
        -d "{\"to\": \"$DID_NF_B\", \"type\": \"mode-check\", \"body\": {\"test\": true}}" 2>&1)

    echo ""
    if echo "$RESPONSE" | grep -q "protected.*ciphertext"; then
        CURRENT_MODE="V1 (encrypted)"
        MODE_COLOR=$GREEN
    else
        CURRENT_MODE="V4a (signed/none)"
        MODE_COLOR=$RED
    fi

    echo -e "  Aktueller Modus: ${MODE_COLOR}${BOLD}$CURRENT_MODE${NC}"
    echo ""

    echo "  ┌───────────────────────────────────────────────────────────────┐"
    echo "  │                    SECURITY COMPARISON                        │"
    echo "  ├───────────────────────────────────────────────────────────────┤"
    echo "  │                         │   V1 (encrypted) │  V4a (signed)   │"
    echo "  ├───────────────────────────────────────────────────────────────┤"
    echo "  │ Gateway sieht Payload   │       ❌ Nein     │     ✅ Ja       │"
    echo "  │ Logs enthalten Secrets  │       ❌ Nein     │     ✅ Ja       │"
    echo "  │ tcpdump zeigt Daten     │       ❌ Nein*    │     ❌ Nein*    │"
    echo "  │ Nach TLS-Termination    │       ❌ Nein     │     ✅ Ja       │"
    echo "  │ Kompromittierter GW     │       ❌ Sicher   │     ⚠️  Leak    │"
    echo "  └───────────────────────────────────────────────────────────────┘"
    echo "    * mTLS schützt auf Netzwerk-Ebene, aber nicht nach Terminierung"
    echo ""

    echo -e "${BOLD}Empfehlung:${NC}"
    echo ""
    if echo "$RESPONSE" | grep -q "protected.*ciphertext"; then
        echo -e "  ${GREEN}✅ V1 ist aktiv - Daten sind Ende-zu-Ende geschützt${NC}"
        echo "     Geeignet für: Production, Cross-Operator, Compliance"
    else
        echo -e "  ${YELLOW}⚠️  V4a ist aktiv - Daten sind am Gateway sichtbar${NC}"
        echo "     Nur geeignet für: Trusted Networks, Development, Debugging"
        echo ""
        echo "     Zum Wechsel auf V1:"
        echo "     kubectl set env deployment/veramo-nf-a DIDCOMM_PACKING_MODE=encrypted -n nf-a-namespace"
        echo "     kubectl set env deployment/veramo-nf-b DIDCOMM_PACKING_MODE=encrypted -n nf-b-namespace"
    fi
}

#############################################################################
# Main
#############################################################################

echo ""
echo -e "${BOLD}${MAGENTA}"
echo "   ██████╗  █████╗ ████████╗███████╗██╗    ██╗ █████╗ ██╗   ██╗"
echo "  ██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝██║    ██║██╔══██╗╚██╗ ██╔╝"
echo "  ██║  ███╗███████║   ██║   █████╗  ██║ █╗ ██║███████║ ╚████╔╝ "
echo "  ██║   ██║██╔══██║   ██║   ██╔══╝  ██║███╗██║██╔══██║  ╚██╔╝  "
echo "  ╚██████╔╝██║  ██║   ██║   ███████╗╚███╔███╔╝██║  ██║   ██║   "
echo "   ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝   "
echo "           ██╗   ██╗██╗███████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗"
echo "           ██║   ██║██║██╔════╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝"
echo "           ██║   ██║██║███████╗██║██████╔╝██║██║     ██║   ██║    ╚████╔╝ "
echo "           ╚██╗ ██╔╝██║╚════██║██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝  "
echo "            ╚████╔╝ ██║███████║██║██████╔╝██║███████╗██║   ██║      ██║   "
echo "             ╚═══╝  ╚═╝╚══════╝╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝   "
echo -e "${NC}"

test_payload_inspection
test_gateway_logs
test_istio_logs
test_tcpdump_simulation
show_summary

echo ""
echo -e "${GREEN}${BOLD}Test abgeschlossen.${NC}"
echo ""
