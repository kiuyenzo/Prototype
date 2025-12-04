FROM node:20-alpine

WORKDIR /app

# Install dependencies
RUN npm install -g @veramo/cli typescript ts-node

# Install required Veramo packages
RUN npm install @veramo/core \
    @veramo/credential-w3c \
    @veramo/credential-ld \
    @veramo/credential-eip712 \
    @veramo/data-store \
    @veramo/did-comm \
    @veramo/did-discovery \
    @veramo/did-manager \
    @veramo/did-provider-ethr \
    @veramo/did-provider-web \
    @veramo/did-provider-key \
    @veramo/did-provider-jwk \
    @veramo/did-provider-peer \
    @veramo/did-provider-pkh \
    @veramo/did-resolver \
    @veramo/key-manager \
    @veramo/kms-local \
    @veramo/message-handler \
    @veramo/remote-server \
    @veramo/selective-disclosure \
    typeorm \
    sqlite3 \
    ethr-did-resolver \
    web-did-resolver \
    @transmute/credentials-context \
    cors \
    express \
    swagger-ui-express

# Copy agent configuration
COPY agent.yml /app/agent.yml

# Expose port
EXPOSE 3332

# Create data directory
RUN mkdir -p /app/data

# Start Veramo agent
CMD ["veramo", "server", "--config", "/app/agent.yml"]
