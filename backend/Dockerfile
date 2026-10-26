# ==============================================================================
# JobPilot AI FastAPI Backend — Production Dockerfile
# Optimized for cloud hosting (Render, Railway, Fly.io, AWS ECS, or DigitalOcean)
# ==============================================================================

FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

# Install system tools required for health checks, certificates, and privilege de-escalation
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend application code and startup entrypoint
COPY app ./app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create non-root application user for least privilege execution
RUN useradd -m -u 1000 -s /bin/bash appuser && chown -R appuser:appuser /app

EXPOSE 8000

# Container healthcheck targeting the FastAPI health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:${PORT:-8000}/api/v1/health || exit 1

# Entrypoint prepares mounted persistent volume ownership at runtime, then drops privileges to appuser
ENTRYPOINT ["docker-entrypoint.sh"]

# Start Uvicorn with reverse-proxy forwarded header support
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
