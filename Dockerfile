# ============================================
# Stage 1: Build Frontend
# ============================================
FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build frontend
RUN npm run build

# ============================================
# Stage 2: Build Backend
# ============================================
FROM node:20-alpine AS backend-builder

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /build/server

# Copy server package files
COPY server/package*.json ./

# Install all dependencies (including dev for building)
RUN npm ci

# Copy Prisma schema first (for generate)
COPY server/prisma ./prisma/

# Generate Prisma client
RUN npx prisma generate

# Copy server source
COPY server/ ./

# Build TypeScript
RUN npm run build

# ============================================
# Stage 3: Production Runtime
# ============================================
FROM node:20-alpine AS runtime

# Install runtime dependencies
# - openssl: Required by Prisma
# - tini: Proper init process for containers
# - openjdk21: Required for running Hytale/Java game servers
# - unzip: Required for extracting server files
# - gcompat: glibc compatibility for native libraries (netty_quiche)
RUN apk add --no-cache openssl tini openjdk21-jre unzip gcompat

# Create default user (can be overridden with PUID/PGID env vars at runtime)
RUN addgroup -g 1001 -S hytale && \
    adduser -S -D -H -u 1001 -h /app -s /sbin/nologin -G hytale -g hytale hytale

WORKDIR /app

# Copy server package files
COPY server/package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy Prisma schema and migrations
COPY server/prisma ./prisma/

# Generate Prisma client for production
RUN npx prisma generate

# Copy built backend from builder
COPY --from=backend-builder /build/server/dist ./dist/

# Copy built frontend to public directory (served by Express)
COPY --from=frontend-builder /build/frontend/dist ./public/

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create data directories with proper ownership
RUN mkdir -p /app/data/db /app/data/logs /app/data/servers /app/data/backups /app/data/certs && \
    chown -R hytale:hytale /app

# Set environment defaults
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    DATABASE_URL=file:/app/data/db/hytalepanel.db \
    SERVERS_BASE_PATH=/app/data/servers \
    BACKUPS_BASE_PATH=/app/data/backups \
    LOGS_PATH=/app/data/logs \
    CERTS_PATH=/app/data/certs \
    HSM_BASE_PATH=/app

# Expose ports
# 3001 - Web UI and API
# 5520 - Default Hytale game server port (TCP + UDP for QUIC)
EXPOSE 3001 5520 5520/udp

# Volume for persistent data
VOLUME ["/app/data"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Install su-exec for dropping privileges
RUN apk add --no-cache su-exec

# Use tini as init
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application (entrypoint handles PUID/PGID)
CMD ["/docker-entrypoint.sh"]
