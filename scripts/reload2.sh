#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ $# -gt 0 ]]; then
  echo "warning: reload2.sh forwards to reloadp.sh and ignores extra arguments." >&2
fi
exec "$SCRIPT_DIR/reloadp.sh"
