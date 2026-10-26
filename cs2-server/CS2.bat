@echo off
rem =============================================================
rem  CS2 — ОДИН ФАЙЛ: проверяет всё, скачивает чего нет, запускает сервер
rem
rem  Запуск: двойной клик
rem    CS2.bat
rem  или с параметрами:
rem    CS2.bat E:\cs2-server MyRconPass123 GSLTТОКЕН
rem
rem  Путь к серверу запоминается в файле cs2-path.txt рядом с батником,
rem  поэтому при следующем двойном клике он снова использует его.
rem  Если на диске по умолчанию мало места — сам выберет диск, где место есть.
rem =============================================================
rem =============================================================
rem  СТРАХОВКА ОТ «ОКНО ЗАКРЫЛОСЬ САМО»
rem  Весь запуск идёт внутри cmd /k: если дальше случится любая
rem  ошибка (или файл окажется битым) — окно ОСТАНЕТСЯ с текстом
rem  ошибки, а не исчезнет. Раньше вывод уходил в пайп powershell,
rem  и любой сбой пайпа гасил окно без единой строчки на экране.
rem =============================================================
if not defined CS2BAT_GUARD (echo [CS2.bat] start... & set "CS2BAT_GUARD=1" & "%COMSPEC%" /k ""%~f0" %*" & pause & exit /b)

rem  куда пишем, как далеко дошёл запуск (пригодится, если окно всё же закроют)
set "TRACE=%~dp0cs2-bat.log"
>>"%TRACE%" 2>nul echo === CS2.bat старт %DATE% %TIME%
chcp 65001 >nul 2>&1
>>"%TRACE%" 2>nul echo [0/7] кодировка консоли переключена
setlocal EnableExtensions EnableDelayedExpansion
title CS2 сервер + скинченджер

rem  файл должен быть с CRLF: с LF cmd ломается на метках goto и сам закрывается.
rem  Проверка однострочная, чтобы сработала даже в таком битом файле.
set "EOL_CHECK="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command \"$t=[IO.File]::ReadAllText('%~f0'); $n=([regex]::Matches($t,[string][char]10)).Count; $r=([regex]::Matches($t,[string][char]13+[string][char]10)).Count; if($n -gt $r){'LF'}else{'CRLF'}\"`) do set "EOL_CHECK=%%A"
if "%EOL_CHECK%"=="LF" echo.
if "%EOL_CHECK%"=="LF" echo   ВНИМАНИЕ: CS2.bat сохранён с переводами строк LF - cmd закрывается сам.
if "%EOL_CHECK%"=="LF" echo   Пересохраняю этот файл с CRLF и запускаю заново...
if "%EOL_CHECK%"=="LF" powershell -NoProfile -Command \"$p='%~f0'; $t=[IO.File]::ReadAllText($p); [IO.File]::WriteAllText($p,($t -replace \"`r?`n\",\"`r`n\"),(New-Object System.Text.UTF8Encoding($false)))\"
if "%EOL_CHECK%"=="LF" start "" "%~f0" %*
if "%EOL_CHECK%"=="LF" exit /b

>>"%TRACE%" 2>nul echo [0/7] файл проверен, переводы строк в порядке

rem ------------------------- НАСТРОЙКИ -------------------------
set "SCRIPT_DIR=%~dp0"
set "PATH_FILE=%SCRIPT_DIR%cs2-path.txt"

set "INSTALL_DIR=%~1"
if "%INSTALL_DIR%"=="" if exist "%PATH_FILE%" set /p INSTALL_DIR=<"%PATH_FILE%"
if "%INSTALL_DIR%"=="" set "INSTALL_DIR=%USERPROFILE%\cs2-server"

