@echo off
rem окно не закроется само: весь запуск идёт внутри cmd /k
if not defined CS2BAT_GUARD (echo [%~nx0] start... & set "CS2BAT_GUARD=1" & "%COMSPEC%" /k ""%~f0" %*" & pause & exit /b)
rem =============================================================
rem  Веб-панель CS2 — запуск в один клик (Windows)
rem  Нужен Node.js 20+: https://nodejs.org
rem
rem  Что делает: ставит зависимости (если их нет) и поднимает панель
rem  на http://localhost:3000
rem =============================================================
chcp 65001 >nul 2>&1
setlocal
title CS2 панель

cd /d "%~dp0"

echo.
echo  ============================================================
echo   Веб-панель CS2: кейсы, апгрейд, скины
echo  ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo   ОШИБКА: Node.js не найден.
    echo   Поставьте Node.js 20 или новее: https://nodejs.org
    echo   После установки запустите этот файл снова.
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do set "NODE_VERSION=%%v"
echo   Node.js: %NODE_VERSION%

if not exist ".env" (
    copy /y ".env.example" ".env" >nul
    echo.
    echo   Создан файл .env — откройте его и укажите свой SteamID64:
    echo       ADMIN_STEAM_IDS=7656119xxxxxxxxxx
    echo   Узнать свой SteamID64: https://steamid.io
    echo.
    pause
)

if not exist "node_modules" (
    echo   Ставлю зависимости — это минута-две, не закрывайте окно...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo   ОШИБКА: npm install не прошёл. Проверьте интернет.
        pause
        exit /b 1
    )
)

echo.
echo   Панель поднимается: http://localhost:3000
echo   Админка:            http://localhost:3000  ^(войдите через Steam^)
echo   Остановить:         Ctrl+C в этом окне
echo  ============================================================
echo.

rem тот же ключ, что использует игровой плагин (его создаёт CS2.bat)
if exist "%~dp0plugin-key.txt" set /p PLUGIN_API_KEY=<"%~dp0plugin-key.txt"

rem порт панели фиксируем сами: в окружении может быть PORT от игрового сервера
set "PANEL_PORT=3000"
set "PORT=3000"

call npm start

echo.
echo   Панель остановлена.
pause
endlocal
exit /b 0
