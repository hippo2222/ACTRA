# ACTRA Dev Server Startup Script
# Запускает PostgreSQL (порт 5433), MinIO и Flask-сервер для локальной разработки.
#
# ВАЖНО: PostgreSQL пробрасывается на порт 5433 (не 5432), чтобы избежать
# конфликтов с Windows TIME_WAIT при перезапусках. DSN уже учитывает это.
#
# Использование: .\start-dev.ps1

Set-Location $PSScriptRoot

Write-Host "🐳 Запускаем Docker-сервисы (postgres:5433, minio:9000)..." -ForegroundColor Cyan
docker compose -f docker-compose.hosted.yml -f docker-compose.localhost.yml up -d postgres minio 2>&1 | Out-Null

# Ждём пока PostgreSQL поднимется
Write-Host "⏳ Ожидаем готовности PostgreSQL..." -ForegroundColor Yellow
$maxWait = 30
$waited = 0
do {
    Start-Sleep -Seconds 2
    $waited += 2
    $listening = netstat -an | Select-String "127.0.0.1:5433.*LISTEN"
} while (-not $listening -and $waited -lt $maxWait)

if (-not $listening) {
    Write-Host "❌ PostgreSQL не поднялся за $maxWait сек. Проверьте Docker." -ForegroundColor Red
    exit 1
}
Write-Host "✅ PostgreSQL готов на порту 5433" -ForegroundColor Green

# Загружаем переменные из .env / .env.localhost если существуют
$envFile = if (Test-Path ".env.localhost") { ".env.localhost" } elseif (Test-Path ".env") { ".env" } else { $null }
$envVars = @{}
if ($envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line -split "=", 2
            $envVars[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
        }
    }
}

$pgPassword = if ($envVars.ContainsKey("POSTGRES_PASSWORD")) { $envVars["POSTGRES_PASSWORD"] } else { "change-me-before-production" }
$s3Access   = if ($envVars.ContainsKey("ACTRA_S3_ACCESS_KEY")) { $envVars["ACTRA_S3_ACCESS_KEY"] } else { "minioadmin" }
$s3Secret   = if ($envVars.ContainsKey("ACTRA_S3_SECRET_KEY")) { $envVars["ACTRA_S3_SECRET_KEY"] } else { "minioadmin" }
$appSecret  = if ($envVars.ContainsKey("ACTRA_SECRET_KEY")) { $envVars["ACTRA_SECRET_KEY"] } else { "actra_dev_secret_key" }
$s3Bucket   = if ($envVars.ContainsKey("ACTRA_S3_BUCKET")) { $envVars["ACTRA_S3_BUCKET"] } else { "actra" }
$pgDsn      = "postgresql://actra:${pgPassword}@127.0.0.1:5433/actra"

# Запускаем Flask-сервер
Write-Host "🚀 Запускаем ACTRA сервер на http://127.0.0.1:8000 ..." -ForegroundColor Cyan
[System.Environment]::SetEnvironmentVariable("TRAINER_HTTP_PORT", "8000", "Process")
[System.Environment]::SetEnvironmentVariable("ACTRA_RUNTIME_MODE", "hosted_web", "Process")
[System.Environment]::SetEnvironmentVariable("ACTRA_POSTGRES_DSN", $pgDsn, "Process")
[System.Environment]::SetEnvironmentVariable("ACTRA_S3_ENDPOINT", "http://127.0.0.1:9000", "Process")
[System.Environment]::SetEnvironmentVariable("ACTRA_S3_BUCKET", $s3Bucket, "Process")
[System.Environment]::SetEnvironmentVariable("ACTRA_S3_ACCESS_KEY", $s3Access, "Process")
[System.Environment]::SetEnvironmentVariable("ACTRA_S3_SECRET_KEY", $s3Secret, "Process")
[System.Environment]::SetEnvironmentVariable("ACTRA_SECRET_KEY", $appSecret, "Process")

.venv\Scripts\python desktop-app/server.py