set "RCON_PASSWORD=%~2"
if "%RCON_PASSWORD%"=="" set "RCON_PASSWORD=cs2-%RANDOM%%RANDOM%"
set "GSLT=%~3"
set "SERVER_PASSWORD="
set "PORT=27015"
set "MAP=de_dust2"
set "MAXPLAYERS=10"
set "AUTO_RESTART=1"
set "MIN_GB=45"
set "APP_ID=730"
set "STEAMCMD_URL=https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip"
set "PLUGIN_SRC=%SCRIPT_DIR%plugins\PanelSkins"
set "PANEL_DIR=%SCRIPT_DIR%..\panel"
rem ключ, по которому игровой плагин забирает скины из панели (один на всё)
set "PANEL_KEY_FILE=%PANEL_DIR%\plugin-key.txt"
set "PLUGIN_KEY="
if exist "%PANEL_KEY_FILE%" set /p PLUGIN_KEY=<"%PANEL_KEY_FILE%"
if defined PLUGIN_KEY goto key_ready
for /f "usebackq delims=" %%K in (`powershell -NoProfile -Command "[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')"`) do set "PLUGIN_KEY=%%K"
>"%PANEL_KEY_FILE%" echo %PLUGIN_KEY%
:key_ready

call :setpaths

rem сервер уже ставился в другое место — найдём его, чтобы не качать вторую копию
if exist "%CS2_EXE%" goto path_known
for %%D in (C D E F G H I J K L M N O P Q R S T U V W X Y Z) do (
    if exist "%%D:\cs2-server\game\game\bin\win64\cs2.exe" (
        set "INSTALL_DIR=%%D:\cs2-server"
        goto path_known
    )
)

:path_known
call :setpaths

rem весь вывод сервера пишем в файл: если он закроется, будет видно почему
set "LOG_DIR=%INSTALL_DIR%\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
set "STAMP="
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"`) do set "STAMP=%%T"
if not defined STAMP set "STAMP=%RANDOM%"
set "LOG_FILE=%LOG_DIR%\cs2-%STAMP%.log"
set "CODE_FILE=%LOG_DIR%\exitcode.tmp"
rem лог сервера пишет сам движок, консоль идёт прямо в окно (пайп в powershell гасил окно)

echo.
echo  ============================================================
echo   CS2 сервер + скины с панели — всё в одном файле
echo  ============================================================
echo   Папка сервера : %INSTALL_DIR%
echo   RCON-пароль   : %RCON_PASSWORD%
if "%GSLT%"=="" (echo   GSLT-токен   : не задан — сервер будет в режиме LAN) else (echo   GSLT-токен   : задан)
echo.

rem --------------------- [0/7] панель ---------------------------
echo [0/7] Поднимаю панель (без неё скины не выдадутся)...
>>"%TRACE%" 2>nul echo [0/7] панель %DATE% %TIME%
call :startpanel

rem --------------------- [1/7] место на диске -------------------
echo [1/7] Проверяю место на диске...
>>"%TRACE%" 2>nul echo [1/7] 1 шаг %DATE% %TIME%
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%STEAMCMD_DIR%" mkdir "%STEAMCMD_DIR%"
if not exist "%GAME_DIR%" mkdir "%GAME_DIR%"

call :freegb %DRIVE%
echo        диск %DRIVE%: свободно %FREEG% ГБ

if %FREEG% GEQ %MIN_GB% goto disk_ok
if exist "%CS2_EXE%" (
    echo        игра уже установлена — места хватает, продолжаю
    goto disk_ok
)

rem место кончилось: ищем другой диск, где его достаточно
echo        на %DRIVE%: меньше %MIN_GB% ГБ — ищу другой диск...
set "BEST_DRIVE="
set "BEST_FREE=0"
for /f "usebackq tokens=1,2 delims==" %%A in (`powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem ^| Where-Object { $_.Free -gt 0 } ^| Sort-Object -Property Free -Descending ^| ForEach-Object { $_.Name + '=' + [math]::Floor($_.Free/1GB) }" 2^>nul`) do (
    if %%B GTR !BEST_FREE! (
        set "BEST_FREE=%%B"
        set "BEST_DRIVE=%%A"
    )
)

call :showdrives

if not defined BEST_DRIVE goto disk_fail
if !BEST_FREE! LSS %MIN_GB% goto disk_fail

echo        ставлю на диск !BEST_DRIVE!: — там свободно !BEST_FREE! ГБ
set "INSTALL_DIR=!BEST_DRIVE!:\cs2-server"
call :setpaths
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%STEAMCMD_DIR%" mkdir "%STEAMCMD_DIR%"
if not exist "%GAME_DIR%" mkdir "%GAME_DIR%"
goto disk_ok

