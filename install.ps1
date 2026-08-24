# Installs the latest published PRSwarm release for Windows.
#
#   irm https://raw.githubusercontent.com/chetratep/prswarm/main/install.ps1 | iex
#
# Draft releases are never installed by this script — GitHub's
# /releases/latest API only ever returns the latest *published* release,
# which is exactly the point of drafting first (see .github/workflows/release.yml):
# nothing reaches an end user until someone hits "Publish" on GitHub.
#
# Env vars (set before running):
#   $env:PRSWARM_VERSION       Install this tag instead of latest (e.g. v1.2.3)
#   $env:PRSWARM_INSTALL_DIR   Install directory (default: $env:LOCALAPPDATA\prswarm)

$ErrorActionPreference = "Stop"

$Repo = "chetratep/prswarm"
$InstallDir = if ($env:PRSWARM_INSTALL_DIR) { $env:PRSWARM_INSTALL_DIR } else { "$env:LOCALAPPDATA\prswarm" }
$Asset = "prswarm-windows-x64.exe"

if ($env:PRSWARM_VERSION) {
    $Tag = $env:PRSWARM_VERSION
} else {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest"
    $Tag = $release.tag_name
    if (-not $Tag) {
        Write-Error "Could not determine the latest release tag. Set `$env:PRSWARM_VERSION to install a specific one."
        exit 1
    }
}

$Url = "https://github.com/$Repo/releases/download/$Tag/$Asset"
$ChecksumsUrl = "https://github.com/$Repo/releases/download/$Tag/SHA256SUMS.txt"

Write-Host "Installing PRSwarm $Tag (windows-x64)..."

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$OutFile = Join-Path $InstallDir "prswarm.exe"
$TmpFile = "$OutFile.download"

Invoke-WebRequest -Uri $Url -OutFile $TmpFile

try {
    $checksums = Invoke-WebRequest -Uri $ChecksumsUrl -UseBasicParsing
    $line = ($checksums.Content -split "`n") | Where-Object { $_ -match [regex]::Escape($Asset) }
    if ($line) {
        $expected = ($line -split '\s+')[0]
        $actual = (Get-FileHash -Path $TmpFile -Algorithm SHA256).Hash.ToLower()
        if ($expected.ToLower() -ne $actual) {
            Remove-Item $TmpFile -Force
            Write-Error "Checksum mismatch for $Asset — expected $expected, got $actual. Aborting."
            exit 1
        }
        Write-Host "Checksum verified."
    }
} catch {
    # No checksums file for this release (older release, or a manual re-run
    # before that step existed) — skip verification rather than fail.
}

Move-Item -Force $TmpFile $OutFile
Write-Host "Installed to $OutFile"

if (($env:Path -split ";") -notcontains $InstallDir) {
    Write-Host ""
    Write-Host "$InstallDir isn't on your PATH. Add it permanently with:"
    Write-Host "  [Environment]::SetEnvironmentVariable('Path', `$env:Path + ';$InstallDir', 'User')"
    Write-Host "(then open a new terminal)"
}

Write-Host ""
Write-Host "Run it with: prswarm"
