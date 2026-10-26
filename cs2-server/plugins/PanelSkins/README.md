# PanelSkins — серверный скинченджер для CS2 (CounterStrikeSharp)

Плагин берёт у веб-панели набор скинов игрока по его SteamID64 и применяет его к оружию,
ножу и перчаткам **на стороне сервера**. Никакого вмешательства в клиент CS2:
не трогаем ни память, ни файлы игры. Это обычный серверный плагин, такой же,
как голосование за карты или ретейки. Сервер с плагинами идёт как **insecure**
(VAC на нём отключён) — это штатный режим для комьюнити-серверов, допускаемый Valve.

Скины видят все игроки на сервере, но надеть можно только то, что игрок реально
купил/выиграл на сайте. Реальных денег в схеме нет: монеты виртуальные.

## Как это работает

```
игрок заходит ──▶ плагин: GET {PanelUrl}/api/plugin/loadout/{steamId64}
                          с заголовком X-Plugin-Key
                  ◀── JSON: { weapons: [{def, paint, wear, seed, statTrak, kills}], knife, gloves, ... }
плагин ──▶ при создании оружия выставляет CEconItemView: def index + атрибуты
           "paint kit" / "paint seed" / "paint wear"
```

- `def` — item definition index (какой предмет: AK-47 = 7, Karambit = 507, Sport Gloves = 5030).
- `paint` — paint kit index (какой скин: Redline = 282, Dragon Lore = 344).
- Оба числа лежат в `panel/data/catalog.sample.json` — они взяты из открытого датасета ByMykel/CSGO-API,
  так что подставлять их руками не нужно.

## Установка

1. Поставьте сам сервер: `../../install-cs2-server.bat` (или `.sh`).
2. Поставьте CounterStrikeSharp и Metamod: `../../install-plugins.bat`.
3. Готово. `prebuilt/PanelSkins.dll` уже собран и лежит в репозитории — .NET SDK не нужен.
   Установщик `install-plugins.bat` (или `install-all.bat`) кладёт его сам:

   - `.../addons/counterstrikesharp/plugins/PanelSkins/PanelSkins.dll`
   - `.../addons/counterstrikesharp/plugins/PanelSkins/PanelSkins.json` (конфиг)
   - `.../addons/counterstrikesharp/gamedata/panelskins.json` (сигнатура движка)

   В `PanelSkins.json` укажите `PanelUrl` и `PluginKey`. Ключ берётся в админке панели:
   вкладка «Настройки» → «новый ключ» у нужного сервера (либо задайте общий
   `PLUGIN_API_KEY` в `.env`).
4. Перезапустите сервер. В консоли должно появиться `[PanelSkins] PanelSkins загружен`.

### Плагин собирается сам

GitHub Actions (`.github/workflows/build-plugin.yml`) при каждом изменении
`cs2-server/plugins/**` собирает плагин и **кладёт готовую DLL обратно в репозиторий**
(`prebuilt/PanelSkins.dll`). Артефакт `PanelSkins` можно скачать из любого запуска,
а при создании релиза файлы прикладываются к нему автоматически.

Если всё же нужно собрать руками — нужен **.NET 10 SDK** (плагин под CounterStrikeSharp 1.0.3xx):

```bash
cd cs2-server/plugins/PanelSkins
dotnet build -c Release
# или по DLL установленного сервера:
dotnet build -c Release -p:CSSharpRefs="C:\cs2-server\game\csgo\addons\counterstrikesharp\api\"
```

## Команды

| Команда | Что делает |
|---|---|
| `!skins` | ссылка на сайт со скинами и апгрейдом |
| `!refreshskins` | принудительно перетянуть свой набор с сайта |

## Что делает плагин, а что нет

| Да | Нет |
|---|---|
| Красит оружие, нож, перчатки тем, что игрок надел на сайте | Не трогает клиент и файлы игры |
| Умеет StatTrak-счётчик, износ и seed | Не даёт игрового преимущества |
| Кэширует набор игрока на `CacheSeconds` | Не обходит VAC (он на плагиновом сервере и так выключен) |

## Если не собирается

Плагин собран под **CounterStrikeSharp 1.0.377+ (net10.0)** — это то, что скачивает
`install-plugins.bat`. Если у вас более старая версия CSSharp, обновите её.

Атрибуты покраски ставятся нативной функцией движка
`CAttributeList::SetOrAddAttributeValueByName` — управляемого API для них в новых версиях
CSSharp нет. Сигнатура лежит в `gamedata/panelskins.json` и должна лежать в
`addons/counterstrikesharp/gamedata/`. Если после обновления CS2 плагин падает при
покраске — значит Valve сдвинула функцию: возьмите свежую сигнатуру, например, из
[cs2-WeaponPaints](https://github.com/Nereziel/cs2-WeaponPaints) (файл
`gamedata/weaponpaints.json`), и замените её в `gamedata/panelskins.json`.

Если перчатки не красятся, отключите их в конфиге (`"ApplyGloves": false`) —
оружие и нож будут работать.

Готовый и регулярно обновляемый аналог, если не хочется собирать самому:
[cs2-WeaponPaints](https://github.com/Nereziel/cs2-WeaponPaints) — там свой формат данных,
но панель отдаёт ровно те же `def` и `paint`, поэтому адаптер пишется в один запрос.

## Проверка API руками

```bash
curl -H "X-Plugin-Key: ВАШ_КЛЮЧ" \
  http://127.0.0.1:3000/api/plugin/loadout/76561190000000000
```

Ответ:

```json
{
  "steamId": "76561190000000000",
  "weapons": [{ "def": 7, "paint": 282, "wear": 0.15, "seed": 661, "statTrak": false, "kills": 0 }],
  "knife": { "def": 507, "paint": 38, "wear": 0.01, "seed": 12, "statTrak": false, "kills": 0 },
  "gloves": { "def": 5030, "paint": 10037, "wear": 0.15, "seed": 3, "statTrak": false, "kills": 0 },
  "agentCt": null, "agentT": null, "music": null
}
```

## Проверка после запуска

В консоли сервера по очереди:

```
meta list            <- должен показать CounterStrikeSharp
css_plugins list     <- должен показать PanelSkins
```

Если `meta list` пишет «Unknown command» — Metamod не загружен. Проверьте три вещи:

1. сервер запущен с **`-insecure`** (без него движок включает VAC secure mode и плагины не грузит);
2. в `<сервер>\game\csgo\gameinfo.gi` есть строка **`Game    csgo/addons/metamod`**
   (после `Game_LowViolence    csgo_lv`); `install-plugins.ps1` добавляет её сам;
3. на Windows установлен **Visual C++ Redistributable x64**:
   https://aka.ms/vs/17/release/vc_redist.x64.exe — без него CounterStrikeSharp не стартует.

Если `meta list` показывает CounterStrikeSharp, а `css_plugins list` пуст —
значит DLL не там: она должна лежать в
`addons\counterstrikesharp\plugins\PanelSkins\PanelSkins.dll`.
