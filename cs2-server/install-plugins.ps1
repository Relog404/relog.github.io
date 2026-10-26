# =============================================================
#  CounterStrikeSharp / Metamod:Source installer for CS2 (Windows)
#  Run:  powershell -ExecutionPolicy Bypass -File install-plugins.ps1 -InstallDir C:\cs2-server
# =============================================================
param(
    [string]$InstallDir = "$env:USERPROFILE\cs2-server",
    [string]$CssUrl = '',
    [string]$MetamodUrl = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# GitHub не отдаёт файлы по старому TLS - включаем 1.2 явно
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

# CS2 кладёт игру в <install_dir>\game\game\csgo - но проверяем и старую раскладку
$CsgoDir = Join-Path $InstallDir 'game\game\csgo'
if (-not (Test-Path $CsgoDir)) {
    $alt = Join-Path $InstallDir 'game\csgo'
    if (Test-Path $alt) { $CsgoDir = $alt }
}
if (-not (Test-Path $CsgoDir)) {
    Write-Host "ERROR: $CsgoDir not found. Run install-cs2-server.bat first." -ForegroundColor Red
    exit 1
}
Write-Host "Папка игры: $CsgoDir"

$Tmp = Join-Path $env:TEMP ("cs2-plugins-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp -Force | Out-Null

function Get-File {
    param([string]$Url, [string]$OutFile)
    for ($i = 1; $i -le 3; $i++) {
        Write-Host "   попытка $i/3"
        $ok = $false
        try {
            Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
            $ok = $true
        } catch {
            Write-Host "     Invoke-WebRequest: $($_.Exception.Message)" -ForegroundColor Yellow
        }
        if (-not $ok) {
            try {
                (New-Object System.Net.WebClient).DownloadFile($Url, $OutFile)
                $ok = $true
            } catch {
                Write-Host "     WebClient: $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
        if (-not $ok) {
            try {
                & curl.exe -L -s -S -o $OutFile $Url
                if ($LASTEXITCODE -eq 0) { $ok = $true } else { Write-Host "     curl.exe код $LASTEXITCODE" -ForegroundColor Yellow }
            } catch {
                Write-Host "     curl.exe: $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
        if ($ok) {
            $size = (Get-Item $OutFile -ErrorAction SilentlyContinue).Length
            if ($size -gt 500KB) {
                Write-Host ("   скачано " + [math]::Round($size / 1MB, 1) + " МБ")
                return
            }
            Write-Host "   скачалось слишком мало ($size байт) - повторяю" -ForegroundColor Yellow
        }
        Start-Sleep -Seconds 3
    }
    throw "не удалось скачать $Url"
}

function Install-FromZip {
    param([string]$Url, [string]$Name)
    Write-Host ""
    Write-Host "== $Name ==" -ForegroundColor Cyan
    Write-Host "   $Url"
    $zip = Join-Path $Tmp ($Name + '.zip')
    $dest = Join-Path $Tmp $Name
    Get-File -Url $Url -OutFile $zip
    Expand-Archive -Force -Path $zip -DestinationPath $dest
    $addons = Join-Path $dest 'addons'
    if (-not (Test-Path $addons)) { throw "в архиве $Name нет папки addons" }
    $target = Join-Path $CsgoDir 'addons'
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Get-ChildItem -Path $addons | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination $target -Recurse -Force
    }
    Write-Host "   распаковано в $target" -ForegroundColor Green
}

function Test-HasDll {
    param([string]$Dir)
    if (-not (Test-Path $Dir)) { return $false }
    $n = (Get-ChildItem -Path $Dir -Recurse -Filter *.dll -ErrorAction SilentlyContinue | Measure-Object).Count
    return ($n -gt 0)
}

# версии зафиксированы: именно с ними собран PanelSkins.dll и проверен CS2 10955
if (-not $MetamodUrl) {
    $MetamodUrl = 'https://github.com/alliedmodders/metamod-source/releases/download/2.0.0.1483/mmsource-2.0.0-git1483-windows.zip'
}
if (-not $CssUrl) {
    $CssUrl = 'https://github.com/roflmuffin/CounterStrikeSharp/releases/download/v1.0.377/counterstrikesharp-with-runtime-windows-1.0.377.zip'
}

$mmDir  = Join-Path $CsgoDir 'addons\metamod'
$cssDir = Join-Path $CsgoDir 'addons\counterstrikesharp'
$fail = $false

# --------------------------- Metamod ----------------------------
if (Test-HasDll $mmDir) {
    Write-Host ""
    Write-Host "== Metamod ==" -ForegroundColor Cyan
    Write-Host "   уже установлен: $mmDir"
} else {
    try {
        Install-FromZip -Url $MetamodUrl -Name 'metamod'
    } catch {
        $fail = $true
        Write-Host ""
        Write-Host "METAMOD НЕ УСТАНОВЛЕН: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Вручную: https://github.com/alliedmodders/metamod-source/releases" -ForegroundColor Yellow
        Write-Host "  файл mmsource-2.0.0-git1483-windows.zip, папку addons распаковать в $CsgoDir" -ForegroundColor Yellow
    }
}

# ---------------------- CounterStrikeSharp ----------------------
# сборка with-runtime: .NET внутри, ничего ставить руками не надо
if (Test-HasDll $cssDir) {
    Write-Host ""
    Write-Host "== CounterStrikeSharp ==" -ForegroundColor Cyan
    Write-Host "   уже установлен: $cssDir"
} else {
    try {
        Install-FromZip -Url $CssUrl -Name 'counterstrikesharp'
    } catch {
        $fail = $true
        Write-Host ""
        Write-Host "COUNTERSTRIKESHARP НЕ УСТАНОВЛЕН: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Вручную: https://github.com/roflmuffin/CounterStrikeSharp/releases" -ForegroundColor Yellow
        Write-Host "  файл counterstrikesharp-with-runtime-windows-1.0.377.zip, папку addons распаковать в $CsgoDir" -ForegroundColor Yellow
    }
}

# metamod подхватывает CSSharp через vdf; в архивах его иногда нет - создаём сами
$cssVdf = Join-Path $mmDir 'counterstrikesharp.vdf'
if ((Test-Path (Join-Path $cssDir 'bin\win64\counterstrikesharp.dll')) -and -not (Test-Path $cssVdf)) {
    New-Item -ItemType Directory -Path $mmDir -Force | Out-Null
    $vdfText = @'
"Metamod Plugin"
{
	"alias"		"counterstrikesharp"
	"file"		"addons/counterstrikesharp/bin/win64/counterstrikesharp"
}
'@
    [IO.File]::WriteAllText($cssVdf, ($vdfText -replace "`n", "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "   создан $cssVdf - без него metamod не подхватит CSSharp" -ForegroundColor Green
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


# --------------------------- проверка ---------------------------
# Metamod для CS2 подменяет server.dll через GAMEBIN, поэтому смотрим, что реально лежит
$addonsDir = Join-Path $CsgoDir 'addons'
$mmBin     = Join-Path $mmDir  'bin\win64'
$cssBin    = Join-Path $cssDir 'bin\win64'
$mmDlls  = @()
$cssDlls = @()
if (Test-Path $mmBin)  { $mmDlls  = @(Get-ChildItem -Path $mmBin  -Filter *.dll -ErrorAction SilentlyContinue) }
if (Test-Path $cssBin) { $cssDlls = @(Get-ChildItem -Path $cssBin -Filter *.dll -ErrorAction SilentlyContinue) }

Write-Host ""
Write-Host "==== Проверка ====" -ForegroundColor Cyan
Write-Host "  $addonsDir :"
Get-ChildItem -Path $addonsDir -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ("    " + $_.Name) }
Write-Host "  addons\metamod\bin\win64 :"
if ($mmDlls.Count -eq 0) { Write-Host "    ПУСТО" -ForegroundColor Red }
$mmDlls | ForEach-Object { Write-Host ("    " + $_.Name + " (" + [math]::Round($_.Length / 1KB) + " КБ)") }
Write-Host "  addons\counterstrikesharp\bin\win64 :"
if ($cssDlls.Count -eq 0) { Write-Host "    ПУСТО" -ForegroundColor Red }
$cssDlls | ForEach-Object { Write-Host ("    " + $_.Name + " (" + [math]::Round($_.Length / 1KB) + " КБ)") }
Write-Host ("  metamod\counterstrikesharp.vdf : " + (Test-Path (Join-Path $mmDir 'counterstrikesharp.vdf')))
$giHasMm = $false
if (Test-Path $gameinfo) { $giHasMm = ((Get-Content $gameinfo -Raw) -match 'csgo[\\/]addons[\\/]metamod') }
Write-Host ("  gameinfo.gi путь к metamod     : " + $giHasMm)

if ($mmDlls.Count -eq 0) {
    Write-Host ""
    Write-Host "Metamod не установлен - плагины не загрузятся." -ForegroundColor Red
    Write-Host "Инструкции по ручной установке - выше." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
    exit 1
}
Write-Host ""
Write-Host "Всё на месте. Запускайте сервер: $InstallDir\start-cs2.bat" -ForegroundColor Green

Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
