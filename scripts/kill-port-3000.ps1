# Kill processes using port 3000 (React dev server)
# Run before npm run dev to avoid "Something is already running on port 3000"

Write-Host "Checking for processes on port 3000..." -ForegroundColor Yellow

$processes = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique

if ($processes) {
    foreach ($procId in $processes) {
        try {
            $processName = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
            Write-Host "Killing process $procId ($processName) on port 3000..." -ForegroundColor Red
            Stop-Process -Id $procId -Force -ErrorAction Stop
        } catch {
            Write-Host "Could not kill process $procId : $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    Write-Host "Port 3000 is now free." -ForegroundColor Green
    Start-Sleep -Seconds 1
} else {
    Write-Host "No process found on port 3000. Port is free." -ForegroundColor Green
}
