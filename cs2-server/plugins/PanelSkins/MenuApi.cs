using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace PanelSkins;

/// <summary>Общение с панелью для внутриигрового меню (тот же ключ, что и у loadout).</summary>
public sealed class MenuApi : IDisposable
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(6) };
    private readonly Func<string> _panelUrl;
    private readonly Func<string> _pluginKey;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public MenuApi(Func<string> panelUrl, Func<string> pluginKey)
    {
        _panelUrl = panelUrl;
        _pluginKey = pluginKey;
    }

    private string BaseUrl => (_panelUrl() ?? "").Trim().TrimEnd('/');

    private bool Ready => !string.IsNullOrWhiteSpace(BaseUrl);

    private void AddKey(HttpRequestMessage request)
    {
        var key = (_pluginKey() ?? "").Trim();
        if (!string.IsNullOrWhiteSpace(key))
            request.Headers.TryAddWithoutValidation("X-Plugin-Key", key);
    }

    public async Task<MenuState?> FetchAsync(ulong steamId, string query = "")
    {
        if (!Ready || steamId == 0) return null;
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{BaseUrl}/api/plugin/menu/{steamId}{query}");
        AddKey(request);
        using var response = await _http.SendAsync(request);
        if (!response.IsSuccessStatusCode) return null;
        await using var stream = await response.Content.ReadAsStreamAsync();
        return await JsonSerializer.DeserializeAsync<MenuState>(stream, Json);
    }

    public async Task<MenuResult?> PostAsync(ulong steamId, string action, object? payload = null)
    {
        if (!Ready || steamId == 0) return null;

        var body = new Dictionary<string, object?>
        {
            ["steamId"] = steamId.ToString(),
            ["action"] = action,
        };

        if (payload is not null)
        {
            foreach (var property in payload.GetType().GetProperties())
            {
                var name = JsonNamingPolicy.CamelCase.ConvertName(property.Name);
                body[name] = property.GetValue(payload);
            }
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{BaseUrl}/api/plugin/menu/action");
        AddKey(request);
        request.Content = new StringContent(JsonSerializer.Serialize(body, Json), Encoding.UTF8, "application/json");
        using var response = await _http.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(text)) return null;
        return JsonSerializer.Deserialize<MenuResult>(text, Json);
    }

    public void Dispose() => _http.Dispose();
}
