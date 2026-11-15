# Installs Eon on Windows: Node.js and Git if they are missing, Eon's own dependencies, the `eon` command, a desktop shortcut.
# Safe to run again. Normally started by double-clicking install.bat.
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Winget-Install($id, $label) {
  if (-not (Have 'winget')) {
    Write-Host "winget is not available on this PC, so $label cannot be installed automatically." -ForegroundColor Yellow
    return $false
  }
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
  Refresh-Path
  return $true
}

try {
  Step 'Checking Node.js (version 18 or newer)'
  $nodeOk = $false
  if (Have 'node') { $nodeOk = ([int](& node -p "process.versions.node.split('.')[0]")) -ge 18 }
  if (-not $nodeOk) {
    Write-Host 'Node.js is missing or too old. Installing it (a Windows prompt may ask you to allow it).'
    [void](Winget-Install 'OpenJS.NodeJS.LTS' 'Node.js')
    if (-not (Have 'node')) { Start-Process 'https://nodejs.org'; throw 'Node.js is still not available. Install the LTS version from nodejs.org (opened for you), then double-click install.bat again.' }
  }
  Write-Host ("Node " + (& node -v)) -ForegroundColor Green

  Step 'Checking Git'
  if (-not (Have 'git')) {
    Write-Host 'Git is missing. Installing it.'
    [void](Winget-Install 'Git.Git' 'Git')
    if (-not (Have 'git')) { Start-Process 'https://git-scm.com/download/win'; throw 'Git is still not available. Install it from git-scm.com (opened for you), then double-click install.bat again.' }
  }
  Write-Host (& git --version) -ForegroundColor Green

  Step 'Installing Eon (this downloads a browser the first time; it can take a few minutes)'
  $setupArgs = @('bin/setup.js')
  if ($env:EON_SKIP_BROWSER -eq '1') { $setupArgs += '--no-browser' }
  & node @setupArgs
  if ($LASTEXITCODE -ne 0) { throw 'The setup step failed. The messages above say why.' }
  Refresh-Path

  Step 'Adding a desktop shortcut'
  try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut((Join-Path $desktop 'Eon.lnk'))
    $lnk.TargetPath = "$env:ComSpec"
    $lnk.Arguments = '/k "echo Go to your project folder, then type: eon  (for example: cd C:\code\myapp)"'
    $lnk.WorkingDirectory = [Environment]::GetFolderPath('MyDocuments')
    $lnk.Description = 'Open a terminal ready to run Eon'
    $lnk.Save()
    Write-Host 'Added "Eon" to your desktop.' -ForegroundColor Green
  } catch { Write-Host "Could not add the shortcut (not important): $($_.Exception.Message)" -ForegroundColor Yellow }

  Step 'Checking this computer'
  if (Have 'eon') { & eon first-run } else { & node bin/eon.js first-run }

  Write-Host "`nDone. Open a NEW terminal, go to a project folder and type:  eon" -ForegroundColor Green
  Write-Host 'First time: type  eon login  to sign in to DeepSeek.' -ForegroundColor Green
} catch {
  Write-Host "`nInstall stopped: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'If you are stuck, tell whoever is helping you what the message above says.'
  exit 1
}
