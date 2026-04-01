#!/bin/bash
# Test script that sends keystrokes to bmux via AppleScript
# This tests the actual keyboard input path through the app

set -e

echo "=== bmux Keystroke Test ==="
echo ""

# Check if bmux is running
if ! pgrep -x "bmux" > /dev/null; then
    echo "Error: bmux is not running"
    echo "Please start bmux first"
    exit 1
fi

echo "bmux is running"
echo ""

# Activate bmux
osascript -e 'tell application "bmux" to activate'
sleep 0.5

echo "Test 1: Testing Ctrl+C (SIGINT)"
echo "  Typing 'sleep 30' and pressing Enter..."

# Type the command
osascript -e 'tell application "System Events" to keystroke "sleep 30"'
sleep 0.2
osascript -e 'tell application "System Events" to keystroke return'
sleep 0.5

echo "  Sending Ctrl+C..."
# Send Ctrl+C
osascript -e 'tell application "System Events" to keystroke "c" using control down'
sleep 0.5

echo "  If you see '^C' or the command was interrupted, Ctrl+C is working!"
echo ""

echo "Test 2: Testing Ctrl+D (EOF)"
echo "  Starting cat command..."

# Type cat command
osascript -e 'tell application "System Events" to keystroke "cat"'
sleep 0.2
osascript -e 'tell application "System Events" to keystroke return'
sleep 0.5

echo "  Sending Ctrl+D..."
# Send Ctrl+D
osascript -e 'tell application "System Events" to keystroke "d" using control down'
sleep 0.5

echo "  If cat exited, Ctrl+D is working!"
echo ""

echo "=== Manual Verification Required ==="
echo "Please check the bmux window to verify:"
echo "  1. The 'sleep 30' command was interrupted by Ctrl+C"
echo "  2. The 'cat' command exited after Ctrl+D"
echo ""
echo "If both worked, the fix is successful!"
