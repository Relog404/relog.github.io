using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Menu;

namespace PanelSkins;

/// <summary>
/// Внутриигровое меню: CenterHtmlMenu. Выбор пункта — набери !1…!5 в чате,
/// !7 — назад, !8 — вперёд, !9 — закрыть. Открывается по F1 (bind от плагина).
/// </summary>
public sealed class MenuUi
{
    private readonly PanelSkinsPlugin _plugin;
    private readonly MenuApi _api;
    private readonly Action<string> _log;

    public MenuUi(PanelSkinsPlugin plugin, MenuApi api, Action<string> log)
    {
        _plugin = plugin;
        _api = api;
        _log = log;
    }

    // ------------------------------- экраны -------------------------------

    public void OpenMain(CCSPlayerController player, string? notice = null) => WithState(player, state =>
    {
        var menu = New(state is null
            ? "Меню скинов<br><font color='red'>Панель недоступна</font>"
            : $"Меню скинов<br>Баланс: <font color='green'>{state.Coins}</font> монет", notice);

        menu.AddMenuOption($"Кейсы ({state?.Cases?.Count ?? 0})", (p, _) => OpenCases(p));
        menu.AddMenuOption("Магазин", (p, _) => OpenShop(p));
        menu.AddMenuOption($"Инвентарь ({state?.Inventory?.Count ?? 0})", (p, _) => OpenInventory(p));
        menu.AddMenuOption("Апгрейд", (p, _) => OpenUpgrade(p));
        menu.AddMenuOption("Топ игроков", (p, _) => OpenTop(p));
        menu.AddMenuOption("Ежедневный бонус", (p, _) => Act(p, "daily", null, "Бонус"));
        return menu;
    });

    public void OpenCases(CCSPlayerController player) => WithState(player, state =>
    {
        var menu = New("Кейсы");
        var cases = state?.Cases ?? new List<MenuCase>();
        if (cases.Count == 0)
            menu.AddMenuOption("Кейсов нет", (p, _) => OpenMain(p));
        foreach (var item in cases)
            menu.AddMenuOption($"{item.Name} — {item.Price} монет", (p, _) => Act(p, "open_case", new { caseId = item.Id }, "Открытие кейса"));
        menu.AddMenuOption("Назад", (p, _) => OpenMain(p));
        return menu;
    });

    public void OpenShop(CCSPlayerController player) => WithState(player, state =>
    {
        var menu = New("Магазин — категории");
        foreach (var category in state?.Categories ?? new List<MenuCategory>())
            menu.AddMenuOption($"{category.Category} ({category.Count})", (p, _) => OpenShopItems(p, category.Category, 1));
        menu.AddMenuOption("Назад", (p, _) => OpenMain(p));
        return menu;
    });

    private void OpenShopItems(CCSPlayerController player, string category, int page) => WithState(player, state =>
    {
        var menu = New($"Магазин — {category}");
        var items = state?.Shop?.Items ?? new List<MenuShopItem>();
        if (items.Count == 0)
            menu.AddMenuOption("Ничего не найдено", (p, _) => OpenShop(p));
        foreach (var item in items)
            menu.AddMenuOption($"{item.Name} — {item.Price}", (p, _) => Act(p, "buy", new { itemId = item.Id }, "Покупка"));
        menu.AddMenuOption("Назад", (p, _) => OpenShop(p));
        return menu;
    }, $"?category={Uri.EscapeDataString(category)}&page={page}");

    public void OpenInventory(CCSPlayerController player) => WithState(player, state =>
    {
        var menu = New("Инвентарь");
        var items = state?.Inventory ?? new List<MenuItemEntry>();
        if (items.Count == 0)
            menu.AddMenuOption("Пусто — загляните в магазин", (p, _) => OpenMain(p));
        foreach (var item in items)
            menu.AddMenuOption($"{item.Name} — {item.Price}", (p, _) => OpenItem(p, state, item));
        menu.AddMenuOption("Назад", (p, _) => OpenMain(p));
        return menu;
    });

    private void OpenItem(CCSPlayerController player, MenuState? state, MenuItemEntry item)
    {
        var menu = New(item.Name);
        menu.AddMenuOption("Надеть", (p, _) => OpenSlots(p, state, item));
        menu.AddMenuOption("Продать", (p, _) => Act(p, "sell", new { uid = item.Uid }, "Продажа"));
        menu.AddMenuOption("Назад", (p, _) => OpenInventory(p));
        menu.Open(player);
    }

    private void OpenSlots(CCSPlayerController player, MenuState? state, MenuItemEntry item)
    {
        var menu = New($"Куда надеть:<br>{item.Name}");
        foreach (var slot in state?.Slots ?? new List<MenuSlot>())
            menu.AddMenuOption(slot.Label, (p, _) => Act(p, "equip", new { slot = slot.Key, uid = item.Uid }, "Экипировка"));
        menu.AddMenuOption("Назад", (p, _) => OpenInventory(p));
        menu.Open(player);
    }

