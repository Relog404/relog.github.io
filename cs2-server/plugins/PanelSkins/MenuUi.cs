using System.Text;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;

namespace PanelSkins;

/// <summary>
/// Меню в центре экрана. Рисуем его сами через PrintToCenterHtml, поэтому
/// ничего не обрезается, а пункты выбираются цифрами 1..9 — бинды игрока
/// мы не трогаем, просто перехватываем slot1..slot9, пока меню открыто.
/// </summary>
public sealed class MenuUi
{
    private const int PerPage = 6;

    private readonly PanelSkinsPlugin _plugin;
    private readonly MenuApi _api;
    private readonly Action<string> _log;
    private readonly Dictionary<ulong, Screen> _open = new();

    public MenuUi(PanelSkinsPlugin plugin, MenuApi api, Action<string> log)
    {
        _plugin = plugin;
        _api = api;
        _log = log;
    }

    private sealed class Option
    {
        public string Text = "";
        public Action<CCSPlayerController>? Select;
    }

    private sealed class Screen
    {
        public string Title = "";
        public List<Option> Options = new();
        public int Page;
        public Action<CCSPlayerController>? Back;
    }

    /* ------------------------- экраны ------------------------- */

    public void OpenMain(CCSPlayerController player, string? notice = null) => WithState(player, state =>
    {
        var screen = new Screen
        {
            Title = state is null
                ? "МЕНЮ СКИНОВ — панель недоступна"
                : $"МЕНЮ СКИНОВ — {state.Coins} монет",
        };
        if (!string.IsNullOrWhiteSpace(notice)) screen.Title += " — " + notice;

        screen.Options.Add(new Option { Text = $"Кейсы ({state?.Cases?.Count ?? 0})", Select = p => OpenCases(p) });
        screen.Options.Add(new Option { Text = "Магазин", Select = p => OpenShop(p) });
        screen.Options.Add(new Option { Text = $"Инвентарь ({state?.Inventory?.Count ?? 0})", Select = p => OpenInventory(p) });
        screen.Options.Add(new Option { Text = "Апгрейд", Select = p => OpenUpgrade(p) });
        screen.Options.Add(new Option { Text = "Топ игроков", Select = p => OpenTop(p) });
        screen.Options.Add(new Option { Text = "Ежедневный бонус", Select = p => Act(p, "daily", null, "Бонус") });
        return screen;
    });

    public void OpenCases(CCSPlayerController player) => WithState(player, state =>
    {
        var screen = new Screen { Title = "КЕЙСЫ", Back = p => OpenMain(p) };
        foreach (var item in state?.Cases ?? new List<MenuCase>())
            screen.Options.Add(new Option { Text = $"{item.Name} — {item.Price}", Select = p => Act(p, "open_case", new { caseId = item.Id }, "Кейс") });
        if (screen.Options.Count == 0) screen.Options.Add(new Option { Text = "кейсов нет" });
        return screen;
    });

    public void OpenShop(CCSPlayerController player) => WithState(player, state =>
    {
        var screen = new Screen { Title = "МАГАЗИН", Back = p => OpenMain(p) };
        foreach (var entry in state?.Categories ?? new List<MenuCategory>())
            screen.Options.Add(new Option { Text = $"{entry.Category} ({entry.Count})", Select = p => OpenShopItems(p, entry.Category) });
        if (screen.Options.Count == 0) screen.Options.Add(new Option { Text = "каталог пуст" });
        return screen;
    });

    private void OpenShopItems(CCSPlayerController player, string category) => WithState(player, state =>
    {
        var screen = new Screen { Title = Cut(category.ToUpperInvariant(), 34), Back = p => OpenShop(p) };
        foreach (var item in state?.Shop?.Items ?? new List<MenuShopItem>())
            screen.Options.Add(new Option { Text = $"{item.Name} — {item.Price}", Select = p => Act(p, "buy", new { itemId = item.Id }, "Покупка") });
        if (screen.Options.Count == 0) screen.Options.Add(new Option { Text = "ничего не найдено" });
        return screen;
    }, "?category=" + Uri.EscapeDataString(category));

