#!/usr/bin/env bash
set -euo pipefail

DERIVED_DATA_ROOT="$HOME/Library/Developer/Xcode/DerivedData"
APP_SUPPORT_DIR="$HOME/Library/Application Support/bmux"
KEEP_TAG=""
MAIN_ONLY=0

usage() {
  cat <<'EOF'
Usage: ./scripts/prune-local-apps.sh [--keep-tag <tag> | --main-only]

Goals:
  - Keep /Applications/bmux.app as the only stable app.
  - Remove Release bmux.app staging bundles from DerivedData.
  - Remove stray untagged Debug bmux DEV.app bundles.
  - Optionally keep only one tagged dev app, or remove all tagged dev apps.

Examples:
  ./scripts/prune-local-apps.sh --keep-tag dev
  ./scripts/prune-local-apps.sh --main-only
EOF
}

sanitize_path() {
  local raw="$1"
  local cleaned
  cleaned="$(echo "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')"
  if [[ -z "$cleaned" ]]; then
    cleaned="agent"
  fi
  echo "$cleaned"
}

remove_path() {
  local path="$1"
  if [[ -e "$path" || -L "$path" ]]; then
    echo "remove: $path"
    rm -rf "$path"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-tag)
      KEEP_TAG="${2:-}"
      if [[ -z "$KEEP_TAG" ]]; then
        echo "error: --keep-tag requires a value" >&2
        exit 1
      fi
      shift 2
      ;;
    --main-only)
      MAIN_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -n "$KEEP_TAG" && "$MAIN_ONLY" -eq 1 ]]; then
  echo "error: --keep-tag and --main-only are mutually exclusive" >&2
  exit 1
fi

KEEP_SLUG=""
if [[ -n "$KEEP_TAG" ]]; then
  KEEP_SLUG="$(sanitize_path "$KEEP_TAG")"
fi

while IFS= read -r -d '' release_app; do
  remove_path "$release_app"
done < <(find "$DERIVED_DATA_ROOT" -path '*/Build/Products/Release/bmux.app' -type d -print0 2>/dev/null)

while IFS= read -r -d '' debug_app; do
  remove_path "$debug_app"
done < <(find "$DERIVED_DATA_ROOT" -path "$DERIVED_DATA_ROOT/bmux-*/Build/Products/Debug/bmux DEV.app" -type d -print0 2>/dev/null)

while IFS= read -r -d '' derived_dir; do
  slug="${derived_dir##*/bmux-}"
  if [[ "$slug" == "install-applications" ]]; then
    continue
  fi
  if [[ -n "$KEEP_SLUG" && "$slug" == "$KEEP_SLUG" ]]; then
    continue
  fi
  if [[ "$MAIN_ONLY" -eq 0 && -z "$KEEP_SLUG" ]]; then
    continue
  fi

  pkill -f "bmux DEV ${slug}.app/Contents/MacOS/bmux DEV" >/dev/null 2>&1 || true
  remove_path "$derived_dir"
  remove_path "/tmp/bmux-${slug}"
  remove_path "/tmp/bmux-debug-${slug}.sock"
  remove_path "/tmp/bmux-debug-${slug}.log"
  remove_path "$APP_SUPPORT_DIR/bmuxd-dev-${slug}.sock"
done < <(find "$DERIVED_DATA_ROOT" -maxdepth 1 -type d -name 'bmux-*' -print0 2>/dev/null)

echo "done"
