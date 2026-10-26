@echo off
rem =============================================================
rem  CS2 — ОДИН ФАЙЛ: проверяет всё, скачивает чего нет, запускает сервер
rem
rem  Запуск: двойной клик
rem    CS2.bat
rem  или с параметрами:
rem    CS2.bat D:\cs2-server MyRconPass123 GSLTТОКЕН
rem
rem  Что делает:
rem    1) проверяет место на диске
rem    2) качает SteamCMD, если его нет
rem    3) качает CS2 (app 730), если игры нет
rem    4) ставит Metamod:Source и CounterStrikeSharp, если их нет
rem    5) кладёт плагин PanelSkins (уже собранный, .NET не нужен)
rem    6) пишет server.cfg с вашим RCON-паролем
rem    7) запускает сервер в режиме insecure (иначе плагины не работают)
rem =============================================================
chcp 65001 >nul 2>&1
setlocal EnableExtensions EnableDelayedExpansion
title CS2 сервер + скинченджер

rem ------------------------- НАСТРОЙКИ -------------------------
set "INSTALL_DIR=%~1"
if "%INSTALL_DIR%"=="" set "INSTALL_DIR=%USERPROFILE%\cs2-server"
set "RCON_PASSWORD=%~2"
if "%RCON_PASSWORD%"=="" set "RCON_PASSWORD=cs2-%RANDOM%%RANDOM%"
set "GSLT=%~3"
set "SERVER_PASSWORD="
set "PORT=27015"
set "MAP=de_dust2"
set "MAXPLAYERS=10"
set "AUTO_RESTART=1"

set "SCRIPT_DIR=%~dp0"
set "GAME_DIR=%INSTALL_DIR%\game"
set "STEAMCMD_DIR=%INSTALL_DIR%\steamcmd"
set "STEAMCMD_EXE=%STEAMCMD_DIR%\steamcmd.exe"
set "CS2_EXE=%GAME_DIR%\game\bin\win64\cs2.exe"
set "CSGO_DIR=%GAME_DIR%\game\csgo"
set "STEAMCMD_URL=https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip"
set "APP_ID=730"
set "MIN_GB=45"

echo.
echo  ============================================================
echo   CS2 сервер + скины с панели — всё в одном файле
echo  ============================================================
echo   Папка сервера : %INSTALL_DIR%
echo   RCON-пароль   : %RCON_PASSWORD%
if "%GSLT%"=="" (echo   GSLT-токен   : не задан — сервер будет в режиме LAN) else (echo   GSLT-токен   : задан)
echo.

rem --------------------- [1/7] место на диске -------------------
echo [1/7] Проверяю место на диске...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%STEAMCMD_DIR%" mkdir "%STEAMCMD_DIR%"
if not exist "%GAME_DIR%" mkdir "%GAME_DIR%"

