using System.Net.Http.Headers;
using System.Text.Json;

namespace PanelSkins;

/// <summary>Минимальный клиент панели: забирает набор скинов игрока по SteamID64.</summary>
public sealed class PanelApiClient : IDisposable
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(5) };
    private readonly Func<string> _getPanelUrl;
    private readonly Func<string> _getPluginKey;
    private readonly Action<string> _log;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public PanelApiClient(Func<string> panelUrl, Func<string> pluginKey, Action<string> log)
    {
        _getPanelUrl = panelUrl;
        _getPluginKey = pluginKey;
        _log = log;
        _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("PanelSkins", "1.0"));
    }

    /// <summary>GET {PanelUrl}/api/plugin/loadout/{steamId} с ключом плагина в заголовке.</summary>
    public async Task<LoadoutResponse?> FetchLoadoutAsync(ulong steamId64)
    {
        var baseUrl = (_getPanelUrl() ?? "").TrimEnd('/');
        if (string.IsNullOrWhiteSpace(baseUrl)) return null;

        var url = $"{baseUrl}/api/plugin/loadout/{steamId64}";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        var key = _getPluginKey();
        if (!string.IsNullOrWhiteSpace(key)) request.Headers.TryAddWithoutValidation("X-Plugin-Key", key);

        try
        {
            using var response = await _http.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                _log($"панель ответила {(int)response.StatusCode} на {url}");
                return null;
            }

            await using var stream = await response.Content.ReadAsStreamAsync();
            return await JsonSerializer.DeserializeAsync<LoadoutResponse>(stream, JsonOptions);
        }
        catch (Exception ex)
        {
            _log($"[PanelSkins] не удалось получить набор: {ex.Message}");
            return null;
        }
    }

    public void Dispose() => _http.Dispose();
}
