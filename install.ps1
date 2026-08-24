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
  [string]$Method = $(if ($env:KUNAI_INSTALL_METHOD) { $env:KUNAI_INSTALL_METHOD } else { 'binary' }),
  [string]$Version = $(if ($env:KUNAI_INSTALL_VERSION) { $env:KUNAI_INSTALL_VERSION } else { 'latest' }),
  # `irm ... | iex` cannot pass parameters, so every switch also has an
  # environment fallback. Matched inline because a param default is evaluated
  # before any function in this file exists.
  [switch]$Yes = $([bool]($env:KUNAI_INSTALL_YES -match '^(?i:1|true|yes|y)$')),
  [switch]$DryRun = $([bool]($env:KUNAI_INSTALL_DRY_RUN -match '^(?i:1|true|yes|y)$')),
  # Parity with install.sh's --skip-deps. Installs Kunai and nothing else, which
  # is what automated environments want: winget can sit for minutes on package
  # downloads or agreement prompts, and a test asserting Kunai's own install has
  # no business waiting for it.
  [switch]$SkipDeps = $([bool]($env:KUNAI_SKIP_DEPS -match '^(?i:1|true|yes|y)$')),
  # Useful for managed/test environments that own PATH themselves. Without
  # this seam an otherwise sandboxed installer still writes HKCU\Environment.
  [switch]$SkipPathUpdate = $([bool]($env:KUNAI_SKIP_PATH_UPDATE -match '^(?i:1|true|yes|y)$'))
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

# $IsWindows is an automatic variable in PowerShell 6+ only. Windows PowerShell
# 5.1 does not define it and runs nowhere else, so its absence implies Windows.
$OnWindows = if ($null -eq $IsWindows) { $true } else { $IsWindows }

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
$ActivationLockTimeoutMs = if ($env:KUNAI_ACTIVATION_LOCK_TIMEOUT_MS) { [int]$env:KUNAI_ACTIVATION_LOCK_TIMEOUT_MS } else { 10000 }
$ActivationLockPollMs = if ($env:KUNAI_ACTIVATION_LOCK_POLL_MS) { [int]$env:KUNAI_ACTIVATION_LOCK_POLL_MS } else { 50 }
$ActivationLockCorruptGraceMs = if ($env:KUNAI_ACTIVATION_LOCK_CORRUPT_GRACE_MS) { [int]$env:KUNAI_ACTIVATION_LOCK_CORRUPT_GRACE_MS } else { 250 }
$ActivationLockTimeoutMs = [Math]::Max(0, $ActivationLockTimeoutMs)
$ActivationLockPollMs = [Math]::Max(1, $ActivationLockPollMs)
$ActivationLockCorruptGraceMs = [Math]::Max(0, $ActivationLockCorruptGraceMs)

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
  # Release tags are not all spelled `vX.Y.Z`. Changesets publishes package tags
  # as `@scope/name@X.Y.Z`, and a tag in that shape used to fail here as
  # "Invalid version" — which reads as a bad -Version argument rather than the
  # tag format it actually is. Take the version off the end of a package tag.
  if ($trimmed -match '^@?[^@]*@(?<ver>\d+\.\d+\.\d+)$') {
    $trimmed = $Matches['ver']
  }
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

# Run a native command and return its first output line, or $null unless it
# exited 0.
#
# The exit code must be read before the output is piped anywhere. Reading
# $LASTEXITCODE off the end of a `| Select-Object -First 1` pipeline is not
# reliable: Select-Object stops the pipeline as soon as it has its item, and the
# native command's exit status is then never recorded — $LASTEXITCODE stays
# null, `-eq 0` is false, and a command that actually succeeded reads as failed.
function Get-FirstLineIfSucceeded([scriptblock]$Command) {
  $global:LASTEXITCODE = $null
  $output = & $Command
  $exitCode = $global:LASTEXITCODE
  if ($exitCode -ne 0) { return $null }
  $first = $output | Select-Object -First 1
  if (-not $first) { return $null }
  return ([string]$first).Trim()
}

