using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Memory;

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
    private static readonly MemoryFunctionVoid<nint, string, float> SetAttribute =
        new(GameData.GetSignature("CAttributeList_SetOrAddAttributeValueByName"));

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
            SetAttribute.Invoke(item.NetworkedDynamicAttributes.Handle, "kill eater", ViewAsFloat((uint)skin.Kills));
            SetAttribute.Invoke(item.NetworkedDynamicAttributes.Handle, "kill eater score type", 0);
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
        SetAttribute.Invoke(list.Handle, "set item texture prefab", paint);
        SetAttribute.Invoke(list.Handle, "set item texture seed", seed);
        SetAttribute.Invoke(list.Handle, "set item texture wear", wear);
    }
}
