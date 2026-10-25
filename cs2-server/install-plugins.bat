@echo off
rem =============================================================
rem  Install server-side plugins: CounterStrikeSharp (+ Metamod)
rem  Wrapper around install-plugins.ps1
rem
rem  Usage: install-plugins.bat [install_dir]
rem  Env:   METAMOD_URL=<zip url>  - optional direct Metamod:Source build
rem
rem  NOTE: these are SERVER-side plugins. They never touch the game client,
rem  do not modify its memory and are the normal way to extend a community
rem  server (map votes, stats, retakes, 1v1 arenas, etc.).
rem =============================================================
setlocal
set "SCRIPT_DIR=%~dp0"
set "INSTALL_DIR=%~1"
if "%INSTALL_DIR%"=="" set "INSTALL_DIR=%USERPROFILE%\cs2-server"

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-plugins.ps1" -InstallDir "%INSTALL_DIR%"
endlocal
