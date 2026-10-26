@echo off
rem =============================================================
rem  ONE-CLICK INSTALL: CS2 server + CounterStrikeSharp + plugins
rem
rem  Usage:
rem    install-all.bat [install_dir] [rcon_password] [gslt_token]
rem
rem  What it does (everything is downloaded automatically):
rem    1) downloads SteamCMD and installs CS2 dedicated server (app 730)
rem    2) downloads CounterStrikeSharp and installs it into the server
rem    3) installs the PanelSkins plugin (PREBUILT dll - no .NET needed)
rem    4) writes server.cfg / start-cs2.bat with your RCON password
rem
rem  Needs ~65-70 GB of free space.
rem  GSLT (public server token): https://steamcommunity.com/dev/managegameservers
rem =============================================================
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "INSTALL_DIR=%~1"
if "%INSTALL_DIR%"=="" set "INSTALL_DIR=%USERPROFILE%\cs2-server"
set "RCON_PASSWORD=%~2"
set "GSLT=%~3"

echo.
echo ============================================
echo  CS2 server + plugins + skinchanger, one click
echo ============================================
echo Install dir : %INSTALL_DIR%
echo.

echo [1/3] Installing CS2 dedicated server...
call "%SCRIPT_DIR%install-cs2-server.bat" "%INSTALL_DIR%" "%RCON_PASSWORD%" "%GSLT%"
if errorlevel 1 (
    echo.
    echo ERROR: CS2 server installation failed. Fix the problem above and run this file again.
    exit /b 1
)

echo.
echo [2/3] Installing CounterStrikeSharp + PanelSkins plugin...
call "%SCRIPT_DIR%install-plugins.bat" "%INSTALL_DIR%"

echo.
echo [3/3] Done.
echo.
echo --------------------------------------------
echo  What to do next:
echo   1) Open %INSTALL_DIR%\game\csgo\addons\counterstrikesharp\plugins\PanelSkins\PanelSkins.json
echo      and set PanelUrl (address of your web panel) and PluginKey.
echo      The key is created in the panel: Settings tab, "new key" for your server.
echo   2) Start the server:  %INSTALL_DIR%\start-cs2.bat
echo   3) In the server console: css_plugins list
echo      PanelSkins must be there, and the console must show
echo      [PanelSkins] PanelSkins loaded
echo   4) The web panel itself is started separately: panel\install-windows.bat
echo --------------------------------------------
echo.
echo Metamod:Source sometimes has to be downloaded by hand (no stable direct link):
echo   https://www.metamodsource.net/downloads.php?branch=stable
echo   unpack the archive into %INSTALL_DIR%\game\csgo
echo   or re-run: set METAMOD_URL=^<zip url^> ^&^& install-plugins.bat
echo.

endlocal
exit /b 0
