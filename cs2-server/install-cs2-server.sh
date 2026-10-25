#!/usr/bin/env bash
# =============================================================
#  CS2 Dedicated Server - automatic installer (Linux)
#
#  Usage:
#    ./install-cs2-server.sh [install_dir] [rcon_password] [gslt_token]
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

STEAMCMD_DIR="$INSTALL_DIR/steamcmd"
GAME_DIR="$INSTALL_DIR/game"

echo "==== CS2 Dedicated Server installer ===="
echo "Install dir   : $INSTALL_DIR"
echo "RCON password : $RCON_PASSWORD"
echo "GSLT token    : ${GSLT:-not set - LAN mode}"
echo

echo "[1/6] Directories..."
mkdir -p "$INSTALL_DIR" "$STEAMCMD_DIR" "$GAME_DIR"

echo "[2/6] SteamCMD..."
if [ ! -x "$STEAMCMD_DIR/steamcmd.sh" ]; then
  command -v curl >/dev/null || { echo "ERROR: curl not found (apt install curl)"; exit 1; }
  command -v tar >/dev/null || { echo "ERROR: tar not found"; exit 1; }
  curl -fsSL "$STEAMCMD_URL" -o "$STEAMCMD_DIR/steamcmd.tar.gz"
  tar -xzf "$STEAMCMD_DIR/steamcmd.tar.gz" -C "$STEAMCMD_DIR"
  rm -f "$STEAMCMD_DIR/steamcmd.tar.gz"
fi

echo "[3/6] Installing CS2 dedicated server (app $APP_ID, ~35 GB, be patient)..."
"$STEAMCMD_DIR/steamcmd.sh" +force_install_dir "$GAME_DIR" +login anonymous +app_update "$APP_ID" validate +quit

echo "[4/6] Config..."
CFG_DIR="$GAME_DIR/game/csgo/cfg"
mkdir -p "$CFG_DIR"
cp "$SCRIPT_DIR/cfg/server.cfg" "$CFG_DIR/server.cfg"
sed -i "s/changeme_rcon_password/$RCON_PASSWORD/" "$CFG_DIR/server.cfg"

echo "[5/6] Start script..."
cp "$SCRIPT_DIR/start-cs2.sh" "$INSTALL_DIR/start-cs2.sh"
sed -i "s/changeme_rcon_password/$RCON_PASSWORD/" "$INSTALL_DIR/start-cs2.sh"
[ -n "$GSLT" ] && sed -i "s|^GSLT=\"\"|GSLT=\"$GSLT\"|" "$INSTALL_DIR/start-cs2.sh"
chmod +x "$INSTALL_DIR/start-cs2.sh"

echo "[6/6] Notes..."
echo
echo "==== Done ===="
echo "Server files : $GAME_DIR"
echo "Start server : $INSTALL_DIR/start-cs2.sh"
echo
echo "If the server does not start, install Steam runtime dependencies, e.g. on Ubuntu/Debian:"
echo "  sudo apt-get install -y lib32stdc++6 libstdc++6 lib32z1 libncurses5"
echo
echo "Open ports: 27015 UDP (game), 27015 TCP (RCON), 27020 UDP (GOTV)"
echo "Optional web panel + plugins: see README.md"