:disk_fail
echo.
echo   ОШИБКА: ни на одном диске нет %MIN_GB% ГБ.
echo   CS2 dedicated — это полная игра, она весит 60-70 ГБ.
echo   Освободите место или укажите папку сами:
echo       %~nx0 E:\cs2-server
echo.
pause
exit /b 1

:disk_ok

rem --------------------- [2/7] SteamCMD -------------------------
echo [2/7] Проверяю SteamCMD...
>>"%TRACE%" 2>nul echo [2/7] 2 шаг %DATE% %TIME%
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
>>"%TRACE%" 2>nul echo [3/7] 3 шаг %DATE% %TIME%
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
echo        игра на месте

rem --------------------- [4/7] Metamod + CSSharp ----------------
echo [4/7] Проверяю Metamod и CounterStrikeSharp...
>>"%TRACE%" 2>nul echo [4/7] 4 шаг %DATE% %TIME%
set "NEED_PLUGINS=0"
set "GI_OK=0"
set "CSS_OK=0"
if exist "%CSGO_DIR%\addons\counterstrikesharp\bin\win64\*.dll" set "CSS_OK=1"
if "%CSS_OK%"=="0" set "NEED_PLUGINS=1"
set "MM_OK=0"
if exist "%CSGO_DIR%\addons\metamod\bin\win64\*.dll" set "MM_OK=1"
if "%MM_OK%"=="0" set "NEED_PLUGINS=1"
if exist "%CSGO_DIR%\gameinfo.gi" findstr /c:"addons/metamod" "%CSGO_DIR%\gameinfo.gi" >nul 2>&1 && set "GI_OK=1"
if "%GI_OK%"=="0" set "NEED_PLUGINS=1"
rem  установщик зовём ВСЕГДА: версии сверяет он сам, по маркерам.
rem  Проверять только «есть ли dll на диске» нельзя: после обновления CS2
rem  старый CSSharp спокойно лежит на месте, но роняет сервер ровно в тот
rem  момент, когда заходит игрок (PlayerManager::OnAuthorized, CS2 1.41.9.2).
goto install_plugins

:install_plugins
set "CSS_VER="
if exist "%CSGO_DIR%\addons\counterstrikesharp\css-version.txt" for /f "usebackq delims=" %%V in ("%CSGO_DIR%\addons\counterstrikesharp\css-version.txt") do set "CSS_VER=%%V"
if defined CSS_VER echo        на диске CounterStrikeSharp %CSS_VER%
set "MM_VER="
if exist "%CSGO_DIR%\addons\metamod\mm-version.txt" for /f "usebackq delims=" %%V in ("%CSGO_DIR%\addons\metamod\mm-version.txt") do set "MM_VER=%%V"
if defined MM_VER echo        на диске Metamod %MM_VER%
if exist "%SCRIPT_DIR%force-reinstall.txt" (
    echo        вижу force-reinstall.txt - сношу старые addons и ставлю заново
    del /q "%SCRIPT_DIR%force-reinstall.txt" >nul 2>&1
    if exist "%CSGO_DIR%\addons\metamod" rmdir /s /q "%CSGO_DIR%\addons\metamod" >nul 2>&1
    if exist "%CSGO_DIR%\addons\counterstrikesharp" rmdir /s /q "%CSGO_DIR%\addons\counterstrikesharp" >nul 2>&1
)
echo        проверяю Metamod + CounterStrikeSharp и правлю gameinfo.gi...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-plugins.ps1" -InstallDir "%INSTALL_DIR%"
if errorlevel 1 echo        установщик плагинов завершился с ошибкой — текст выше
set "MM_OK=0"
if exist "%CSGO_DIR%\addons\metamod\bin\win64\*.dll" set "MM_OK=1"
if "%MM_OK%"=="1" (
    echo        metamod на месте:
    dir /b "%CSGO_DIR%\addons\metamod\bin\win64\*.dll"
) else (
    echo.
    echo   ============================================================
    echo     METAMOD НЕ УСТАНОВЛЕН - плагины не загрузятся.
    echo     Причина - в тексте выше.
    echo     Вручную: распаковать папку addons из архива
    echo       mmsource-2.0.0-git1483-windows.zip
    echo     в папку: %CSGO_DIR%
    echo   ============================================================
    echo.
    pause
)
set "CSS_OK=0"
if exist "%CSGO_DIR%\addons\counterstrikesharp\bin\win64\*.dll" set "CSS_OK=1"
if "%CSS_OK%"=="1" (
    echo        counterstrikesharp на месте
) else (
    echo        ВНИМАНИЕ: нет dll в addons\counterstrikesharp\bin\win64
    echo        PanelSkins не загрузится
)

