using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;

namespace PanelSkins;

/// <summary>
/// Серверный «скинченджер»: сервер сам красит оружие игроков теми скинами,
/// которыми они владеют на сайте. Клиент CS2 не модифицируется.
/// </summary>
[MinimumApiVersion(200)]
public sealed class PanelSkinsPlugin : BasePlugin, IPluginConfig<PanelSkinsConfig>
{
    public override string ModuleName => "PanelSkins";
    public override string ModuleVersion => "1.0.0";
    public override string ModuleAuthor => "relog.github.io";
    public override string ModuleDescription => "Скины из веб-панели выдаются сервером, без вмешательства в клиент";

    public PanelSkinsConfig Config { get; set; } = new();

    private PanelApiClient _api = null!;
    private MenuApi _menuApi = null!;
    private MenuUi _menu = null!;
    private readonly Dictionary<ulong, CachedLoadout> _cache = new();

    public void OnConfigParsed(PanelSkinsConfig config) => Config = config;

    public override void Load(bool hotReload)
    {
        _api = new PanelApiClient(() => Config.PanelUrl, () => Config.PluginKey, Log);
        _menuApi = new MenuApi(() => Config.PanelUrl, () => Config.PluginKey);
        _menu = new MenuUi(this, _menuApi, Log);

        RegisterListener<Listeners.OnClientPutInServer>(OnClientPutInServer);
        RegisterListener<Listeners.OnEntityCreated>(OnEntityCreated);
        RegisterListener<Listeners.OnClientDisconnectPost>(OnClientDisconnect);

        RegisterEventHandler<EventPlayerSpawn>(OnPlayerSpawn);
        RegisterEventHandler<EventPlayerActivate>(OnPlayerActivate);

        RegisterListener<Listeners.OnTick>(OnTick);
        RegisterEventHandler<EventRoundStart>(OnRoundStart);

        AddCommand("css_panelcheck", "Проверить связь с панелью", OnPanelCheckCommand);

        // цифры 1..9 выбирают пункты: пока меню открыто, перехватываем slot1..slot9,
        // бинды игрока при этом не трогаем — без меню цифры снова переключают оружие
        for (var slot = 1; slot <= 9; slot++)
        {
            var number = slot;
            AddCommandListener("slot" + number, (player, info) => OnSlot(player, number), HookMode.Pre);
        }
        AddCommandListener("say", OnSay, HookMode.Pre);
        AddCommandListener("say_team", OnSay, HookMode.Pre);

        AddCommand("css_menu", "Меню скинов (по F1)", OnMenuCommand);
        AddCommand("css_skins", "Ссылка на сайт со скинами", OnSkinsCommand);
        AddCommand("css_refreshskins", "Обновить свои скины с сайта", OnRefreshCommand);

        if (!Config.ApplyAttributes)
        {
            SkinApplier.DisableAttributes();
            Log("ApplyAttributes=false - нативные атрибуты покраски отключены, работают только Fallback-поля.");
        }

        Log("PanelSkins загружен. Панель: " + Config.PanelUrl);
        if (string.IsNullOrWhiteSpace(Config.PluginKey))
            Log("ВНИМАНИЕ: PluginKey пуст — панель отдаст 401. Возьмите ключ в админке панели.");
    }

    public override void Unload(bool hotReload)
    {
        _api?.Dispose();
        _menuApi?.Dispose();
        _cache.Clear();
    }

    private void Log(string message) => Console.WriteLine("[PanelSkins] " + message);

    /** Меню обязано открываться в главном потоке движка. */
    public void NextFrame(Action action) => Server.NextFrame(action);

    /* ------------------------------ события ------------------------------- */

    private void OnClientPutInServer(int playerSlot)
    {
        var controller = Utilities.GetPlayerFromSlot(playerSlot);
        if (controller is null || !controller.IsValid || controller.IsBot) return;

        var steamId = controller.SteamID;
        if (steamId <= 0) return;

        _ = RefreshLoadoutAsync(steamId);
    }

    private void OnClientDisconnect(int playerSlot)
    {
        var controller = Utilities.GetPlayerFromSlot(playerSlot);
        if (controller is null) return;
        _cache.Remove(controller.SteamID);
    }

    /** F1 вешаем только когда игрок уже в игре: на подключении движок к этому не готов. */
    private HookResult OnPlayerActivate(EventPlayerActivate @event, GameEventInfo info)
    {
        var controller = @event.Userid;
        if (controller is null || !controller.IsValid || controller.IsBot) return HookResult.Continue;
        if (!Config.BindF1Menu) return HookResult.Continue;

        Server.NextFrame(() =>
        {
            try
            {
                if (!controller.IsValid) return;
                BindMenuKey(controller);
                controller.PrintToChat(" [PanelSkins] Меню скинов: F1, !menu в чате или цифры 1-9");
            }
            catch (Exception ex)
            {
                Log($"не удалось повесить F1: {ex.Message}");
            }
        });

        return HookResult.Continue;
    }

