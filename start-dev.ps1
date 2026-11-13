<#
  Start the whole dev stack: PostgreSQL -> moto (S3) -> [Cloudflare tunnel] -> API -> Next.
  Services that are already running are skipped. Each one opens in its own window (close it to stop it).

  .\start-dev.cmd              local only   (http://localhost:3111)
  .\start-dev.cmd -Tunnel      + public link via Cloudflare quick tunnel (FRONTEND_URL is updated automatically)
  .\start-dev.cmd -Build       rebuild the frontend first (needed after changing frontend code)
#>
param([switch]$Tunnel, [switch]$Build)
$ErrorActionPreference = 'Stop'

$Root        = $PSScriptRoot
$Backend     = Join-Path $Root 'backend'
$Frontend    = Join-Path $Root 'frontend'
$EnvFile     = Join-Path $Backend '.env'
$PgBin       = 'C:\Program Files\PostgreSQL\18\bin'
$PgData      = 'e:\Ky4-KyThucTapTotNghiep\pgdata-dev'
$PgLog       = 'e:\Ky4-KyThucTapTotNghiep\pgdata-dev.log'
$Cloudflared = 'C:\Users\Admin\tools\cloudflared.exe'
$TunnelLog   = Join-Path $env:TEMP 'haken-cloudflared.log'

function Test-Port([int]$Port) {
    [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}
function Wait-Port([int]$Port, [int]$Seconds) {
    for ($i = 0; $i -lt $Seconds; $i++) { if (Test-Port $Port) { return $true }; Start-Sleep -Seconds 1 }
    return $false
}
function Open-Window([string]$Title, [string]$Dir, [string]$Command) {
    $cmd = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$Dir'; $Command"
    Start-Process powershell -WorkingDirectory $Dir -ArgumentList '-NoExit', '-NoProfile', '-Command', $cmd | Out-Null
}
function Set-FrontendUrl([string]$Url) {
    $raw = [IO.File]::ReadAllText($EnvFile)
    if ($raw -match '(?m)^FRONTEND_URL=') {
        $raw = [regex]::Replace($raw, '(?m)^FRONTEND_URL=[^\r\n]*', "FRONTEND_URL=$Url")
    } else {
        $raw = $raw.TrimEnd() + "`r`nFRONTEND_URL=$Url`r`n"
    }
    [IO.File]::WriteAllText($EnvFile, $raw, (New-Object Text.UTF8Encoding $false))
}

# 1. PostgreSQL
if (Test-Port 55432) { Write-Host '[skip] PostgreSQL already running on 55432' }
else {
    Write-Host '[start] PostgreSQL (55432)'
    # Launched detached: the server inherits pg_ctl's output handles, so piping/waiting on pg_ctl would hang.
    Start-Process -FilePath "$PgBin\pg_ctl.exe" -ArgumentList '-D', "`"$PgData`"", '-o', '"-p 55432"', '-l', "`"$PgLog`"", 'start' -WindowStyle Hidden
    if (-not (Wait-Port 55432 30)) { throw "PostgreSQL did not start - see $PgLog" }
}

# 2. moto = local S3
if (Test-Port 9000) { Write-Host '[skip] moto already running on 9000' }
else {
    Write-Host '[start] moto S3 (9000)'
    Open-Window 'moto S3 :9000' $Backend '.\.venv\Scripts\moto_server.exe -p 9000'
}

# 3. Tunnel first, so the API starts with the right FRONTEND_URL
$PublicUrl = 'http://localhost:3111'
if ($Tunnel) {
    Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
    Remove-Item $TunnelLog -ErrorAction SilentlyContinue
    Write-Host '[start] Cloudflare tunnel -> 3111 (waiting for the link...)'
    Open-Window 'Cloudflare tunnel' $Root "& '$Cloudflared' tunnel --url http://localhost:3111 --logfile '$TunnelLog'"
    $found = $null
    for ($i = 0; $i -lt 45 -and -not $found; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Path $TunnelLog) {
            $m = Select-String -Path $TunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
            if ($m) { $found = $m.Matches[0].Value }
        }
    }
    if ($found) { $PublicUrl = $found } else { Write-Warning 'Tunnel link not found yet - look in the "Cloudflare tunnel" window.' }
}
Set-FrontendUrl $PublicUrl

# 4. API (reads backend/.env; restart it so a new FRONTEND_URL is picked up)
if (Test-Port 8000) {
    $owner = (Get-NetTCPConnection -LocalPort 8000 -State Listen).OwningProcess | Select-Object -First 1
    Write-Host '[restart] API (to load the current .env)'
    Stop-Process -Id $owner -Force
    Start-Sleep -Seconds 1
} else { Write-Host '[start] API (8000)' }
# --proxy-headers: the browser reaches the API through Next (127.0.0.1), so take the visitor's IP from the
# X-Forwarded-For header that Next adds - trusted ONLY when the request comes from this machine. Without it
# every visitor shares one IP and the rate limits (login, contact form, view counter) act site-wide.
Open-Window 'API :8000' $Backend '.\.venv\Scripts\uvicorn.exe app.main:app --port 8000 --proxy-headers --forwarded-allow-ips 127.0.0.1'

# 5. Frontend (production build)
$hasBuild = Test-Path (Join-Path $Frontend '.next\BUILD_ID')
if ($Build -or -not $hasBuild) {
    if (Test-Port 3111) {
        $owner = (Get-NetTCPConnection -LocalPort 3111 -State Listen).OwningProcess | Select-Object -First 1
        Stop-Process -Id $owner -Force
        Start-Sleep -Seconds 1
    }
    Write-Host '[build] frontend (npm run build) ...'
    Push-Location $Frontend
    try { npm run build; if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed - see the errors above.' } }
    finally { Pop-Location }
}
if (Test-Port 3111) { Write-Host '[skip] Next already running on 3111' }
else {
    Write-Host '[start] Next (3111)'
    Open-Window 'Next :3111' $Frontend 'npm run start -- -p 3111'
}

# Summary
Write-Host ''
Write-Host 'Waiting for the services...'
$ok = @{}
foreach ($p in 55432, 9000, 8000, 3111) { $ok[$p] = Wait-Port $p 60 }
Write-Host ('  PostgreSQL 55432 : ' + $(if ($ok[55432]) { 'OK' } else { 'NOT RUNNING' }))
Write-Host ('  moto S3    9000  : ' + $(if ($ok[9000])  { 'OK' } else { 'NOT RUNNING' }))
Write-Host ('  API        8000  : ' + $(if ($ok[8000])  { 'OK' } else { 'NOT RUNNING - see the "API" window' }))
Write-Host ('  Website    3111  : ' + $(if ($ok[3111])  { 'OK' } else { 'NOT RUNNING - see the "Next" window' }))
Write-Host ''
Write-Host "Open:        $PublicUrl/ja"
Write-Host "Admin:       $PublicUrl/ja/admin"
if ($Tunnel) {
    Write-Host ''
    Write-Host 'Google login: add this to Google Cloud Console > Credentials > Authorized redirect URIs:' -ForegroundColor Yellow
    Write-Host "  $PublicUrl/api/v1/auth/oauth/google/callback" -ForegroundColor Yellow
}
