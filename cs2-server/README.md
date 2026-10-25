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
├─ install-cs2-server.bat   # установка (Windows)
├─ install-cs2-server.sh    # установка (Linux)
├─ start-cs2.bat / .sh      # запуск сервера
├─ install-plugins.bat/.ps1 # CounterStrikeSharp + Metamod
└─ cfg/server.cfg           # базовый конфиг сервера
```
