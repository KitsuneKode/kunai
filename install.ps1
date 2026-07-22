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
Add-Type -AssemblyName System.Net.Http

$DlBase = if ($env:KUNAI_DL_BASE) { $env:KUNAI_DL_BASE } else { 'https://github.com/KitsuneKode/kunai/releases' }
$ReleasesApi = if ($env:KUNAI_RELEASES_API) { $env:KUNAI_RELEASES_API } else { 'https://api.github.com/repos/KitsuneKode/kunai/releases/latest' }
$Package = '@kitsunekode/kunai'
$BinDir = if ($env:KUNAI_BIN_DIR) { $env:KUNAI_BIN_DIR } else { Join-Path $env:LOCALAPPDATA 'kunai\bin' }
$DataDir = if ($env:KUNAI_DATA_DIR) { $env:KUNAI_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'kunai' }
$ConfigDir = if ($env:KUNAI_CONFIG_DIR) { $env:KUNAI_CONFIG_DIR } else { Join-Path $env:APPDATA 'kunai' }
$CacheDir = if ($env:KUNAI_CACHE_DIR) { $env:KUNAI_CACHE_DIR } else { Join-Path $env:LOCALAPPDATA 'kunai\cache' }
$BinPath = Join-Path $BinDir 'kunai.exe'
$VersionsDir = Join-Path $DataDir 'versions'
$LocksDir = Join-Path $DataDir 'locks'
$TransactionsDir = Join-Path $DataDir 'transactions'
$StagingRoot = Join-Path $CacheDir 'staging'

# Bounded download policy (mirrors DEFAULT_BINARY_DOWNLOAD_POLICY).
$DownloadConnectTimeoutSec = if ($env:KUNAI_DOWNLOAD_CONNECT_TIMEOUT) { [int]$env:KUNAI_DOWNLOAD_CONNECT_TIMEOUT } else { 15 }
$DownloadTotalSeconds = if ($env:KUNAI_DOWNLOAD_TOTAL_SECONDS) { [int]$env:KUNAI_DOWNLOAD_TOTAL_SECONDS } else { 300 }
$DownloadStallMs = if ($env:KUNAI_DOWNLOAD_STALL_MS) { [int]$env:KUNAI_DOWNLOAD_STALL_MS } else { 30000 }
$DownloadMaxBytes = if ($env:KUNAI_DOWNLOAD_MAX_BYTES) { [long]$env:KUNAI_DOWNLOAD_MAX_BYTES } else { 268435456 }
$DownloadChecksumMaxBytes = if ($env:KUNAI_DOWNLOAD_CHECKSUM_MAX_BYTES) { [long]$env:KUNAI_DOWNLOAD_CHECKSUM_MAX_BYTES } else { 1048576 }
$DownloadMaxAttempts = if ($env:KUNAI_DOWNLOAD_MAX_ATTEMPTS) { [int]$env:KUNAI_DOWNLOAD_MAX_ATTEMPTS } else { 3 }
$DownloadRetryBaseMs = if ($env:KUNAI_DOWNLOAD_RETRY_BASE_MS) { [int]$env:KUNAI_DOWNLOAD_RETRY_BASE_MS } else { 1000 }