:gi_check
rem Metamod подключается ТОЛЬКО через gameinfo.gi — без этой строки он молчит
set "GI_OK=0"
if exist "%CSGO_DIR%\gameinfo.gi" findstr /c:"addons/metamod" "%CSGO_DIR%\gameinfo.gi" >nul 2>&1 && set "GI_OK=1"
if "%GI_OK%"=="1" goto gi_ok
echo        правлю gameinfo.gi сам...
call :patchgi
set "GI_OK=0"
if exist "%CSGO_DIR%\gameinfo.gi" findstr /c:"addons/metamod" "%CSGO_DIR%\gameinfo.gi" >nul 2>&1 && set "GI_OK=1"
if "%GI_OK%"=="1" goto gi_ok
echo        ВНИМАНИЕ: не вышло — сделайте руками.
echo        Откройте %CSGO_DIR%\gameinfo.gi и добавьте после Game_LowViolence csgo_lv:
echo            Game    csgo/addons/metamod
goto cfg_extra

:gi_ok
echo        metamod прописан в gameinfo.gi

:cfg_extra
rem этот конфиг игра выполняет ПОСЛЕ своего gamemode_competitive.cfg — убирает ботов
if exist "%SCRIPT_DIR%cfg\gamemode_competitive_server.cfg" (
    if not exist "%CSGO_DIR%\cfg" mkdir "%CSGO_DIR%\cfg"
    copy /y "%SCRIPT_DIR%cfg\gamemode_competitive_server.cfg" "%CSGO_DIR%\cfg\gamemode_competitive_server.cfg" >nul
    echo        gamemode_competitive_server.cfg установлен ^(боты выключены^)
)

rem --------------------- [5/7] плагин PanelSkins ----------------
echo [5/7] Проверяю плагин PanelSkins...
>>"%TRACE%" 2>nul echo [5/7] 5 шаг %DATE% %TIME%
if not exist "%PLUGIN_DST%" mkdir "%PLUGIN_DST%"
if not exist "%GAMEDATA_DST%" mkdir "%GAMEDATA_DST%"

if exist "%PLUGIN_SRC%\prebuilt\PanelSkins.dll" (
    copy /y "%PLUGIN_SRC%\prebuilt\PanelSkins.dll" "%PLUGIN_DST%\PanelSkins.dll" >nul
    echo        PanelSkins.dll обновлён из готовой сборки
) else (
    if not exist "%PLUGIN_DST%\PanelSkins.dll" (
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
>>"%TRACE%" 2>nul echo [6/7] 6 шаг %DATE% %TIME%
if not exist "%CFG_DIR%" mkdir "%CFG_DIR%"
copy /y "%SCRIPT_DIR%cfg\server.cfg" "%CFG_DIR%\server.cfg" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%CFG_DIR%\server.cfg'; $t=[IO.File]::ReadAllText($f) -replace 'changeme_rcon_password','%RCON_PASSWORD%'; [IO.File]::WriteAllText($f,$t,(New-Object System.Text.UTF8Encoding($false)))"
if "%GSLT%"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%CFG_DIR%\server.cfg'; $t=[IO.File]::ReadAllText($f) -replace 'sv_lan 0','sv_lan 1'; [IO.File]::WriteAllText($f,$t,(New-Object System.Text.UTF8Encoding($false)))"
    echo        GSLT нет — включил sv_lan 1, чтобы сервер не ругался на вход в Steam
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%CFG_DIR%\server.cfg'; $t=[IO.File]::ReadAllText($f) -replace 'sv_lan 1','sv_lan 0'; [IO.File]::WriteAllText($f,$t,(New-Object System.Text.UTF8Encoding($false)))"
)
echo        готово

rem старая копия start-cs2.bat запускала сервер без -insecure — плагины молча не грузились,
rem поэтому перезапишем её актуальной версией с нашими паролем и токеном
copy /y "%SCRIPT_DIR%start-cs2.bat" "%INSTALL_DIR%\start-cs2.bat" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%INSTALL_DIR%\start-cs2.bat'; $t=[IO.File]::ReadAllText($f) -replace 'changeme_rcon_password','%RCON_PASSWORD%'; [IO.File]::WriteAllText($f,$t,(New-Object System.Text.UTF8Encoding($false)))"
if not "%GSLT%"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%INSTALL_DIR%\start-cs2.bat'; $t=[IO.File]::ReadAllText($f) -replace 'set \"GSLT=\"','set \"GSLT=%GSLT%\"'; [IO.File]::WriteAllText($f,$t,(New-Object System.Text.UTF8Encoding($false)))"
)
echo        start-cs2.bat обновлён ^(теперь с -insecure^)

