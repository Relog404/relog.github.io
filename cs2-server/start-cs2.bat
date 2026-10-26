@echo off
rem =============================================================
rem  Launch CS2 dedicated server (Windows)
rem  Installer copies this file and substitutes the RCON password.
rem
rem  -insecure is REQUIRED: without it Metamod/CSSharp/PanelSkins
rem  do not load at all (the game keeps VAC secure mode on).
rem =============================================================
chcp 65001 >nul 2>&1
setlocal

set "GAME_DIR=%~dp0game"
set "RCON_PASSWORD=changeme_rcon_password"
set "SERVER_PASSWORD="
set "GSLT="
set "PORT=27015"
set "MAP=de_dust2"
set "GAME_TYPE=0"
set "GAME_MODE=1"
set "MAXPLAYERS=10"

set "ARGS=-dedicated -console -usercon -insecure -port %PORT% -maxplayers_override %MAXPLAYERS%"
set "ARGS=%ARGS% +map %MAP% +game_type %GAME_TYPE% +game_mode %GAME_MODE%"
set "ARGS=%ARGS% +maxplayers %MAXPLAYERS% +bot_quota 0"
set "ARGS=%ARGS% +rcon_password %RCON_PASSWORD% +sv_password %SERVER_PASSWORD%"
set "ARGS=%ARGS% +exec server.cfg"

if not "%GSLT%"=="" (
    set "ARGS=%ARGS% +sv_setsteamaccount %GSLT%"
) else (
    set "ARGS=%ARGS% +sv_lan 1"
    echo GSLT не задан — сервер поднимется только в локальной сети.
)

echo Запускаю CS2 на порту %PORT%, карта %MAP% ...
echo Плагины грузятся только с -insecure (он уже добавлен).
"%GAME_DIR%\game\bin\win64\cs2.exe" %ARGS%

endlocal
