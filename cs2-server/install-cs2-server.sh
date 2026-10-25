#!/usr/bin/env bash
# =============================================================
#  CS2 Dedicated Server - automatic installer (Linux)
#
#  Usage:
#    ./install-cs2-server.sh [install_dir] [rcon_password] [gslt_token]
#
#  Needs ~65-70 GB of free space: app 730 is the full game, not a small
#  server package. If SteamCMD says "state is 0x202", that means disk full.
#
#  GSLT: https://steamcommunity.com/dev/managegameservers
#  Without GSLT the server works in LAN only (sv_lan 1).
# =============================================================
set -euo pipefail

INSTALL_DIR="${1:-$HOME/cs2-server}"
RCON_PASSWORD="${2:-cs2-$RANDOM$RANDOM}"
GSLT="${3:-}"
APP_ID=730
STEAMCMD_URL="https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MIN_GB=45          # меньше этого — даже не начинаем
RECOMMENDED_GB=70  # столько реально нужно с запасом (Valve: 65 GB)
MAX_ATTEMPTS=3

STEAMCMD_DIR="$INSTALL_DIR/steamcmd"
GAME_DIR="$INSTALL_DIR/game"
CS2_BIN="$GAME_DIR/game/bin/linuxsteamrt64/cs2"

echo "==== CS2 Dedicated Server installer ===="
echo "Install dir   : $INSTALL_DIR"
echo "RCON password : $RCON_PASSWORD"
echo "GSLT token    : ${GSLT:-not set - LAN mode}"
echo

echo "[1/6] Directories..."
mkdir -p "$INSTALL_DIR" "$STEAMCMD_DIR" "$GAME_DIR"

echo "[2/6] Checking free disk space..."
FREE_GB=$(df -P "$INSTALL_DIR" | awk 'NR==2 {printf "%d", $4/1048576}')
if [ -z "${FREE_GB:-}" ] || [ "$FREE_GB" -eq 0 ]; then
  echo "   Could not detect free space - continuing anyway."
else
  echo "   Free space: ${FREE_GB} GB in $INSTALL_DIR"
fi

if [ "${FREE_GB:-0}" -gt 0 ] && [ "${FREE_GB:-0}" -lt "$MIN_GB" ]; then
  echo
  echo "ERROR: only ${FREE_GB} GB free, need at least ${MIN_GB} GB."
  echo "       CS2 dedicated server is the FULL game (app 730), ~60-70 GB."
  echo "       Free the space or install elsewhere, e.g.:"
  echo "           $0 /mnt/bigdisk/cs2-server"
  exit 1
fi
if [ "${FREE_GB:-0}" -gt 0 ] && [ "${FREE_GB:-0}" -lt "$RECOMMENDED_GB" ]; then
  echo "   WARNING: recommended ${RECOMMENDED_GB} GB, you have ${FREE_GB} GB - may not be enough."
fi

echo "[3/6] SteamCMD..."
if [ ! -x "$STEAMCMD_DIR/steamcmd.sh" ]; then
  command -v curl >/dev/null || { echo "ERROR: curl not found (apt install curl)"; exit 1; }
  command -v tar >/dev/null || { echo "ERROR: tar not found"; exit 1; }
  curl -fsSL "$STEAMCMD_URL" -o "$STEAMCMD_DIR/steamcmd.tar.gz"
  tar -xzf "$STEAMCMD_DIR/steamcmd.tar.gz" -C "$STEAMCMD_DIR"
  rm -f "$STEAMCMD_DIR/steamcmd.tar.gz"
fi

echo "[4/6] Installing CS2 dedicated server (app $APP_ID)."
echo "      This is ~35-70 GB and can take a long time - do not interrupt."
echo

ATTEMPT=0
while [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  echo "--- attempt $ATTEMPT of $MAX_ATTEMPTS ---"

  # `set -e` отключаем на время установки: SteamCMD может вернуть ненулевой код,
  # но оставить докачанные файлы — тогда следующая попытка просто продолжит.
  set +e
  "$STEAMCMD_DIR/steamcmd.sh" +force_install_dir "$GAME_DIR" +login anonymous +app_update "$APP_ID" validate +quit
  RC=$?
  set -e

  if [ -x "$CS2_BIN" ]; then
    echo "   CS2 installed: $CS2_BIN"
    break
  fi

  echo
  echo "   SteamCMD did not finish (exit code $RC)."
  if [ "$ATTEMPT" -eq 1 ]; then
    echo "   Retrying as is: SteamCMD usually resumes the download."
  elif [ "$ATTEMPT" -eq 2 ]; then
    echo "   Clearing partial download cache and retrying one last time..."
    rm -rf "$GAME_DIR/steamapps/downloading"
    rm -f "$GAME_DIR/steamapps/appmanifest_${APP_ID}.acf"
  else
    echo
    echo "ERROR: could not install CS2 after $MAX_ATTEMPTS attempts."
    echo "       Most common cause: not enough disk space ('state is 0x202')."
    echo "       Free space now:"; df -h "$INSTALL_DIR"
    exit 1
  fi
done

if [ ! -x "$CS2_BIN" ]; then
  echo "ERROR: $CS2_BIN not found after $MAX_ATTEMPTS attempts."
  exit 1
fi

echo "[5/6] Config and start script..."
CFG_DIR="$GAME_DIR/game/csgo/cfg"
mkdir -p "$CFG_DIR"
cp "$SCRIPT_DIR/cfg/server.cfg" "$CFG_DIR/server.cfg"
sed -i "s/changeme_rcon_password/$RCON_PASSWORD/" "$CFG_DIR/server.cfg"

cp "$SCRIPT_DIR/start-cs2.sh" "$INSTALL_DIR/start-cs2.sh"
sed -i "s/changeme_rcon_password/$RCON_PASSWORD/" "$INSTALL_DIR/start-cs2.sh"
[ -n "$GSLT" ] && sed -i "s|^GSLT=\"\"|GSLT=\"$GSLT\"|" "$INSTALL_DIR/start-cs2.sh"
chmod +x "$INSTALL_DIR/start-cs2.sh"

echo "[6/6] Done."
echo
echo "==== Done ===="
echo "Server files : $GAME_DIR"
echo "Start server : $INSTALL_DIR/start-cs2.sh"
echo
echo "If the server does not start, install Steam runtime dependencies, e.g. on Ubuntu/Debian:"
echo "  sudo apt-get install -y lib32stdc++6 libstdc++6 lib32z1 libncurses5"
echo
echo "Open ports: 27015 UDP (game), 27015 TCP (RCON), 27020 UDP (GOTV)"
echo "Optional web panel + skin plugin: see README.md"
