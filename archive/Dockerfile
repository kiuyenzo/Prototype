# Dockerfile for Veramo DIDComm Agent
# Optimized for Kubernetes deployment with proper layer caching

FROM node:20-alpine

# Install build dependencies for native modules (sqlite3)
RUN apk update && apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite \
    sqlite-dev \
    wget

# Create app directory
WORKDIR /app

# Copy node_modules
COPY node_modules/ ./node_modules/

# Rebuild native modules for Alpine Linux
RUN npm rebuild sqlite3 better-sqlite3 2>/dev/null || npm install sqlite3 better-sqlite3

# Copy application code
COPY shared/ ./shared/
COPY cluster-a/ ./cluster-a/
COPY cluster-b/ ./cluster-b/

# Copy and setup entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose default port
EXPOSE 3000

# Health check using HTTP/2
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget --spider --http2 http://localhost:3000/health || exit 1

# Use entrypoint script to initialize credentials before starting server
ENTRYPOINT ["/app/entrypoint.sh"]
