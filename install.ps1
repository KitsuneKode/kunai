#Requires -Version 5
<#
.SYNOPSIS
  Kunai installer for Windows — binary-first, channel-aware.
.EXAMPLE
  irm https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.ps1 | iex
.EXAMPLE
  .\install.ps1 -Method binary -Version 1.2.3
.DESCRIPTION
  Installs Kunai only. After install, use `kunai upgrade` and `kunai uninstall`.
#>
[CmdletBinding()]
param(
  [ValidateSet('binary', 'npm', 'bun', 'source')]
  [string]$Method = 'binary',
  [string]$Version = 'latest',
  [switch]$Yes,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$DlBase = if ($env:KUNAI_DL_BASE) { $env:KUNAI_DL_BASE } else { 'https://github.com/KitsuneKode/kunai/releases' }
$ReleasesApi = if ($env:KUNAI_RELEASES_API) { $env:KUNAI_RELEASES_API } else { 'https://api.github.com/repos/KitsuneKode/kunai/releases/latest' }
$Package = '@kitsunekode/kunai'
$BinDir = Join-Path $env:LOCALAPPDATA 'kunai\bin'
$DataDir = Join-Path $env:LOCALAPPDATA 'kunai'
$ConfigDir = Join-Path $env:APPDATA 'kunai'
$BinPath = Join-Path $BinDir 'kunai.exe'
$VersionsDir = Join-Path $DataDir 'versions'

function Write-Info($m) { Write-Host "-> $m" }
function Write-Warn($m) { Write-Host "! $m" -ForegroundColor Yellow }
function Test-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Get-WindowsArch {
  if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64) {
    return 'arm64'
  }
  return 'x64'
}

function Get-ReleaseAssetName {
  param([string]$Arch = (Get-WindowsArch))
  if ($Arch -eq 'arm64') { return 'kunai-windows-arm64.exe' }
  return 'kunai-windows-x64.exe'
}

function Resolve-PublishedVersion {
  if ($DryRun -and $Version -eq 'latest') { return 'dry-run' }
  if ($Version -ne 'latest') { return $Version }
  $release = Invoke-RestMethod -Uri $ReleasesApi -Headers @{ 'user-agent' = 'kunai-installer' }
  $tag = [string]$release.tag_name
  if ($tag -match '(\d+\.\d+\.\d+)') { return $Matches[1] }
  throw 'Could not resolve the latest release version. Try -Version X.Y.Z or -Method npm.'
}

function Write-Manifest([string]$Channel, [string]$Ver, [string]$Bin, [string]$VersionPath = '', [string]$Layout = '') {
  if ($DryRun) { Write-Info "[dry-run] would write manifest ($Channel)"; return }
  New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
  $manifest = [ordered]@{
    channel     = $Channel
    version     = $Ver
    binPath     = $Bin
    dlBase      = $DlBase
    installedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  }
  if ($VersionPath) { $manifest.versionPath = $VersionPath }
  if ($Layout) { $manifest.layout = $Layout }
  $manifest | ConvertTo-Json | Set-Content -Path (Join-Path $ConfigDir 'install.json') -Encoding utf8
  Write-Info "Recorded install method ($Channel)."
}

function Broadcast-EnvironmentChange {
  if ($DryRun) { return }
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class KunaiEnvBroadcast {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam,
    uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
}
"@
  [UIntPtr]$ignore = [UIntPtr]::Zero
  [void][KunaiEnvBroadcast]::SendMessageTimeout(
    [IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$ignore)
}

function Add-UserPath([string]$Dir) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (($current -split ';') -notcontains $Dir) {
    $next = if ([string]::IsNullOrEmpty($current)) { $Dir } else { "$current;$Dir" }
    if ($DryRun) { Write-Info "[dry-run] would add $Dir to User PATH"; return }
    [Environment]::SetEnvironmentVariable('Path', $next, 'User')
    $env:Path = "$env:Path;$Dir"
    Broadcast-EnvironmentChange
    Write-Info "Added $Dir to your User PATH (new shells pick it up automatically)."
  }
}

