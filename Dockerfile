# Dockerfile for Veramo DIDComm Agent
# Optimized for Kubernetes deployment with proper layer caching

FROM node:20-alpine

# Install build dependencies for native modules (sqlite3)
RUN apk update && apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite \
    wget

# Create app directory
WORKDIR /app

# Copy node_modules (already installed on host)
COPY node_modules/ ./node_modules/

# Copy application code
COPY shared/ ./shared/

# Rebuild native modules for Alpine (sqlite3)
RUN cd node_modules/sqlite3 && npm run install --build-from-source || true

# Expose default port
EXPOSE 3000

# Health check using HTTP/2
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget --spider --http2 http://localhost:3000/health || exit 1

# Start the server
CMD ["node", "shared/didcomm-http-server.js"]
