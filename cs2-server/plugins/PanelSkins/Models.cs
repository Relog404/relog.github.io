using System.Text.Json.Serialization;

namespace PanelSkins;

/// <summary>Ответ панели: GET /api/plugin/loadout/{steamId64}</summary>
public sealed class LoadoutResponse
{
    [JsonPropertyName("steamId")] public string SteamId { get; set; } = "";
    [JsonPropertyName("weapons")] public List<LoadoutSkin>? Weapons { get; set; }
    [JsonPropertyName("knife")] public LoadoutSkin? Knife { get; set; }
    [JsonPropertyName("gloves")] public LoadoutSkin? Gloves { get; set; }
    [JsonPropertyName("agentCt")] public LoadoutSkin? AgentCt { get; set; }
    [JsonPropertyName("agentT")] public LoadoutSkin? AgentT { get; set; }
    [JsonPropertyName("music")] public LoadoutSkin? Music { get; set; }
}

/// <summary>def — item definition index, paint — paint kit index.</summary>
public sealed class LoadoutSkin
{
    [JsonPropertyName("def")] public int Def { get; set; }
    [JsonPropertyName("paint")] public int Paint { get; set; }
    [JsonPropertyName("wear")] public float Wear { get; set; }
    [JsonPropertyName("seed")] public int Seed { get; set; }
    [JsonPropertyName("statTrak")] public bool StatTrak { get; set; }
    [JsonPropertyName("kills")] public int Kills { get; set; }
}

/// <summary>Кэш набора игрока, чтобы не дёргать панель на каждый выстрел.</summary>
public sealed class CachedLoadout
{
    public LoadoutResponse? Data { get; init; }
    public DateTime FetchedAt { get; init; }
    public bool IsEmpty => Data is null;
}
