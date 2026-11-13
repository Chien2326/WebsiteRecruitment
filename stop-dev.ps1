# Stop the whole dev stack started by start-dev.ps1. Data in PostgreSQL is kept.
$PgBin  = 'C:\Program Files\PostgreSQL\18\bin'
$PgData = 'e:\Ky4-KyThucTapTotNghiep\pgdata-dev'

foreach ($item in @(@{Port = 3111; Name = 'Next'}, @{Port = 8000; Name = 'API'}, @{Port = 9000; Name = 'moto S3'})) {
    $ids = (Get-NetTCPConnection -LocalPort $item.Port -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
    if ($ids) { $ids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; Write-Host "[stop] $($item.Name)" }
    else { Write-Host "[skip] $($item.Name) not running" }
}
if (Get-Process cloudflared -ErrorAction SilentlyContinue) {
    Get-Process cloudflared | Stop-Process -Force; Write-Host '[stop] Cloudflare tunnel'
}
if (Get-NetTCPConnection -LocalPort 55432 -State Listen -ErrorAction SilentlyContinue) {
    & "$PgBin\pg_ctl.exe" -D $PgData -m fast -w stop *> $null; Write-Host '[stop] PostgreSQL'
} else { Write-Host '[skip] PostgreSQL not running' }
