@echo off
rem =============================================================
rem  Launch CS2 dedicated server (Windows)
rem  Installer copies this file and substitutes the RCON password.
rem
rem  -insecure is REQUIRED: without it Metamod/CSSharp/PanelSkins
rem  do not load at all (the game keeps VAC secure mode on).
rem
rem  Вывод сервера дублируется в logs\cs2-console.log
rem =============================================================
rem =============================================================
rem  СТРАХОВКА: запуск идёт внутри cmd /k, поэтому окно не может
rem  закрыться само — любая ошибка останется на экране.
rem =============================================================
if not defined CS2BAT_GUARD (echo [start-cs2.bat] start... & set "CS2BAT_GUARD=1" & "%COMSPEC%" /k ""%~f0" %*" & pause & exit /b)
set "TRACE=%~dp0cs2-bat.log"
>>"%TRACE%" 2>nul echo === start-cs2.bat старт %DATE% %TIME%
chcp 65001 >nul 2>&1
setlocal EnableExtensions EnableDelayedExpansion

set "GAME_DIR=%~dp0game"
set "RCON_PASSWORD=changeme_rcon_password"
set "SERVER_PASSWORD="
set "GSLT="
set "PORT=27015"
set "MAP=de_dust2"
set "GAME_TYPE=0"
set "GAME_MODE=1"
set "MAXPLAYERS=10"

if "%RCON_PASSWORD%"=="changeme_rcon_password" (
    echo.
    echo   ВНИМАНИЕ: пароль RCON не заменён ^(в файле так и осталось changeme^).
    echo   Запустите CS2.bat — он подставит пароль, ключ плагина, проверит
    echo   Metamod/CSSharp и напишет лог. Этот файл нужен только как запасной.
    echo.
    pause
)

set "LOG_DIR=%~dp0logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
set "LOG_FILE=%LOG_DIR%\cs2-console.log"
set "CODE_FILE=%LOG_DIR%\exitcode.tmp"
rem консоль сервера идёт прямо в окно (пайп в powershell гасил окно)

set "ARGS=-dedicated -console -usercon -insecure -port %PORT% -maxplayers_override %MAXPLAYERS%"
set "ARGS=%ARGS% +map %MAP% +game_type %GAME_TYPE% +game_mode %GAME_MODE%"
set "ARGS=%ARGS% +bot_quota 0"
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
echo Лог: %LOG_FILE%
(echo === CS2 запуск %DATE% %TIME% : %ARGS%)>>"%LOG_FILE%"

if exist "%CODE_FILE%" del /q "%CODE_FILE%" >nul 2>&1
"%GAME_DIR%\game\bin\win64\cs2.exe" %ARGS%
set "CODE=%ERRORLEVEL%"
(echo EXITCODE:%CODE%)>"%CODE_FILE%"
>>"%TRACE%" 2>nul echo сервер остановлен, код %CODE% %DATE% %TIME%

echo.
echo   ---- последние 25 строк лога ----
powershell -NoProfile -Command "Get-Content -LiteralPath '%TRACE%' -Tail 25 -ErrorAction SilentlyContinue"
echo   --------------------------------
echo   Сервер остановлен ^(код %CODE%^).
echo   Лог запуска: %TRACE%
echo.
echo   Окно остаётся открытым специально — закрыть его можно крестиком.
pause

endlocal
