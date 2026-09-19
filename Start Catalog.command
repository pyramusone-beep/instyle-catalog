#!/bin/bash
# Double-click launcher for the Instyle Outfitters catalog (macOS).
# Go to this script's own folder so it works wherever you put it.
cd "$(dirname "$0")" || exit 1
clear
echo "==============================================="
echo "   Instyle Outfitters  —  Product Catalog"
echo "==============================================="
echo

# 1) Node.js required (one-time install)
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed yet — this is a one-time setup."
  echo
  echo "  1. I'll open the download page in your browser."
  echo "  2. Click the big green 'LTS' button and install it."
  echo "  3. Then double-click 'Start Catalog' again."
  echo
  open "https://nodejs.org/en/download/" 2>/dev/null
  echo "Press Return to close this window."
  read _
  exit 0
fi

# 2) First-time: download what the app needs
if [ ! -d node_modules ]; then
  echo "First-time setup: downloading the app's parts (about a minute)…"
  echo
  if ! npm install --no-audit --no-fund; then
    echo
    echo "Setup hit a problem. Copy everything in this window and send it to Claude."
    echo "Press Return to close."
    read _
    exit 1
  fi
  echo
fi

# 3) First-time: create your login and save it to a file you can always reopen
if [ ! -f .env ]; then
  PW=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 12)
  [ -z "$PW" ] && PW="instyle$(date +%s | tail -c 6)"
  cp .env.example .env 2>/dev/null
  /usr/bin/sed -i '' "s|^OWNER_PASSWORD=.*|OWNER_PASSWORD=$PW|" .env 2>/dev/null
  {
    echo "Instyle Catalog — your manager login"
    echo "------------------------------------"
    echo "Web address : http://localhost:3000/admin"
    echo "Username    : owner"
    echo "Password    : $PW"
    echo
    echo "Keep this file. To change the password later, edit the .env file."
  } > "YOUR-LOGIN.txt"
  echo "Created your login — see the file 'YOUR-LOGIN.txt' in this folder."
  echo
fi

# 4) Open the manager in your browser once the server is up
( sleep 2; open "http://localhost:3000/admin" 2>/dev/null ) &

echo "Your login (also saved in YOUR-LOGIN.txt):"
echo "   Username: owner"
echo "   Password: $(grep '^OWNER_PASSWORD=' .env 2>/dev/null | cut -d= -f2-)"
echo
echo "Starting the catalog… your browser will open the manager automatically."
echo
echo ">>>  To STOP the catalog: close this window (or press Control-C).  <<<"
echo
npm start