function Write-Utf8File([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Write-Info($m) { Write-Host "-> $m" }
function Write-Warn($m) { Write-Host "! $m" -ForegroundColor Yellow }
function Test-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Test-CanonicalVersion([string]$Value) {
  return [bool]($Value -match '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')
}

function Get-NormalizedVersion([string]$Value) {
  $trimmed = $Value.Trim()
  if ($trimmed.StartsWith('v') -or $trimmed.StartsWith('V')) {
    $trimmed = $trimmed.Substring(1)
  }
  if (-not (Test-CanonicalVersion $trimmed)) {
    throw "Invalid version: $Value (expected exact major.minor.patch)."
  }
  return $trimmed
}

function Read-KunaiPackageVersion([string]$PackageRoot) {
  $pkgJson = Join-Path $PackageRoot (Join-Path $Package 'package.json')
  if (Test-Path -LiteralPath $pkgJson) {
    try {
      $pkg = Get-Content -LiteralPath $pkgJson -Raw | ConvertFrom-Json
      if ($pkg.name -eq $Package -and $pkg.version) {
        return (Get-NormalizedVersion ([string]$pkg.version))
      }
    }
    catch { }
  }
  return $null
}

function Resolve-InstalledPackageVersion([string]$InstallMethod) {
  if ($InstallMethod -eq 'npm') {
    $global:LASTEXITCODE = $null
    $root = (& npm root -g 2>$null | Select-Object -First 1)
    if ($global:LASTEXITCODE -eq 0 -and $root) {
      $version = Read-KunaiPackageVersion ([string]$root)
      if ($version) { return $version }
    }
  }
  elseif ($InstallMethod -eq 'bun') {
    $bunRoot = if ($env:BUN_INSTALL) { $env:BUN_INSTALL } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.bun' }
    $root = Join-Path $bunRoot 'install\global\node_modules'
    $version = Read-KunaiPackageVersion $root
    if ($version) { return $version }
  }
  elseif ($InstallMethod -eq 'source') {
    $src = if ($env:KUNAI_SOURCE_DIR) { $env:KUNAI_SOURCE_DIR } else { Join-Path $env:LOCALAPPDATA 'kunai\src' }
    $version = Read-KunaiPackageVersion $src
    if ($version) { return $version }
  }
  throw "Could not resolve installed Kunai version from $InstallMethod-owned package metadata."
}

function Complete-PackageActiveVersion([string]$InstallMethod, [string]$Resolved) {
  if ($DryRun) {
    if ($Resolved -eq 'latest') { return 'dry-run' }
    return $Resolved
  }
  $observed = Resolve-InstalledPackageVersion $InstallMethod
  if ($Resolved -ne 'latest' -and $observed -ne $Resolved) {
    throw "Installed Kunai version $observed does not match requested $Resolved."
  }
  return $observed
}

function Get-IsoNow {
  return (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}

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
  if ($Version -ne 'latest') { return (Get-NormalizedVersion $Version) }
  $release = Invoke-RestMethod -Uri $ReleasesApi -Headers @{ 'user-agent' = 'kunai-installer' }
  $tag = [string]$release.tag_name
  return (Get-NormalizedVersion $tag)
}

function Test-RetryableHttpStatus([int]$Status) {
  return ($Status -eq 408 -or $Status -eq 429 -or $Status -ge 500)
}

function Invoke-BoundedDownload {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$DestinationPath,
    [Parameter(Mandatory = $true)][long]$MaxBytes,
    [string]$Label = 'download'
  )

  $started = [DateTime]::UtcNow
  $attempt = 1
  while ($attempt -le $DownloadMaxAttempts) {
    $elapsed = ([DateTime]::UtcNow - $started).TotalSeconds
    $remainingSec = [Math]::Max(0, $DownloadTotalSeconds - [int][Math]::Floor($elapsed))
    if ($remainingSec -le 0) {
      throw "Download total deadline exceeded for $Label."
    }

    if (Test-Path -LiteralPath $DestinationPath) {
      Remove-Item -LiteralPath $DestinationPath -Force -ErrorAction SilentlyContinue
    }

    $handler = [System.Net.Http.HttpClientHandler]::new()
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds([Math]::Max($remainingSec, 1))
    $cts = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds([Math]::Max($remainingSec, 1)))

    try {
      $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $Url)
      $request.Headers.TryAddWithoutValidation('User-Agent', 'kunai-installer') | Out-Null
      $response = $client.SendAsync(
        $request,
        [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead,
        $cts.Token
      ).GetAwaiter().GetResult()

      $status = [int]$response.StatusCode
      if ($status -lt 200 -or $status -ge 300) {
        if ((Test-RetryableHttpStatus $status) -and $attempt -lt $DownloadMaxAttempts) {
          Write-Info "Retrying $Label (attempt $($attempt + 1)/$DownloadMaxAttempts) after HTTP $status..."
          Start-Sleep -Milliseconds ($DownloadRetryBaseMs * $attempt)
          $attempt++
          continue
        }
        throw "Download failed for $Label with HTTP $status."
      }

      if ($null -ne $response.Content.Headers.ContentLength -and $response.Content.Headers.ContentLength -gt $MaxBytes) {
        throw "Download for $Label exceeds max size ($($response.Content.Headers.ContentLength) > $MaxBytes)."
      }

      $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
      $outStream = [System.IO.File]::Open(
        $DestinationPath,
        [System.IO.FileMode]::Create,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
      )
      try {
        $buffer = New-Object byte[] 8192
        $total = [long]0
        $lastProgress = [DateTime]::UtcNow
        while ($true) {
          $readTask = $stream.ReadAsync($buffer, 0, $buffer.Length, $cts.Token)
          if (-not $readTask.Wait($DownloadStallMs, $cts.Token)) {
            throw "Download stalled for $Label (no progress within ${DownloadStallMs}ms)."
          }
          $read = $readTask.Result
          if ($read -le 0) { break }
          $total += $read
          if ($total -gt $MaxBytes) {
            throw "Download for $Label exceeds max size ($total > $MaxBytes)."
          }
          $outStream.Write($buffer, 0, $read)
          $lastProgress = [DateTime]::UtcNow
          if (([DateTime]::UtcNow - $lastProgress).TotalMilliseconds -gt $DownloadStallMs) {
            throw "Download stalled for $Label."
          }
        }
        if ($total -le 0) {
          throw "Downloaded asset $Label is empty; the release is incomplete."
        }
        return
      }
      finally {
        $outStream.Dispose()
        $stream.Dispose()
        $response.Dispose()
      }
    }
    catch {
      if (Test-Path -LiteralPath $DestinationPath) {
        Remove-Item -LiteralPath $DestinationPath -Force -ErrorAction SilentlyContinue
      }
      $msg = $_.Exception.Message
      $retryable = $msg -match 'stall|timeout|network|temporarily|HTTP 5|HTTP 408|HTTP 429' -or
        ($_.Exception -is [System.Net.Http.HttpRequestException])
      if ($retryable -and $attempt -lt $DownloadMaxAttempts -and $msg -notmatch 'empty|exceeds max size|HTTP 404|HTTP 4[0-9][0-9]') {
        if ($msg -match 'HTTP (4\d\d)' -and -not (Test-RetryableHttpStatus ([int]$Matches[1]))) {
          throw
        }
        Write-Info "Retrying $Label (attempt $($attempt + 1)/$DownloadMaxAttempts)..."
        Start-Sleep -Milliseconds ($DownloadRetryBaseMs * $attempt)
        $attempt++
        continue
      }
      throw
    }
    finally {
      $cts.Dispose()
      $client.Dispose()
      $handler.Dispose()
    }
  }
  throw "Download failed for $Label after $DownloadMaxAttempts attempts."
}

