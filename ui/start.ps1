# Mithra UI launcher - starts the server (if it isn't running) and opens the app window.
# Forkable: uses the script's own folder and reads the port from mithra.config.json.
$ErrorActionPreference = 'SilentlyContinue'
$dir  = $PSScriptRoot                        # ui/ - where server.js lives
$root = Split-Path -Parent $dir              # repo root - where the config lives

# Port: mithra.config.json > default 7777.
$port = 7777
$cfgPath = Join-Path $root 'mithra.config.json'
if (Test-Path $cfgPath) {
    try { $c = Get-Content $cfgPath -Raw | ConvertFrom-Json; if ($c.port) { $port = [int]$c.port } } catch {}
}
$url = "http://127.0.0.1:$port"

# Already running?
$inUse = $false
try {
    $c = New-Object Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', $port)
    $inUse = $true; $c.Close()
} catch {}

if (-not $inUse) {
    $node = (Get-Command node).Source
    if (-not $node) { Write-Host 'Node.js is not on your PATH. Install it: https://nodejs.org'; exit 1 }
    Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $dir -WindowStyle Hidden
    Start-Sleep -Milliseconds 1400
}

# Chromeless app window (Edge or Chrome); falls back to the default browser.
$edge   = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (Test-Path $edge) {
    Start-Process $edge -ArgumentList "--app=$url", "--window-size=1180,760"
} elseif (Test-Path $chrome) {
    Start-Process $chrome -ArgumentList "--app=$url", "--window-size=1180,760"
} else {
    Start-Process $url
}
