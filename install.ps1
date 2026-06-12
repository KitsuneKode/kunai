#Requires -Version 5
<#
.SYNOPSIS
  Kunai installer for Windows — binary-first, channel-aware.
.EXAMPLE
  irm https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.ps1 | iex
.EXAMPLE
  .\install.ps1 -Method binary -Version 1.2.3
  .\install.ps1 -Upgrade
  .\install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [ValidateSet('binary', 'npm', 'bun', 'source')]
  [string]$Method = 'binary',
  [string]$Version = 'latest',
  [switch]$Upgrade,
  [switch]$Uninstall,
  [switch]$Yes,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$DlBase = if ($env:KUNAI_DL_BASE) { $env:KUNAI_DL_BASE } else { 'https://github.com/KitsuneKode/kunai/releases' }
$Package = '@kitsunekode/kunai'
$BinDir = Join-Path $env:LOCALAPPDATA 'kunai\bin'
$ConfigDir = Join-Path $env:APPDATA 'kunai'
$BinPath = Join-Path $BinDir 'kunai.exe'

function Write-Info($m) { Write-Host "-> $m" }
function Write-Warn($m) { Write-Host "! $m" -ForegroundColor Yellow }
function Test-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Write-Manifest([string]$Channel, [string]$Ver, [string]$Bin) {
  if ($DryRun) { Write-Info "[dry-run] would write manifest ($Channel)"; return }
  New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
  $manifest = [ordered]@{
    channel     = $Channel
    version     = $Ver
    binPath     = $Bin
    dlBase      = $DlBase
    installedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  }
  $manifest | ConvertTo-Json | Set-Content -Path (Join-Path $ConfigDir 'install.json') -Encoding utf8
  Write-Info "Recorded install method ($Channel)."
}

function Add-UserPath([string]$Dir) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (($current -split ';') -notcontains $Dir) {
    $next = if ([string]::IsNullOrEmpty($current)) { $Dir } else { "$current;$Dir" }
    if ($DryRun) { Write-Info "[dry-run] would add $Dir to User PATH"; return }
    [Environment]::SetEnvironmentVariable('Path', $next, 'User')
    $env:Path = "$env:Path;$Dir"
    Write-Info "Added $Dir to your User PATH (new shells pick it up automatically)."
  }
}

function Install-Binary {
  $asset = 'kunai-windows-x64.exe'
  $base = if ($Version -eq 'latest') { "$DlBase/latest/download" } else { "$DlBase/download/v$Version" }

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $tmp = Join-Path $BinDir '.kunai-new.exe'

  Write-Info "Downloading $asset ..."
  if (-not $DryRun) {
    Invoke-WebRequest -Uri "$base/$asset" -OutFile $tmp -UseBasicParsing
    $sums = (Invoke-WebRequest -Uri "$base/SHA256SUMS" -UseBasicParsing).Content
    $want = ($sums -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape($asset))$" }) -replace '\s.*', ''
    $got = (Get-FileHash -Path $tmp -Algorithm SHA256).Hash.ToLower()
    if ([string]::IsNullOrEmpty($want) -or $want -ne $got) {
      Remove-Item $tmp -Force -ErrorAction SilentlyContinue
      throw "Checksum mismatch for $asset (expected '$want', got '$got')."
    }
    Unblock-File -Path $tmp
    Move-Item -Force -Path $tmp -Destination $BinPath
  }
  else {
    Write-Info "[dry-run] would download, verify SHA256, and install to $BinPath"
  }

  Add-UserPath $BinDir
  Write-Manifest 'binary' $Version $BinPath
  Write-Info "Installed kunai -> $BinPath"
}

function Install-Bun {
  if (-not (Test-Cmd 'bun')) {
    if ($DryRun) { Write-Info '[dry-run] would install Bun from bun.sh' }
    else { Invoke-RestMethod -Uri 'https://bun.sh/install.ps1' | Invoke-Expression }
  }
}

function Invoke-Step([string]$Description, [scriptblock]$Action) {
  if ($DryRun) { Write-Info "[dry-run] $Description" } else { & $Action }
}

if ($Upgrade) {
  if (Test-Cmd 'kunai') { & kunai upgrade; exit $LASTEXITCODE }
  throw 'kunai is not installed yet. Run the installer first.'
}

if ($Uninstall) {
  if (Test-Cmd 'kunai') { & kunai --uninstall; exit $LASTEXITCODE }
  Remove-Item -Force -Path $BinPath -ErrorAction SilentlyContinue
  Write-Info "Removed $BinPath. Config/data left in place: $ConfigDir"
  exit 0
}

Write-Host 'Kunai installer' -ForegroundColor Cyan

switch ($Method) {
  'binary' { Install-Binary }
  'npm' {
    Install-Bun
    Invoke-Step "npm install -g $Package" { & npm install -g $Package }
    Write-Manifest 'npm-global' $Version 'kunai'
  }
  'bun' {
    Install-Bun
    Invoke-Step "bun install -g $Package" { & bun install -g $Package }
    Write-Manifest 'bun-global' $Version 'kunai'
  }
  'source' {
    Install-Bun
    $src = Join-Path $env:LOCALAPPDATA 'kunai\src'
    Invoke-Step "git clone Kunai into $src" {
      if (Test-Path (Join-Path $src '.git')) { & git -C $src pull --ff-only }
      else { & git clone --depth 1 'https://github.com/KitsuneKode/kunai.git' $src }
      Push-Location $src
      & bun install; & bun run build; & bun run link:global
      Pop-Location
    }
    Write-Manifest 'source' $Version 'kunai'
  }
}

Write-Host 'Done.' -ForegroundColor Green
Write-Host 'Try:  kunai -S "Frieren" -a'
Write-Host 'Update any time:  kunai upgrade'
Write-Host 'Remove:          kunai --uninstall'
