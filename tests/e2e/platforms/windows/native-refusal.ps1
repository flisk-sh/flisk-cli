# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
# The native Windows CLI contract (W3 in run.sh; moved verbatim from the "Verify native Windows CLI contract" step of
# the retired windows-smoke workflow, #1300). Run from the cli directory. GitHub's pwsh step sets ErrorActionPreference to Stop;
# the file sets it itself so a local run behaves the same.
$ErrorActionPreference = 'Stop'

Remove-Item Env:FLISK_ALLOW_NATIVE_WINDOWS -ErrorAction SilentlyContinue
$env:FLISK_ALLOW_NATIVE_WINDOWS = ""
[Environment]::SetEnvironmentVariable("FLISK_ALLOW_NATIVE_WINDOWS", "", "Process")

$version = & node bin/flisk.js --version
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($version | Out-String))) {
  throw 'flisk --version did not succeed.'
}
Write-Output $version

$fliskBin = Join-Path (Get-Location).Path 'bin/flisk.js'

function Invoke-Flisk {
  param(
    [Parameter(Mandatory = $true)][string[]]$CliArgs,
    [string]$WorkingDirectory = (Get-Location).Path
  )

  Push-Location $WorkingDirectory
  try {
    $output = & node $fliskBin @CliArgs 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  return [PSCustomObject]@{ Text = ($output | Out-String); ExitCode = $exitCode }
}

function Invoke-NativeWindowsRefusal {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string[]]$CliArgs,
    # The folder to run in. A folder holding a plain package.json with a dev or start script is a runnable project
    # (flisk infers one local process from it, #3396), so a refusal has to be asked from a folder with no runnable service.
    [string]$WorkingDirectory = (Get-Location).Path
  )

  $result = Invoke-Flisk -CliArgs $CliArgs -WorkingDirectory $WorkingDirectory
  Write-Host "$Label exit code: $($result.ExitCode)"
  Write-Host $result.Text

  if ($result.ExitCode -eq 0) {
    throw "$Label unexpectedly succeeded on native Windows."
  }
  if ($result.Text -notmatch '(?i)WSL2' -or $result.Text -notmatch '(?i)Ubuntu') {
    throw "$Label did not direct the user to WSL2 Ubuntu."
  }
  return $result.Text
}

$doctorText = Invoke-NativeWindowsRefusal -Label 'flisk doctor' -CliArgs @('doctor')
# Hosted Windows runners have no Docker daemon, so the Docker OS check is
# skipped there; the daemon failure line is the container diagnostic we get.
# checkWindowsDockerMode prints "Docker daemon is not responding", so accept that wording too.
if ($doctorText -notmatch '(?i)Docker container mode|Windows containers|Linux containers|Docker OS|Docker is not running|Docker daemon is not responding') {
  throw 'flisk doctor did not report Docker container mode diagnostics on native Windows.'
}
if ($doctorText -notmatch '(?i)flisk\.localhost|Windows ports and DNS|core\.autocrlf|File sharing') {
  throw 'flisk doctor did not report Windows ports/DNS or autocrlf diagnostics on native Windows.'
}
$scratchDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "flisk-w3-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $scratchDirectory | Out-Null
try {
  # `flisk up` checks for a project root before the native Windows gate (#4795): outside a project "no project" is
  # the answer on every platform, so an empty folder exits non-zero and never mentions WSL2. Assert that first.
  $noProject = Invoke-Flisk -CliArgs @('up', '--dry-run') -WorkingDirectory $scratchDirectory
  Write-Host "flisk up --dry-run (no project) exit code: $($noProject.ExitCode)"
  Write-Host $noProject.Text
  if ($noProject.ExitCode -eq 0) {
    throw 'flisk up --dry-run unexpectedly succeeded outside a project.'
  }
  if ($noProject.Text -notmatch '(?i)Could not find project root') {
    throw 'flisk up --dry-run outside a project did not report the missing project root.'
  }
  if ($noProject.Text -match '(?i)WSL2|Ubuntu') {
    throw 'flisk up --dry-run outside a project mentioned WSL2 Ubuntu; the refusal only applies to a project.'
  }

  # The .flisk/project.json marker makes the folder a project with no runnable service, so `up` gets past the
  # project-root check and reaches the native Windows gate. Both `up --dry-run` and `up shop` run in it.
  New-Item -ItemType Directory -Path (Join-Path $scratchDirectory '.flisk') | Out-Null
  Set-Content -Path (Join-Path $scratchDirectory '.flisk/project.json') -Value '{}'

  $null = Invoke-NativeWindowsRefusal -Label 'flisk up --dry-run' -CliArgs @('up', '--dry-run') -WorkingDirectory $scratchDirectory

  $beforeRuntimeProcesses = @(
    Get-Process -Name @('tilt', 'dockerd', 'containerd', 'com.docker.backend') -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty Id
  )
  $dockerBefore = @()
  $canInspectContainers = $false
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    $dockerBefore = @(& docker ps -aq 2>$null | Where-Object { $_ })
    $canInspectContainers = $LASTEXITCODE -eq 0
  }

  $shopOutput = Invoke-NativeWindowsRefusal -Label 'flisk up shop' -CliArgs @('up', 'shop') -WorkingDirectory $scratchDirectory
} finally {
  Remove-Item -Recurse -Force $scratchDirectory -ErrorAction SilentlyContinue
}
if ($shopOutput -match '(?im)^(Starting|Running tilt up)') {
  throw 'flisk up shop emitted a landscape startup message despite refusing native Windows.'
}

$afterRuntimeProcesses = @(
  Get-Process -Name @('tilt', 'dockerd', 'containerd', 'com.docker.backend') -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Id
)
$newRuntimeProcesses = @($afterRuntimeProcesses | Where-Object { $_ -notin $beforeRuntimeProcesses })
if ($newRuntimeProcesses.Count -gt 0) {
  throw "flisk up shop started runtime processes: $($newRuntimeProcesses -join ', ')"
}

if ($canInspectContainers) {
  $dockerAfter = @(& docker ps -aq 2>$null | Where-Object { $_ })
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker became unavailable while checking the native refusal result.'
  }
  $newContainers = @($dockerAfter | Where-Object { $_ -notin $dockerBefore })
  if ($newContainers.Count -gt 0) {
    throw "flisk up shop started containers: $($newContainers -join ', ')"
  }
}

# Refusal commands intentionally returned non-zero; the assertions above verified them.
$global:LASTEXITCODE = 0
