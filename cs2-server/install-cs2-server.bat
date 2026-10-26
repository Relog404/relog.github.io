@echo off
rem =============================================================
rem  CS2 Dedicated Server - automatic installer (Windows)
rem
rem  Usage:
rem    install-cs2-server.bat [install_dir] [rcon_password] [gslt_token]
rem
rem  Examples:
rem    install-cs2-server.bat
rem    install-cs2-server.bat D:\cs2-server MyRconPass123
rem    install-cs2-server.bat D:\cs2-server MyRconPass123 8A2F............
rem
rem  Needs ~65-70 GB of free space: app 730 is the full game, not a small
rem  server package. If SteamCMD says "state is 0x202", that means disk full.
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
set "CS2_EXE=%GAME_DIR%\game\bin\win64\cs2.exe"
set "SCRIPT_DIR=%~dp0"

rem Minimum free space to even start; recommended is what Valve's wiki says (65 GB)
set "MIN_GB=45"
set "RECOMMENDED_GB=70"
set "MAX_ATTEMPTS=3"

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

echo [2/6] Checking free disk space...
set "DRIVE=%INSTALL_DIR:~0,1%"
set "FREEG=0"
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "[math]::Floor((Get-PSDrive -Name '%DRIVE%').Free/1GB)" 2^>nul`) do set "FREEG=%%A"
if not defined FREEG set "FREEG=0"
set /a "FREEG=%FREEG%" 2>nul
if "%FREEG%"=="0" (
    echo    Could not detect free space - continuing anyway.
) else (
    echo    Drive %DRIVE%: free %FREEG% GB.
)

set "SPACE_OK=1"
if %FREEG% GTR 0 if %FREEG% LSS %MIN_GB% set "SPACE_OK=0"

if "%SPACE_OK%"=="0" (
    echo.
    echo ERROR: on drive %DRIVE%: only %FREEG% GB free, need at least %MIN_GB% GB.
    echo        CS2 dedicated server is the FULL game ^(app 730^), it takes ~60-70 GB.
    echo        Free the space, or install to another drive:
    echo            %~nx0 D:\cs2-server
    echo.
    exit /b 1
)

set "SPACE_WARN=0"
if %FREEG% GTR 0 if %FREEG% LSS %RECOMMENDED_GB% set "SPACE_WARN=1"
if "%SPACE_WARN%"=="1" (
    echo    WARNING: recommended %RECOMMENDED_GB% GB, you have %FREEG% GB - may not be enough.
)

echo [3/6] Downloading SteamCMD...
if not exist "%STEAMCMD_EXE%" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%STEAMCMD_URL%' -OutFile '%STEAMCMD_DIR%\steamcmd.zip'; Expand-Archive -Force -Path '%STEAMCMD_DIR%\steamcmd.zip' -DestinationPath '%STEAMCMD_DIR%'; Remove-Item '%STEAMCMD_DIR%\steamcmd.zip'"
)
if not exist "%STEAMCMD_EXE%" (
    echo ERROR: steamcmd.exe not found. Check internet connection / antivirus.
    exit /b 1
)

echo [4/6] Installing CS2 dedicated server (app %APP_ID%).
echo       This is ~35-70 GB and can take a long time - do not close the window.
echo.

set "ATTEMPT=0"

:install_loop
set /a ATTEMPT+=1
echo --- attempt %ATTEMPT% of %MAX_ATTEMPTS% ---
"%STEAMCMD_EXE%" +force_install_dir "%GAME_DIR%" +login anonymous +app_update %APP_ID% validate +quit

if exist "%CS2_EXE%" goto install_ok

echo.
echo    SteamCMD did not finish the install.
call :show_space
if "%ATTEMPT%"=="1" (
    echo    Retrying as is: SteamCMD usually resumes the download.
    goto install_loop
)
if "%ATTEMPT%"=="2" (
    echo    Clearing partial download cache and retrying one last time...
    if exist "%GAME_DIR%\steamapps\downloading" rd /s /q "%GAME_DIR%\steamapps\downloading"
    if exist "%GAME_DIR%\steamapps\appmanifest_%APP_ID%.acf" del /q "%GAME_DIR%\steamapps\appmanifest_%APP_ID%.acf"
    goto install_loop
)

echo.
echo ERROR: could not install CS2 after %MAX_ATTEMPTS% attempts.
echo        Most common cause: not enough disk space ^("state is 0x202"^).
echo        Check the free space above, then run again - the download resumes.
exit /b 1

:install_ok
echo.
echo    CS2 installed: %CS2_EXE%

echo [5/6] Installing config and start script...
set "CFG_DIR=%GAME_DIR%\game\csgo\cfg"
if not exist "%CFG_DIR%" mkdir "%CFG_DIR%"
copy /y "%SCRIPT_DIR%cfg\server.cfg" "%CFG_DIR%\server.cfg" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%CFG_DIR%\server.cfg'; (Get-Content $f -Raw) -replace 'changeme_rcon_password','%RCON_PASSWORD%' | Set-Content $f -Encoding utf8"

copy /y "%SCRIPT_DIR%start-cs2.bat" "%INSTALL_DIR%\start-cs2.bat" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%INSTALL_DIR%\start-cs2.bat'; (Get-Content $f -Raw) -replace 'changeme_rcon_password','%RCON_PASSWORD%' | Set-Content $f -Encoding utf8"
if not "%GSLT%"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%INSTALL_DIR%\start-cs2.bat'; (Get-Content $f -Raw) -replace 'set \"GSLT=\"','set \"GSLT=%GSLT%\"' | Set-Content $f -Encoding utf8"
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
echo   1) Run the server:  %INSTALL_DIR%\start-cs2.bat
if "%GSLT%"=="" echo   2) Get a GSLT at https://steamcommunity.com/dev/managegameservers and put it into start-cs2.bat for a public server
echo   3) Optional web panel + skin plugin: see README.md
echo.
endlocal
exit /b 0

:show_space
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "[math]::Floor((Get-PSDrive -Name '%DRIVE%').Free/1GB)" 2^>nul`) do set "FREEG=%%A"
echo    Free space now: %FREEG% GB on %DRIVE%:
exit /b 0