set "DRIVE=%INSTALL_DIR:~0,1%"
set "FREEG=0"
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "[math]::Floor((Get-PSDrive -Name '%DRIVE%').Free/1GB)" 2^>nul`) do set "FREEG=%%A"
if not defined FREEG set "FREEG=0"
echo        на диске %DRIVE%: свободно %FREEG% ГБ
if %FREEG% GTR 0 if %FREEG% LSS %MIN_GB% (
    echo.
    echo   ОШИБКА: нужно минимум %MIN_GB% ГБ, свободно %FREEG% ГБ.
    echo   CS2 dedicated — это полная игра, она весит 60-70 ГБ.
    echo   Освободите место или запустите с другой папкой:
    echo       %~nx0 D:\cs2-server
    echo.
    pause
    exit /b 1
)

rem --------------------- [2/7] SteamCMD -------------------------
echo [2/7] Проверяю SteamCMD...
if not exist "%STEAMCMD_EXE%" (
    echo        качаю SteamCMD...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%STEAMCMD_URL%' -OutFile '%STEAMCMD_DIR%\steamcmd.zip'; Expand-Archive -Force -Path '%STEAMCMD_DIR%\steamcmd.zip' -DestinationPath '%STEAMCMD_DIR%'; Remove-Item '%STEAMCMD_DIR%\steamcmd.zip'"
)
if not exist "%STEAMCMD_EXE%" (
    echo   ОШИБКА: SteamCMD не скачался. Проверьте интернет и антивирус.
    pause
    exit /b 1
)
echo        готово

rem --------------------- [3/7] игра CS2 -------------------------
echo [3/7] Проверяю игру CS2...
set "ATTEMPT=0"
:game_loop
if exist "%CS2_EXE%" goto game_ok
set /a ATTEMPT+=1
if %ATTEMPT% GTR 3 (
    echo   ОШИБКА: CS2 не установилась после 3 попыток.
    echo   Обычно это нехватка места — SteamCMD пишет "state is 0x202".
    pause
    exit /b 1
)
echo        качаю CS2 ^(app %APP_ID%^), попытка %ATTEMPT% из 3 — это долго, не закрывайте окно
"%STEAMCMD_EXE%" +force_install_dir "%GAME_DIR%" +login anonymous +app_update %APP_ID% validate +quit
goto game_loop
:game_ok
echo        игра на месте: %CS2_EXE%

rem --------------------- [4/7] Metamod + CSSharp ----------------
echo [4/7] Проверяю Metamod и CounterStrikeSharp...
if not exist "%CSGO_DIR%\addons\counterstrikesharp" (
    echo        ставлю плагиновую обвязку ^(Metamod + CounterStrikeSharp^)...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-plugins.ps1" -InstallDir "%INSTALL_DIR%"
)
if not exist "%CSGO_DIR%\addons\metamod" (
    echo.
    echo   ВНИМАНИЕ: папка addons\metamod не найдена — CounterStrikeSharp без него не работает.
    echo   Скачайте архив тут: https://www.metamodsource.net/downloads.php?branch=stable
    echo   и распакуйте его в %CSGO_DIR%
    echo.
) else (
    echo        metamod на месте
)

rem --------------------- [5/7] плагин PanelSkins ----------------
echo [5/7] Проверяю плагин PanelSkins...
set "PLUGIN_SRC=%SCRIPT_DIR%plugins\PanelSkins"
set "PLUGIN_DST=%CSGO_DIR%\addons\counterstrikesharp\plugins\PanelSkins"
set "GAMEDATA_DST=%CSGO_DIR%\addons\counterstrikesharp\gamedata"
if not exist "%PLUGIN_DST%" mkdir "%PLUGIN_DST%"
if not exist "%GAMEDATA_DST%" mkdir "%GAMEDATA_DST%"

if not exist "%PLUGIN_DST%\PanelSkins.dll" (
    if exist "%PLUGIN_SRC%\prebuilt\PanelSkins.dll" (
        copy /y "%PLUGIN_SRC%\prebuilt\PanelSkins.dll" "%PLUGIN_DST%\PanelSkins.dll" >nul
    ) else (
        echo        готовой сборки рядом нет — качаю с GitHub
        powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/Relog404/relog.github.io/main/cs2-server/plugins/PanelSkins/prebuilt/PanelSkins.dll' -OutFile '%PLUGIN_DST%\PanelSkins.dll' } catch { Write-Host 'не скачалось' }"
    )
)
if exist "%PLUGIN_DST%\PanelSkins.dll" (echo        PanelSkins.dll на месте) else (echo        ВНИМАНИЕ: PanelSkins.dll не найден — скины работать не будут)

if exist "%PLUGIN_SRC%\gamedata\panelskins.json" copy /y "%PLUGIN_SRC%\gamedata\panelskins.json" "%GAMEDATA_DST%\panelskins.json" >nul

if not exist "%PLUGIN_DST%\PanelSkins.json" (
    copy /y "%PLUGIN_SRC%\config.example.json" "%PLUGIN_DST%\PanelSkins.json" >nul
    echo        создан конфиг: %PLUGIN_DST%\PanelSkins.json
)

rem --------------------- [6/7] server.cfg -----------------------
echo [6/7] Готовлю server.cfg...
set "CFG_DIR=%CSGO_DIR%\cfg"
if not exist "%CFG_DIR%" mkdir "%CFG_DIR%"
copy /y "%SCRIPT_DIR%cfg\server.cfg" "%CFG_DIR%\server.cfg" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%CFG_DIR%\server.cfg'; (Get-Content $f -Raw) -replace 'changeme_rcon_password','%RCON_PASSWORD%' | Set-Content $f -Encoding utf8"
if "%GSLT%"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%CFG_DIR%\server.cfg'; (Get-Content $f -Raw) -replace 'sv_lan 0','sv_lan 1' | Set-Content $f -Encoding utf8"
    echo        GSLT нет — включил sv_lan 1, чтобы сервер не ругался на вход в Steam
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%CFG_DIR%\server.cfg'; (Get-Content $f -Raw) -replace 'sv_lan 1','sv_lan 0' | Set-Content $f -Encoding utf8"
)
echo        готово

rem --------------------- [7/7] запуск ---------------------------
echo [7/7] Запускаю сервер...

rem Проверим, жива ли панель: без неё плагин не получит скины
set "PANEL_DIR=%SCRIPT_DIR%..\panel"
set "PANEL_OK=0"
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 3 -UseBasicParsing; $r.StatusCode } catch { 0 }" 2^>nul`) do set "PANEL_OK=%%A"