    private void OnEntityCreated(CEntityInstance entity)
    {
        if (entity is not CBasePlayerWeapon weapon) return;
        // На следующем кадре у оружия уже есть владелец и item definition index.
        Server.NextFrame(() => TryApplyWeaponSkin(weapon));
    }

    /** F1 вешаем и при входе, и на спавне: на экране загрузки клиент его игнорирует. */
    private void BindMenuKey(CCSPlayerController controller)
    {
        if (!Config.BindF1Menu) return;
        try
        {
            controller.ExecuteClientCommand("bind F1 css_menu");
        }
        catch (Exception ex)
        {
            Log($"не удалось повесить F1: {ex.Message}");
        }
    }

    /** Перерисовка открытых меню: сообщение в центре экрана живёт несколько секунд. */
    private int _ticks;
    private bool _skinAppliedLogged;

    private void OnTick()
    {
        if (++_ticks < 768) return; // примерно раз в 12 секунд: чаще — меню мигает
        _ticks = 0;
        _menu.Refresh();
    }

    /** Раунд начался — меню закрываем, чтобы цифры снова переключали оружие. */
    private HookResult OnRoundStart(EventRoundStart @event, GameEventInfo info)
    {
        foreach (var player in Utilities.GetPlayers())
        {
            if (player is null || !player.IsValid) continue;
            _menu.Close(player);
        }
        return HookResult.Continue;
    }

    private HookResult OnSlot(CCSPlayerController? player, int number)
    {
        if (player is null || !player.IsValid || player.IsBot) return HookResult.Continue;
        return _menu.HandleKey(player, number) ? HookResult.Stop : HookResult.Continue;
    }

    private HookResult OnSay(CCSPlayerController? player, CommandInfo info)
    {
        // игрок часто пишет "!menu\" или "!menu," — обрезаем мусор по краям
        var raw = (info.ArgString ?? "").Trim().Trim('"').Trim('\'').Trim('`').Trim();
        var word = raw.TrimStart('!', '/', '.', ',').Trim().ToLowerInvariant();
        if (word is not ("menu" or "меню" or "менюшка" or "skins")) return HookResult.Continue;

        if (player is not null && player.IsValid && !player.IsBot) _menu.OpenMain(player);
        return HookResult.Stop;
    }

    /** Диагностика: видно, доходит ли плагин до панели и что она отвечает. */
    private void OnPanelCheckCommand(CCSPlayerController? player, CommandInfo info)
    {
        ulong steamId = player?.SteamID ?? 0;
        if (steamId == 0)
        {
            foreach (var candidate in Utilities.GetPlayers())
            {
                if (candidate is not null && candidate.IsValid && !candidate.IsBot && candidate.SteamID > 0)
                {
                    steamId = candidate.SteamID;
                    break;
                }
            }
        }

        Log($"проверка связи: панель {Config.PanelUrl}, ключ " +
            (string.IsNullOrWhiteSpace(Config.PluginKey) ? "НЕ ЗАДАН — панель отдаст 401" : "задан"));

        _ = Task.Run(async () =>
        {
            // сначала честно спрашиваем, какой код ответила панель:
            // 400 — ключ верный, но на сервере никого нет и SteamID взять неоткуда
            var code = await _api.ProbeAsync(steamId);
            if (code == 401)
            {
                Log("ключ не подходит: панель отдала 401. Запусти CS2.bat заново — он пропишет свежий ключ.");
                return;
            }
            if (code == 400)
            {
                Log("ключ верный, но SteamID пуст: на сервере никого нет. Зайди в игру и повтори css_panelcheck.");
                return;
            }
            if (code < 0)
            {
                Log("панель не запущена или не отвечает: подними её через CS2.bat или panel\\start-windows.bat.");
                return;
            }
            if (code != 200)
            {
                Log($"панель ответила {code}: проверь адрес в PanelSkins.json.");
                return;
            }

            MenuState? state = null;
            LoadoutResponse? loadout = null;
            try
            {
                state = await _menuApi.FetchAsync(steamId);
                if (steamId > 0) loadout = await _api.FetchLoadoutAsync(steamId);
            }
            catch (Exception ex)
            {
                Log($"проверка связи: {ex.Message}");
            }

            Log(state is null
                ? "меню: панель не отдала данные"
                : $"панель отвечает: монеты {state.Coins}, кейсов {state.Cases?.Count ?? 0}, вещей в инвентаре {state.Inventory?.Count ?? 0}");
            Log(loadout is null
                ? "набор скинов пуст: на сайте ничего не надето, либо панель не отдала данные"
                : $"набор скинов: оружие {loadout.Weapons?.Count ?? 0}, нож {loadout.Knife?.Def}, перчатки {loadout.Gloves?.Def}");
        });
    }

