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

$CsgoDir = Join-Path $InstallDir 'game\csgo'
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
    $asset = $release.assets | Where-Object { $_.name -like '*.zip' -and $_.name -match 'windows' } | Select-Object -First 1
    if (-not $asset) {
        $asset = $release.assets | Where-Object { $_.name -like '*.zip' -and $_.name -notmatch 'linux' } | Select-Object -First 1
    }
    if (-not $asset) { throw 'no suitable asset in the latest release' }

    Write-Host "   latest CounterStrikeSharp: $($release.tag_name) -> $($asset.name)"
    Install-FromZip -Url $asset.browser_download_url -Name 'counterstrikesharp'
} catch {
    Write-Host "CounterStrikeSharp install failed: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "Download it manually: https://github.com/roflmuffin/CounterStrikeSharp/releases" -ForegroundColor Yellow
}

# --------------------------- Metamod ----------------------------
if ($MetamodUrl) {
    try {
        Install-FromZip -Url $MetamodUrl -Name 'metamod'
    } catch {
        Write-Host "Metamod install failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host ""
    Write-Host "== Metamod:Source ==" -ForegroundColor Cyan
    Write-Host "   CounterStrikeSharp needs Metamod:Source, which is distributed without a stable direct link."
    Write-Host "   1) take a build here : https://www.metamodsource.net/downloads.php?branch=stable"
    Write-Host "   2) unpack the archive into: $CsgoDir"
    Write-Host "   3) or re-run this script with:  set METAMOD_URL=<zip url>  before it"
}

# --------------------------- PanelSkins ---------------------------
Write-Host ""
Write-Host "== PanelSkins (серверный скинченджер) ==" -ForegroundColor Cyan

$pluginSrc = Join-Path $PSScriptRoot 'plugins\PanelSkins'
$distDll   = Join-Path $pluginSrc 'dist\PanelSkins.dll'
$pluginDst = Join-Path $CsgoDir 'addons\counterstrikesharp\plugins\PanelSkins'
$gamedataDst = Join-Path $CsgoDir 'addons\counterstrikesharp\gamedata'

# готовой сборки в репозитории нет (например, скачали только исходники) — тянем её с GitHub
if (-not (Test-Path $distDll)) {
    try {
        Write-Host "   готовой DLL рядом нет — скачиваем сборку с GitHub"
        New-Item -ItemType Directory -Path (Split-Path $distDll) -Force | Out-Null
        $dllUrl = 'https://raw.githubusercontent.com/Relog404/relog.github.io/main/cs2-server/plugins/PanelSkins/dist/PanelSkins.dll'
        Invoke-WebRequest -Uri $dllUrl -OutFile $distDll
    } catch {
        Write-Host "   скачать не удалось: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# если DLL так и нет — пробуем собрать сами (нужен .NET 10 SDK)
if (-not (Test-Path $distDll)) {
    $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($dotnet) {
        try {
            Write-Host "   собираем плагин из исходников (dotnet build)"
            Push-Location $pluginSrc
            dotnet build -c Release
            $built = Join-Path $pluginSrc 'bin\Release\net10.0\PanelSkins.dll'
            if (Test-Path $built) {
                New-Item -ItemType Directory -Path (Split-Path $distDll) -Force | Out-Null
                Copy-Item $built $distDll -Force
            }
        } catch {
            Write-Host "   сборка не удалась: $($_.Exception.Message)" -ForegroundColor Yellow
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "   .NET SDK не найден и готовой DLL нет — поставьте .NET 10 SDK или возьмите" -ForegroundColor Yellow
        Write-Host "   готовую сборку: https://github.com/Relog404/relog.github.io/actions (артефакт PanelSkins)" -ForegroundColor Yellow
    }
}

if (Test-Path $distDll) {
    New-Item -ItemType Directory -Path $pluginDst -Force | Out-Null
    Copy-Item $distDll (Join-Path $pluginDst 'PanelSkins.dll') -Force

    $cfgDst = Join-Path $pluginDst 'PanelSkins.json'
    if (-not (Test-Path $cfgDst)) {
        Copy-Item (Join-Path $pluginSrc 'config.example.json') $cfgDst -Force
        Write-Host "   создан конфиг $cfgDst — укажите в нём PanelUrl и PluginKey" -ForegroundColor Yellow
    }

    New-Item -ItemType Directory -Path $gamedataDst -Force | Out-Null
    Copy-Item (Join-Path $pluginSrc 'gamedata\panelskins.json') (Join-Path $gamedataDst 'panelskins.json') -Force
    Write-Host "   плагин установлен: $pluginDst" -ForegroundColor Green
}

Write-Host ""
Write-Host "==== Next steps ====" -ForegroundColor Cyan
Write-Host "1) Check that $CsgoDir\addons\metamod exists (Metamod) and $CsgoDir\addons\counterstrikesharp (CSSharp)."
Write-Host "2) Fill in $CsgoDir\addons\counterstrikesharp\plugins\PanelSkins\PanelSkins.json (PanelUrl + PluginKey)."
Write-Host "3) Start the server: $InstallDir\start-cs2.bat"
Write-Host "4) In server console:  css_plugins list  (PanelSkins must be in the list)"
Write-Host ""
Write-Host "Plugins are server-side only: the server will be marked 'insecure' (VAC disabled on it) -"
Write-Host "that is the normal, officially tolerated mode for community servers with plugins."

Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