function Install-OptionalDeps {
  $installMpv = $true
  if (-not $Yes -and -not $DryRun -and [Console]::IsInputRedirected -eq $false) {
    $reply = Read-Host 'Install mpv (required for playback)? [Y/n]'
    if ($reply -match '^[Nn]') { $installMpv = $false }
  }
  if (-not $installMpv) { return }
  if (Test-Cmd 'winget') {
    Invoke-Step 'winget install --id mpv.net -e' { winget install --id mpv.net -e --accept-package-agreements --accept-source-agreements }
    return
  }
  if (Test-Cmd 'scoop') {
    Invoke-Step 'scoop install mpv' { scoop install mpv }
    return
  }
  Write-Warn 'No winget/scoop found. Install mpv manually: https://mpv.io/installation/'

  $installYtDlp = $true
  if (-not $Yes -and -not $DryRun -and [Console]::IsInputRedirected -eq $false) {
    $reply = Read-Host 'Install yt-dlp (YouTube playback and downloads)? [Y/n]'
    if ($reply -match '^[Nn]') { $installYtDlp = $false }
  }
  if (-not $installYtDlp) { return }
  if (Test-Cmd 'winget') {
    Invoke-Step 'winget install yt-dlp' { winget install yt-dlp --accept-package-agreements --accept-source-agreements }
    return
  }
  if (Test-Cmd 'scoop') {
    Invoke-Step 'scoop install yt-dlp' { scoop install yt-dlp }
    return
  }
  Write-Warn 'No winget/scoop found. Install yt-dlp manually: https://github.com/yt-dlp/yt-dlp#installation'
}

function Install-Binary {
  $arch = Get-WindowsArch
  $asset = Get-ReleaseAssetName -Arch $arch
  $resolved = Resolve-PublishedVersion
  $base = if ($Version -eq 'latest') { "$DlBase/latest/download" } else { "$DlBase/download/v$Version" }
  $versionPath = Join-Path (Join-Path $VersionsDir $resolved) 'kunai.exe'

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Split-Path $versionPath) | Out-Null
  $tmp = Join-Path $BinDir '.kunai-new.exe'

  Write-Info "Downloading $asset (v$resolved) ..."
  if (-not $DryRun) {
    try {
      Invoke-WebRequest -Uri "$base/$asset" -OutFile $tmp -UseBasicParsing
      $sums = (Invoke-WebRequest -Uri "$base/SHA256SUMS" -UseBasicParsing).Content
    }
    catch {
      Write-Warn "Download failed for $asset."
      Write-Warn 'Try: -Method npm | -Method bun | -Method source'
      Write-Warn 'Or pin a version: -Version X.Y.Z'
      throw
    }
    $want = ($sums -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape($asset))$" }) -replace '\s.*', ''
    $got = (Get-FileHash -Path $tmp -Algorithm SHA256).Hash.ToLower()
    if ([string]::IsNullOrEmpty($want) -or $want -ne $got) {
      Remove-Item $tmp -Force -ErrorAction SilentlyContinue
      throw "Checksum mismatch for $asset (expected '$want', got '$got')."
    }
    Unblock-File -Path $tmp
    Move-Item -Force -Path $tmp -Destination $versionPath
    Copy-Item -Force -Path $versionPath -Destination $BinPath
  }
  else {
    Write-Info "[dry-run] would download, verify SHA256, install to $versionPath and $BinPath"
  }

  Add-UserPath $BinDir
  Write-Manifest 'binary' $resolved $BinPath $versionPath 'versioned'
  Write-Info "Installed kunai -> $BinPath (v$resolved at $versionPath)"
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

Write-Host 'Kunai installer' -ForegroundColor Cyan

switch ($Method) {
  'binary' { Install-Binary }
  'npm' {
    Install-Bun
    Invoke-Step "npm install -g $Package" { & npm install -g $Package }
    Write-Manifest 'npm-global' (Resolve-PublishedVersion) 'kunai'
  }
  'bun' {
    Install-Bun
    Invoke-Step "bun install -g $Package" { & bun install -g $Package }
    Write-Manifest 'bun-global' (Resolve-PublishedVersion) 'kunai'
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
    Write-Manifest 'source' (Resolve-PublishedVersion) 'kunai'
  }
}

if ($Method -eq 'binary') {
  Install-OptionalDeps
}

Write-Host 'Done.' -ForegroundColor Green
Write-Host 'Try:  kunai -S "Frieren" -a'
Write-Host 'Update any time:  kunai upgrade'
Write-Host 'Remove:          kunai uninstall'
