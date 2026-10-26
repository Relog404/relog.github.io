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

        // F1 = меню скинов. Бинд ставится на стороне клиента при каждом входе.
        try
        {
            controller.ExecuteClientCommand("bind F1 css_menu");
            controller.PrintToChat(" [PanelSkins] Меню скинов — F1 (или !css_menu)");
        }
        catch (Exception ex)
        {
            Log($"не удалось повесить F1: {ex.Message}");
        }
    }

    private void OnClientDisconnect(int playerSlot)
    {
        var controller = Utilities.GetPlayerFromSlot(playerSlot);
        if (controller is null) return;
        _cache.Remove(controller.SteamID);
    }

    private void OnEntityCreated(CEntityInstance entity)
    {
        if (entity is not CBasePlayerWeapon weapon) return;
        // На следующем кадре у оружия уже есть владелец и item definition index.
        Server.NextFrame(() => TryApplyWeaponSkin(weapon));
    }

    private HookResult OnPlayerSpawn(EventPlayerSpawn @event, GameEventInfo info)
    {
        var controller = @event.Userid;
        if (controller is null || !controller.IsValid || controller.IsBot) return HookResult.Continue;

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
                    SkinApplier.ApplyKnife(weapon, knife, Config.DefaultWear, Config.DefaultSeed);
                return;
            }

            var skin = loadout.Weapons?.FirstOrDefault(w =>
                w.Def > 0 ? w.Def == itemDef : false);

            if (skin is null) return;
            SkinApplier.ApplyWeapon(weapon, skin, Config.DefaultWear, Config.DefaultSeed);

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
