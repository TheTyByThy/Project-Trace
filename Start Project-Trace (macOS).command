#!/bin/bash
# Project-Trace launcher for macOS. Double-click me (first time: right-click → Open).
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  # Homebrew / nvm installs aren't always on the PATH of double-clicked scripts.
  for p in /opt/homebrew/bin /usr/local/bin "$HOME/.nvm/versions/node"/*/bin; do
    [ -x "$p/node" ] && export PATH="$p:$PATH" && break
  done
fi

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Project-Trace needs Node.js (free). Opening the download page..."
  echo "  Install the LTS version, then double-click this file again."
  open "https://nodejs.org/en/download"
  read -r -p "Press Enter to close."
  exit 1
fi

# Installs (or re-installs, if the folder was copied from Windows) the dependencies for this Mac.
node scripts/ensure-install.mjs || { read -r -p "Installation failed — press Enter to close."; exit 1; }

echo "  Starting Project-Trace..."
npm start

# Project-Trace has quit: close the Terminal window that was opened to launch it. This runs detached
# (and ignores the hang-up) so the window has no running process left and closes without a prompt.
if [ "$TERM_PROGRAM" = "Apple_Terminal" ]; then
  PT_TTY="$(tty)"
  nohup /bin/sh -c "sleep 0.5; osascript \
    -e 'tell application \"Terminal\"' \
    -e 'repeat with w in windows' \
    -e 'repeat with t in tabs of w' \
    -e 'if tty of t is \"$PT_TTY\" then' \
    -e 'close w' \
    -e 'return' \
    -e 'end if' \
    -e 'end repeat' \
    -e 'end repeat' \
    -e 'end tell'" >/dev/null 2>&1 &
fi
exit 0
