#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "error: reload2 requires a tag (example: ./scripts/reload2.sh --tag dev)" >&2
  exit 1
fi

echo "warning: reload2.sh is deprecated; forwarding to ./scripts/reload.sh --install-applications" >&2
./scripts/reload.sh "$@" --install-applications