if "%PANEL_OK%"=="200" goto panel_ok

echo        панель не отвечает — поднимаю её сам в отдельном окне
where node >nul 2>&1
if errorlevel 1 goto panel_no_node
start "CS2 панель" /D "%PANEL_DIR%" cmd /c "npm install --no-audit --no-fund && npm start"
echo        жду 15 секунд, пока панель поднимется...
timeout /t 15 /nobreak >nul
goto panel_ok

:panel_no_node
echo        Node.js не найден — поставьте его: https://nodejs.org
echo        без панели сервер запустится, но скины выдавать будет нечем

:panel_ok

rem свежий конфиг копируется из примера — проверим, что ключ в нём поменяли
findstr /c:"КЛЮЧ_ИЗ_АДМИНКИ_ПАНЕЛИ" "%PLUGIN_DST%\PanelSkins.json" >nul 2>&1
if not errorlevel 1 (
    echo        ВНИМАНИЕ: в PanelSkins.json пустой PluginKey — панель отдаст 401.
    echo        Возьмите ключ в админке панели ^(«Настройки»^) и впишите его в
    echo        %PLUGIN_DST%\PanelSkins.json
)

set "ARGS=-dedicated -console -usercon -insecure -port %PORT% -maxplayers_override %MAXPLAYERS%"
set "ARGS=%ARGS% +map %MAP% +game_type 0 +game_mode 1"
set "ARGS=%ARGS% +rcon_password %RCON_PASSWORD% +sv_password %SERVER_PASSWORD%"
set "ARGS=%ARGS% +exec server.cfg"
if not "%GSLT%"=="" set "ARGS=%ARGS% +sv_setsteamaccount %GSLT%"
if "%GSLT%"=="" set "ARGS=%ARGS% +sv_lan 1"

echo.
echo   Карта: %MAP%   Порт: %PORT%   Игроков: %MAXPLAYERS%
echo   Команды в консоли сервера:  status   css_plugins list   quit
echo   Чтобы остановить — закройте окно или наберите quit
echo  ============================================================
echo.

set "RESTARTS=0"

:launch
"%CS2_EXE%" %ARGS%
set "CODE=%ERRORLEVEL%"

if "%CODE%"=="0" goto finished
if "%AUTO_RESTART%"=="1" if %RESTARTS% LSS 3 (
    set /a RESTARTS+=1
    echo.
    echo   Сервер завершился с кодом %CODE%. Перезапуск %RESTARTS% из 3 через 10 секунд...
    timeout /t 10 /nobreak >nul
    goto launch
)

:finished
echo.
echo   Сервер остановлен.
echo   Логи сервера: %CSGO_DIR%\logs
pause
endlocal
exit /b 0
