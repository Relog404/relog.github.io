# =============================================================
#  CounterStrikeSharp / Metamod:Source installer for CS2 (Windows)
#  Run directly:  powershell -ExecutionPolicy Bypass -File install-plugins.ps1 -InstallDir C:\cs2-server
# =============================================================
param(
    [string]$InstallDir = "$env:USERPROFILE\cs2-server",
    [string]$MetamodUrl = $env:METAMOD_URL
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# CS2 кладёт игру в <install_dir>\game\game\csgo — но проверяем и старую раскладку
$CsgoDir = Join-Path $InstallDir 'game\game\csgo'
if (-not (Test-Path $CsgoDir)) {
    $alt = Join-Path $InstallDir 'game\csgo'
    if (Test-Path $alt) { $CsgoDir = $alt }
}
if (-not (Test-Path $CsgoDir)) {
    Write-Host "ERROR: $CsgoDir not found. Run install-cs2-server.bat first." -ForegroundColor Red
    exit 1
}

$Tmp = Join-Path $env:TEMP ("cs2-plugins-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp -Force | Out-Null

function Install-FromZip {
    param([string]$Url, [string]$Name)

    $zip = Join-Path $Tmp ($Name + '.zip')
    $dest = Join-Path $Tmp $Name
    Write-Host "== $Name =="
    Write-Host "   downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $zip
    Expand-Archive -Force -Path $zip -DestinationPath $dest

    $addons = Join-Path $dest 'addons'
    if (Test-Path $addons) {
        $target = Join-Path $CsgoDir 'addons'
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        Get-ChildItem -Path $addons | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination $target -Recurse -Force
        }
        Write-Host "   installed into $target" -ForegroundColor Green
    } else {
        Write-Host "   archive has no 'addons' folder - unpacked to $dest, copy it into $CsgoDir manually" -ForegroundColor Yellow
    }
}

# ---------------------- CounterStrikeSharp ----------------------
try {
    $release = Invoke-RestMethod 'https://api.github.com/repos/roflmuffin/CounterStrikeSharp/releases/latest'
    # сборка "with-runtime" содержит внутри .NET - ничего ставить руками не надо
    $asset = $release.assets | Where-Object { $_.name -like '*with-runtime*windows*.zip' } | Select-Object -First 1
    if (-not $asset) {
        $asset = $release.assets | Where-Object { $_.name -like '*.zip' -and $_.name -match 'windows' } | Select-Object -First 1
    }
    if (-not $asset) { throw 'no suitable asset in the latest release' }

    Write-Host "   latest CounterStrikeSharp: $($release.tag_name) -> $($asset.name)"
    Install-FromZip -Url $asset.browser_download_url -Name 'counterstrikesharp'
} catch {
    Write-Host "CounterStrikeSharp install failed: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "Download it manually: https://github.com/roflmuffin/CounterStrikeSharp/releases" -ForegroundColor Yellow
}

# --------------------------- Metamod ----------------------------
Write-Host ""
Write-Host "== Metamod:Source ==" -ForegroundColor Cyan

# сначала пробуем свежий билд ветки 2.0 (она для CS2) прямо с GitHub
if (-not $MetamodUrl) {
    try {
        $mmReleases = Invoke-RestMethod 'https://api.github.com/repos/alliedmodders/metamod-source/releases?per_page=50'
        $mm = $mmReleases | Where-Object { $_.tag_name -like '2.0.*' } | Select-Object -First 1
        $mmAsset = $mm.assets | Where-Object { $_.name -like '*windows*.zip' } | Select-Object -First 1
        if ($mmAsset) { $MetamodUrl = $mmAsset.browser_download_url }
    } catch {
        Write-Host "   не удалось узнать последнюю версию Metamod: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

if (-not $MetamodUrl) {
    # запасная прямая ссылка, если GitHub API недоступен
    $MetamodUrl = 'https://github.com/alliedmodders/metamod-source/releases/download/2.0.0.1483/mmsource-2.0.0-git1483-windows.zip'
}

try {
    Write-Host "   $MetamodUrl"
    Install-FromZip -Url $MetamodUrl -Name 'metamod'
} catch {
    Write-Host "Metamod install failed: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "Fallback: https://www.metamodsource.net/downloads.php?branch=stable" -ForegroundColor Yellow
    Write-Host "   unpack the archive into: $CsgoDir" -ForegroundColor Yellow
    Write-Host "   or re-run with:  install-plugins.bat -MetamodUrl <zip url>" -ForegroundColor Yellow
}

# --------------------- gameinfo.gi: подключаем Metamod ---------------------
# Без этой правки движок про Metamod даже не узнает: в консоли не будет
# ни "meta list", ни плагинов, хотя папки лежат на месте.
Write-Host ""
Write-Host "== gameinfo.gi ==" -ForegroundColor Cyan

$gameinfo = Join-Path $CsgoDir 'gameinfo.gi'
if (Test-Path $gameinfo) {
    $gi = Get-Content $gameinfo -Raw
    if ($gi -match 'csgo[\\/]addons[\\/]metamod') {
        Write-Host "   metamod уже прописан" -ForegroundColor Green
    } else {
        Copy-Item $gameinfo "$gameinfo.bak" -Force
        $new = $gi -replace '(?m)^(\s*Game_LowViolence\s+csgo_lv\s*)$', '$1' + "`n`t`tGame`t`tcsgo/addons/metamod"
        if ($new -eq $gi) {
            # нет строки Game_LowViolence - вставим сразу после SearchPaths {
            $new = $gi -replace '(?ms)(SearchPaths\s*\{)', '$1' + "`n`t`tGame`t`tcsgo/addons/metamod"
        }
        if ($new -eq $gi) {
            Write-Host "   не нашёл блок SearchPaths - допишите в gameinfo.gi вручную:" -ForegroundColor Yellow
            Write-Host "       Game    csgo/addons/metamod" -ForegroundColor Yellow
        } else {
            [IO.File]::WriteAllText($gameinfo, $new, (New-Object System.Text.UTF8Encoding($false)))
            Write-Host "   gameinfo.gi: добавлен путь csgo/addons/metamod (бэкап: gameinfo.gi.bak)" -ForegroundColor Green
        }
    }
} else {
    Write-Host "   gameinfo.gi не найден - Metamod без него не загрузится" -ForegroundColor Yellow
}

# конфиг, который игра выполняет ПОСЛЕ своего gamemode_competitive.cfg
$gamemodeCfg = Join-Path $CsgoDir 'cfg\gamemode_competitive_server.cfg'
if (Test-Path (Join-Path $PSScriptRoot 'cfg\gamemode_competitive_server.cfg')) {
    New-Item -ItemType Directory -Path (Join-Path $CsgoDir 'cfg') -Force | Out-Null
    Copy-Item (Join-Path $PSScriptRoot 'cfg\gamemode_competitive_server.cfg') $gamemodeCfg -Force
    Write-Host "   cfg\gamemode_competitive_server.cfg установлен" -ForegroundColor Green
}

# --------------------------- PanelSkins ---------------------------
Write-Host ""
Write-Host "== PanelSkins (серверный скинченджер) ==" -ForegroundColor Cyan

$pluginSrc = Join-Path $PSScriptRoot 'plugins\PanelSkins'
$dll       = Join-Path $pluginSrc 'prebuilt\PanelSkins.dll'
$pluginDst = Join-Path $CsgoDir 'addons\counterstrikesharp\plugins\PanelSkins'
$gamedataDst = Join-Path $CsgoDir 'addons\counterstrikesharp\gamedata'

# готовой сборки в репозитории нет (например, скачали только исходники) - тянем её с GitHub
if (-not (Test-Path $dll)) {
    try {
        Write-Host "   готовой DLL рядом нет - скачиваем сборку с GitHub"
        New-Item -ItemType Directory -Path (Split-Path $dll) -Force | Out-Null
        $dllUrl = 'https://raw.githubusercontent.com/Relog404/relog.github.io/main/cs2-server/plugins/PanelSkins/prebuilt/PanelSkins.dll'
        Invoke-WebRequest -Uri $dllUrl -OutFile $dll
    } catch {
        Write-Host "   скачать не удалось: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# если DLL так и нет - пробуем собрать сами (нужен .NET 10 SDK)
if (-not (Test-Path $dll)) {
    $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($dotnet) {
        try {
            Write-Host "   собираем плагин из исходников (dotnet build)"
            Push-Location $pluginSrc
            dotnet build -c Release
            $built = Join-Path $pluginSrc 'bin\Release\net10.0\PanelSkins.dll'
            if (Test-Path $built) {
                New-Item -ItemType Directory -Path (Split-Path $dll) -Force | Out-Null
                Copy-Item $built $dll -Force
            }
        } catch {
            Write-Host "   сборка не удалась: $($_.Exception.Message)" -ForegroundColor Yellow
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "   .NET SDK не найден и готовой DLL нет - поставьте .NET 10 SDK или возьмите" -ForegroundColor Yellow
        Write-Host "   готовую сборку: https://github.com/Relog404/relog.github.io/actions (артефакт PanelSkins)" -ForegroundColor Yellow
    }
}

if (Test-Path $dll) {
    New-Item -ItemType Directory -Path $pluginDst -Force | Out-Null
    Copy-Item $dll (Join-Path $pluginDst 'PanelSkins.dll') -Force

    $cfgDst = Join-Path $pluginDst 'PanelSkins.json'
    if (-not (Test-Path $cfgDst)) {
        Copy-Item (Join-Path $pluginSrc 'config.example.json') $cfgDst -Force
        Write-Host "   создан конфиг $cfgDst - укажите в нём PanelUrl и PluginKey" -ForegroundColor Yellow
    }

    New-Item -ItemType Directory -Path $gamedataDst -Force | Out-Null
    Copy-Item (Join-Path $pluginSrc 'gamedata\panelskins.json') (Join-Path $gamedataDst 'panelskins.json') -Force
    Write-Host "   плагин установлен: $pluginDst" -ForegroundColor Green
}

Write-Host ""
Write-Host "==== Next steps ====" -ForegroundColor Cyan
Write-Host "1) On Windows install Visual C++ Redistributable (x64) or CSSharp will not start:"
Write-Host "   https://aka.ms/vs/17/release/vc_redist.x64.exe"
Write-Host "2) Check that $CsgoDir\addons\metamod exists (Metamod) and $CsgoDir\addons\counterstrikesharp (CSSharp)."
Write-Host "   gameinfo.gi must contain the line:  Game    csgo/addons/metamod"
Write-Host "3) Fill in $CsgoDir\addons\counterstrikesharp\plugins\PanelSkins\PanelSkins.json (PanelUrl + PluginKey)."
Write-Host "4) Start the server: $InstallDir\start-cs2.bat"
Write-Host "5) In server console:  meta list  (CounterStrikeSharp) and  css_plugins list  (PanelSkins)"
Write-Host ""
Write-Host "Plugins are server-side only: the server will be marked 'insecure' (VAC disabled on it) -"
Write-Host "that is the normal, officially tolerated mode for community servers with plugins."

Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
