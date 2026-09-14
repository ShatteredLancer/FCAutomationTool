$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

Write-Host "Serving FC Plugins from $root"
Write-Host "URL: http://127.0.0.1:8765/FCAutomationTool.user.js"
Write-Host "Keep this window open while using Reload Loop."

python -m http.server 8765 --bind 127.0.0.1
