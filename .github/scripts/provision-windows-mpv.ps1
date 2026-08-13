[CmdletBinding()]
param(
  [ValidateRange(1, 10)]
  [int]$MaxAttempts = 3,

  [string]$InstallRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Keep the URL and digest immutable together. This is the official mpv Windows
# archive also referenced by Scoop's mpv manifest, without making CI depend on
# a mutable package-manager feed or on bootstrapping another package manager.
$mpvVersion = "0.41.0"
$archiveName = "mpv-v$mpvVersion-x86_64-pc-windows-msvc.zip"
$archiveUri = "https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-x86_64-pc-windows-msvc.zip"
$expectedSha256 = "4e197f729f5071c6772f35fffd96e0f36e3e8a044bd9479b136bb09b7c6a80ff"

if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
  $tempRoot = if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) { $env:TEMP } else { $env:RUNNER_TEMP }
  $InstallRoot = Join-Path $tempRoot "kunai-mpv-$mpvVersion"
}

$archivePath = Join-Path $InstallRoot $archiveName
$extractRoot = Join-Path $InstallRoot "expanded"
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

function Get-VerifiedArchive {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Uri,

    [Parameter(Mandatory = $true)]
    [string]$Destination,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedSha256,

    [Parameter(Mandatory = $true)]
    [int]$Attempts
  )

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
      Write-Host "Downloading mpv $mpvVersion (attempt $attempt/$Attempts)"
      Invoke-WebRequest -Uri $Uri -OutFile $Destination -MaximumRetryCount 2 -RetryIntervalSec 2

      $actualSha256 = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actualSha256 -ne $ExpectedSha256) {
        throw "mpv archive checksum mismatch: expected $ExpectedSha256, got $actualSha256"
      }

      return
    }
    catch {
      Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
      if ($attempt -eq $Attempts) {
        throw "Unable to download a verified mpv archive after $Attempts attempts: $($_.Exception.Message)"
      }

      $delaySeconds = [Math]::Min(2 * $attempt, 6)
      Write-Warning "mpv download attempt $attempt failed: $($_.Exception.Message). Retrying in $delaySeconds seconds."
      Start-Sleep -Seconds $delaySeconds
    }
  }
}

Get-VerifiedArchive `
  -Uri $archiveUri `
  -Destination $archivePath `
  -ExpectedSha256 $expectedSha256 `
  -Attempts $MaxAttempts

Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot

$mpvCandidates = @(Get-ChildItem -LiteralPath $extractRoot -Filter "mpv.exe" -File -Recurse)
if ($mpvCandidates.Count -ne 1) {
  throw "Expected exactly one mpv.exe in the verified archive, found $($mpvCandidates.Count)"
}

$mpvPath = $mpvCandidates[0].FullName
$mpvDirectory = $mpvCandidates[0].Directory.FullName
$env:PATH = "$mpvDirectory$([IO.Path]::PathSeparator)$env:PATH"

if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_PATH)) {
  Add-Content -LiteralPath $env:GITHUB_PATH -Value $mpvDirectory
}

$mpvProcess = Start-Process `
  -FilePath $mpvPath `
  -ArgumentList "--version" `
  -NoNewWindow `
  -Wait `
  -PassThru
if ($mpvProcess.ExitCode -ne 0) {
  throw "mpv --version exited $($mpvProcess.ExitCode)"
}

Write-Host "Provisioned mpv $mpvVersion from verified archive"
