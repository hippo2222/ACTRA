[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateSet("show-clone-plan", "init-local")]
    [string]$Mode = "show-clone-plan",
    [string]$RemoteUrl = "",
    [string]$Branch = "main",
    [string]$InitialCommitMessage = "Initial local snapshot",
    [switch]$NoCommit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-Git {
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        throw "Git is not installed or not in PATH."
    }
}

function Get-CurrentRepoRoot {
    try {
        $root = (& git rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -eq 0 -and $root) {
            return ($root | Select-Object -First 1)
        }
    } catch {
        return $null
    }
    return $null
}

function Show-ClonePlan {
    $currentPath = (Get-Location).Path
    $suggestedTarget = Join-Path (Split-Path $currentPath -Parent) "radioproject_git"

    Write-Host ""
    Write-Host "Recommended flow (keeps real remote history):" -ForegroundColor Cyan
    Write-Host "1) Clone into a clean folder:"
    Write-Host "   git clone <REMOTE_URL> `"$suggestedTarget`""
    Write-Host ""
    Write-Host "2) Copy local changes into that clone (exclude heavy/generated dirs):"
    Write-Host "   robocopy `"$currentPath`" `"$suggestedTarget`" /E /XD .git node_modules .venv dist build logs /XF coverage.xml"
    Write-Host ""
    Write-Host "3) In cloned folder:"
    Write-Host "   cd `"$suggestedTarget`""
    Write-Host "   git status"
    Write-Host "   git add ."
    Write-Host "   git commit -m `"$InitialCommitMessage`""
    Write-Host "   git push"
    Write-Host ""
    Write-Host "If you only need local Git without history, use:" -ForegroundColor Yellow
    Write-Host "   .\scripts\fix_git_root.ps1 -Mode init-local"
    Write-Host ""
}

function Init-LocalRepo {
    $currentPath = (Get-Location).Path
    if (Test-Path ".git") {
        throw "Current folder already contains .git."
    }

    if ($PSCmdlet.ShouldProcess($currentPath, "Initialize local git repository")) {
        & git init -b $Branch 2>$null
        if ($LASTEXITCODE -ne 0) {
            & git init
            if ($LASTEXITCODE -ne 0) {
                throw "git init failed."
            }
            & git branch -M $Branch
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to rename branch to '$Branch'."
            }
        }

        if ($RemoteUrl) {
            & git remote add origin $RemoteUrl
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to add remote origin."
            }
        }

        & git add .
        if ($LASTEXITCODE -ne 0) {
            throw "git add failed."
        }

        if (-not $NoCommit) {
            & git commit -m $InitialCommitMessage
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "Commit failed. Configure user.name/user.email and retry commit."
                Write-Host "  git config user.name `"Your Name`""
                Write-Host "  git config user.email `"you@example.com`""
            }
        }

        Write-Host ""
        Write-Host "Local git repo prepared in: $currentPath" -ForegroundColor Green
        & git status --short
    }
}

Require-Git

$existingRoot = Get-CurrentRepoRoot
if ($existingRoot) {
    Write-Host "Current folder is already under Git root:" -ForegroundColor Yellow
    Write-Host "  $existingRoot"
    exit 0
}

switch ($Mode) {
    "show-clone-plan" { Show-ClonePlan }
    "init-local" { Init-LocalRepo }
}

