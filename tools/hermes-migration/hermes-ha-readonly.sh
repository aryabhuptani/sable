#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python_bin="${HERMES_PYTHON:-}"

if [[ -z "$python_bin" ]]; then
  if [[ -x /opt/hermes/.venv/bin/python ]]; then
    python_bin=/opt/hermes/.venv/bin/python
  else
    python_bin=python3
  fi
fi

cd "$repo_root"
exec "$python_bin" tools/homeassistant/homeassistant_cli.py --output json "$@"