    private HookResult OnPlayerSpawn(EventPlayerSpawn @event, GameEventInfo info)
    {
        var controller = @event.Userid;
        if (controller is null || !controller.IsValid || controller.IsBot) return HookResult.Continue;

        BindMenuKey(controller);

        var loadout = GetLoadout(controller.SteamID);
        if (loadout?.Gloves is null || !Config.ApplyGloves) return HookResult.Continue;

        var pawn = controller.PlayerPawn?.Value;
        if (pawn is null || !pawn.IsValid) return HookResult.Continue;

        try
        {
            SkinApplier.ApplyGloves(pawn, loadout.Gloves);
        }
        catch (Exception ex)
        {
            Log($"не удалось надеть перчатки: {ex.Message}");
        }

        return HookResult.Continue;
    }

    /* --------------------------- применение скинов ------------------------ */

    private void TryApplyWeaponSkin(CBasePlayerWeapon weapon)
    {
        try
        {
            if (!weapon.IsValid || weapon.AttributeManager?.Item is null) return;

            var pawn = weapon.OwnerEntity?.Value?.As<CCSPlayerPawn>();
            if (pawn is null || !pawn.IsValid) return;

            var controller = pawn.OriginalController?.Value;
            if (controller is null || !controller.IsValid || controller.IsBot) return;

            var loadout = GetLoadout(controller.SteamID);
            if (loadout is null) return;

            var itemDef = weapon.AttributeManager.Item.ItemDefinitionIndex;
            var designer = weapon.DesignerName ?? "";

            // Нож: 42 (CT) и 59 (T) — дефолтные ножи команд.
            var isKnife = itemDef is 42 or 59 || designer.StartsWith("weapon_knife", StringComparison.OrdinalIgnoreCase);

            if (isKnife)
            {
                if (Config.ApplyKnife && loadout.Knife is { } knife)
                    SkinApplier.ApplyKnife(weapon, knife, Config.DefaultWear, Config.DefaultSeed, (uint)(controller.SteamID & 0xFFFFFFFF));
                return;
            }

            var skin = loadout.Weapons?.FirstOrDefault(w =>
                w.Def > 0 ? w.Def == itemDef : false);

            if (skin is null) return;
            SkinApplier.ApplyWeapon(weapon, skin, Config.DefaultWear, Config.DefaultSeed, (uint)(controller.SteamID & 0xFFFFFFFF));

            // один раз за запуск: видно, что покраска вообще происходит
            if (!_skinAppliedLogged)
            {
                _skinAppliedLogged = true;
                Log($"скин наложен: {controller.PlayerName} / {designer} (def {itemDef}) -> paint {skin.Paint}");
            }

            if (Config.Debug)
                Log($"{controller.PlayerName}: {designer} -> paint {skin.Paint}, def {skin.Def}");
        }
        catch (Exception ex)
        {
            Log($"ошибка при покраске оружия: {ex.Message}");
        }
    }

    /* ------------------------------- кэш ---------------------------------- */

    private async Task RefreshLoadoutAsync(ulong steamId)
    {
        var data = await _api.FetchLoadoutAsync(steamId);
        _cache[steamId] = new CachedLoadout { Data = data, FetchedAt = DateTime.UtcNow };
        if (Config.Debug)
            Log($"набор {steamId}: оружие {(data?.Weapons?.Count ?? 0)} шт., нож {data?.Knife?.Def}, перчатки {data?.Gloves?.Def}");
    }

    private LoadoutResponse? GetLoadout(ulong steamId)
    {
        var hasCached = _cache.TryGetValue(steamId, out var cached);
        var fresh = hasCached && (DateTime.UtcNow - cached!.FetchedAt).TotalSeconds < Config.CacheSeconds;

        if (!fresh) _ = RefreshLoadoutAsync(steamId); // обновим в фоне
        return hasCached ? cached!.Data : null;
    }

    /* ------------------------------ команды ------------------------------- */

    /** Открывает внутриигровое меню: команда css_menu (биндится на F1). */
    private void OnMenuCommand(CCSPlayerController? player, CommandInfo info)
    {
        if (player is null || !player.IsValid || player.IsBot) return;
        _menu.OpenMain(player);
    }

    private void OnSkinsCommand(CCSPlayerController? player, CommandInfo info)
    {
        if (player is null) return;
        player.PrintToChat($" Твои скины и апгрейд: {Config.SiteUrl}");
    }

    private void OnRefreshCommand(CCSPlayerController? player, CommandInfo info)
    {
        if (player is null) return;

        var steamId = player.SteamID;
        if (steamId <= 0) return;

        _cache.Remove(steamId);
        _ = RefreshLoadoutAsync(steamId).ContinueWith(_ =>
            player.PrintToChat(" Скины обновлены с сайта."));
    }
}
