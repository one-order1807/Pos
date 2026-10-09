#!/usr/bin/env bash
# Run this directly on the server to stand up the ONE-ORDER backend: builds the api image and
# starts the full docker-compose stack (postgres, redis, api, worker, scheduler), then applies any
# pending Alembic migrations. Safe to re-run - compose only recreates containers whose config/image
# actually changed, and `alembic upgrade head` is a no-op once already at head.
#
# Usage: ./deploy.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed. Install Docker Engine + the compose plugin first: https://docs.docker.com/engine/install/" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose (the plugin, not docker-compose v1) is required." >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "No .env found - creating one from .env.example. Edit it (POSTGRES_PASSWORD at minimum) before trusting this deployment." >&2
  cp .env.example .env
fi

echo "==> Building images"
docker compose build

echo "==> Starting the stack"
docker compose up -d

echo "==> Waiting for postgres + redis to report healthy"
for _ in $(seq 1 30); do
  status=$(docker compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null | grep -E '^(postgres|redis) ' || true)
  if ! printf '%s\n' "$status" | grep -qv 'healthy'; then
    break
  fi
  sleep 2
done

echo "==> Applying database migrations"
docker compose run --rm api alembic upgrade head

echo "==> Health check"
PORT=$(grep -E '^API_PORT=' .env | cut -d= -f2)
curl -sf "http://localhost:${PORT:-8000}/health" && echo || echo "Warning: health check did not return 200 - check 'docker compose logs api'." >&2

echo "==> Done. Containers:"
docker compose ps
