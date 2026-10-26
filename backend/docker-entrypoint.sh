#!/bin/sh
set -e

# ==============================================================================
# JobPilot AI — Docker Production Entrypoint
# Resolves persistent volume mount ownership and drops privileges to appuser
# ==============================================================================

# Default command if none provided or if first argument starts with a flag
if [ $# -eq 0 ] || [ "${1#-}" != "$1" ]; then
    set -- python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips "*" "$@"
fi

# If command is python/uvicorn and PORT is set (e.g. dynamically assigned by Render),
# ensure the --port parameter matches the runtime PORT environment variable
if [ -n "$PORT" ] && [ "$PORT" != "8000" ]; then
    PORT_SET=0
    NEW_ARGS=""
    SKIP_NEXT=0
    for arg in "$@"; do
        if [ "$SKIP_NEXT" -eq 1 ]; then
            NEW_ARGS="$NEW_ARGS $PORT"
            SKIP_NEXT=0
            PORT_SET=1
            continue
        fi
        if [ "$arg" = "--port" ]; then
            NEW_ARGS="$NEW_ARGS --port"
            SKIP_NEXT=1
            continue
        fi
        NEW_ARGS="$NEW_ARGS $arg"
    done
    eval "set -- $NEW_ARGS"
fi

# Determine persistent data directory from JOBPILOT_DB_PATH
DB_PATH="${JOBPILOT_DB_PATH:-/app/data/jobpilot.db}"
DATA_DIR=""

if [ "$DB_PATH" != ":memory:" ] && [ "${DB_PATH#file:}" = "$DB_PATH" ]; then
    DATA_DIR="$(dirname "$DB_PATH")"
fi

STORAGE_DIR="${JOBPILOT_STORAGE_DIR:-}"

# Runtime privilege handling
if [ "$(id -u)" = "0" ]; then
    # Ensure appuser exists with UID 1000
    if ! id -u appuser >/dev/null 2>&1; then
        useradd -m -u 1000 -s /bin/bash appuser
    fi

    # Prepare persistent database and storage directories if configured
    if [ -n "$DATA_DIR" ]; then
        if [ ! -d "$DATA_DIR" ]; then
            mkdir -p "$DATA_DIR"
        fi
        mkdir -p "$DATA_DIR/storage" "$DATA_DIR/backups"
        chown -R appuser:appuser "$DATA_DIR"
        chmod 750 "$DATA_DIR"
    fi

    if [ -n "$STORAGE_DIR" ]; then
        if [ ! -d "$STORAGE_DIR" ]; then
            mkdir -p "$STORAGE_DIR"
        fi
        chown -R appuser:appuser "$STORAGE_DIR"
        chmod 750 "$STORAGE_DIR"
    fi

    # Verify that DATA_DIR is writable by appuser before dropping privileges
    if [ -n "$DATA_DIR" ]; then
        if ! gosu appuser test -w "$DATA_DIR"; then
            echo "FATAL: Mounted persistent disk '$DATA_DIR' is not writable by appuser." >&2
            echo "Verify Render persistent disk mount and permissions." >&2
            exit 1
        fi
    fi

    # Drop root privileges and execute the application as non-root appuser
    exec gosu appuser "$@"
else
    # Already running as non-root user (e.g. local container with --user)
    if [ -n "$DATA_DIR" ]; then
        if [ ! -d "$DATA_DIR" ]; then
            echo "FATAL: Mounted persistent disk '$DATA_DIR' does not exist." >&2
            exit 1
        fi
        if [ ! -w "$DATA_DIR" ]; then
            echo "FATAL: Mounted persistent disk '$DATA_DIR' is not writable by current user ($(id -u))." >&2
            exit 1
        fi
    fi

    exec "$@"
fi
