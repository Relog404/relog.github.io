using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;

namespace PanelSkins;

/*
 * Единственное место плагина, которое трогает внутренности движка.
 *
 * Логика: у оружия есть CEconItemView (AttributeManager.Item). Достаточно выставить
 * ему item definition index и атрибуты покраски — клиент сам отрисует скин.
 * Мы ничего не меняем на стороне игрока: это серверные данные, как любые другие плагины.
 *
 * ВАЖНО: имена schema-членов зависят от версии CounterStrikeSharp. Если при сборке
 * компилятор ругается на NetworkedDynamicAttributes / SetOrAddAttributeValue,
 * см. раздел «Если не собирается» в README — там варианты B и C для этих строк.
 */
public static class SkinApplier
{
    public static void ApplyWeapon(CBasePlayerWeapon weapon, LoadoutSkin skin, float defaultWear, int defaultSeed)
    {
        if (weapon.AttributeManager is null) return;
        var item = weapon.AttributeManager.Item;
        if (item is null) return;

        if (skin.Def > 0)
            item.ItemDefinitionIndex = (ushort)skin.Def;

        var attrs = item.NetworkedDynamicAttributes.Attributes;

        // Вариант A (основной):
        attrs.SetOrAddAttributeValue("paint kit", skin.Paint);
        attrs.SetOrAddAttributeValue("paint seed", skin.Seed > 0 ? skin.Seed : defaultSeed);
        attrs.SetOrAddAttributeValue("paint wear", skin.Wear > 0 ? skin.Wear : defaultWear);

        if (skin.StatTrak)
        {
            attrs.SetOrAddAttributeValue("kill eater", 1);
            attrs.SetOrAddAttributeValue("kill eater score type", 0);
            attrs.SetOrAddAttributeValue("kill counter", skin.Kills);
        }
        else
        {
            attrs.Remove("kill eater");
            attrs.Remove("kill counter");
        }

        // Без этого клиенты не узнают, что предмет изменился.
        Utilities.SetStateChanged(weapon, "CBasePlayerWeapon", "m_AttributeManager");
    }

    public static void ApplyKnife(CBasePlayerWeapon knife, LoadoutSkin skin, float defaultWear, int defaultSeed)
        => ApplyWeapon(knife, skin, defaultWear, defaultSeed);

    public static void ApplyGloves(CCSPlayerPawn pawn, LoadoutSkin skin)
    {
        var gloves = pawn.EconGloves;
        if (gloves is null) return;

        if (skin.Def > 0)
            gloves.ItemDefinitionIndex = (ushort)skin.Def;

        var attrs = gloves.NetworkedDynamicAttributes.Attributes;
        attrs.SetOrAddAttributeValue("set item texture prefab", skin.Paint);
        attrs.SetOrAddAttributeValue("paint kit", skin.Paint);

        Utilities.SetStateChanged(pawn, "CCSPlayerPawn", "m_EconGloves");
    }
}
