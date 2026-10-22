#!/usr/bin/env bash
# Para a interface da assistente
pids=$(pgrep -f "[h]ttp.server.*assistente" || true)
if [ -z "$pids" ]; then
  pids=$(pgrep -f "[h]ttp.server 3000" || true)
fi
if [ -z "$pids" ]; then
  echo "Nada rodando."
  exit 0
fi
kill $pids 2>/dev/null
sleep 1
echo "Parado."
