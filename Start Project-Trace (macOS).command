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

if [ ! -d node_modules/electron ]; then
  echo ""
  echo "  First run: installing Project-Trace (about a minute, needs internet)..."
  npm install || { read -r -p "Installation failed — press Enter to close."; exit 1; }
fi

echo "  Starting Project-Trace..."
npm start