function Write-Manifest(
  [string]$MethodName,
  [string]$Ver,
  [string]$Launcher,
  [string]$VersionPath = '',
  [string]$Target = '',
  [string]$Sha256 = '',
  [string]$PreviousVersion = ''
) {
  if ($DryRun) { Write-Info "[dry-run] would write schema-1 manifest ($MethodName)"; return }
  New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
  $manifestPath = Join-Path $ConfigDir 'install.json'
  $now = Get-IsoNow
  $installedAt = $now
  if (Test-Path -LiteralPath $manifestPath) {
    try {
      $existing = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
      if ($existing.installedAt) { $installedAt = [string]$existing.installedAt }
    }
    catch { }
  }

  $managedPaths = @()
  if ($MethodName -eq 'binary') {
    $managedPaths = @($DataDir, $CacheDir)
  }

  $manifest = [ordered]@{
    schemaVersion     = 1
    method            = $MethodName
    activeVersion     = $Ver
    preferredChannel  = 'stable'
    launcherPath      = $Launcher
    managedPaths      = $managedPaths
    downloadBaseUrl   = $DlBase
    installedAt       = $installedAt
    updatedAt         = $now
  }
  if ($VersionPath) { $manifest.versionedPath = $VersionPath }
  if ($PreviousVersion) { $manifest.previousVersion = $PreviousVersion }
  if ($Target) { $manifest.target = $Target }
  if ($Sha256) { $manifest.artifactSha256 = $Sha256 }

  $tmp = "$manifestPath.tmp-$PID"
  Write-Utf8File $tmp (($manifest | ConvertTo-Json -Depth 6) + "`n")
  Move-Item -Force -Path $tmp -Destination $manifestPath
  Write-Info "Recorded install method ($MethodName)."
}

