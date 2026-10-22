#!/usr/bin/env bash
# Sobe a interface da assistente (arquivos estaticos) na porta 3000
DIR="$(cd "$(dirname "$0")" && pwd)"
PORTA="${1:-3000}"

if curl -s --max-time 2 "http://localhost:${PORTA}/" >/dev/null 2>&1; then
  echo "Ja esta rodando: http://localhost:${PORTA}"
  exit 0
fi

setsid python3 -m http.server "$PORTA" --bind 127.0.0.1 --directory "$DIR" > "${DIR}/server-${PORTA}.log" 2>&1 < /dev/null &
echo "Assistente em http://localhost:${PORTA}"
echo "Abra esse endereco no Chrome."