    public void OpenInventory(CCSPlayerController player) => WithState(player, state =>
    {
        var screen = new Screen { Title = "ИНВЕНТАРЬ", Back = p => OpenMain(p) };
        foreach (var item in state?.Inventory ?? new List<MenuItemEntry>())
            screen.Options.Add(new Option { Text = $"{item.Name} — {item.Price}", Select = p => OpenItem(p, state, item) });
        if (screen.Options.Count == 0) screen.Options.Add(new Option { Text = "пусто" });
        return screen;
    });

    private void OpenItem(CCSPlayerController player, MenuState? state, MenuItemEntry item)
    {
        var screen = new Screen { Title = Cut(item.Name, 40), Back = p => OpenInventory(p) };
        screen.Options.Add(new Option { Text = "Надеть", Select = p => OpenSlots(p, state, item) });
        screen.Options.Add(new Option { Text = "Продать", Select = p => Act(p, "sell", new { uid = item.Uid }, "Продажа") });
        Show(player, screen);
    }

    private void OpenSlots(CCSPlayerController player, MenuState? state, MenuItemEntry item)
    {
        var screen = new Screen { Title = "КУДА НАДЕТЬ", Back = p => OpenInventory(p) };
        foreach (var slot in state?.Slots ?? new List<MenuSlot>())
            screen.Options.Add(new Option { Text = slot.Label, Select = p => Act(p, "equip", new { slot = slot.Key, uid = item.Uid }, "Экипировка") });
        Show(player, screen);
    }

    public void OpenUpgrade(CCSPlayerController player) => WithState(player, state =>
    {
        var screen = new Screen { Title = "АПГРЕЙД — СТАВКА", Back = p => OpenMain(p) };
        foreach (var item in state?.Inventory ?? new List<MenuItemEntry>())
            screen.Options.Add(new Option { Text = $"{item.Name} — {item.Price}", Select = p => OpenMultiplier(p, item) });
        if (screen.Options.Count == 0) screen.Options.Add(new Option { Text = "ставить нечего" });
        return screen;
    });

