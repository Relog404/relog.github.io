using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Memory;
using CounterStrikeSharp.API.Modules.Memory.DynamicFunctions;

namespace PanelSkins;

/*
 * Единственное место плагина, которое трогает внутренности движка.
 *
 * Как это работает в CS2. У оружия есть CEconItemView (AttributeManager.Item).
 * Ему выставляем item definition index и Fallback-поля (paint kit / seed / wear),
 * плюс атрибуты покраски в оба списка атрибутов — клиент сам отрисует скин.
 * Мы ничего не меняем на стороне игрока: это серверные данные, как у любого
 * другого плагина.
 *
 * Три вещи, без которых скин не виден (проверено на рабочих плагинах CS2):
 *   1) у предмета должен быть «свой» ItemID, а не нулевой;
 *   2) после записи Fallback-полей движок надо уведомить через
 *      Utilities.SetStateChanged — иначе клиент берёт первый же сетевой
 *      снимок сущности и рисует дефолтную текстуру;
 *   3) покраска кладётся в ОБА списка атрибутов: NetworkedDynamicAttributes
 *      и AttributeList.
 *
 * Управляемого API для атрибутов в современных версиях CounterStrikeSharp нет,
 * поэтому атрибуты ставятся нативной функцией движка
 * CAttributeList::SetOrAddAttributeValueByName — её сигнатура лежит в
 * gamedata/panelskins.json (файл кладётся в addons/counterstrikesharp/gamedata).
 * Если сигнатура не найдена или вызов упал — отключаются только атрибуты,
 * Fallback-поля продолжают работать и сервер не падает.
 */
public static class SkinApplier
{
    /*
     * Нативную функцию ищем лениво и осторожно: если сигнатуры в движке нет
     * (обновился CS2) или вызов падает — отключаем только атрибуты покраски,
     * а сам сервер продолжает работать: paint/seed/wear выставляются и без них.
     */
    private static MemoryFunctionVoid<nint, string, float>? _setAttribute;
    private static bool _resolveFailed;
    private static bool _attributesDisabled;

    /// <summary>Свои ItemID раздаём по возрастающей, начиная с заведомо «не настоящего».</summary>
    private static ulong _nextItemId = 0xF00DCAFE;

    /// <summary>Полностью выключить нативные вызовы (ApplyAttributes = false в конфиге).</summary>
    public static void DisableAttributes() => _attributesDisabled = true;

    private static MemoryFunctionVoid<nint, string, float>? Resolve()
    {
        if (_setAttribute is not null) return _setAttribute;
        if (_resolveFailed) return null;

        try
        {
            _setAttribute = new MemoryFunctionVoid<nint, string, float>(
                GameData.GetSignature("CAttributeList_SetOrAddAttributeValueByName"));
        }
        catch (Exception ex)
        {
            _resolveFailed = true;
            Console.WriteLine("[PanelSkins] не найдена CAttributeList_SetOrAddAttributeValueByName: " + ex.Message);
            Console.WriteLine("[PanelSkins] атрибуты покраски отключены, скины работают через Fallback-поля.");
        }

        return _setAttribute;
    }

    private static void SetAttr(nint list, string name, float value)
    {
        if (_attributesDisabled || list == 0) return;

        var fn = Resolve();
        if (fn is null) return;

        try
        {
            fn.Invoke(list, name, value);
        }
        catch (Exception ex)
        {
            _attributesDisabled = true;
            Console.WriteLine("[PanelSkins] вызов атрибутов покраски упал: " + ex.Message);
            Console.WriteLine("[PanelSkins] больше не вызываю нативную функцию — сервер продолжает работать.");
        }
    }

    private static void SetAttr(nint list, string name, uint value) => SetAttr(list, name, ViewAsFloat(value));

    /// <summary>Целое число упаковываем во float: движок хранит атрибуты так же.</summary>
    private static float ViewAsFloat(uint value) => BitConverter.Int32BitsToSingle((int)value);

    /// <summary>Оба списка атрибутов предмета — красить надо и тот, и другой.</summary>
    private static IEnumerable<nint> AttributeLists(CEconItemView item)
    {
        if (item.NetworkedDynamicAttributes is { } dyn) yield return dyn.Handle;
        if (item.AttributeList is { } plain) yield return plain.Handle;
    }

