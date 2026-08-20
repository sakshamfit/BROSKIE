<#
.SYNOPSIS
    Publish a +one over-the-air (OTA) update to installed Android/iOS apps.

.DESCRIPTION
    Pulls main, verifies the expected commits and code are present, installs
    exact dependencies, prints the fingerprint runtime version (which decides
    whether installed builds can even receive this update), publishes the
    update to an EAS channel, then lists the most recent updates.

    JS/asset-only changes ship this way. If the printed fingerprint no longer
    matches what your installed builds were built with, an OTA update will NOT
    reach them and you need a new build instead (npm run build:android).

.EXAMPLE
    .\scripts\publish-update.ps1

.EXAMPLE
    .\scripts\publish-update.ps1 -Message "fix: conversation scroll" -Channel stable
#>
[CmdletBinding()]
param(
    [string]$Message = "feat: Settings > App Updates - one-tap self-update + auto-install on reopen",
    [string]$Channel = "stable",
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
# PowerShell 7.4+ turns a non-zero native exit code into a terminating error.
# This script checks exit codes itself (git merge-base --is-ancestor returns 1
# on purpose), so opt out where the variable exists.
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

function Assert-LastExitCode {
    param([string]$What)
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: $What (exit $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
}

function Write-Step { param([string]$Text) Write-Host "`n=== $Text ===" -ForegroundColor Cyan }

# Repo root = parent of the folder holding this script
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
Write-Host "Repository: $repoRoot" -ForegroundColor DarkGray

Write-Step "Working tree"
git status --short
$dirty = git status --porcelain
if ($dirty) {
    Write-Host "Uncommitted changes present — commit or stash them before publishing." -ForegroundColor Yellow
    exit 1
}

Write-Step "Update main"
git fetch origin
Assert-LastExitCode "git fetch"
git switch main
Assert-LastExitCode "git switch main"
git pull --ff-only origin main
Assert-LastExitCode "git pull"

Write-Step "Recent commits"
git log --oneline -5

Write-Step "Verify the App Updates feature is in this checkout"
$requiredCommits = @{
    'a5bf76a' = 'App Updates feature commit'
    '2f31dd1' = 'PR #9 merge commit'
}
foreach ($sha in $requiredCommits.Keys) {
    git merge-base --is-ancestor $sha HEAD 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host ("{0} {1} is present" -f $sha, $requiredCommits[$sha]) -ForegroundColor Green
    } else {
        Write-Host ("{0} {1} is MISSING" -f $sha, $requiredCommits[$sha]) -ForegroundColor Red
        exit 1
    }
}

$codeChecks = @(
    @{ Path = '.\app\src\updates.js';                  Pattern = 'checkForUpdate|fetchUpdateAsync|reloadAsync|startUpdateLifecycle' },
    @{ Path = '.\app\src\components\UpdateSection.js'; Pattern = 'Update now|Auto-install updates' },
    @{ Path = '.\app\App.js';                          Pattern = 'startUpdateLifecycle' },
    @{ Path = '.\app\src\screens\SettingsScreen.js';   Pattern = 'UpdateSection|App Updates' }
)
foreach ($check in $codeChecks) {
    if (-not (Test-Path $check.Path)) {
        Write-Host ("MISSING FILE: {0}" -f $check.Path) -ForegroundColor Red
        exit 1
    }
    $hits = Select-String -Path $check.Path -Pattern $check.Pattern
    if ($hits) {
        Write-Host ("{0}: {1} match(es)" -f $check.Path, $hits.Count) -ForegroundColor Green
    } else {
        Write-Host ("{0}: pattern not found" -f $check.Path) -ForegroundColor Red
        exit 1
    }
}

Set-Location .\app

if (-not $SkipInstall) {
    Write-Step "Install exact dependencies"
    npm ci
    Assert-LastExitCode "npm ci"
}

Write-Step "Expo account and project"
npx eas-cli@latest whoami
Assert-LastExitCode "eas whoami (run: npx eas-cli@latest login)"
npx eas-cli@latest project:info
Assert-LastExitCode "eas project:info"

Write-Step "Fingerprint runtime version (must match your installed builds)"
Write-Host "Android:" -ForegroundColor DarkGray
$androidFingerprint = (npx expo-updates fingerprint:generate --platform android 2>$null | ConvertFrom-Json).hash
Write-Host $androidFingerprint
Write-Host "iOS:" -ForegroundColor DarkGray
$iosFingerprint = (npx expo-updates fingerprint:generate --platform ios 2>$null | ConvertFrom-Json).hash
Write-Host $iosFingerprint
Write-Host "If these differ from the runtime version listed for your installed build," -ForegroundColor Yellow
Write-Host "publish will succeed but no device will pick it up — make a new build instead." -ForegroundColor Yellow

Write-Step "Publish OTA update to channel '$Channel'"
npx eas-cli@latest update --channel $Channel --message $Message
Assert-LastExitCode "eas update"

Write-Step "Recent updates on '$Channel'"
npx eas-cli@latest update:list --channel $Channel --limit 5

Set-Location $repoRoot
Write-Host "`nDone. Installed apps download this in the background and install it the next time they are reopened." -ForegroundColor Green
Write-Host "To apply it right away on a device: Settings > App Updates > Update now." -ForegroundColor Green
