#!/bin/sh
set -eu

ENV_PATH="${ENV_FILE:-/app/data/.env}"
ENV_DIR="$(dirname "$ENV_PATH")"

mkdir -p "$ENV_DIR"

if [ ! -f "$ENV_PATH" ]; then
  cp /app/.env.example "$ENV_PATH"
  echo "Created default env file at $ENV_PATH from .env.example"
fi

exec "$@"