    /// <summary>Свой ItemID: без него движок считает предмет дефолтным и игнорирует покраску.</summary>
    private static void AssignItemId(CEconItemView item)
    {
        var id = unchecked(_nextItemId++);
        item.ItemID = id;
        item.ItemIDLow = (uint)(id & 0xFFFFFFFF);
        item.ItemIDHigh = (uint)(id >> 32);
    }

    public static void ApplyWeapon(CBasePlayerWeapon weapon, LoadoutSkin skin, float defaultWear, int defaultSeed, uint accountId = 0)
    {
        var item = weapon.AttributeManager?.Item;
        if (item is null) return;

        var wear = skin.Wear > 0 ? skin.Wear : defaultWear;
        var seed = skin.Seed > 0 ? skin.Seed : defaultSeed;

        // старые атрибуты с прошлого набора скинов мешают новой покраске
        item.NetworkedDynamicAttributes?.Attributes.RemoveAll();
        item.AttributeList?.Attributes.RemoveAll();

        AssignItemId(item);
        if (accountId > 0) item.AccountID = accountId;

        if (skin.Def > 0)
            item.ItemDefinitionIndex = (ushort)skin.Def;

        // Fallback-поля сетевые: клиент сам подтянет модель и текстуру.
        weapon.FallbackPaintKit = skin.Paint;
        weapon.FallbackSeed = seed;
        weapon.FallbackWear = wear;
        weapon.FallbackStatTrak = skin.StatTrak ? skin.Kills : 0;

        foreach (var list in AttributeLists(item))
        {
            SetAttr(list, "set item texture prefab", skin.Paint);
            SetAttr(list, "set item texture seed", seed);
            SetAttr(list, "set item texture wear", wear);
        }

        if (skin.StatTrak)
        {
            item.EntityQuality = 9; // StatTrak
            foreach (var list in AttributeLists(item))
            {
                SetAttr(list, "kill eater", (uint)Math.Max(0, skin.Kills));
                SetAttr(list, "kill eater score type", 0u);
            }
        }
        else
        {
            item.EntityQuality = 0;
        }

        item.Initialized = true;

        // ГЛАВНОЕ: помечаем сетевые поля изменёнными, иначе клиент может
        // так и не перерисовать оружие — скин будет «в описании», но не в руках.
        Utilities.SetStateChanged(weapon, "CEconEntity", "m_nFallbackPaintKit");
        Utilities.SetStateChanged(weapon, "CEconEntity", "m_nFallbackSeed");
        Utilities.SetStateChanged(weapon, "CEconEntity", "m_flFallbackWear");
        Utilities.SetStateChanged(weapon, "CEconEntity", "m_AttributeManager");

        // переключаем группу костей: без этого часть моделей остаётся дефолтной
        weapon.AcceptInput("SetBodygroup", value: "body,0");
        Utilities.SetStateChanged(weapon, "CBaseModelEntity", "m_CBodyComponent");
    }

    public static void ApplyKnife(CBasePlayerWeapon knife, LoadoutSkin skin, float defaultWear, int defaultSeed, uint accountId = 0)
        => ApplyWeapon(knife, skin, defaultWear, defaultSeed, accountId);

    public static void ApplyGloves(CCSPlayerPawn pawn, LoadoutSkin skin)
    {
        var item = pawn.EconGloves;
        if (item is null) return;

        var wear = skin.Wear > 0 ? skin.Wear : 0.000001f;

        item.NetworkedDynamicAttributes?.Attributes.RemoveAll();
        item.AttributeList?.Attributes.RemoveAll();

        if (skin.Def > 0)
            item.ItemDefinitionIndex = (ushort)skin.Def;

        AssignItemId(item);

        foreach (var list in AttributeLists(item))
        {
            SetAttr(list, "set item texture prefab", skin.Paint);
            SetAttr(list, "set item texture seed", skin.Seed);
            SetAttr(list, "set item texture wear", wear);
        }

        Utilities.SetStateChanged(pawn, "CBaseModelEntity", "m_CBodyComponent");
        item.Initialized = true;
    }
}
