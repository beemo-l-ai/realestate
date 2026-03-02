#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-realestate-app}"
IMAGE_NAME="${IMAGE_NAME:-realestate-app:latest}"
CONTAINER_PORT="${CONTAINER_PORT:-8080}"
HOST_PORT="${HOST_PORT:-80}"
ENV_FILE="${ENV_FILE:-.env}"
WALLET_DIR="${WALLET_DIR:-oracle-wallet}"
DOCKER_NETWORK="${DOCKER_NETWORK:-webnet}"
INTERNAL_ONLY="${INTERNAL_ONLY:-auto}" # auto | true | false
NO_CACHE="${NO_CACHE:-false}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[deploy] project dir: $SCRIPT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "[deploy] error: docker is not installed."
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[deploy] error: missing env file: $ENV_FILE"
  exit 1
fi

if [[ ! -d "$WALLET_DIR" ]]; then
  echo "[deploy] error: missing wallet directory: $WALLET_DIR"
  exit 1
fi

if [[ ! -f "Dockerfile" ]]; then
  echo "[deploy] error: Dockerfile not found in $SCRIPT_DIR"
  exit 1
fi

if ! systemctl is-active --quiet docker; then
  echo "[deploy] starting docker service..."
  sudo systemctl start docker
fi
sudo systemctl enable docker >/dev/null 2>&1 || true

if ! docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1; then
  echo "[deploy] creating docker network: $DOCKER_NETWORK"
  docker network create "$DOCKER_NETWORK" >/dev/null
fi

if [[ "$NO_CACHE" == "true" ]]; then
  BUILD_OPTS=(--no-cache)
else
  BUILD_OPTS=()
fi

echo "[deploy] building image: $IMAGE_NAME"
docker build "${BUILD_OPTS[@]}" -t "$IMAGE_NAME" .

if docker ps -a --format '{{.Names}}' | grep -q "^${APP_NAME}$"; then
  echo "[deploy] removing existing container: $APP_NAME"
  docker rm -f "$APP_NAME" >/dev/null
fi

if [[ "$INTERNAL_ONLY" == "auto" ]]; then
  if docker ps --format '{{.Names}}' | grep -q '^caddy$'; then
    INTERNAL_ONLY="true"
  else
    INTERNAL_ONLY="false"
  fi
fi

RUN_ARGS=(
  -d
  --name "$APP_NAME"
  --restart unless-stopped
  --env-file "$ENV_FILE"
  --network "$DOCKER_NETWORK"
)

if [[ "$INTERNAL_ONLY" == "true" ]]; then
  echo "[deploy] running in internal-only mode (for reverse proxy like caddy)"
else
  echo "[deploy] exposing host port ${HOST_PORT} -> container port ${CONTAINER_PORT}"
  RUN_ARGS+=(-p "${HOST_PORT}:${CONTAINER_PORT}")
fi

docker run "${RUN_ARGS[@]}" "$IMAGE_NAME" >/dev/null

echo "[deploy] done"
docker ps --filter "name=${APP_NAME}" --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
echo "[deploy] recent logs:"
docker logs --tail 50 "$APP_NAME" || true
