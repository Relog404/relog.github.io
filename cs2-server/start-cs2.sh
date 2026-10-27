#!/usr/bin/env bash
# =============================================================
#  Запуск выделенного сервера CS2 (Linux)
# =============================================================
set -euo pipefail

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/game"
RCON_PASSWORD="${RCON_PASSWORD:-changeme_rcon_password}"
SERVER_PASSWORD="${SERVER_PASSWORD:-}"
GSLT="${GSLT:-}"                 # токен сервера: https://steamcommunity.com/dev/managegameservers
PORT="${PORT:-27015}"
MAP="${MAP:-de_dust2}"
GAME_TYPE="${GAME_TYPE:-0}"      # 0 = Classic
GAME_MODE="${GAME_MODE:-1}"      # 1 = Competitive

ARGS=(-dedicated -console -usercon -port "$PORT" -maxplayers_override 10
      +map "$MAP" +game_type "$GAME_TYPE" +game_mode "$GAME_MODE"
      +rcon_password "$RCON_PASSWORD" +sv_password "$SERVER_PASSWORD")

[[ -n "$GSLT" ]] && ARGS+=(+sv_setsteamaccount "$GSLT")

echo "Starting CS2 dedicated server on port $PORT ..."
exec "$GAME_DIR/game/bin/linuxsteamrt64/cs2" "${ARGS[@]}"
