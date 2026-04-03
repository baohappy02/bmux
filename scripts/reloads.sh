#!/usr/bin/env bash
set -euo pipefail

echo "error: reloads.sh is retired. Keep only /Applications/bmux.app and one dev build." >&2
echo "Use ./scripts/reload.sh --tag dev --launch --install-applications or ./scripts/reloadp.sh instead." >&2
exit 1
