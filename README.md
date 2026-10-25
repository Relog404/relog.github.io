# relog.github.io

Проект по CS2: **выделенный сервер + сайт на Node.js** (управление сервером, каталог скинов,
виртуальный магазин, апгрейд-рулетка, админка).

```
cs2-server/        установка выделенного сервера CS2 (SteamCMD), конфиги, плагины
panel/             сайт на Node.js: RCON-панель, каталог, монеты, магазин, апгрейд, админка
  deploy/          systemd-юнит и конфиг nginx для деплоя на выделенный сервер
.github/           CI: тесты и проверка запуска
```

## Что внутри

| Возможность | Где |
|---|---|
| Автоустановка сервера CS2 через SteamCMD одним батником | `cs2-server/install-cs2-server.bat` (Windows), `.sh` (Linux) |
| Запуск с GSLT-токеном, competitive-конфигом, GOTV | `cs2-server/start-cs2.bat`, `cfg/server.cfg` |
| Серверные плагины (CounterStrikeSharp + Metamod) | `cs2-server/install-plugins.bat` |
| Веб-панель: статус, игроки, смена карты, чат, RCON-консоль | `panel/` |
| Вход через Steam (OpenID) и сохранение данных **по SteamID** | `panel/src/steam.js`, `panel/src/store.js` |
| Каталог CS2: ножи, перчатки, оружие, стикеры, **медали**, значки, кейсы, музыка, агенты | `panel/data/catalog.sample.json` |
| Виртуальные монеты, магазин, хранилище, **апгрейд-рулетка** с честным RNG | `panel/src/economy.js` |
| Админка: статистика, игроки, монеты, баны, правки каталога | `panel/src/app.js` (`/api/admin/*`) |
| Деплой на свой сервер: systemd + nginx | `panel/deploy/` |
| Тесты и CI | `panel/test/`, `.github/workflows/ci.yml` |

## Быстрый старт

**1. Сервер (Windows):**

```bat
cd cs2-server
install-cs2-server.bat C:\cs2-server
start-cs2.bat
```

**2. Сайт:**

```bash
cd panel
npm install
cp .env.example .env     # укажите ADMIN_STEAM_IDS (ваш SteamID64) и CS2_RCON_PASSWORD
npm start                # http://localhost:3000
```

**3. На выделенном сервере:**

```bash
sudo cp panel/deploy/systemd/cs2-panel.service /etc/systemd/system/
sudo systemctl enable --now cs2-panel
```

Подробности — [`cs2-server/README.md`](cs2-server/README.md) и [`panel/README.md`](panel/README.md).

## Про монеты и апгрейд — коротко

Монеты **виртуальные**: их нельзя купить за деньги, пополнить предметами из Steam или вывести наружу.
Апгрейд — это игра на фан: ставишь купленные за монеты предметы, крутишь рулетку,
забираешь цель или остаёшься без ставки. Исход считает сервер через
`HMAC_SHA256(serverSeed, "clientSeed:nonce")`, результат можно перепроверить вручную.

Реальных ставок, депозитов из инвентаря и вывода скинов здесь нет — это нарушение правил Steam
(Steam Web API прямо запрещает использование инвентарей для игорных сайтов) и, по сути,
незаконная игорная деятельность. Сделать такое — значит лишиться API-ключа и аккаунта.

## Чего здесь нет

- **Скинченджеров и «худов»** (AIM/WH/ESP): это чит в клиент CS2, VAC-бан и порча игры остальным.
- **Реальных ставок и депозитов скинами**: см. выше.

Всё остальное официально и легально: RCON, серверные плагины, Steam OpenID и Steam Web API.

## Хостинг сайта

Сайт — Node.js-приложение, GitHub Pages его не запустит (там только статика).
Подойдут любой VPS (systemd-юнит уже в репозитории), Render, Fly.io, Railway или домашний сервер.
Игровой сервер и сайт могут работать на разных машинах — сайт ходит к CS2 по RCON.
