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

Write-Host ""
Write-Host "==== Next steps ====" -ForegroundColor Cyan
Write-Host "1) Check that $CsgoDir\addons\metamod exists (Metamod) and $CsgoDir\addons\counterstrikesharp (CSSharp)."
Write-Host "2) Start the server: $InstallDir\start-cs2.bat"
Write-Host "3) In server console:  css_plugins list"
Write-Host ""
Write-Host "Plugins are server-side only: the server will be marked 'insecure' (VAC disabled on it) -"
Write-Host "that is the normal, officially tolerated mode for community servers with plugins."

Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
