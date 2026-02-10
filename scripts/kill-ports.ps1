# Free ports 5000 and 3000 so SUPACLEAN POS can start (server + React client)
# Run before npm run dev to avoid EADDRINUSE / "Something is already running on port..."

$ports = @(5000, 3000)
foreach ($port in $ports) {
    Write-Host "Checking for processes on port $port..." -ForegroundColor Yellow
    $processes = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    if ($processes) {
        foreach ($procId in $processes) {
            try {
                $processName = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
                Write-Host "Killing process $procId ($processName) on port $port..." -ForegroundColor Red
                Stop-Process -Id $procId -Force -ErrorAction Stop
            } catch {
                Write-Host "Could not kill process $procId : $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
        Write-Host "Port $port is now free." -ForegroundColor Green
        Start-Sleep -Seconds 1
    } else {
        Write-Host "No process found on port $port. Port is free." -ForegroundColor Green
    }
}
