# CS2 Dedicated Server — автоустановка

Честный, «ванильный» выделенный сервер Counter-Strike 2: ставится через SteamCMD (app id `730`),
настраивается одним батником, управляется из веб-панели по RCON, расширяется серверными плагинами.

> **Важно про читы.** Здесь нет и не будет клиентских «худов» (AIM/WH/ESP) и скинченджеров,
> которые лезут в память или файлы игры. Это прямое нарушение правил Steam, гарантированный VAC-бан
> и порча игры остальным. Всё, что ниже, — серверная часть, которая официально разрешена Valve.

## Быстрый старт (Windows)

```bat
install-cs2-server.bat
```

С аргументами (каталог, RCON-пароль, GSLT-токен):

```bat
install-cs2-server.bat C:\cs2-server MyRconPass123 8A2F............
```

Что делает установщик:

1. создаёт `%USERPROFILE%\cs2-server` (или указанный каталог);
2. скачивает и распаковывает SteamCMD;
3. ставит/обновляет CS2 DS (`+app_update 730 validate`, ~35 ГБ);
4. кладёт `cfg/server.cfg` и подставляет в него сгенерированный RCON-пароль;
5. копирует `start-cs2.bat` с вашим паролем и GSLT;
6. пробует открыть порты 27015 (TCP/UDP) и 27020 (UDP) в брандмауэре Windows.

Запуск сервера:

```bat
start-cs2.bat
```

## Быстрый старт (Linux)

```bash
chmod +x install-cs2-server.sh start-cs2.sh
./install-cs2-server.sh ~/cs2-server MyRconPass123 <GSLT>
./start-cs2.sh
```

Если сервер не стартует, установите рантайм-зависимости Steam:

```bash
sudo apt-get install -y lib32stdc++6 libstdc++6 lib32z1 libncurses5
```

## Типичные ошибки установки

### `Error! App '730' state is 0x202 after update job`

Это **не** «сломанный SteamCMD» и не «нет прав». Код `0x202` у SteamCMD означает
«обновление встало на паузу» — на практике всегда **не хватает места на диске**.
CS2 DS — это полная игра (app 730), а не маленький серверный пакет: нужно **~65-70 ГБ**
(Valve в своей вики пишет 65 GB storage), а не 15-20.

Что делать:

1. Проверьте место: `PowerShell → Get-PSDrive C` или просто «Свойства» диска.
2. Освободите место **или** поставьте сервер на другой диск:
   ```bat
   install-cs2-server.bat D:\cs2-server
   ```
3. Просто запустите установщик ещё раз — SteamCMD **докачивает**, а не начинает с нуля.
   Скрипт сам сделает до 3 попыток и напечатает свободное место перед каждой.

Ручное обновление уже установленного сервера:

```bat
update-cs2-server.bat C:\cs2-server
```

### `Update state (0x3) reconfiguring` и тишина

Это нормально: SteamCMD распаковывает десятки гигабайт. Ждите, не закрывайте окно.

### Сервер не запускается после установки

- Windows: запускайте `start-cs2.bat` **из каталога установки** (`C:\cs2-server\start-cs2.bat`),
  а не из папки с репозиторием.
- Linux: поставьте рантайм Steam:
  `sudo apt-get install -y lib32stdc++6 libstdc++6 lib32z1 libncurses5`.

## Порты

| Назначение | Протокол | Порт |
|---|---|---|
| Игра | UDP | 27015 |
| RCON | TCP | 27015 |
| GOTV | UDP | 27020 |

## GSLT (токен сервера)

Для публичного сервера нужен Game Server Login Token: <https://steamcommunity.com/dev/managegameservers>.
Без токена сервер поднимается только в режиме LAN (`sv_lan 1` в `cfg/server.cfg`).

## Плагины (серверные, легальные)

```bat
install-plugins.bat C:\cs2-server
```

Скрипт ставит [CounterStrikeSharp](https://github.com/roflmuffin/CounterStrikeSharp) (плагины на C#:
голосование за карты, статистика, ретейки, 1v1-арены и т.д.). Для него нужен
Metamod:Source — скрипт подскажет, где взять сборку, или примет прямую ссылку:

```bat
set METAMOD_URL=https://.../mmsource-2.x-windows.zip
install-plugins.bat C:\cs2-server
```

Сервер с плагинами помечается как **insecure** (VAC на нём отключён) — это штатный режим
для комьюнити-серверов, разрешённый Valve. На клиенты игроков плагины не влияют.

## Скины игрокам на сервере (серверный скинченджер)

Плагин [`plugins/PanelSkins`](plugins/PanelSkins/README.md) забирает у панели набор скинов
игрока по его SteamID и применяет его к оружию, ножу и перчаткам — **на стороне сервера**.
Клиент CS2 не модифицируется, файлы игры не трогаются, это обычный серверный плагин.

```bash
cd plugins/PanelSkins
dotnet build -c Release -p:CSSharpRefs="<сервер>/game/csgo/addons/counterstrikesharp/shared/"
# затем PanelSkins.dll → addons/counterstrikesharp/plugins/PanelSkins/
```

Скины видно только на серверах с этим плагином, и надеть можно только то, чем игрок владеет
на сайте. Реальных денег в схеме нет: монеты виртуальные, апгрейд замкнут внутри сайта.

## Веб-панель

Управление сервером (статус, игроки, смена карты, чат, RCON-консоль), каталог скинов и медалей,
виртуальный магазин с апгрейд-рулеткой, админка и сборки, привязанные к SteamID:
смотрите [`../panel/README.md`](../panel/README.md).

```bat
cd ..\panel
npm install
copy .env.example .env   REM заполните ADMIN_STEAM_IDS и CS2_RCON_PASSWORD
npm start
```

## Карты из мастерской Steam

```bat
:: в server.cfg или при запуске
+workshop_start_map 3070207XX 0
host_workshop_map 3070207XX
```

Либо используйте смену карты из веб-панели (`ds_workshop_changelevel`).

## Файлы

```
cs2-server/
├─ install-cs2-server.bat   # установка (Windows, с проверкой места и 3 попытками)
├─ install-cs2-server.sh    # установка (Linux)
├─ update-cs2-server.bat/.sh# обновление уже установленного сервера
├─ install-cs2-server.sh    # установка (Linux)
├─ start-cs2.bat / .sh      # запуск сервера
├─ install-plugins.bat/.ps1 # CounterStrikeSharp + Metamod
└─ cfg/server.cfg           # базовый конфиг сервера
```


## Установка в один клик

```bat
install-all.bat
```

Скрипт сам: скачает SteamCMD и поставит CS2 (app 730), скачает CounterStrikeSharp,
положит **уже собранный** плагин `PanelSkins` (DLL лежит в репозитории, .NET не нужен),
напишет `server.cfg` и `start-cs2.bat`. Останется только указать адрес панели и ключ
в `PanelSkins.json`.

Метамод иногда приходится скачивать руками (у него нет стабильной прямой ссылки):
https://www.metamodsource.net/downloads.php?branch=stable — распакуйте архив в
`<сервер>\game\csgo`. Либо задайте ссылку: `set METAMOD_URL=<zip url>` перед запуском.

Плагин собирается автоматически в GitHub Actions при каждом изменении
`cs2-server/plugins/**`: готовая DLL коммитится обратно в `plugins/PanelSkins/prebuilt/`.
