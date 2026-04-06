#!/bin/sh
set -eu

ENV_PATH="${ENV_FILE:-/app/data/.env}"
ENV_DIR="$(dirname "$ENV_PATH")"

mkdir -p "$ENV_DIR"

if [ ! -f "$ENV_PATH" ]; then
  echo "error: env file not found at $ENV_PATH" >&2
  echo "The image does not ship PORT or ADMIN_PASSWORD. Mount a directory and provide a .env file there." >&2
  echo "Example (compose): volumes: - ./data:/app/data  and create ./data/.env with PORT and ADMIN_PASSWORD." >&2
  exit 1
fi

exec "$@"
