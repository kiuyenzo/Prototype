#!/bin/bash

set -e
cd "$(dirname "$0")/.."

MODE=$1

if [ "$MODE" != "encrypted" ] && [ "$MODE" != "signed" ]; then
    echo "Usage: ./scripts/switch-mode.sh <encrypted|signed>"
    echo ""
    echo "Modes:"
    echo "  encrypted  - E2E encrypted DIDComm (authcrypt), Pod-Gateway: TCP"
    echo "  signed     - Signed DIDComm (JWS), Pod-Gateway: mTLS"
    exit 1
fi

sedi() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "$@"
    else
        sed -i "$@"
    fi
}

echo "Switching to '$MODE' mode..."

sedi "/DIDCOMM_PACKING_MODE/,/value:/ s/value: \"encrypted\"/value: \"$MODE\"/" deploy/cluster-a/deployment.yaml
sedi "/DIDCOMM_PACKING_MODE/,/value:/ s/value: \"signed\"/value: \"$MODE\"/" deploy/cluster-a/deployment.yaml

sedi "/DIDCOMM_PACKING_MODE/,/value:/ s/value: \"encrypted\"/value: \"$MODE\"/" deploy/cluster-b/deployment.yaml
sedi "/DIDCOMM_PACKING_MODE/,/value:/ s/value: \"signed\"/value: \"$MODE\"/" deploy/cluster-b/deployment.yaml

echo "Mode set to: $MODE"
echo ""

./scripts/build-and-deploy.sh
