#!/bin/sh
set -e

echo "======================================"
echo "  Hytale Server Manager - Docker"
echo "======================================"

# Set default PUID/PGID if not provided
PUID=${PUID:-1000}
PGID=${PGID:-1000}

echo "Starting with UID: $PUID, GID: $PGID"

# Update hsm group with the specified PGID
if [ "$(id -g hsm)" != "$PGID" ]; then
    groupmod -o -g "$PGID" hsm
fi

# Update hsm user with the specified PUID
if [ "$(id -u hsm)" != "$PUID" ]; then
    usermod -o -u "$PUID" hsm
fi

# Ensure data directories exist
mkdir -p /app/data/db /app/data/servers /app/data/backups /app/data/logs /app/data/certs

# Fix ownership of data directories
chown -R hsm:hsm /app/data
chown hsm:hsm /app
chown 1000:1000 /app

# Generate secrets if not provided
if [ -z "$JWT_SECRET" ]; then
    echo "Warning: JWT_SECRET not set, generating random value..."
    export JWT_SECRET=$(head -c 64 /dev/urandom | base64 | tr -d '\n' | head -c 128)
fi

if [ -z "$JWT_REFRESH_SECRET" ]; then
    echo "Warning: JWT_REFRESH_SECRET not set, generating random value..."
    export JWT_REFRESH_SECRET=$(head -c 64 /dev/urandom | base64 | tr -d '\n' | head -c 128)
fi

if [ -z "$SETTINGS_ENCRYPTION_KEY" ]; then
    echo "Warning: SETTINGS_ENCRYPTION_KEY not set, generating random value..."
    export SETTINGS_ENCRYPTION_KEY=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 32)
fi

# Run Prisma database setup as the hsm user
echo "Setting up database..."
gosu hsm npx prisma db push --skip-generate --accept-data-loss

echo "Database ready."
echo "Starting Hytale Server Manager..."

# Execute the main command as the hsm user
exec gosu hsm "$@"
