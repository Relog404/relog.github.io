using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Memory;
using CounterStrikeSharp.API.Modules.Memory.DynamicFunctions;

namespace PanelSkins;

/*
 * Единственное место плагина, которое трогает внутренности движка.
 *
 * Логика: у оружия есть CEconItemView (AttributeManager.Item). Ему выставляем
 * item definition index + Fallback-поля (paint kit / seed / wear) и атрибуты
 * покраски — клиент сам отрисует скин. Мы ничего не меняем на стороне игрока:
 * это серверные данные, как у любого другого плагина.
 *
 * Управляемого API для атрибутов в современных версиях CounterStrikeSharp нет,
 * поэтому атрибуты ставятся нативной функцией движка
 * CAttributeList::SetOrAddAttributeValueByName — её сигнатура лежит в
 * gamedata/panelskins.json (файл кладётся в addons/counterstrikesharp/gamedata).
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

    /// <summary>Целое число упаковываем во float: движок хранит атрибуты так же.</summary>
    private static float ViewAsFloat(uint value) => BitConverter.Int32BitsToSingle((int)value);

    public static void ApplyWeapon(CBasePlayerWeapon weapon, LoadoutSkin skin, float defaultWear, int defaultSeed)
    {
        var item = weapon.AttributeManager?.Item;
        if (item is null) return;

        var wear = skin.Wear > 0 ? skin.Wear : defaultWear;
        var seed = skin.Seed > 0 ? skin.Seed : defaultSeed;

        if (skin.Def > 0)
            item.ItemDefinitionIndex = (ushort)skin.Def;

        item.Initialized = true;

        // Fallback-поля сетевые: клиент сам подтянет модель и текстуру.
        weapon.FallbackPaintKit = skin.Paint;
        weapon.FallbackSeed = seed;
        weapon.FallbackWear = wear;
        weapon.FallbackStatTrak = skin.StatTrak ? skin.Kills : 0;

        item.NetworkedDynamicAttributes.Attributes.RemoveAll();
        SetPaint(item.NetworkedDynamicAttributes, skin.Paint, seed, wear);

        if (skin.StatTrak)
        {
            item.EntityQuality = 9; // StatTrak
            SetAttr(item.NetworkedDynamicAttributes.Handle, "kill eater", ViewAsFloat((uint)skin.Kills));
            SetAttr(item.NetworkedDynamicAttributes.Handle, "kill eater score type", 0);
        }
        else
        {
            item.EntityQuality = 0;
        }
    }

    public static void ApplyKnife(CBasePlayerWeapon knife, LoadoutSkin skin, float defaultWear, int defaultSeed)
        => ApplyWeapon(knife, skin, defaultWear, defaultSeed);

    public static void ApplyGloves(CCSPlayerPawn pawn, LoadoutSkin skin)
    {
        var item = pawn.EconGloves;
        if (item is null) return;

        if (skin.Def > 0)
            item.ItemDefinitionIndex = (ushort)skin.Def;

        var wear = skin.Wear > 0 ? skin.Wear : 0.000001f;

        item.NetworkedDynamicAttributes.Attributes.RemoveAll();
        SetPaint(item.NetworkedDynamicAttributes, skin.Paint, skin.Seed, wear);
        item.Initialized = true;
    }

    private static void SetPaint(CAttributeList list, int paint, int seed, float wear)
    {
        SetAttr(list.Handle, "set item texture prefab", paint);
        SetAttr(list.Handle, "set item texture seed", seed);
        SetAttr(list.Handle, "set item texture wear", wear);
    }
}