rem запомним путь, чтобы двойной клик в следующий раз попал туда же
>"%PATH_FILE%" echo %INSTALL_DIR%

rem --------------------- [7/7] запуск ---------------------------
echo [7/7] Запускаю сервер...
>>"%TRACE%" 2>nul echo [7/7] 7 шаг %DATE% %TIME%

rem Проверим, жива ли панель: без неё плагин не получит скины
set "PANEL_DIR=%SCRIPT_DIR%..\panel"
call :startpanel
rem панель должна принимать наш ключ: 400 — ключ верный (ругается только на SteamID), 401 — ключ чужой
set "KEY_OK="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri ('http://127.0.0.1:3000/api/plugin/loadout/1?key=' + '%PLUGIN_KEY%') -TimeoutSec 4 -UseBasicParsing; 'ok' } catch { $c = 0; try { $c = [int]$_.Exception.Response.StatusCode.value__ } catch { $c = 0 }; if ($c -eq 400) { 'ok' } else { 'bad' } }" 2^>nul`) do set "KEY_OK=%%A"
if "%KEY_OK%"=="ok" (
    echo        панель принимает ключ плагина
) else (
    echo        ВНИМАНИЕ: панель не принимает ключ плагина — скины не выдадутся.
    echo        Закройте окно «CS2 панель» и запустите её заново: panel\start-windows.bat
)


rem свежий конфиг копируется из примера — проверим, что ключ в нём поменяли
rem ключ плагина = тот же, что знает панель, иначе /api/plugin/loadout вернёт 401
if not "%PLUGIN_KEY%"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%PLUGIN_DST%\PanelSkins.json'; $j=[IO.File]::ReadAllText($f) | ConvertFrom-Json; $j.PanelUrl='http://127.0.0.1:3000'; $j.PluginKey='%PLUGIN_KEY%'; [IO.File]::WriteAllText($f,($j | ConvertTo-Json -Depth 6),(New-Object System.Text.UTF8Encoding($false)))"
    set "KEY_WRITTEN=no"
    for /f "usebackq delims=" %%K in (`powershell -NoProfile -Command "$j=[IO.File]::ReadAllText('%PLUGIN_DST%\PanelSkins.json') ^| ConvertFrom-Json; if ($j.PluginKey -eq '%PLUGIN_KEY%') { 'ok' } else { 'no' }"`) do set "KEY_WRITTEN=%%K"
    if "!KEY_WRITTEN!"=="ok" (echo        ключ плагина прописан в PanelSkins.json) else (echo        ВНИМАНИЕ: ключ в PanelSkins.json не прописался - плагин получит 401)
) else (
    echo        ВНИМАНИЕ: ключ плагина пуст - плагин получит 401
)

set "ARGS=-dedicated -console -usercon -insecure -port %PORT% -maxplayers_override %MAXPLAYERS%"
set "ARGS=%ARGS% +map %MAP% +game_type 0 +game_mode 1"
set "ARGS=%ARGS% +bot_quota 0"
set "ARGS=%ARGS% +rcon_password %RCON_PASSWORD% +sv_password %SERVER_PASSWORD%"
set "ARGS=%ARGS% +exec server.cfg"
if not "%GSLT%"=="" set "ARGS=%ARGS% +sv_setsteamaccount %GSLT%"
if "%GSLT%"=="" set "ARGS=%ARGS% +sv_lan 1"

