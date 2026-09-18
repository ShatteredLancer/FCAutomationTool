$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

Write-Host "Serving FC Plugins from $root"
Write-Host "URL: http://127.0.0.1:8765/FCAutomationTool.user.js"
Write-Host "FC27: reinstall the built userscript in Tampermonkey, then refresh the Web App."
Write-Host "The legacy Reload Loop script cannot load FC27. Keep this server open during installation."

python -m http.server 8765 --bind 127.0.0.1
