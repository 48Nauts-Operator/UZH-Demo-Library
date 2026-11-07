#!/bin/zsh
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo 'Install Node.js 22 or newer from https://nodejs.org, then run this again.'
  read -r '?Press Return to close.'
  exit 1
fi
if [[ ! -d node_modules/qrcode || ! -d node_modules/chrono-node ]]; then
  npm ci --omit=dev || exit 1
fi
npm run event
read -r '?Press Return to close.'
