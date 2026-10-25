# relog.github.io

Проект по CS2: **выделенный сервер + веб-панель управления на Node.js**.

```
cs2-server/     установка выделенного сервера CS2 (SteamCMD), конфиги, плагины
panel/          веб-панель: RCON-управление сервером, каталог скинов, сборки по Steam
.github/        CI: тесты и проверка запуска панели
```

## Что внутри

| Возможность | Где |
|---|---|
| Автоустановка сервера CS2 через SteamCMD одним батником | `cs2-server/install-cs2-server.bat` (Windows), `.sh` (Linux) |
| Запуск с GSLT-токеном, competitive-конфигом, GOTV | `cs2-server/start-cs2.bat`, `cfg/server.cfg` |
| Серверные плагины (CounterStrikeSharp + Metamod) | `cs2-server/install-plugins.bat` |
| Веб-панель: статус, игроки, смена карты, чат, RCON-консоль | `panel/` |
| Вход через Steam (OpenID) и сохранение данных **по SteamID** | `panel/src/steam.js`, `panel/src/store.js` |
| Каталог/вишлист скинов с фильтрами и публичными сборками | `panel/src/skins.js`, `panel/public/app.js` |
| Тесты и CI | `panel/test/`, `.github/workflows/ci.yml` |

## Быстрый старт

**1. Сервер (Windows):**

```bat
cd cs2-server
install-cs2-server.bat C:\cs2-server
start-cs2.bat
```

**2. Панель:**

```bash
cd panel
npm install
cp .env.example .env     # укажите ADMIN_STEAM_IDS (ваш SteamID64) и CS2_RCON_PASSWORD
npm start                # http://localhost:3000
```

Подробности — в [`cs2-server/README.md`](cs2-server/README.md) и [`panel/README.md`](panel/README.md).

## Чего здесь нет и не будет

В репозитории **нет** клиентских «худов» (AIM, WH, ESP), скинченджеров и любых других модификаций
игрового клиента CS2. Причины простые:

- это прямое нарушение правил Steam — итогом будет VAC-бан аккаунта;
- это портит игру всем остальным на сервере;
- такие инструменты обычно поставляются в виде бинарников непонятного происхождения —
  вместе с читом вы получаете троян и угон аккаунта.

Всё, что сделано здесь, — легально: официальный RCON, серверные плагины, Steam OpenID и Steam Web API.
Каталог скинов — обычный справочник/вишлист, он ничего не меняет ни в игре, ни в инвентаре.

## Хостинг панели

Панель — это Node.js-приложение, GitHub Pages её не запустит (там только статика).
Подойдут любой VPS, Render, Fly.io, Railway или ваш домашний сервер с пробросом порта.
Игровой сервер и панель могут работать на разных машинах — панель ходит к серверу по RCON.
