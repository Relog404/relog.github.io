@echo off
rem =============================================================
rem  CS2 Dedicated Server - automatic installer (Windows)
rem
rem  Usage:
rem    install-cs2-server.bat [install_dir] [rcon_password] [gslt_token]
rem
rem  Examples:
rem    install-cs2-server.bat
rem    install-cs2-server.bat C:\cs2-server MyRconPass123
rem    install-cs2-server.bat C:\cs2-server MyRconPass123 8A2F............
rem
rem  GSLT (game server login token): https://steamcommunity.com/dev/managegameservers
rem  Without GSLT the server works in LAN only (sv_lan 1).
rem =============================================================
setlocal EnableExtensions

set "INSTALL_DIR=%~1"
if "%INSTALL_DIR%"=="" set "INSTALL_DIR=%USERPROFILE%\cs2-server"
set "STEAMCMD_DIR=%INSTALL_DIR%\steamcmd"
set "GAME_DIR=%INSTALL_DIR%\game"
set "APP_ID=730"
set "STEAMCMD_URL=https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip"
set "STEAMCMD_EXE=%STEAMCMD_DIR%\steamcmd.exe"
set "SCRIPT_DIR=%~dp0"

set "RCON_PASSWORD=%~2"
if "%RCON_PASSWORD%"=="" set "RCON_PASSWORD=cs2-%RANDOM%%RANDOM%"
set "GSLT=%~3"

echo.
echo ==== CS2 Dedicated Server installer ====
echo Install dir : %INSTALL_DIR%
echo RCON password: %RCON_PASSWORD%
if "%GSLT%"=="" (echo GSLT token   : not set - LAN mode) else (echo GSLT token   : %GSLT%)
echo.

echo [1/6] Creating directories...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%STEAMCMD_DIR%" mkdir "%STEAMCMD_DIR%"
if not exist "%GAME_DIR%" mkdir "%GAME_DIR%"

echo [2/6] Downloading SteamCMD...
if not exist "%STEAMCMD_EXE%" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%STEAMCMD_URL%' -OutFile '%STEAMCMD_DIR%\steamcmd.zip'; Expand-Archive -Force -Path '%STEAMCMD_DIR%\steamcmd.zip' -DestinationPath '%STEAMCMD_DIR%'; Remove-Item '%STEAMCMD_DIR%\steamcmd.zip'"
)
if not exist "%STEAMCMD_EXE%" (
    echo ERROR: steamcmd.exe not found. Check internet connection / antivirus.
    exit /b 1
)

echo [3/6] Installing CS2 dedicated server (app %APP_ID%, ~35 GB, be patient)...
"%STEAMCMD_EXE%" +force_install_dir "%GAME_DIR%" +login anonymous +app_update %APP_ID% validate +quit
if errorlevel 1 (
    echo ERROR: SteamCMD failed. See output above.
    exit /b 1
)

echo [4/6] Installing config...
set "CFG_DIR=%GAME_DIR%\game\csgo\cfg"
if not exist "%CFG_DIR%" mkdir "%CFG_DIR%"
copy /y "%SCRIPT_DIR%cfg\server.cfg" "%CFG_DIR%\server.cfg" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%CFG_DIR%\server.cfg'; (Get-Content $f -Raw) -replace 'changeme_rcon_password','%RCON_PASSWORD%' | Set-Content $f -Encoding utf8"

echo [5/6] Installing start script...
copy /y "%SCRIPT_DIR%start-cs2.bat" "%INSTALL_DIR%\start-cs2.bat" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%INSTALL_DIR%\start-cs2.bat'; (Get-Content $f -Raw) -replace 'changeme_rcon_password','%RCON_PASSWORD%' | Set-Content $f -Encoding ascii"
if not "%GSLT%"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%INSTALL_DIR%\start-cs2.bat'; (Get-Content $f -Raw) -replace 'set \"GSLT=\"','set \"GSLT=%GSLT%\"' | Set-Content $f -Encoding ascii"
)

echo [6/6] Firewall rules (needs admin rights, ignore errors if any)...
netsh advfirewall firewall add rule name="CS2 DS 27015 UDP" dir=in action=allow protocol=UDP localport=27015 >nul 2>&1
netsh advfirewall firewall add rule name="CS2 DS 27015 TCP" dir=in action=allow protocol=TCP localport=27015 >nul 2>&1
netsh advfirewall firewall add rule name="CS2 DS 27020 UDP" dir=in action=allow protocol=UDP localport=27020 >nul 2>&1

echo.
echo ==== Done ====
echo Server files : %GAME_DIR%
echo Start script : %INSTALL_DIR%\start-cs2.bat
echo.
echo Next steps:
echo   1) Edit %INSTALL_DIR%\start-cs2.bat if you need another port/map.
if "%GSLT%"=="" echo   2) Get a GSLT at https://steamcommunity.com/dev/managegameservers and put it into start-cs2.bat
echo   3) Start the server: %INSTALL_DIR%\start-cs2.bat
echo   4) Optional web panel + plugins: see README.md
echo.
endlocal
