# Run Cartwise permanently on a Windows PC, reachable from every device on your
# tailnet over HTTPS.
#
# Run this ON the PC in PowerShell:
#   irm https://raw.githubusercontent.com/tateo12/cartwise/main/scripts/host-on-windows.ps1 | iex

$ErrorActionPreference = 'Stop'
$Repo = 'https://github.com/tateo12/cartwise.git'
$Dir  = Join-Path $HOME 'cartwise'

Write-Host '==> Checking prerequisites'
# node:sqlite is a Node 24 built-in, so 24 is a hard floor, not a preference.
$nodeMajor = 0
if (Get-Command node -ErrorAction SilentlyContinue) {
  $nodeMajor = [int]((node -v).TrimStart('v').Split('.')[0])
}
if ($nodeMajor -lt 24) {
  Write-Host '    Node 24+ required. Install with: winget install OpenJS.NodeJS'
  exit 1
}
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Host '    Installing bun'
  irm bun.sh/install.ps1 | iex
  $env:Path = "$HOME\.bun\bin;$env:Path"
}

Write-Host '==> Fetching code'
if (Test-Path (Join-Path $Dir '.git')) { git -C $Dir pull --ff-only } else { git clone $Repo $Dir }
Set-Location $Dir

Write-Host '==> Building'
bun install --frozen-lockfile
bun run build

Write-Host '==> Starting on port 3000'
# Keep the database beside the checkout so a rebuild never touches it.
$env:CARTWISE_DB = Join-Path $Dir 'cartwise.db'
Start-Process -NoNewWindow bun -ArgumentList 'run','start'
Start-Sleep -Seconds 5

Write-Host '==> Publishing over Tailscale with HTTPS'
# Gives a real certificate and a stable name; nothing is exposed publicly.
tailscale serve --bg 3000

Write-Host ''
Write-Host 'Done. Open the https URL that tailscale printed above on your phone.'
