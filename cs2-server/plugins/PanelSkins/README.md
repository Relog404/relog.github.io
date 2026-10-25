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
3. Соберите плагин (нужен .NET 8 SDK):

   ```bat
   cd cs2-server\plugins\PanelSkins
   dotnet build -c Release ^
     -p:CSSharpRefs="C:\cs2-server\game\csgo\addons\counterstrikesharp\shared\"
   ```

   На Linux:

   ```bash
   dotnet build -c Release \
     -p:CSSharpRefs="$HOME/cs2-server/game/csgo/addons/counterstrikesharp/shared/"
   ```

4. Скопируйте `bin/Release/net8.0/PanelSkins.dll` в
   `<сервер>/game/csgo/addons/counterstrikesharp/plugins/PanelSkins/PanelSkins.dll`
5. Положите рядом `config.example.json` как `PanelSkins.json`, укажите `PanelUrl` и `PluginKey`.
   Ключ берётся в админке панели: вкладка «Настройки» → «новый ключ» у нужного сервера
   (либо задайте общий `PLUGIN_API_KEY` в `.env`).
6. Перезапустите сервер. В консоли должно появиться `[PanelSkins] PanelSkins загружен`.

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

Плагин написан под CounterStrikeSharp 1.0.х (API 200+). Имена schema-членов между версиями
CSSharp иногда меняются, и тогда компилятор ругается на строки в `SkinApplier.cs`. Варианты:

**Вариант A** (в коде):

```csharp
item.NetworkedDynamicAttributes.Attributes.SetOrAddAttributeValue("paint kit", skin.Paint);
```

**Вариант B** — если у `CEconItemView` нет `NetworkedDynamicAttributes`:

```csharp
using CounterStrikeSharp.API.Modules.Memory;

item.SetAttributeValue("paint kit", skin.Paint);
item.SetAttributeValue("paint wear", skin.Wear);
item.SetAttributeValue("paint seed", skin.Seed);
```

**Вариант C** — через список атрибутов напрямую:

```csharp
var list = item.NetworkedDynamicAttributes.Attributes;
list.SetOrAddAttributeValueByName("paint kit", skin.Paint);
```

Если не находится `pawn.EconGloves` — замените `SkinApplier.ApplyGloves` на вариант через
`pawn.EconGloves` → `pawn.EconGloves.ItemDefinitionIndex` или вовсе отключите перчатки
(`"ApplyGloves": false` в конфиге) — оружие и нож будут работать.

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