function Resolve-InstalledPackageVersion([string]$InstallMethod) {
  if ($InstallMethod -eq 'npm') {
    $root = Get-FirstLineIfSucceeded { & npm root -g 2>$null }
    if ($root) {
      $version = Read-KunaiPackageVersion ([string]$root)
      if ($version) { return $version }
    }
  }
  elseif ($InstallMethod -eq 'bun') {
    $bunRoot = if ($env:BUN_INSTALL) { $env:BUN_INSTALL } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.bun' }
    $bunGlobalDir = if ($env:BUN_INSTALL_GLOBAL_DIR) { $env:BUN_INSTALL_GLOBAL_DIR } else { Join-Path $bunRoot 'install\global' }
    $root = Join-Path $bunGlobalDir 'node_modules'
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

# Resolve the absolute launcher path recorded in the manifest, mirroring
# resolve_owned_package_launcher in install.sh and inspectPackageInstall in
# apps/cli/src/services/update/run-install.ts. A bare "kunai" is not a path:
# anything later reading launcherPath would resolve it against the wrong root.
# On Windows npm shims live directly in the prefix, not in a bin/ subdirectory.
function Resolve-OwnedPackageLauncher([string]$InstallMethod) {
  if ($DryRun) { return 'kunai' }
  if ($InstallMethod -eq 'npm') {
    $prefix = Get-FirstLineIfSucceeded { & npm prefix -g 2>$null }
    if ($prefix) {
      return (Join-Path $prefix 'kunai.cmd')
    }
  }
  elseif ($InstallMethod -eq 'bun') {
    $bunRoot = if ($env:BUN_INSTALL) { $env:BUN_INSTALL } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.bun' }
    $binDir = if ($env:BUN_INSTALL_BIN) { $env:BUN_INSTALL_BIN } else { Join-Path $bunRoot 'bin' }
    return (Join-Path $binDir 'kunai.exe')
  }
  throw "Could not resolve the $InstallMethod-owned Kunai launcher path."
}

function Get-IsoNow {
  return (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}

# Kunai publishes 64-bit binaries only: Bun has no 32-bit compile target, so
# there is no x86 or 32-bit ARM build to fall back to. This used to return 'x64'
# for anything that was not arm64, which handed a 32-bit machine a binary it
# cannot load and reported the failure as a corrupt download. Name the real
# reason instead.
function Get-WindowsArch {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
  switch ($arch) {
    ([System.Runtime.InteropServices.Architecture]::X64) { return 'x64' }
    ([System.Runtime.InteropServices.Architecture]::Arm64) { return 'arm64' }
  }
  throw "Unsupported architecture: $arch. Kunai ships 64-bit builds only (x64, arm64). Install from source with Bun instead: https://github.com/KitsuneKode/kunai#install"
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

function Invoke-WithManifestPublication([string]$Ver, [scriptblock]$Action) {
  if ($DryRun) { & $Action; return }
  $lockPath = Join-Path $LocksDir 'activation.lock'
  New-Item -ItemType Directory -Force -Path $LocksDir | Out-Null
  $ownerId = Acquire-ActivationLock $Ver $lockPath
  try {
    & $Action
  }
  finally {
    Release-ActivationLock $lockPath $ownerId
  }
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

function Test-LifecycleLockActive([string]$LockPath) {
  $script:LifecycleHolderPid = $null
  $raw = try { Get-Content -LiteralPath $LockPath -Raw -ErrorAction Stop } catch { '' }
  $candidate = $null
  try { $candidate = $raw | ConvertFrom-Json } catch { $candidate = $null }
  $validPid = $null -ne $candidate -and
    ($candidate.pid -is [int] -or $candidate.pid -is [long]) -and [int64]$candidate.pid -gt 0
  $properties = if ($null -ne $candidate) { @($candidate.PSObject.Properties.Name) } else { @() }
  $modernIntent = $properties -contains 'schemaVersion' -or $properties -contains 'scope' -or
    $properties -contains 'hostname' -or $properties -contains 'processStartId'
  $validModern = $validPid -and $modernIntent -and
    [int64]$candidate.schemaVersion -eq 1 -and [string]$candidate.scope -eq 'lifecycle' -and
    $candidate.version -is [string] -and [string]$candidate.version -eq '0.0.0' -and
    $candidate.execPath -is [string] -and -not [string]::IsNullOrWhiteSpace([string]$candidate.execPath) -and
    $candidate.ownerId -is [string] -and -not [string]::IsNullOrWhiteSpace([string]$candidate.ownerId) -and
    $raw -match '"acquiredAt"\s*:\s*"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z"' -and
    $candidate.hostname -is [string] -and -not [string]::IsNullOrWhiteSpace([string]$candidate.hostname) -and
    ($properties -contains 'processStartId') -and
    ($null -eq $candidate.processStartId -or
      ($candidate.processStartId -is [string] -and
        -not [string]::IsNullOrWhiteSpace([string]$candidate.processStartId)))

  if (-not $validPid -or ($modernIntent -and -not $validModern)) {
    Start-Sleep -Milliseconds 250
    $reread = try { Get-Content -LiteralPath $LockPath -Raw -ErrorAction Stop } catch { '' }
    # A changing record is still being published. An unchanged invalid record
    # has exhausted its bounded grace and is abandoned crash residue.
    return $reread -ne $raw
  }

  $script:LifecycleHolderPid = [int]$candidate.pid
  if (-not $modernIntent) {
    return $null -ne (Get-Process -Id $script:LifecycleHolderPid -ErrorAction SilentlyContinue)
  }
  $ownerHost = ([string]$candidate.hostname).Trim().ToLowerInvariant()
  if ($ownerHost -ne (Get-ActivationLockHostname)) { return $true }
  $process = Get-Process -Id $script:LifecycleHolderPid -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $false }
  if (-not [string]::IsNullOrWhiteSpace([string]$candidate.processStartId)) {
    $currentStart = Get-ActivationProcessStartId $script:LifecycleHolderPid
    if ($currentStart -and $currentStart -ne [string]$candidate.processStartId) { return $false }
  }
  return $true
}

function Acquire-VersionLock([string]$Ver, [string]$LockPath) {
  New-Item -ItemType Directory -Force -Path (Split-Path $LockPath) | Out-Null
  $lifecyclePath = Join-Path (Split-Path $LockPath) 'lifecycle.lock'
  $lifecycleGuardPath = "$DataDir.lifecycle.lock"
  foreach ($lifecycleCandidate in @($lifecycleGuardPath, $lifecyclePath)) {
    if (Test-Path -LiteralPath $lifecycleCandidate) {
      if (Test-LifecycleLockActive $lifecycleCandidate) {
        $detail = if ($null -ne $script:LifecycleHolderPid) { " by pid $($script:LifecycleHolderPid)" } else { '' }
        throw "Install lifecycle lock held$detail; uninstall is in progress"
      }
    }
  }
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

  # Close the race with lifecycle acquisition before download or mutation.
  foreach ($lifecycleCandidate in @($lifecycleGuardPath, $lifecyclePath)) {
    if (Test-Path -LiteralPath $lifecycleCandidate) {
      if (Test-LifecycleLockActive $lifecycleCandidate) {
        Release-VersionLock $LockPath
        $detail = if ($null -ne $script:LifecycleHolderPid) { " by pid $($script:LifecycleHolderPid)" } else { '' }
        throw "Install lifecycle lock held$detail; uninstall is in progress"
      }
    }
  }
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

function Get-ActivationLockHostname {
  return ([System.Net.Dns]::GetHostName()).Trim().ToLowerInvariant()
}

function Get-ActivationProcessStartId([int]$ProcessId) {
  if ($ProcessId -le 0) { return $null }
  if ($OnWindows) {
    try {
      $process = Get-Process -Id $ProcessId -ErrorAction Stop
      return "windows-ticks:$($process.StartTime.ToUniversalTime().Ticks)"
    }
    catch { return $null }
  }
  if (Test-Path -LiteralPath "/proc/$ProcessId/stat" -PathType Leaf) {
    try {
      $stat = [System.IO.File]::ReadAllText("/proc/$ProcessId/stat")
      $close = $stat.LastIndexOf(') ')
      if ($close -lt 0) { return $null }
      $fields = $stat.Substring($close + 2).Trim() -split '\s+'
      if ($fields.Count -gt 19 -and $fields[19]) { return "linux-proc:$($fields[19])" }
    }
    catch { return $null }
  }
  if ($IsMacOS) {
    try {
      $value = (& ps -o lstart= -p $ProcessId 2>$null) -join ' '
      $value = ($value -replace '\s+', ' ').Trim()
      if ($value) { return "darwin-ps:$value" }
    }
    catch { return $null }
  }
  return $null
}

function Read-ActivationLockState([string]$LockPath) {
  if (-not (Test-Path -LiteralPath $LockPath -PathType Leaf)) { return $null }
  $raw = try { Get-Content -LiteralPath $LockPath -Raw } catch { '' }
  $content = $null
  try {
    $candidate = $raw | ConvertFrom-Json
    $hasProcessStart = $candidate.PSObject.Properties.Name -contains 'processStartId'
    $validProcessStart = $hasProcessStart -and (
      $null -eq $candidate.processStartId -or
      ($candidate.processStartId -is [string] -and
        -not [string]::IsNullOrWhiteSpace([string]$candidate.processStartId))
    )
    # PowerShell 7 converts ISO JSON strings to DateTime, so validate the wire
    # representation to keep corrupt-record semantics identical to Bash/TS.
    $validAcquiredAt = $raw -match '"acquiredAt"\s*:\s*"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z"'
    if (
      ($candidate.schemaVersion -is [int] -or $candidate.schemaVersion -is [long]) -and
      [int64]$candidate.schemaVersion -eq 1 -and
      $candidate.scope -is [string] -and
      [string]::Equals([string]$candidate.scope, 'activation', [StringComparison]::Ordinal) -and
      ($candidate.pid -is [int] -or $candidate.pid -is [long]) -and
      [int64]$candidate.pid -gt 0 -and
      $candidate.version -is [string] -and (Test-CanonicalVersion ([string]$candidate.version)) -and
      $candidate.execPath -is [string] -and -not [string]::IsNullOrWhiteSpace([string]$candidate.execPath) -and
      $candidate.ownerId -is [string] -and -not [string]::IsNullOrWhiteSpace([string]$candidate.ownerId) -and
      $validAcquiredAt -and
      $candidate.hostname -is [string] -and -not [string]::IsNullOrWhiteSpace([string]$candidate.hostname) -and
      $validProcessStart
    ) { $content = $candidate }
  }
  catch { $content = $null }
  return [pscustomobject]@{ Raw = $raw; Content = $content }
}

function Read-ActivationLock([string]$LockPath) {
  $state = Read-ActivationLockState $LockPath
  if ($null -eq $state) { return $null }
  return $state.Content
}

function Test-ActivationOwnerStale($Content) {
  if ([string]$Content.hostname -ne (Get-ActivationLockHostname)) { return $false }
  $process = Get-Process -Id ([int]$Content.pid) -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $true }
  if (-not [string]::IsNullOrWhiteSpace([string]$Content.processStartId)) {
    $currentStart = if ($OnWindows) {
      "windows-ticks:$($process.StartTime.ToUniversalTime().Ticks)"
    }
    else {
      Get-ActivationProcessStartId ([int]$Content.pid)
    }
    if ($currentStart -and -not [string]::Equals(
        [string]$currentStart,
        [string]$Content.processStartId,
        [StringComparison]::Ordinal
      )) { return $true }
  }
  return $false
}

function Get-ActivationReclaimClaims([string]$LockPath) {
  $directory = Split-Path $LockPath
  $leaf = Split-Path $LockPath -Leaf
  $claims = [System.Collections.Generic.List[string]]::new()
  foreach ($filter in @("$leaf.reclaim-tmp.*", "$leaf.reclaim.*.tmp.*")) {
    foreach ($temp in @(Get-ChildItem -LiteralPath $directory -Filter $filter -File -ErrorAction SilentlyContinue)) {
      # Temp publications never participate in election. The second pattern
      # recovers crash residue written by older installers inside `.reclaim.*`.
      $tempState = Read-ActivationLockState $temp.FullName
      $reclaimable = if ($null -ne $tempState -and $null -ne $tempState.Content) {
        Test-ActivationOwnerStale $tempState.Content
      }
      else {
        ([DateTime]::UtcNow - $temp.LastWriteTimeUtc).TotalMilliseconds -ge $ActivationLockCorruptGraceMs
      }
      if ($reclaimable) {
        Remove-Item -LiteralPath $temp.FullName -Force -ErrorAction SilentlyContinue
      }
    }
  }
  foreach ($item in @(Get-ChildItem -LiteralPath $directory -Filter "$leaf.reclaim.*" -File -ErrorAction SilentlyContinue)) {
    $state = Read-ActivationLockState $item.FullName
    if ($null -ne $state -and $null -ne $state.Content -and
      ([DateTime]::UtcNow - $item.LastWriteTimeUtc).TotalMilliseconds -lt 1000) {
      $claims.Add($item.FullName)
      continue
    }
    if ($null -ne $state -and $null -ne $state.Content -and (Test-ActivationOwnerStale $state.Content)) {
      # Claim paths contain a GUID owner token and are never reused.
      Remove-Item -LiteralPath $item.FullName -Force -ErrorAction SilentlyContinue
      continue
    }
    $claims.Add($item.FullName)
  }
  return @($claims | Sort-Object)
}

function New-ActivationReclaimClaim([string]$LockPath, [string]$OwnerId, [byte[]]$Bytes) {
  $claimPath = "$LockPath.reclaim.$OwnerId"
  $tempPath = "$LockPath.reclaim-tmp.$OwnerId.$([Guid]::NewGuid().ToString('N'))"
  [System.IO.File]::WriteAllBytes($tempPath, $Bytes)
  try { [System.IO.File]::Move($tempPath, $claimPath) }
  catch {
    Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
    throw
  }
  return $claimPath
}

function Restore-ActivationQuarantine([string]$QuarantinePath, [string]$LockPath) {
  try {
    # Hard-link creation is exclusive and therefore cannot overwrite a newer
    # canonical owner that won after the quarantine rename.
    New-Item -ItemType HardLink -Path $LockPath -Target $QuarantinePath -ErrorAction Stop | Out-Null
    Remove-Item -LiteralPath $QuarantinePath -Force -ErrorAction SilentlyContinue
    return $true
  }
  catch {
    if (Test-Path -LiteralPath $LockPath) {
      # Preserve the quarantine for diagnostics when another owner already won.
      return $false
    }
    # With no canonical successor, fail closed rather than abandoning a valid
    # observed owner in quarantine and allowing activation to overlap it.
    throw
  }
}

function Move-ActivationLockToQuarantine(
  [string]$LockPath,
  [string]$ObservedRaw,
  [bool]$AllowCorrupt,
  [string]$OwnerId,
  [byte[]]$SuccessorBytes,
  [System.Diagnostics.Stopwatch]$Timer
) {
  if ($Timer.ElapsedMilliseconds -ge $ActivationLockTimeoutMs) { return $false }
  $quarantinePath = "$LockPath.quarantine.$OwnerId.$([Guid]::NewGuid().ToString('N'))"
  try { [System.IO.File]::Move($LockPath, $quarantinePath) }
  catch [System.IO.IOException] { return $false }

  $quarantined = Read-ActivationLockState $quarantinePath
  if ($null -eq $quarantined -or -not [string]::Equals(
      [string]$quarantined.Raw,
      $ObservedRaw,
      [StringComparison]::Ordinal
    )) {
    Restore-ActivationQuarantine $quarantinePath $LockPath | Out-Null
    return $false
  }
  if ($null -ne $quarantined.Content) {
    if (-not (Test-ActivationOwnerStale $quarantined.Content)) {
      Restore-ActivationQuarantine $quarantinePath $LockPath | Out-Null
      return $false
    }
  }
  elseif (-not $AllowCorrupt) {
    Restore-ActivationQuarantine $quarantinePath $LockPath | Out-Null
    return $false
  }
  if ($Timer.ElapsedMilliseconds -ge $ActivationLockTimeoutMs) {
    Restore-ActivationQuarantine $quarantinePath $LockPath | Out-Null
    return $false
  }
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if ($Timer.ElapsedMilliseconds -ge $ActivationLockTimeoutMs) {
      Restore-ActivationQuarantine $quarantinePath $LockPath | Out-Null
      return $false
    }
    $stream = $null
    try {
      $stream = [System.IO.File]::Open(
        $LockPath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
      )
      $stream.Write($SuccessorBytes, 0, $SuccessorBytes.Length)
      $stream.Flush()
      $stream.Dispose()
      Remove-Item -LiteralPath $quarantinePath -Force -ErrorAction Stop
      return $true
    }
    catch [System.IO.IOException] {
      if ($null -ne $stream) { $stream.Dispose() }
      $remaining = $ActivationLockTimeoutMs - $Timer.ElapsedMilliseconds
      if ($remaining -le 0) {
        Restore-ActivationQuarantine $quarantinePath $LockPath | Out-Null
        return $false
      }
      Start-Sleep -Milliseconds ([Math]::Min(1, $remaining))
    }
  }
  Restore-ActivationQuarantine $quarantinePath $LockPath | Out-Null
  return $false
}

function Invoke-ActivationReclaim(
  [string]$LockPath,
  [string]$ObservedRaw,
  [bool]$AllowCorrupt,
  [string]$OwnerId,
  [byte[]]$SuccessorBytes,
  [System.Diagnostics.Stopwatch]$Timer
) {
  if ($Timer.ElapsedMilliseconds -ge $ActivationLockTimeoutMs) { return $false }
  $claimPath = New-ActivationReclaimClaim $LockPath $OwnerId $SuccessorBytes
  try {
    $claims = @(Get-ActivationReclaimClaims $LockPath)
    if ($claims.Count -eq 0) { return $false }
    # FullName may expand a Windows 8.3 path that LockPath retained. Election is
    # scoped to one lock directory, so compare the unique token-owned leaf.
    $electedLeaf = [System.IO.Path]::GetFileName([string]$claims[0])
    $claimLeaf = [System.IO.Path]::GetFileName($claimPath)
    if (-not [string]::Equals($electedLeaf, $claimLeaf, [StringComparison]::Ordinal)) { return $false }
    $current = Read-ActivationLockState $LockPath
    if ($null -eq $current -or -not [string]::Equals(
        [string]$current.Raw,
        $ObservedRaw,
        [StringComparison]::Ordinal
      )) { return $false }
    return Move-ActivationLockToQuarantine $LockPath $ObservedRaw $AllowCorrupt $OwnerId $SuccessorBytes $Timer
  }
  finally {
    Remove-Item -LiteralPath $claimPath -Force -ErrorAction SilentlyContinue
  }
}

function Wait-ActivationLockPoll([System.Diagnostics.Stopwatch]$Timer) {
  $remaining = $ActivationLockTimeoutMs - $Timer.ElapsedMilliseconds
  if ($remaining -le 0) { return }
  Start-Sleep -Milliseconds ([Math]::Max(1, [Math]::Min($ActivationLockPollMs, $remaining)))
}

function Acquire-ActivationLock([string]$Ver, [string]$LockPath) {
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  New-Item -ItemType Directory -Force -Path (Split-Path $LockPath) | Out-Null
  $ownerId = "$PID-$([Guid]::NewGuid().ToString('N'))"
  $record = [ordered]@{
    schemaVersion = 1
    scope         = 'activation'
    pid           = $PID
    version       = $Ver
    execPath      = 'install.ps1'
    ownerId       = $ownerId
    acquiredAt    = (Get-IsoNow)
    hostname      = (Get-ActivationLockHostname)
    processStartId = (Get-ActivationProcessStartId $PID)
  }
  $bytes = (New-Object System.Text.UTF8Encoding $false).GetBytes((($record | ConvertTo-Json -Compress) + "`n"))
  $corruptRaw = $null
  $corruptSinceMs = 0L
  $holder = $null
  $attempted = $false

  while ($true) {
    if ($attempted -and $timer.ElapsedMilliseconds -ge $ActivationLockTimeoutMs) {
      $detail = if ($null -ne $holder) { " by pid $holder" } else { '' }
      throw "Activation lock held$detail while activating version $Ver"
    }
    $attempted = $true
    if (@(Get-ActivationReclaimClaims $LockPath).Count -gt 0) {
      if ($timer.ElapsedMilliseconds -ge $ActivationLockTimeoutMs) {
        throw "Activation reclamation is already in progress for version $Ver"
      }
      Wait-ActivationLockPoll $timer
      continue
    }
    $stream = $null
    try {
      $stream = [System.IO.File]::Open(
        $LockPath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
      )
      $stream.Write($bytes, 0, $bytes.Length)
      $stream.Flush()
      $stream.Dispose()
      if (@(Get-ActivationReclaimClaims $LockPath).Count -eq 0) { return $ownerId }
      Release-ActivationLock $LockPath $ownerId
      continue
    }
    catch [System.IO.IOException] {
      if ($null -ne $stream) { $stream.Dispose() }
      if (-not (Test-Path -LiteralPath $LockPath)) {
        if ($timer.ElapsedMilliseconds -ge $ActivationLockTimeoutMs) {
          throw "Could not create activation lock at $LockPath"
        }
        Wait-ActivationLockPoll $timer
        continue
      }
    }

    $observed = Read-ActivationLockState $LockPath
    if ($null -eq $observed) {
      if ($timer.ElapsedMilliseconds -ge $ActivationLockTimeoutMs) {
        throw "Activation lock held while activating version $Ver"
      }
      Wait-ActivationLockPoll $timer
      continue
    }
    $content = $observed.Content
    if ($null -ne $content) {
      $corruptRaw = $null
      $corruptSinceMs = 0L
      $holder = [int]$content.pid
      if (Test-ActivationOwnerStale $content) {
        if (Invoke-ActivationReclaim $LockPath ([string]$observed.Raw) $false $ownerId $bytes $timer) {
          return $ownerId
        }
      }
    }
    else {
      $raw = [string]$observed.Raw
      if ($null -eq $corruptRaw -or -not [string]::Equals(
          $raw,
          [string]$corruptRaw,
          [StringComparison]::Ordinal
        )) {
        $corruptRaw = $raw
        $corruptSinceMs = $timer.ElapsedMilliseconds
        $holder = $null
      }
      elseif (($timer.ElapsedMilliseconds - $corruptSinceMs) -ge $ActivationLockCorruptGraceMs) {
        if (Invoke-ActivationReclaim $LockPath $raw $true $ownerId $bytes $timer) { return $ownerId }
        $corruptRaw = $null
        $corruptSinceMs = 0L
      }
    }

    if ($timer.ElapsedMilliseconds -ge $ActivationLockTimeoutMs) {
      $detail = if ($null -ne $holder) { " by pid $holder" } else { '' }
      throw "Activation lock held$detail while activating version $Ver"
    }
    Wait-ActivationLockPoll $timer
  }
}

function Release-ActivationLock([string]$LockPath, [string]$OwnerId) {
  if ([string]::IsNullOrWhiteSpace($OwnerId)) { return }
  $quarantinePath = "$LockPath.quarantine.$OwnerId.release.$([Guid]::NewGuid().ToString('N'))"
  try { [System.IO.File]::Move($LockPath, $quarantinePath) }
  catch [System.IO.IOException] { return }
  $moved = Read-ActivationLock $quarantinePath
  if ($null -ne $moved -and [string]::Equals(
      [string]$moved.ownerId,
      $OwnerId,
      [StringComparison]::Ordinal
    )) {
    Remove-Item -LiteralPath $quarantinePath -Force -ErrorAction SilentlyContinue
  }
  else {
    Restore-ActivationQuarantine $quarantinePath $LockPath | Out-Null
  }
}

function New-LauncherSnapshot([string]$LauncherPath) {
  $backup = "$LauncherPath.activation-backup.$PID"
  Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
  $exists = Test-Path -LiteralPath $LauncherPath -PathType Leaf
  if ($exists) { Copy-Item -Force -Path $LauncherPath -Destination $backup }
  return [pscustomobject]@{ Exists = $exists; BackupPath = $backup }
}

function Restore-LauncherSnapshot([string]$LauncherPath, $Snapshot) {
  if ($Snapshot.Exists) {
    Copy-Item -Force -Path $Snapshot.BackupPath -Destination $LauncherPath
  }
  else {
    Remove-Item -LiteralPath $LauncherPath -Force -ErrorAction SilentlyContinue
  }
}

function Remove-LauncherSnapshot($Snapshot) {
  if ($null -ne $Snapshot) {
    Remove-Item -LiteralPath $Snapshot.BackupPath -Force -ErrorAction SilentlyContinue
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
    # Never delete the working launcher after a failed move-aside. The caller
    # holds a durable snapshot and will restore it after any later failure.
    Move-Item -Force -Path $LauncherPath -Destination $aside
  }
  Copy-Item -Force -Path $VersionPath -Destination $LauncherPath
  # Clearing the mark-of-the-web is meaningful only on Windows, and the cmdlet
  # raises an unsuppressable platform error elsewhere.
  if ($OnWindows) { Unblock-File -Path $LauncherPath -ErrorAction SilentlyContinue }
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
  if ($DryRun -or -not $OnWindows) { return }
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
  # The 'User' environment target and the WM_SETTINGCHANGE broadcast that makes
  # it visible are both Windows-only; there is no persistent equivalent to
  # update elsewhere, and reading the target throws off-Windows.
  if (-not $OnWindows) { return }
  if ($SkipPathUpdate) {
    Write-Info "Skipping persistent User PATH update for $Dir."
    return
  }
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  $entries = @($current -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  $alreadyPresent = @($entries | ForEach-Object { $_.Trim().Trim('"').TrimEnd('\\') }) -contains $Dir.TrimEnd('\\')
  if (-not $alreadyPresent) {
    # A native install should be the command the user just installed. Put its
    # directory before older npm/Bun shims while leaving those files and their
    # package-manager ownership untouched.
    $next = if ($entries.Count -eq 0) { $Dir } else { (@($Dir) + $entries) -join ';' }
    if ($DryRun) { Write-Info "[dry-run] would add $Dir to User PATH"; return }
    [Environment]::SetEnvironmentVariable('Path', $next, 'User')
    $env:Path = "$Dir;$env:Path"
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
    $directory = $pathEntry.Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($directory)) { continue }

    foreach ($extension in $pathExtensions) {
      try {
        $candidate = [System.IO.Path]::GetFullPath((Join-Path $directory "kunai$extension"))
      }
      catch {
        continue
      }
      if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }

      # Report the name as it exists on disk, not as PATHEXT spells it. PATHEXT
      # is conventionally uppercase (".CMD"), and building the path from it
      # printed "kunai.CMD" for a file actually named "kunai.cmd". Windows
      # resolves either, so the shim still worked — but the diagnostic is meant
      # to be pasted into a shell and compared against `Get-Command kunai -All`,
      # and a path whose case does not match the real file undermines exactly
      # that. Case-insensitive de-duplication below is unaffected.
      try {
        $onDisk = [System.IO.Directory]::GetFiles(
          [System.IO.Path]::GetDirectoryName($candidate),
          [System.IO.Path]::GetFileName($candidate)
        )
        if ($onDisk.Length -gt 0) { $candidate = $onDisk[0] }
      }
      catch {
        # Keep the constructed path when the directory cannot be enumerated.
      }

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

# Consent for one optional package install.
#
# An explicit -Yes is consent. Redirected input is not: with no console to
# prompt, the three call sites below each defaulted to $true and installed
# anyway, so `irm … | iex` in CI or a container silently acquired system
# package installs. Decline instead, and say which step was skipped so the
# run stays useful and the gap is visible.
function Confirm-OptionalInstall {
  param([Parameter(Mandatory)][string]$Question)

  if ($Yes) { return $true }
  if ($DryRun) { return $true }
  if ([Console]::IsInputRedirected) {
    Write-Warn "No console for: $Question - skipping (pass -Yes to accept, -SkipDeps to silence)"
    return $false
  }
  $reply = Read-Host "$Question [Y/n]"
  return -not ($reply -match '^[Nn]')
}

function Install-OptionalDeps {
  if ($SkipDeps) {
    Write-Info 'Skipping optional dependencies (mpv, yt-dlp, curl).'
    return
  }
  $installMpv = Confirm-OptionalInstall 'Install mpv (required for playback)?'
  if ($installMpv) {
    if (Test-Cmd 'winget') {
      # mpv.net ships mpvnet.exe, but Kunai probes for `mpv` and drives playback
      # over mpv's IPC socket + Lua bridge. mpv-player.mpv-CI.MSVC is the winget
      # package that provides a real mpv.exe (same upstream build CI pins).
      Invoke-OptionalStep 'winget install --id mpv-player.mpv-CI.MSVC -e' { winget install --id mpv-player.mpv-CI.MSVC -e --accept-package-agreements --accept-source-agreements }
    }
    elseif (Test-Cmd 'scoop') {
      Invoke-OptionalStep 'scoop install mpv' { scoop install mpv }
    }
    else {
      Write-Warn 'No winget/scoop found. Install mpv manually: https://mpv.io/installation/'
    }
  }

  $installYtDlp = Confirm-OptionalInstall 'Install yt-dlp (YouTube playback and downloads)?'
  if ($installYtDlp) {
    if (Test-Cmd 'winget') {
      Invoke-OptionalStep 'winget install yt-dlp' { winget install yt-dlp --accept-package-agreements --accept-source-agreements }
    }
    elseif (Test-Cmd 'scoop') {
      Invoke-OptionalStep 'scoop install yt-dlp' { scoop install yt-dlp }
    }
    else {
      Write-Warn 'No winget/scoop found. Install yt-dlp manually: https://github.com/yt-dlp/yt-dlp#installation'
    }
  }

  # Windows 10+ ships curl.exe in System32, so "is curl present" is the wrong
  # question here — the bundled build uses Schannel with no nghttp2, so it
  # reports no HTTP2 feature. Providers that negotiate HTTP/2 fall back or fail
  # against that build, so offer the full winget/scoop curl when the one on PATH
  # cannot do HTTP/2.
  $curlNeedsUpgrade = $false
  if (Test-Cmd 'curl') {
    try {
      $curlFeatures = (& curl.exe --version 2>$null) -join "`n"
      $curlNeedsUpgrade = -not ($curlFeatures -match 'HTTP2')
    }
    catch { $curlNeedsUpgrade = $true }
  }
  else {
    $curlNeedsUpgrade = $true
  }
  if ($curlNeedsUpgrade) {
    Write-Warn 'The curl on PATH has no HTTP/2 support (Windows ships a Schannel build).'
    $installCurl = Confirm-OptionalInstall 'Install full curl with HTTP/2 (recommended for providers)?'
    if ($installCurl) {
      if (Test-Cmd 'winget') {
        Invoke-OptionalStep 'winget install curl' { winget install --id cURL.cURL -e --accept-package-agreements --accept-source-agreements }
      }
      elseif (Test-Cmd 'scoop') {
        Invoke-OptionalStep 'scoop install curl' { scoop install curl }
      }
      else {
        Write-Warn 'No winget/scoop found. Install curl manually: https://curl.se/windows/'
      }
    }
  }

  # No poster dependency to install: every renderer consumes one natively
  # prepared image, and half-block is the universal in-process floor.
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
  $activationLockPath = Join-Path $LocksDir 'activation.lock'
  $stagedBin = Join-Path $staging $asset
  $stagedSums = Join-Path $staging 'SHA256SUMS'
  $metadataPath = Join-Path (Join-Path $VersionsDir $resolved) 'version.json'

  $cleanupDone = $false
  $activationOwnerId = $null
  $launcherSnapshot = $null
  $launcherActivated = $false
  $preserveLauncherSnapshot = $false
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
    if ($OnWindows) { Unblock-File -Path $versionTmp -ErrorAction SilentlyContinue }
    Move-Item -Force -Path $versionTmp -Destination $versionPath

    $sizeBytes = [long](Get-Item -LiteralPath $versionPath).Length
    Write-VersionMetadata -Ver $resolved -Target $target -ArtifactName $asset -Sha256 $got `
      -SizeBytes $sizeBytes -SourceUrl $url -Path $metadataPath

    $activationOwnerId = Acquire-ActivationLock $resolved $activationLockPath
    # Another version may have activated during this download. Read shared state
    # under the cross-version lock before publishing the launcher and manifest.
    $activationPrevious = Get-PreviousActiveVersion
    $launcherSnapshot = New-LauncherSnapshot $BinPath
    try {
      # Update-Launcher can fail after moving the old launcher but before the
      # replacement copy completes, so restoration is required from invocation.
      $launcherActivated = $true
      Update-Launcher -VersionPath $versionPath -LauncherPath $BinPath

      $prevArg = ''
      if ($activationPrevious -and $activationPrevious -ne $resolved) { $prevArg = $activationPrevious }
      Write-Manifest 'binary' $resolved $BinPath $versionPath $target $got $prevArg
      $launcherActivated = $false
    }
    catch {
      if ($launcherActivated) {
        try {
          Restore-LauncherSnapshot $BinPath $launcherSnapshot
          $launcherActivated = $false
        }
        catch {
          $launcherActivated = $false
          $preserveLauncherSnapshot = $true
          throw
        }
      }
      throw
    }
    finally {
      if (-not $preserveLauncherSnapshot) { Remove-LauncherSnapshot $launcherSnapshot }
      Release-ActivationLock $activationLockPath $activationOwnerId
      $activationOwnerId = $null
    }

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
      if ($launcherActivated -and $null -ne $launcherSnapshot) {
        try { Restore-LauncherSnapshot $BinPath $launcherSnapshot }
        catch { $preserveLauncherSnapshot = $true }
      }
      if (-not $preserveLauncherSnapshot) { Remove-LauncherSnapshot $launcherSnapshot }
      Release-ActivationLock $activationLockPath $activationOwnerId
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
  if ($SkipPathUpdate) {
    Write-Info "PATH activation is environment-managed; ensure $BinDir is present before running kunai."
  }
  else {
    Write-Info "PATH activation: new terminals inherit $BinDir. Reopen the terminal if this shell cannot find kunai."
  }
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

# Optional dependencies must never fail the Kunai install.
#
# They are installed *after* Kunai is already on disk with its manifest written,
# so throwing here reported a completed install as a failure. winget makes that
# easy to hit: asked to install a package that is already present it prints "No
# available upgrade found" and exits -1978335189, which is not an error for our
# purposes at all. Rather than enumerate winget's status codes, treat every
# optional step as best-effort and tell the user what to run by hand.
function Invoke-OptionalStep([string]$Description, [scriptblock]$Action) {
  if ($DryRun) {
    Write-Info "[dry-run] $Description"
    return
  }

  $global:LASTEXITCODE = $null
  try {
    & $Action
  }
  catch {
    Write-Warn "$Description did not complete: $($_.Exception.Message)"
    return
  }
  $exitCode = $global:LASTEXITCODE
  if ($null -ne $exitCode -and $exitCode -ne 0) {
    Write-Warn "$Description reported exit code $exitCode (Kunai itself is installed)."
    return
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
    $publicationVersion = if ($Version -eq 'latest') { '0.0.0' } else { Get-NormalizedVersion $Version }
    Invoke-WithManifestPublication $publicationVersion {
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
      Write-Manifest 'npm-global' $resolved (Resolve-OwnedPackageLauncher 'npm')
    }
  }
  'bun' {
    $publicationVersion = if ($Version -eq 'latest') { '0.0.0' } else { Get-NormalizedVersion $Version }
    Invoke-WithManifestPublication $publicationVersion {
      Require-Cmd 'bun' 'Install Bun before using -Method bun.'
      $resolved = if ($Version -eq 'latest') { 'latest' } else { Get-NormalizedVersion $Version }
      if ($resolved -eq 'latest') {
        Invoke-Step "bun install -g $Package" { & bun install -g $Package }
      }
      else {
        Invoke-Step "bun install -g $Package@$resolved" { & bun install -g "$Package@$resolved" }
      }
      $resolved = Complete-PackageActiveVersion 'bun' $resolved
      Write-Manifest 'bun-global' $resolved (Resolve-OwnedPackageLauncher 'bun')
    }
  }
  'source' {
    $publicationVersion = if ($Version -eq 'latest') { '0.0.0' } else { Get-NormalizedVersion $Version }
    Invoke-WithManifestPublication $publicationVersion {
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
}

if ($Method -eq 'binary') {
  Install-OptionalDeps
}

Write-Host 'Done.' -ForegroundColor Green
Write-Host 'Try:  kunai -S "Frieren" -a'
Write-Host 'Update any time:  kunai upgrade'
Write-Host 'Remove:          kunai uninstall'
