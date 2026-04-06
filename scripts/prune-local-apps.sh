#!/usr/bin/env bash
set -euo pipefail

DERIVED_DATA_ROOT="$HOME/Library/Developer/Xcode/DerivedData"
APP_SUPPORT_DIR="$HOME/Library/Application Support/bmux"

usage() {
  cat <<'EOF'
Usage: ./scripts/prune-local-apps.sh

Goals:
  - Keep /Applications/bmux.app as the only local app bundle that matters.
  - Remove bmux build artifacts and staging bundles from DerivedData.
  - Remove leftover temporary bmux sockets and logs from /tmp.
EOF
}

if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: prune-local-apps.sh does not take arguments" >&2
      usage
      exit 1
      ;;
  esac
fi

remove_path() {
  local path="$1"
  if [[ -e "$path" || -L "$path" ]]; then
    echo "remove: $path"
    rm -rf "$path"
  fi
}

while IFS= read -r -d '' release_app; do
  remove_path "$release_app"
done < <(find "$DERIVED_DATA_ROOT" -path '*/Build/Products/Release/bmux.app' -type d -print0 2>/dev/null)

while IFS= read -r -d '' debug_app; do
  remove_path "$debug_app"
done < <(find "$DERIVED_DATA_ROOT" -path '*/Build/Products/Debug/bmux.app' -type d -print0 2>/dev/null)

while IFS= read -r -d '' derived_dir; do
  case "${derived_dir##*/}" in
    bmux-install-applications|GhosttyTabs-*)
      continue
      ;;
  esac
  remove_path "$derived_dir"
done < <(find "$DERIVED_DATA_ROOT" -maxdepth 1 -type d -name 'bmux-*' -print0 2>/dev/null)

while IFS= read -r -d '' tmp_path; do
  remove_path "$tmp_path"
done < <(find /tmp -maxdepth 1 \( -name 'bmux*.sock' -o -name 'bmux*.log' -o -name 'bmux-*' \) -print0 2>/dev/null)

while IFS= read -r -d '' app_support_path; do
  remove_path "$app_support_path"
done < <(find "$APP_SUPPORT_DIR" -maxdepth 1 \( -name '*.sock' -o -name 'last-socket-path' \) -print0 2>/dev/null)

echo "done"
