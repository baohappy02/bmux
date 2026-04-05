#!/usr/bin/env bash
set -euo pipefail

APPLICATIONS_APP_PATH="/Applications/bmux.app"
DERIVED_DATA="$HOME/Library/Developer/Xcode/DerivedData/bmux-install-applications"
XCODE_LOG="/tmp/bmux-xcodebuild-install-applications.log"
AUTO_SKIP_ZIG_BUILD_REASON=""

should_skip_ghostty_cli_helper_zig_build() {
  if [[ "${CMUX_SKIP_ZIG_BUILD:-}" == "1" ]]; then
    AUTO_SKIP_ZIG_BUILD_REASON="CMUX_SKIP_ZIG_BUILD=1"
    return 0
  fi

  local product_version zig_version major_version
  product_version="$(sw_vers -productVersion 2>/dev/null || true)"
  zig_version="$(zig version 2>/dev/null || true)"
  major_version="${product_version%%.*}"

  if [[ "$zig_version" == "0.15.2" ]] && [[ "$major_version" =~ ^[0-9]+$ ]] && (( major_version >= 26 )); then
    AUTO_SKIP_ZIG_BUILD_REASON="macOS ${product_version} + zig ${zig_version}"
    return 0
  fi

  AUTO_SKIP_ZIG_BUILD_REASON=""
  return 1
}

find_bmux_index_src() {
  local candidate=""
  for candidate in \
    "$PWD/../bmux-index/.build/release/bmux-index" \
    "$PWD/../bmux-index/.build/debug/bmux-index" \
    "$HOME/.local/bin/bmux-index" \
    "$(command -v bmux-index 2>/dev/null || true)"
  do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    echo "$candidate"
    return 0
  done
  return 1
}

find_bmux_deps_src() {
  local resolve_script="$PWD/scripts/resolve-bmux-deps.sh"
  if [[ ! -f "$resolve_script" ]]; then
    echo "error: missing bmux-deps resolver script at $resolve_script" >&2
    return 1
  fi
  bash "$resolve_script"
}

bundle_runtime_binaries() {
  local app_path="$1"
  local bin_dir="${app_path}/Contents/Resources/bin"
  local bmux_index_src=""
  local bmux_deps_src=""

  mkdir -p "$bin_dir"

  if [[ -x "$CMUXD_SRC" ]]; then
    cp "$CMUXD_SRC" "$bin_dir/bmuxd"
    chmod +x "$bin_dir/bmuxd"
  fi

  if [[ -x "$GHOSTTY_HELPER_SRC" ]]; then
    cp "$GHOSTTY_HELPER_SRC" "$bin_dir/ghostty"
    chmod +x "$bin_dir/ghostty"
  fi

  bmux_index_src="$(find_bmux_index_src || true)"
  if [[ -n "$bmux_index_src" ]]; then
    cp "$bmux_index_src" "$bin_dir/bmux-index"
    chmod +x "$bin_dir/bmux-index"
  else
    echo "warning: bmux-index binary was not found; agent.code will stay unavailable until bmux-index is installed." >&2
  fi

  bmux_deps_src="$(find_bmux_deps_src)"
  cp "$bmux_deps_src" "$bin_dir/bmux-deps"
  chmod +x "$bin_dir/bmux-deps"
}

if should_skip_ghostty_cli_helper_zig_build; then
  if [[ "${CMUX_SKIP_ZIG_BUILD:-}" != "1" ]]; then
    echo "Auto-enabling CMUX_SKIP_ZIG_BUILD=1 for Ghostty CLI helper (${AUTO_SKIP_ZIG_BUILD_REASON})"
  fi
  export CMUX_SKIP_ZIG_BUILD=1
fi

CMUXD_SRC="$PWD/bmuxd/zig-out/bin/bmuxd"
GHOSTTY_HELPER_SRC="$PWD/ghostty/zig-out/bin/ghostty"
if [[ -d "$PWD/bmuxd" ]]; then
  (cd "$PWD/bmuxd" && zig build -Doptimize=ReleaseFast)
fi
if [[ -d "$PWD/ghostty" ]]; then
  if [[ "${CMUX_SKIP_ZIG_BUILD:-}" == "1" ]]; then
    echo "Skipping direct ghostty CLI helper zig build (CMUX_SKIP_ZIG_BUILD=1)"
  else
    (cd "$PWD/ghostty" && zig build cli-helper -Dapp-runtime=none -Demit-macos-app=false -Demit-xcframework=false -Doptimize=ReleaseFast)
  fi
fi

XCODEBUILD_ARGS=(
  -project GhosttyTabs.xcodeproj
  -scheme bmux
  -configuration Release
  -destination 'platform=macOS'
  -derivedDataPath "$DERIVED_DATA"
)
if [[ "${CMUX_SKIP_ZIG_BUILD:-}" == "1" ]]; then
  XCODEBUILD_ARGS+=(CMUX_SKIP_ZIG_BUILD=1)
fi
XCODEBUILD_ARGS+=(build)

set +e
xcodebuild "${XCODEBUILD_ARGS[@]}" 2>&1 | tee "$XCODE_LOG" | grep -E '(warning:|error:|fatal:|BUILD FAILED|BUILD SUCCEEDED|\*\* BUILD)'
XCODE_PIPESTATUS=("${PIPESTATUS[@]}")
set -e
XCODE_EXIT="${XCODE_PIPESTATUS[0]}"
echo "Full build log: $XCODE_LOG"
if [[ "$XCODE_EXIT" -ne 0 ]]; then
  echo "error: xcodebuild failed with exit code $XCODE_EXIT" >&2
  exit "$XCODE_EXIT"
fi

APP_PATH="${DERIVED_DATA}/Build/Products/Release/bmux.app"
if [[ ! -d "${APP_PATH}" ]]; then
  echo "bmux.app not found in ${DERIVED_DATA}" >&2
  exit 1
fi

bundle_runtime_binaries "$APP_PATH"
/usr/bin/codesign --force --sign - --timestamp=none --generate-entitlement-der "$APP_PATH" >/dev/null 2>&1 || true

pkill -f "/Applications/bmux.app/Contents/MacOS/bmux" >/dev/null 2>&1 || true
sleep 0.2
rm -rf "$APPLICATIONS_APP_PATH"
ditto "$APP_PATH" "$APPLICATIONS_APP_PATH"
/usr/bin/codesign --force --sign - --timestamp=none --generate-entitlement-der "$APPLICATIONS_APP_PATH" >/dev/null 2>&1 || true

echo "Release app:"
echo "  ${APP_PATH}"
echo "Installed app:"
echo "  ${APPLICATIONS_APP_PATH}"
rm -rf "$APP_PATH"
echo "Pruned staging release app:"
echo "  ${APP_PATH}"

# Dev shells (including CI/Codex) often force-disable paging by exporting these.
# Don't leak that into bmux, otherwise `git diff` won't page even with PAGER=less.
env -u GIT_PAGER -u GH_PAGER open -g "$APPLICATIONS_APP_PATH"

APP_PROCESS_PATH="${APPLICATIONS_APP_PATH}/Contents/MacOS/bmux"
ATTEMPT=0
MAX_ATTEMPTS=20
while [[ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]]; do
  if pgrep -f "$APP_PROCESS_PATH" >/dev/null 2>&1; then
    echo "Release launch status:"
    echo "  running: ${APP_PROCESS_PATH}"
    exit 0
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 0.25
done

echo "warning: Release app launch was requested, but no running process was observed for:" >&2
echo "  ${APP_PROCESS_PATH}" >&2