echo.
echo   Карта: %MAP%   Порт: %PORT%   Игроков: %MAXPLAYERS%
echo   Панель ^(сайт^) : http://localhost:3000 — открывать в браузере
echo   Сервер CS2    : порт %PORT% — в браузере не открывается,
echo                   заходить из игры: connect 127.0.0.1:%PORT%
echo   Проверка плагинов в консоли:  meta list   и   css_plugins list
echo   VAC отключён (-insecure): игроки с VAC-баном заходят
echo   Выкидывает с «ошибкой переполнения»? В консоли игры: rate 786432 и fps_max 300
echo   Заходим так: в консоли CS2 наберите  connect 127.0.0.1:%PORT%
if "%GSLT%"=="" echo   Без GSLT-токена сервер виден только в локальной сети: в общем списке серверов его не будет
echo   Если плагинов нет — установите Visual C++ Redistributable x64:
echo       https://aka.ms/vs/17/release/vc_redist.x64.exe
echo   Лог запуска  : %TRACE%
echo   Чтобы остановить — закройте окно или наберите quit
echo  ============================================================
echo.

set "RESTARTS=0"
(echo === CS2 запуск %DATE% %TIME% : %ARGS%)>>"%LOG_FILE%"

:launch
if exist "%CODE_FILE%" del /q "%CODE_FILE%" >nul 2>&1
"%CS2_EXE%" %ARGS%
set "CODE=%ERRORLEVEL%"
(echo EXITCODE:%CODE%)>"%CODE_FILE%"
>>"%TRACE%" 2>nul echo [7/7] сервер остановлен, код %CODE% %DATE% %TIME%
if not "%CODE%"=="0" call :dumpengine
if not "%CODE%"=="0" (> "%SCRIPT_DIR%force-reinstall.txt" echo следующий запуск переустановит Metamod и CSSharp)
if "%CODE%"=="0" goto finished
if "%AUTO_RESTART%"=="1" if %RESTARTS% LSS 3 (
    set /a RESTARTS+=1
    echo.
    echo   Сервер завершился с кодом %CODE%. Перезапуск %RESTARTS% из 3 через 10 секунд...
    timeout /t 10 /nobreak >nul
    goto launch
)

:finished
if not "%CODE%"=="0" (
    echo.
    echo   Сервер завершился с кодом %CODE% - так быть не должно.
    echo   Если он падает, когда заходит игрок, проверь плагин:
    echo     переименуй папку %PLUGIN_DST% в PanelSkins_off и запусти снова.
    echo   Не падает без плагина - пришли мне cs2-bat.log.
)
echo.
echo   ---- последние 25 строк лога ----
powershell -NoProfile -Command "Get-Content -LiteralPath '%TRACE%' -Tail 25 -ErrorAction SilentlyContinue"
echo   --------------------------------
echo.
echo   Полный лог запуска: %TRACE%
echo   Логи движка: %CSGO_DIR%\logs
echo.
echo   Окно остаётся открытым специально: если что-то пошло не так,
echo   текст ошибки будет здесь. Закрыть окно — крестиком.
pause
endlocal
exit /b 0

rem ========================== процедуры ==========================

:setpaths
set "DRIVE=%INSTALL_DIR:~0,1%"
set "GAME_DIR=%INSTALL_DIR%\game"
set "STEAMCMD_DIR=%INSTALL_DIR%\steamcmd"
set "STEAMCMD_EXE=%STEAMCMD_DIR%\steamcmd.exe"
set "CS2_EXE=%GAME_DIR%\game\bin\win64\cs2.exe"
set "CSGO_DIR=%GAME_DIR%\game\csgo"
set "CFG_DIR=%CSGO_DIR%\cfg"
set "PLUGIN_DST=%CSGO_DIR%\addons\counterstrikesharp\plugins\PanelSkins"
set "GAMEDATA_DST=%CSGO_DIR%\addons\counterstrikesharp\gamedata"
exit /b 0

