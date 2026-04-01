#!/bin/bash
# Rebuild and restart bmux app

set -e

cd "$(dirname "$0")/.."

# Kill existing app if running
pkill -9 -f "bmux" 2>/dev/null || true

# Build
swift build

# Copy to app bundle
cp .build/debug/bmux .build/debug/bmux.app/Contents/MacOS/

# Open the app
open .build/debug/bmux.app
