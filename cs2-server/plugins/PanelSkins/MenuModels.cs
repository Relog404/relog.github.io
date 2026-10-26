using System.Text.Json.Serialization;

namespace PanelSkins;

/// <summary>Состояние игрока для внутриигрового меню: GET /api/plugin/menu/{steamId}</summary>
public sealed class MenuState
{
    [JsonPropertyName("steamId")] public string SteamId { get; set; } = "";
    [JsonPropertyName("coins")] public long Coins { get; set; }
    [JsonPropertyName("cases")] public List<MenuCase>? Cases { get; set; }
    [JsonPropertyName("inventory")] public List<MenuItemEntry>? Inventory { get; set; }
    [JsonPropertyName("equipped")] public List<MenuEquipped>? Equipped { get; set; }
    [JsonPropertyName("slots")] public List<MenuSlot>? Slots { get; set; }
    [JsonPropertyName("categories")] public List<MenuCategory>? Categories { get; set; }
    [JsonPropertyName("shop")] public MenuShop? Shop { get; set; }
    [JsonPropertyName("top")] public List<MenuTop>? Top { get; set; }
}

public sealed class MenuCase
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("price")] public long Price { get; set; }
}

public sealed class MenuItemEntry
{
    [JsonPropertyName("uid")] public string Uid { get; set; } = "";
    [JsonPropertyName("itemId")] public string ItemId { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("price")] public long Price { get; set; }
    [JsonPropertyName("rarity")] public string Rarity { get; set; } = "";
}

public sealed class MenuEquipped
{
    [JsonPropertyName("slot")] public string Slot { get; set; } = "";
    [JsonPropertyName("uid")] public string Uid { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
}

public sealed class MenuSlot
{
    [JsonPropertyName("key")] public string Key { get; set; } = "";
    [JsonPropertyName("label")] public string Label { get; set; } = "";
}

public sealed class MenuCategory
{
    [JsonPropertyName("category")] public string Category { get; set; } = "";
    [JsonPropertyName("count")] public int Count { get; set; }
}

public sealed class MenuShop
{
    [JsonPropertyName("items")] public List<MenuShopItem>? Items { get; set; }
    [JsonPropertyName("page")] public int Page { get; set; }
    [JsonPropertyName("pages")] public int Pages { get; set; }
}

public sealed class MenuShopItem
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("price")] public long Price { get; set; }
    [JsonPropertyName("rarity")] public string Rarity { get; set; } = "";
}

public sealed class MenuTop
{
    [JsonPropertyName("steamId")] public string SteamId { get; set; } = "";
    [JsonPropertyName("wagered")] public long Wagered { get; set; }
    [JsonPropertyName("coins")] public long Coins { get; set; }
}

/// <summary>Ответ на действие из меню: POST /api/plugin/menu/action</summary>
public sealed class MenuResult
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("message")] public string Message { get; set; } = "";
    [JsonPropertyName("error")] public string Error { get; set; } = "";
    [JsonPropertyName("coins")] public long Coins { get; set; }
    [JsonPropertyName("prize")] public MenuPrize? Prize { get; set; }
    [JsonPropertyName("won")] public bool Won { get; set; }
    [JsonPropertyName("multiplier")] public double Multiplier { get; set; }
    [JsonPropertyName("targets")] public List<MenuShopItem>? Targets { get; set; }
}

public sealed class MenuPrize
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("rarity")] public string Rarity { get; set; } = "";
    [JsonPropertyName("price")] public long Price { get; set; }
}