    private void OpenMultiplier(CCSPlayerController player, MenuItemEntry stake)
    {
        var screen = new Screen { Title = "АПГРЕЙД — МНОЖИТЕЛЬ", Back = p => OpenUpgrade(p) };
        foreach (var multiplier in new[] { 2, 4, 10, 25 })
            screen.Options.Add(new Option { Text = $"x{multiplier}", Select = p => PlayUpgrade(p, stake, multiplier) });
        Show(player, screen);
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
                if (player.IsValid) ShowResult(player, "АПГРЕЙД", result);
            });
        });
        player.PrintToCenterHtml("<font color='gold'>Крутим...</font>", 3);
    }

    public void OpenTop(CCSPlayerController player) => WithState(player, state =>
    {
        var screen = new Screen { Title = "ТОП ПО СТАВКАМ", Back = p => OpenMain(p) };
        foreach (var entry in state?.Top ?? new List<MenuTop>())
        {
            var tail = entry.SteamId.Length > 4 ? entry.SteamId.Substring(entry.SteamId.Length - 4) : entry.SteamId;
            screen.Options.Add(new Option { Text = $"…{tail} — {entry.Wagered}" });
        }
        if (screen.Options.Count == 0) screen.Options.Add(new Option { Text = "пока пусто" });
        return screen;
    });

    /* ------------------------- действия ------------------------- */

    private void Act(CCSPlayerController player, string action, object? payload, string title)
    {
        var steamId = player.SteamID;
        player.PrintToCenterHtml("<font color='gold'>Отправляю...</font>", 3);
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
                if (player.IsValid) ShowResult(player, title, result);
            });
        });
    }

    private void ShowResult(CCSPlayerController player, string title, MenuResult? result)
    {
        var ok = result?.Ok ?? false;
        var text = result is null
            ? "панель не ответила"
            : (string.IsNullOrWhiteSpace(result.Error) ? result.Message : result.Error);

        var screen = new Screen { Title = $"{title} — {text}", Back = p => OpenMain(p) };
        if (result?.Prize is { } prize)
            screen.Options.Add(new Option { Text = $"{prize.Name} ({prize.Rarity})" });
        screen.Options.Add(new Option { Text = $"Баланс: {result?.Coins ?? 0}", Select = p => OpenMain(p) });
        Show(player, screen);
    }

    /* ------------------------- механика ------------------------- */

    public bool IsOpen(CCSPlayerController player) => _open.ContainsKey(player.SteamID);

    public void Close(CCSPlayerController player)
    {
        if (!_open.Remove(player.SteamID)) return;
        try
        {
            player.PrintToCenterHtml(" ", 1);
        }
        catch
        {
            // игрок уже вышел
        }
    }

    public void Forget(ulong steamId) => _open.Remove(steamId);

    /** true — нажатие съела менюшка (оружие не переключаем). */
    public bool HandleKey(CCSPlayerController player, int key)
    {
        if (!_open.TryGetValue(player.SteamID, out var screen)) return false;

        if (key == 9)
        {
            Close(player);
            return true;
        }

        if (key == 8)
        {
            if ((screen.Page + 1) * PerPage < screen.Options.Count)
            {
                screen.Page += 1;
                Render(player, screen);
            }
            return true;
        }

        if (key == 7)
        {
            if (screen.Page > 0)
            {
                screen.Page -= 1;
                Render(player, screen);
                return true;
            }
            if (screen.Back is not null)
            {
                _open.Remove(player.SteamID);
                screen.Back(player);
                return true;
            }
            Close(player);
            return true;
        }

        var index = screen.Page * PerPage + (key - 1);
        if (index < 0 || index >= screen.Options.Count) return true;

        var option = screen.Options[index];
        if (option.Select is null)
        {
            Render(player, screen);
            return true;
        }

        _open.Remove(player.SteamID);
        option.Select(player);
        return true;
    }

    /** Перерисовка открытых меню: центр- html живёт несколько секунд. */
    public void Refresh()
    {
        if (_open.Count == 0) return;

        var alive = new HashSet<ulong>();
        foreach (var player in Utilities.GetPlayers())
        {
            if (player is null || !player.IsValid) continue;
            alive.Add(player.SteamID);
            if (_open.TryGetValue(player.SteamID, out var screen)) Render(player, screen);
        }

        var gone = new List<ulong>();
        foreach (var id in _open.Keys) if (!alive.Contains(id)) gone.Add(id);
        foreach (var id in gone) _open.Remove(id);
    }

    private void Show(CCSPlayerController player, Screen screen)
    {
        _open[player.SteamID] = screen;
        Render(player, screen);
    }

    private void Render(CCSPlayerController player, Screen screen)
    {
        var pages = Math.Max(1, (screen.Options.Count + PerPage - 1) / PerPage);
        if (screen.Page >= pages) screen.Page = pages - 1;
        if (screen.Page < 0) screen.Page = 0;

        var start = screen.Page * PerPage;
        var end = Math.Min(start + PerPage, screen.Options.Count);

        var html = new StringBuilder();
        html.Append($"<b><font color='gold'>{Clean(screen.Title)}</font></b>");
        if (pages > 1) html.Append($" <font color='silver'>[{screen.Page + 1}/{pages}]</font>");
        html.Append("<br>");

        for (var i = start; i < end; i++)
        {
            var number = i - start + 1;
            var option = screen.Options[i];
            var color = option.Select is null ? "silver" : "white";
            html.Append($"<font color='gold'>{number}.</font> <font color='{color}'>{Clean(Cut(option.Text, 42))}</font><br>");
        }

        var hints = new List<string>();
        if (screen.Page > 0) hints.Add("7-назад");
        else if (screen.Back is not null) hints.Add("7-назад");
        else hints.Add("7-закрыть");
        if (end < screen.Options.Count) hints.Add("8-дальше");
        hints.Add("9-закрыть");
        html.Append($"<font color='silver'>{string.Join("  ", hints)}</font>");

        try
        {
            player.PrintToCenterHtml(html.ToString(), 20);
        }
        catch
        {
            _open.Remove(player.SteamID);
        }
    }

    private void WithState(CCSPlayerController player, Func<MenuState?, Screen> build, string query = "")
    {
        var steamId = player.SteamID;
        player.PrintToCenterHtml("<font color='gold'>Загружаю...</font>", 3);
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
                if (!player.IsValid) return;
                Show(player, build(state));
            });
        });
    }

    private static string Clean(string text) => text.Replace("<", "").Replace(">", "");

    private static string Cut(string text, int max)
    {
        if (string.IsNullOrEmpty(text) || text.Length <= max) return text;
        return text.Substring(0, Math.Max(0, max - 1)) + "…";
    }
}
