@echo off
rem =============================================================
rem  Launch CS2 dedicated server (Windows)
rem  Installer copies this file and substitutes the RCON password.
rem =============================================================
setlocal

set "GAME_DIR=%~dp0game"
set "RCON_PASSWORD=changeme_rcon_password"
set "SERVER_PASSWORD="
set "GSLT="
set "PORT=27015"
set "MAP=de_dust2"
set "GAME_TYPE=0"
set "GAME_MODE=1"

set "ARGS=-dedicated -console -usercon -port %PORT% -maxplayers_override 10"
set "ARGS=%ARGS% +map %MAP% +game_type %GAME_TYPE% +game_mode %GAME_MODE%"
set "ARGS=%ARGS% +rcon_password %RCON_PASSWORD% +sv_password %SERVER_PASSWORD%"

if not "%GSLT%"=="" set "ARGS=%ARGS% +sv_setsteamaccount %GSLT%"

echo Starting CS2 dedicated server on port %PORT% ...
"%GAME_DIR%\game\bin\win64\cs2.exe" %ARGS%

endlocal
