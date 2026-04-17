#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/arya/projects/sable/apps/signal-bridge"
SLEEP_SECONDS=2
RESTART_REQUEST_PATH="$REPO_DIR/.restart-requested"

compute_hash() {
  find "$REPO_DIR" \
    \( -path "$REPO_DIR/node_modules" -o \
       -path "$REPO_DIR/.git" -o \
       -path "$REPO_DIR/.bridge-state.json" -o \
       -path "$REPO_DIR/.restart-requested" -o \
       -path "$REPO_DIR/.restart-notice-pending" -o \
       -path "$REPO_DIR/bridge.log" \) -prune -o \
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
