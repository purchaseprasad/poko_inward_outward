# Starts the API (port 3001) and the React app (port 5173) in two windows.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path "$root\server\.env")) { Write-Host "Create server\.env first (copy server\.env.example and set PGPASSWORD)." -ForegroundColor Red; exit 1 }
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\server'; npm run dev"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\client'; npm run dev"
Start-Sleep 4
Start-Process "http://localhost:5173"