:freegb
set "FREEG=0"
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "[math]::Floor((Get-PSDrive -Name '%~1').Free/1GB)" 2^>nul`) do set "FREEG=%%A"
if not defined FREEG set "FREEG=0"
if "%FREEG%"=="" set "FREEG=0"
exit /b 0

rem вставляет "Game    csgo/addons/metamod" в gameinfo.gi (страховка, если install-plugins.ps1 не отработал)
:patchgi
if not exist "%CSGO_DIR%\gameinfo.gi" exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -Command "$gi='%CSGO_DIR%\gameinfo.gi'; $t=[IO.File]::ReadAllText($gi); if ($t -notmatch 'addons/metamod') { [IO.File]::WriteAllText($gi+'.bak',$t); $nl=[string][char]10; $tb=[string][char]9; $r='$1'+$nl+$tb+$tb+'Game'+$tb+$tb+'csgo/addons/metamod'; $n=[regex]::Replace($t,'(?m)^(\s*Game_LowViolence\s+csgo_lv\s*)$',$r); if ($n -eq $t) { $n=[regex]::Replace($t,'(?ms)(SearchPaths\s*\{)','$1'+$nl+$tb+$tb+'Game'+$tb+$tb+'csgo/addons/metamod') }; [IO.File]::WriteAllText($gi,$n) }"
exit /b 0

:showdrives
echo        свободно по дискам:
for /f "usebackq tokens=1,2 delims==" %%A in (`powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem ^| Where-Object { $_.Free -gt 0 } ^| Sort-Object -Property Free -Descending ^| ForEach-Object { $_.Name + '=' + [math]::Floor($_.Free/1GB) }" 2^>nul`) do (
    echo          %%A: %%B ГБ
)
exit /b 0

:startpanel
rem  Панель должна отвечать ДО старта сервера, иначе плагин уйдёт в пустоту.
set "PANEL_OK=0"
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 3 -UseBasicParsing; $r.StatusCode } catch { 0 }" 2^>nul`) do set "PANEL_OK=%%A"
if "%PANEL_OK%"=="200" (
    echo        панель отвечает: сайт http://localhost:3000
    exit /b 0
)
where node >nul 2>&1
if errorlevel 1 (
    echo        Node.js не найден - поставьте его: https://nodejs.org
    echo        без панели сервер запустится, но скины выдавать будет нечем
    exit /b 1
)
echo        панель молчит - поднимаю её в отдельном окне
start "CS2 панель" /D "%PANEL_DIR%" cmd /c "set PANEL_PORT=3000&& set PORT=3000&& set PLUGIN_API_KEY=%PLUGIN_KEY%&& npm install --no-audit --no-fund && npm start"
set "WAITED=0"

:panel_wait
set /a WAITED+=5
timeout /t 5 /nobreak >nul
set "PANEL_OK=0"
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 3 -UseBasicParsing; $r.StatusCode } catch { 0 }" 2^>nul`) do set "PANEL_OK=%%A"
if "%PANEL_OK%"=="200" (
    echo        панель поднялась ^(через %WAITED% сек^), сайт: http://localhost:3000
    start "" http://localhost:3000
    exit /b 0
)
if %WAITED% LSS 60 goto panel_wait
rem  Если панель унаследовала PORT игрового сервера, она сядет на 27015
set "PANEL_OK=0"
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:27015/api/health' -TimeoutSec 3 -UseBasicParsing; $r.StatusCode } catch { 0 }" 2^>nul`) do set "PANEL_OK=%%A"
if "%PANEL_OK%"=="200" (
    echo.
    echo   ВНИМАНИЕ: панель сидит на порте 27015 - это порт игрового сервера.
    echo   Закройте окно "CS2 панель" и запустите CS2.bat заново.
    echo.
)
echo        панель не поднялась за %WAITED% секунд - скины не выдадутся
exit /b 1

:dumpengine
rem  сервер упал - снимем хвост его последнего лога в cs2-bat.log
set "ENGINE_LOG="
for /f "delims=" %%F in ('dir /b /o-d "%CSGO_DIR%\logs\*.log" 2^>nul') do if not defined ENGINE_LOG set "ENGINE_LOG=%CSGO_DIR%\logs\%%F"
if not defined ENGINE_LOG exit /b 0
>>"%TRACE%" 2>nul echo ---- хвост лога движка: %ENGINE_LOG% ----
powershell -NoProfile -Command "Get-Content -LiteralPath '%ENGINE_LOG%' -Tail 40 -ErrorAction SilentlyContinue" >>"%TRACE%" 2>nul
exit /b 0