    public void OpenUpgrade(CCSPlayerController player) => WithState(player, state =>
    {
        var menu = New("Апгрейд — выбери ставку");
        var items = state?.Inventory ?? new List<MenuItemEntry>();
        if (items.Count == 0)
            menu.AddMenuOption("Ставить нечего", (p, _) => OpenMain(p));
        foreach (var item in items)
            menu.AddMenuOption($"{item.Name} — {item.Price}", (p, _) => OpenMultiplier(p, item));
        menu.AddMenuOption("Назад", (p, _) => OpenMain(p));
        return menu;
    });

    private void OpenMultiplier(CCSPlayerController player, MenuItemEntry stake)
    {
        var menu = New($"Апгрейд: {stake.Name} ({stake.Price})");
        foreach (var multiplier in new[] { 2, 4, 10, 25 })
            menu.AddMenuOption($"x{multiplier}", (p, _) => PlayUpgrade(p, stake, multiplier));
        menu.AddMenuOption("Назад", (p, _) => OpenUpgrade(p));
        menu.Open(player);
    }

    private void PlayUpgrade(CCSPlayerController player, MenuItemEntry stake, int multiplier)
    {
        var steamId = player.SteamID;
        _ = Task.Run(async () =>
        {
            MenuResult? result = null;
            try
            {
                var suggestion = await _api.PostAsync(steamId, "suggest", new { stake = stake.Price, multiplier });
                var targetId = suggestion?.Targets?.FirstOrDefault()?.Id;
                result = await _api.PostAsync(steamId, "upgrade", new { uids = new[] { stake.Uid }, targetItemId = targetId });
            }
            catch (Exception error)
            {
                _log($"апгрейд: {error.Message}");
            }

            _plugin.NextFrame(() =>
            {
                try
                {
                    if (player.IsValid) ShowResult(player, "Апгрейд", result);
                }
                catch (Exception error)
                {
                    _log($"апгрейд: {error.Message}");
                }
            });
        });
    }

    public void OpenTop(CCSPlayerController player) => WithState(player, state =>
    {
        var menu = New("Топ по ставкам");
        var top = state?.Top ?? new List<MenuTop>();
        if (top.Count == 0)
            menu.AddMenuOption("Пока пусто", (p, _) => OpenMain(p));
        foreach (var entry in top)
            menu.AddMenuOption($"…{entry.SteamId.Substring(Math.Max(0, entry.SteamId.Length - 4))} — поставлено {entry.Wagered}", (p, _) => OpenMain(p));
        menu.AddMenuOption("Назад", (p, _) => OpenMain(p));
        return menu;
    });

    // ------------------------------- помощники -------------------------------

    /** Выполнить действие на панели и показать результат. */
    private void Act(CCSPlayerController player, string action, object? payload, string title)
    {
        var steamId = player.SteamID;
        _ = Task.Run(async () =>
        {
            MenuResult? result = null;
            try
            {
                result = await _api.PostAsync(steamId, action, payload);
            }
            catch (Exception error)
            {
                _log($"меню {action}: {error.Message}");
            }

            _plugin.NextFrame(() =>
            {
                try
                {
                    if (player.IsValid) ShowResult(player, title, result);
                }
                catch (Exception error)
                {
                    _log($"меню {action}: {error.Message}");
                }
            });
        });
    }

    private void ShowResult(CCSPlayerController player, string title, MenuResult? result)
    {
        var text = result is null
            ? "Панель не ответила"
            : (string.IsNullOrWhiteSpace(result.Error) ? result.Message : result.Error);

        var menu = New($"{title}<br><font color='{(result?.Ok ?? false ? "green" : "red")}'>{text}</font><br>Баланс: {result?.Coins ?? 0}");
        if (result?.Prize is { } prize)
            menu.AddMenuOption($"Выпало: {prize.Name} ({prize.Rarity}) — {prize.Price}", (p, _) => OpenMain(p));
        menu.AddMenuOption("Продолжить", (p, _) => OpenMain(p));
        menu.Open(player);
    }

    /** Тянет состояние игрока с панели и строит меню уже в главном потоке сервера. */
    private void WithState(CCSPlayerController player, Func<MenuState?, CenterHtmlMenu> build, string query = "")
    {
        var steamId = player.SteamID;
        _ = Task.Run(async () =>
        {
            MenuState? state = null;
            try
            {
                state = await _api.FetchAsync(steamId, query);
            }
            catch (Exception error)
            {
                _log($"меню: {error.Message}");
            }

            _plugin.NextFrame(() =>
            {
                try
                {
                    if (player.IsValid) build(state).Open(player);
                }
                catch (Exception error)
                {
                    _log($"меню: {error.Message}");
                }
            });
        });
    }

    private CenterHtmlMenu New(string title, string? notice = null)
    {
        var html = string.IsNullOrWhiteSpace(notice) ? title : $"{title}<br><font color='orange'>{notice}</font>";
        return new CenterHtmlMenu(html, _plugin)
        {
            TitleColor = "gold",
            EnabledColor = "white",
            DisabledColor = "gray",
            PrevPageColor = "yellow",
            NextPageColor = "yellow",
            CloseColor = "red",
        };
    }
}
