param(
    [switch]$InfraOnly,
    [switch]$NoDocker
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
Set-Location $repoRoot

$envFile = Join-Path $repoRoot ".env.localhost"
$envExampleFile = Join-Path $repoRoot ".env.localhost.example"
$venvDir = Join-Path $repoRoot ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$requirementsFile = Join-Path $repoRoot "requirements-hosted.txt"

function Get-BootstrapPython {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        return @("py", "-3.12")
    }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        return @("python")
    }
    throw "Python was not found in PATH."
}

function Ensure-Venv {
    if (Test-Path $venvPython) {
        return
    }

    $bootstrap = Get-BootstrapPython
    $bootstrapArgs = @()
    if ($bootstrap.Length -gt 1) {
        $bootstrapArgs = $bootstrap[1..($bootstrap.Length - 1)]
    }
    Write-Host "Creating local virtual environment in .venv ..."
    & $bootstrap[0] @($bootstrapArgs + "-m", "venv", ".venv")
}

function Ensure-HostedDependencies {
    Write-Host "Checking Python dependencies in .venv ..."
    $checkCode = "import importlib.util, sys; mods=('flask','psycopg'); missing=[m for m in mods if importlib.util.find_spec(m) is None]; sys.exit(0 if not missing else 1)"
    $stdoutFile = Join-Path $env:TEMP "actra-dev-python-check.stdout.log"
    $stderrFile = Join-Path $env:TEMP "actra-dev-python-check.stderr.log"

    if (Test-Path $stdoutFile) { Remove-Item $stdoutFile -Force }
    if (Test-Path $stderrFile) { Remove-Item $stderrFile -Force }

    $checkProcess = Start-Process -FilePath $venvPython `
        -ArgumentList @("-c", $checkCode) `
        -NoNewWindow `
        -PassThru `
        -Wait `
        -RedirectStandardOutput $stdoutFile `
        -RedirectStandardError $stderrFile

    if ($checkProcess.ExitCode -eq 0) {
        return
    }

    Write-Host "Installing hosted Python dependencies ..."
    & $venvPython -m pip install --upgrade pip
    & $venvPython -m pip install -r $requirementsFile
}

function Assert-DockerDaemonReady {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker CLI was not found in PATH."
    }

    & docker info --format '{{.ServerVersion}}' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker daemon is not available. Start Docker Desktop, or rerun with -NoDocker only if your local Postgres/MinIO/Mailpit stack is already running."
    }
}

function Test-PostgresConnection {
    $code = @'
import os
import sys

import psycopg

dsn = os.environ.get("ACTRA_POSTGRES_DSN", "").strip()
if not dsn:
    sys.exit(2)

try:
    with psycopg.connect(dsn, connect_timeout=3) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
except Exception:
    sys.exit(1)

sys.exit(0)
'@

    $code | & $venvPython - 1>$null 2>$null
    return ($LASTEXITCODE -eq 0)
}

function Wait-ForPostgresReady {
    param(
        [int]$TimeoutSeconds = 60
    )

    $dsn = [System.Environment]::GetEnvironmentVariable("ACTRA_POSTGRES_DSN", "Process")
    if (-not $dsn) {
        throw "ACTRA_POSTGRES_DSN is not set; cannot verify Postgres readiness."
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-PostgresConnection) {
            Write-Host "Postgres is ready."
            return
        }
        Start-Sleep -Seconds 2
    }

    throw "Postgres did not become ready within $TimeoutSeconds seconds. Check Docker Desktop, port 5432, and ACTRA_POSTGRES_DSN."
}

if (-not (Test-Path $envFile)) {
    if (-not (Test-Path $envExampleFile)) {
        throw "Missing $envExampleFile"
    }
    Copy-Item $envExampleFile $envFile
    Write-Host "Created .env.localhost from .env.localhost.example"
}

Ensure-Venv
Ensure-HostedDependencies

foreach ($dir in @("data", "logs", "runtime_state")) {
    $path = Join-Path $repoRoot $dir
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Path $path | Out-Null
    }
}

if (-not $NoDocker) {
    Assert-DockerDaemonReady
    Write-Host "Starting local infra containers..."
    & docker compose --env-file .env.localhost -f docker-compose.hosted.yml -f docker-compose.localhost.yml up -d postgres minio minio-init mailpit
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to start local infra containers via docker compose."
    }
}

Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line) { return }
    if ($line.StartsWith("#")) { return }

    $pair = $line -split "=", 2
    $name = $pair[0].Trim()
    $value = ""
    if ($pair.Length -gt 1) {
        $value = $pair[1]
    }
    [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
}

# Localhost dev runs should be easy to enter without full auth setup.
[System.Environment]::SetEnvironmentVariable("ACTRA_HOSTED_DEV_AUTH_BRIDGE", "1", "Process")

Wait-ForPostgresReady

Write-Host ""
Write-Host "Local URLs:"
Write-Host "  App:     http://localhost:8000/welcome"
Write-Host "  Mailpit: http://localhost:8025"
Write-Host "  Dev auth bridge: enabled"
Write-Host ""

if ($InfraOnly) {
    Write-Host "InfraOnly mode: app server was not started."
    exit 0
}

$pythonExe = $venvPython

Write-Host "Starting hosted app from source with $pythonExe ..."
& $pythonExe ".\desktop-app\hosted_entrypoint.py"