function Write-VersionMetadata {
  param(
    [string]$Ver,
    [string]$Target,
    [string]$ArtifactName,
    [string]$Sha256,
    [long]$SizeBytes,
    [string]$SourceUrl,
    [string]$Path
  )
  $meta = [ordered]@{
    schemaVersion   = 1
    version         = $Ver
    target          = $Target
    artifactName    = $ArtifactName
    artifactSha256  = $Sha256.ToLowerInvariant()
    sizeBytes       = $SizeBytes
    sourceUrl       = $SourceUrl
    verification    = 'release-checksum'
    installedAt     = (Get-IsoNow)
  }
  $tmp = "$Path.tmp-$PID"
  New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
  Write-Utf8File $tmp (($meta | ConvertTo-Json -Depth 4) + "`n")
  Move-Item -Force -Path $tmp -Destination $Path
}

function Acquire-VersionLock([string]$Ver, [string]$LockPath) {
  New-Item -ItemType Directory -Force -Path (Split-Path $LockPath) | Out-Null
  if (Test-Path -LiteralPath $LockPath) {
    try {
      $existing = Get-Content -LiteralPath $LockPath -Raw | ConvertFrom-Json
      $holder = [int]$existing.pid
      if ($holder -gt 0) {
        try {
          Get-Process -Id $holder -ErrorAction Stop | Out-Null
          throw "Install lock held by pid $holder for version $Ver"
        }
        catch [System.Management.Automation.ProcessCommandException] { }
        catch {
          if ($_.Exception.Message -match 'held by pid') { throw }
        }
      }
    }
    catch {
      if ($_.Exception.Message -match 'held by pid') { throw }
    }
    Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
  }
  $content = @{
    pid        = $PID
    version    = $Ver
    execPath   = 'install.ps1'
    acquiredAt = (Get-IsoNow)
  }
  Write-Utf8File $LockPath (($content | ConvertTo-Json -Compress) + "`n")
}

function Release-VersionLock([string]$LockPath) {
  if (-not (Test-Path -LiteralPath $LockPath)) { return }
  try {
    $existing = Get-Content -LiteralPath $LockPath -Raw | ConvertFrom-Json
    if ([int]$existing.pid -eq $PID) {
      Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
    }
  }
  catch {
    Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
  }
}

function Begin-InstallTransaction([string]$Id, [string]$Kind, [string]$Ver, [string]$Staging, [string]$Path) {
  New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
  $record = [ordered]@{
    schemaVersion = 1
    id            = $Id
    kind          = $Kind
    pid           = $PID
    version       = $Ver
    stagingDir    = $Staging
    startedAt     = (Get-IsoNow)
  }
  Write-Utf8File $Path (($record | ConvertTo-Json -Depth 4) + "`n")
}

function Finish-InstallTransaction([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  }
}

function Update-Launcher([string]$VersionPath, [string]$LauncherPath) {
  New-Item -ItemType Directory -Force -Path (Split-Path $LauncherPath) | Out-Null
  if (Test-Path -LiteralPath $LauncherPath) {
    $aside = "$LauncherPath.old.$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
    try {
      Move-Item -Force -Path $LauncherPath -Destination $aside
    }
    catch {
      Remove-Item -LiteralPath $LauncherPath -Force -ErrorAction SilentlyContinue
    }
  }
  Copy-Item -Force -Path $VersionPath -Destination $LauncherPath
  Unblock-File -Path $LauncherPath -ErrorAction SilentlyContinue
}

