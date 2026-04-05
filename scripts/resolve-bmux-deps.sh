#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BMUX_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
BMUX_DEPS_REPO="${BMUX_DEPS_REPO:-${BMUX_ROOT}/../bmux-deps}"
BMUX_DEPS_BUILD_CONFIGURATION="${BMUX_DEPS_BUILD_CONFIGURATION:-release}"

if [[ -n "${BMUX_DEPS_CLI:-}" ]]; then
  if [[ -x "${BMUX_DEPS_CLI}" ]]; then
    printf '%s\n' "${BMUX_DEPS_CLI}"
    exit 0
  fi
  echo "error: BMUX_DEPS_CLI is set but not executable: ${BMUX_DEPS_CLI}" >&2
  exit 1
fi

case "${BMUX_DEPS_BUILD_CONFIGURATION}" in
  release|debug) ;;
  *)
    echo "error: unsupported BMUX_DEPS_BUILD_CONFIGURATION=${BMUX_DEPS_BUILD_CONFIGURATION} (expected release or debug)" >&2
    exit 1
    ;;
esac

if [[ ! -f "${BMUX_DEPS_REPO}/Package.swift" ]]; then
  echo "error: bmux-deps repo not found at ${BMUX_DEPS_REPO}. Set BMUX_DEPS_REPO to a valid local checkout." >&2
  exit 1
fi

echo "Ensuring bmux-deps (${BMUX_DEPS_BUILD_CONFIGURATION}) from ${BMUX_DEPS_REPO}..." >&2
swift build \
  --package-path "${BMUX_DEPS_REPO}" \
  -c "${BMUX_DEPS_BUILD_CONFIGURATION}" \
  --product bmux-deps >&2

BIN_DIR="$(swift build --package-path "${BMUX_DEPS_REPO}" -c "${BMUX_DEPS_BUILD_CONFIGURATION}" --show-bin-path)"
BMUX_DEPS_BIN="${BIN_DIR}/bmux-deps"
if [[ ! -x "${BMUX_DEPS_BIN}" ]]; then
  echo "error: bmux-deps build completed but no executable was found at ${BMUX_DEPS_BIN}" >&2
  exit 1
fi

printf '%s\n' "${BMUX_DEPS_BIN}"
