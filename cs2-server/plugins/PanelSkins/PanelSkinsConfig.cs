using System.Text.Json.Serialization;
using CounterStrikeSharp.API.Core;

namespace PanelSkins;

public sealed class PanelSkinsConfig : BasePluginConfig
{
    [JsonPropertyName("PanelUrl")]
    public string PanelUrl { get; set; } = "http://127.0.0.1:3000";

    /// <summary>Ключ сервера из админки панели (кнопка «новый ключ» на вкладке «Настройки»).</summary>
    [JsonPropertyName("PluginKey")]
    public string PluginKey { get; set; } = "";

    /// <summary>Адрес сайта, который показываем игрокам по !skins.</summary>
    [JsonPropertyName("SiteUrl")]
    public string SiteUrl { get; set; } = "http://127.0.0.1:3000";

    /// <summary>Сколько секунд держать набор игрока в кэше.</summary>
    [JsonPropertyName("CacheSeconds")]
    public int CacheSeconds { get; set; } = 120;

    [JsonPropertyName("ApplyKnife")]
    public bool ApplyKnife { get; set; } = true;

    [JsonPropertyName("ApplyGloves")]
    public bool ApplyGloves { get; set; } = true;

    /// <summary>Износ по умолчанию, если панель его не прислала.</summary>
    [JsonPropertyName("DefaultWear")]
    public float DefaultWear { get; set; } = 0.001f;

    [JsonPropertyName("DefaultSeed")]
    public int DefaultSeed { get; set; } = 0;

    /// <summary>
    /// Вызывать нативную функцию атрибутов покраски (paint/seed/wear дублируются
    /// в атрибутах, как в CS:GO, + работает StatTrak).
    /// По умолчанию ВЫКЛЮЧЕНО: это единственное место плагина, которое лезет
    /// в нативный код движка и может уронить сервер, если сигнатура устарела.
    /// Скины видны и без него — через FallbackPaintKit/Seed/Wear.
    /// </summary>
    [JsonPropertyName("ApplyAttributes")]
    public bool ApplyAttributes { get; set; } = false;

    /// <summary>Писать в консоль сервера отладочную информацию.</summary>
    [JsonPropertyName("Debug")]
    public bool Debug { get; set; } = false;
}