function Get-PreviousActiveVersion {
  $manifestPath = Join-Path $ConfigDir 'install.json'
  if (-not (Test-Path -LiteralPath $manifestPath)) { return $null }
  try {
    $existing = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $ver = $null
    if ($existing.activeVersion) { $ver = [string]$existing.activeVersion }
    elseif ($existing.version) { $ver = [string]$existing.version }
    if ($ver -and (Test-CanonicalVersion $ver)) { return $ver }
  }
  catch { }
  return $null
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

function Get-KunaiPathCandidates {
  [OutputType([string[]])]
  param()

  $pathValue = if ($null -eq $env:Path) { '' } else { $env:Path }
  $pathExtensions = if ([string]::IsNullOrWhiteSpace($env:PATHEXT)) {
    @('.COM', '.EXE', '.BAT', '.CMD')
  }
  else {
    @($env:PATHEXT -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  }
  $seen = @{}
  $candidates = New-Object 'System.Collections.Generic.List[string]'

  foreach ($pathEntry in ($pathValue -split ';')) {
    $directory = $pathEntry.Trim()
    if ([string]::IsNullOrWhiteSpace($directory)) { continue }

    foreach ($extension in $pathExtensions) {
      try {
        $candidate = [System.IO.Path]::GetFullPath((Join-Path $directory "kunai$extension"))
      }
      catch {
        continue
      }
      if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }

      $canonicalKey = $candidate.ToLowerInvariant()
      if ($seen.ContainsKey($canonicalKey)) { continue }
      $seen[$canonicalKey] = $true
      [void]$candidates.Add($candidate)
    }
  }

  return $candidates.ToArray()
}

function Write-KunaiPathDiagnostic {
  param([string]$InstalledPath)

  $candidates = @(Get-KunaiPathCandidates)
  $winner = if ($candidates.Count -gt 0) { $candidates[0] } else { $null }
  $winnerText = if ($null -eq $winner) { '(none)' } else { $winner }
  Write-Info "PATH winner: $winnerText"

  if ($null -eq $winner -or -not [string]::Equals($winner, $InstalledPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Info "Planned native path: $InstalledPath"
    if ($null -eq $winner) {
      Write-Warn 'No kunai executable is currently found on PATH.'
      Write-Info "Add $BinDir to PATH if you want the native install to win."
    }
    elseif ($winner -match '[\\/]npm[\\/]kunai\.(com|exe|bat|cmd)$') {
      Write-Warn 'A stale npm shim is earlier in PATH.'
      Write-Info "After confirming it is unused: npm uninstall -g $Package"
    }
    else {
      Write-Info "Move $BinDir ahead of $winner in PATH if you want the native install to win."
    }
    Write-Info 'Reopen your shell, then run: Get-Command kunai -All'
  }
}

function Install-OptionalDeps {
  $installMpv = $true
  if (-not $Yes -and -not $DryRun -and [Console]::IsInputRedirected -eq $false) {
    $reply = Read-Host 'Install mpv (required for playback)? [Y/n]'
    if ($reply -match '^[Nn]') { $installMpv = $false }
  }
  if ($installMpv) {
    if (Test-Cmd 'winget') {
      Invoke-Step 'winget install --id mpv.net -e' { winget install --id mpv.net -e --accept-package-agreements --accept-source-agreements }
    }
    elseif (Test-Cmd 'scoop') {
      Invoke-Step 'scoop install mpv' { scoop install mpv }
    }
    else {
      Write-Warn 'No winget/scoop found. Install mpv manually: https://mpv.io/installation/'
    }
  }

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
  if ($Version -ne 'latest') {
    $null = Get-NormalizedVersion $Version
  }

  $arch = Get-WindowsArch
  $asset = Get-ReleaseAssetName -Arch $arch
  $resolved = Resolve-PublishedVersion
  $base = "$DlBase/download/v$resolved"
  $versionPath = Join-Path (Join-Path $VersionsDir $resolved) 'kunai.exe'
  $target = "windows-$arch"
  $url = "$base/$asset"
  $sumsUrl = "$base/SHA256SUMS"

  Write-Info "Downloading $asset (v$resolved) ..."
  if ($DryRun) {
    Write-Info "[dry-run] would download (bounded HttpClient), verify SHA256, install to $versionPath and $BinPath"
    Write-Manifest 'binary' $resolved $BinPath $versionPath $target
    return
  }

  $previous = Get-PreviousActiveVersion
  $kind = if ($previous -and $previous -ne $resolved) { 'upgrade' } else { 'install' }
  $staging = Join-Path (Join-Path $StagingRoot $resolved) ("txn-$PID-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  $txnId = ("{0:x}-{1}" -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(), $PID)
  $txnPath = Join-Path $TransactionsDir "$txnId.json"
  $lockPath = Join-Path $LocksDir "$resolved.lock"
  $stagedBin = Join-Path $staging $asset
  $stagedSums = Join-Path $staging 'SHA256SUMS'
  $metadataPath = Join-Path (Join-Path $VersionsDir $resolved) 'version.json'

  $cleanupDone = $false
  try {
    Acquire-VersionLock $resolved $lockPath
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    Begin-InstallTransaction $txnId $kind $resolved $staging $txnPath

    try {
      Invoke-BoundedDownload -Url $sumsUrl -DestinationPath $stagedSums -MaxBytes $DownloadChecksumMaxBytes -Label 'SHA256SUMS'
    }
    catch {
      Write-Warn "Download failed for SHA256SUMS."
      Write-Warn 'Try: -Method npm | -Method bun | -Method source'
      Write-Warn 'Or pin a version: -Version X.Y.Z'
      throw
    }

    try {
      Invoke-BoundedDownload -Url $url -DestinationPath $stagedBin -MaxBytes $DownloadMaxBytes -Label $asset
    }
    catch {
      Write-Warn "Download failed for $asset."
      Write-Warn 'Try: -Method npm | -Method bun | -Method source'
      Write-Warn 'Or pin a version: -Version X.Y.Z'
      throw
    }

    if ((Get-Item -LiteralPath $stagedBin).Length -eq 0) {
      throw "Downloaded asset $asset is empty; the release is incomplete. Try -Method npm, -Method bun, or -Method source."
    }

    $sumsText = Get-Content -LiteralPath $stagedSums -Raw
    $want = ($sumsText -split "`n" |
      Where-Object { $_ -match "\s$([regex]::Escape($asset))\s*$" }) -replace '\s.*', ''
    $want = ([string]$want).Trim().ToLowerInvariant()

    if ([string]::IsNullOrEmpty($want)) {
      throw "SHA256SUMS has no entry for $asset; the release is incomplete. Try -Method npm, -Method bun, or -Method source."
    }

    $got = (Get-FileHash -Path $stagedBin -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($want -ne $got) {
      throw "Checksum mismatch for $asset (expected '$want', got '$got')."
    }

    New-Item -ItemType Directory -Force -Path (Split-Path $versionPath) | Out-Null
    $versionTmp = "$versionPath.tmp.$PID"
    Copy-Item -Force -Path $stagedBin -Destination $versionTmp
    Unblock-File -Path $versionTmp -ErrorAction SilentlyContinue
    Move-Item -Force -Path $versionTmp -Destination $versionPath

    $sizeBytes = [long](Get-Item -LiteralPath $versionPath).Length
    Write-VersionMetadata -Ver $resolved -Target $target -ArtifactName $asset -Sha256 $got `
      -SizeBytes $sizeBytes -SourceUrl $url -Path $metadataPath

    Update-Launcher -VersionPath $versionPath -LauncherPath $BinPath

    $prevArg = ''
    if ($previous -and $previous -ne $resolved) { $prevArg = $previous }
    Write-Manifest 'binary' $resolved $BinPath $versionPath $target $got $prevArg

    Finish-InstallTransaction $txnPath
    Release-VersionLock $lockPath
    if (Test-Path -LiteralPath $staging) {
      Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    }
    # Prune empty version/staging parents left by New-Item -Force.
    $versionStaging = Split-Path -Parent $staging
    if ((Test-Path -LiteralPath $versionStaging) -and -not (Get-ChildItem -LiteralPath $versionStaging -Force -ErrorAction SilentlyContinue)) {
      Remove-Item -LiteralPath $versionStaging -Force -ErrorAction SilentlyContinue
    }
    if ((Test-Path -LiteralPath $StagingRoot) -and -not (Get-ChildItem -LiteralPath $StagingRoot -Force -ErrorAction SilentlyContinue)) {
      Remove-Item -LiteralPath $StagingRoot -Force -ErrorAction SilentlyContinue
    }
    $cleanupDone = $true
  }
  catch {
    if (-not $cleanupDone) {
      Finish-InstallTransaction $txnPath
      Release-VersionLock $lockPath
      if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
      }
      $versionStaging = Split-Path -Parent $staging
      if ((Test-Path -LiteralPath $versionStaging) -and -not (Get-ChildItem -LiteralPath $versionStaging -Force -ErrorAction SilentlyContinue)) {
        Remove-Item -LiteralPath $versionStaging -Force -ErrorAction SilentlyContinue
      }
      if ((Test-Path -LiteralPath $StagingRoot) -and -not (Get-ChildItem -LiteralPath $StagingRoot -Force -ErrorAction SilentlyContinue)) {
        Remove-Item -LiteralPath $StagingRoot -Force -ErrorAction SilentlyContinue
      }
    }
    throw
  }

  Add-UserPath $BinDir
  Write-KunaiPathDiagnostic $BinPath
  Write-Info "Installed kunai -> $BinPath (v$resolved at $versionPath)"
}

function Require-Cmd([string]$Name, [string]$InstallHint) {
  if (-not $DryRun -and -not (Test-Cmd $Name)) {
    throw "Required command '$Name' was not found. $InstallHint"
  }
}

function Invoke-Step([string]$Description, [scriptblock]$Action) {
  if ($DryRun) {
    Write-Info "[dry-run] $Description"
    return
  }

  $global:LASTEXITCODE = $null
  & $Action
  $exitCode = $global:LASTEXITCODE
  if ($null -ne $exitCode -and $exitCode -ne 0) {
    throw "$Description failed with exit code $exitCode."
  }
  Write-Host 'Done.' -ForegroundColor Green
}

# Reject non-canonical pinned versions before any install side effects.
if ($Version -ne 'latest') {
  $null = Get-NormalizedVersion $Version
}

Write-Host 'Kunai installer' -ForegroundColor Cyan

switch ($Method) {
  'binary' { Install-Binary }
  'npm' {
    Require-Cmd 'node' 'Install Node.js before using -Method npm.'
    Require-Cmd 'npm' 'Install npm before using -Method npm.'
    $resolved = if ($Version -eq 'latest') { 'latest' } else { Get-NormalizedVersion $Version }
    if ($resolved -eq 'latest') {
      Invoke-Step "npm install -g $Package" { & npm install -g $Package }
    }
    else {
      Invoke-Step "npm install -g $Package@$resolved" { & npm install -g "$Package@$resolved" }
    }
    $resolved = Complete-PackageActiveVersion 'npm' $resolved
    Write-Manifest 'npm-global' $resolved 'kunai'
  }
  'bun' {
    Require-Cmd 'bun' 'Install Bun before using -Method bun.'
    $resolved = if ($Version -eq 'latest') { 'latest' } else { Get-NormalizedVersion $Version }
    if ($resolved -eq 'latest') {
      Invoke-Step "bun install -g $Package" { & bun install -g $Package }
    }
    else {
      Invoke-Step "bun install -g $Package@$resolved" { & bun install -g "$Package@$resolved" }
    }
    $resolved = Complete-PackageActiveVersion 'bun' $resolved
    Write-Manifest 'bun-global' $resolved 'kunai'
  }
  'source' {
    Require-Cmd 'git' 'Install Git before using -Method source.'
    Require-Cmd 'bun' 'Install Bun before using -Method source.'
    $resolved = if ($Version -eq 'latest') { 'latest' } else { Get-NormalizedVersion $Version }
    $src = if ($env:KUNAI_SOURCE_DIR) { $env:KUNAI_SOURCE_DIR } else { Join-Path $env:LOCALAPPDATA 'kunai\src' }
    if (Test-Path (Join-Path $src '.git')) {
      Invoke-Step "git pull Kunai in $src" { & git -C $src pull --ff-only }
    }
    else {
      Invoke-Step "git clone Kunai into $src" { & git clone --depth 1 'https://github.com/KitsuneKode/kunai.git' $src }
    }
    if (-not $DryRun) {
      Push-Location $src
      try {
        Invoke-Step 'bun install' { & bun install }
        Invoke-Step 'bun run build' { & bun run build }
        Invoke-Step 'bun run link:global' { & bun run link:global }
      }
      finally {
        Pop-Location
      }
    }
    else {
      Invoke-Step 'bun install' { }
      Invoke-Step 'bun run build' { }
      Invoke-Step 'bun run link:global' { }
    }
    $resolved = Complete-PackageActiveVersion 'source' $resolved
    Write-Manifest 'source' $resolved 'kunai'
  }
}

if ($Method -eq 'binary') {
  Install-OptionalDeps
}

Write-Host 'Done.' -ForegroundColor Green
Write-Host 'Try:  kunai -S "Frieren" -a'
Write-Host 'Update any time:  kunai upgrade'
Write-Host 'Remove:          kunai uninstall'
