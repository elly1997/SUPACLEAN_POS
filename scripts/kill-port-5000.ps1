# Kill processes using port 5000
# This script helps prevent EADDRINUSE errors by cleaning up port 5000 before starting the server

Write-Host "Checking for processes on port 5000..." -ForegroundColor Yellow

$processes = Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique

if ($processes) {
    foreach ($procId in $processes) {
        try {
            $processName = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
            Write-Host "Killing process $procId ($processName) on port 5000..." -ForegroundColor Red
            Stop-Process -Id $procId -Force -ErrorAction Stop
        } catch {
            Write-Host "Could not kill process $procId : $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    Write-Host "Port 5000 is now free." -ForegroundColor Green
    Start-Sleep -Seconds 1
} else {
    Write-Host "No process found on port 5000. Port is free." -ForegroundColor Green
}