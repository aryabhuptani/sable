#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SLEEP_SECONDS=2
RESTART_REQUEST_PATH="$APP_DIR/.restart-requested"

compute_hash() {
  find "$APP_DIR" \
    \( -path "$APP_DIR/node_modules" -o \
       -path "$APP_DIR/.git" -o \
       -path "$APP_DIR/.attachment-queue" -o \
       -path "$APP_DIR/.ops" -o \
       -path "$APP_DIR/.venv" -o \
       -path "$APP_DIR/.venv-pdf" -o \
       -path "$APP_DIR/__pycache__" -o \
       -path "$APP_DIR/.bridge-state.json" -o \
       -path "$APP_DIR/.restart-requested" -o \
       -path "$APP_DIR/.restart-notice-pending" -o \
       -path "$APP_DIR/bridge.log" \) -prune -o \
    -type f -print0 |
    sort -z |
    xargs -0 sha256sum |
    sha256sum |
    cut -d" " -f1
}

last_hash=""

while true; do
  current_hash="$(compute_hash)"

  if [[ -n "$last_hash" && "$current_hash" != "$last_hash" ]]; then
    touch "$RESTART_REQUEST_PATH"
  fi

  last_hash="$current_hash"
  sleep "$SLEEP_SECONDS"
done
