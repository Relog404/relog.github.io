#!/usr/bin/env bash
# =============================================================
#  Обновление уже установленного сервера CS2 (Linux)
#  Usage: ./update-cs2-server.sh [install_dir]
# =============================================================
set -uo pipefail

INSTALL_DIR="${1:-$HOME/cs2-server}"
STEAMCMD="$INSTALL_DIR/steamcmd/steamcmd.sh"
GAME_DIR="$INSTALL_DIR/game"
APP_ID=730
MAX_ATTEMPTS=3

[ -x "$STEAMCMD" ] || { echo "ERROR: $STEAMCMD not found. Run install-cs2-server.sh first."; exit 1; }

ATTEMPT=0
while [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  echo "--- attempt $ATTEMPT of $MAX_ATTEMPTS ---"

  "$STEAMCMD" +force_install_dir "$GAME_DIR" +login anonymous +app_update "$APP_ID" validate +quit
  RC=$?

  [ "$RC" -eq 0 ] && { echo "Update finished. Start: $INSTALL_DIR/start-cs2.sh"; exit 0; }

  echo "   SteamCMD returned $RC. Free space:"; df -h "$INSTALL_DIR"
  if [ "$ATTEMPT" -eq 2 ]; then
    echo "   Clearing partial download cache..."
    rm -rf "$GAME_DIR/steamapps/downloading"
  fi
done

echo "ERROR: update failed. 'state is 0x202' means not enough disk space."
exit 1
