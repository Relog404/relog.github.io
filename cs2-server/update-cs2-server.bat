@echo off
rem =============================================================
rem  Обновление уже установленного сервера CS2 (Windows)
rem  Usage: update-cs2-server.bat [install_dir]
rem =============================================================
setlocal EnableExtensions

set "INSTALL_DIR=%~1"
if "%INSTALL_DIR%"=="" set "INSTALL_DIR=%USERPROFILE%\cs2-server"
set "STEAMCMD_EXE=%INSTALL_DIR%\steamcmd\steamcmd.exe"
set "GAME_DIR=%INSTALL_DIR%\game"
set "APP_ID=730"
set "MAX_ATTEMPTS=3"

if not exist "%STEAMCMD_EXE%" (
    echo ERROR: %STEAMCMD_EXE% not found. Run install-cs2-server.bat first.
    exit /b 1
)

set "ATTEMPT=0"

:update_loop
set /a ATTEMPT+=1
echo --- attempt %ATTEMPT% of %MAX_ATTEMPTS% ---
"%STEAMCMD_EXE%" +force_install_dir "%GAME_DIR%" +login anonymous +app_update %APP_ID% validate +quit

if not errorlevel 1 goto update_ok

echo    SteamCMD returned an error.
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "[math]::Floor((Get-PSDrive -Name '%INSTALL_DIR:~0,1%').Free/1GB)" 2^>nul`) do set "FREEG=%%A"
echo    Free space: %FREEG% GB
if "%ATTEMPT%"=="1" goto update_loop
if "%ATTEMPT%"=="2" (
    echo    Clearing partial download cache and retrying...
    if exist "%GAME_DIR%\steamapps\downloading" rd /s /q "%GAME_DIR%\steamapps\downloading"
    goto update_loop
)
echo ERROR: update failed. If you see "state is 0x202" - that means not enough disk space.
exit /b 1

:update_ok
echo Update finished. Start the server: %INSTALL_DIR%\start-cs2.bat
endlocal
