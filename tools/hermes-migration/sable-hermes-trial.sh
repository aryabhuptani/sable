#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  cat >&2 <<'USAGE'
Usage:
  tools/hermes-migration/sable-hermes-trial.sh "prompt"
  printf '%s' "prompt" | tools/hermes-migration/sable-hermes-trial.sh --stdin

Runs the reversible Hermes Sable trial profile inside the hermes-sable-trial
container. Production Sable/Signal is not touched.
USAGE
  exit 2
fi

if [[ "${1:-}" == "--stdin" ]]; then
  prompt="$(cat)"
else
  prompt="$*"
fi

docker exec -i -u hermes hermes-sable-trial sh -lc '
  export PYTHONPATH=/opt/data/home/python-packages:${PYTHONPATH:-}
  export PATH=/opt/data/home/.npm-global/bin:${PATH:-}
  export CODEX_HOME=/opt/data/home/.codex
  cd /opt/data/workspace
  prompt="$(cat)"
  /opt/hermes/.venv/bin/hermes -z "$prompt" --accept-hooks
' <<<"$prompt"
