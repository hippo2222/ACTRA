# Phase 1 commit helper.
# Run from repo root (D:\Ai Ai\radioproject_git) in PowerShell:
#   .\scripts\commit_phase1.ps1
#
# What it does:
#   1. Removes any stale .git/index.lock left from previous attempts.
#   2. Stages exactly the 13 files modified for Phase 1 (URL cleanup + SEO).
#   3. Shows you what will be committed and asks for confirmation.
#   4. Commits with a structured message.
#   5. Optionally pushes to origin/online-hosting.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "Repo: $repoRoot" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Clean up stale index.lock if present -----------------------------
$lockPath = Join-Path $repoRoot ".git\index.lock"
if (Test-Path $lockPath) {
    Write-Host "Found stale .git\index.lock - removing it..." -ForegroundColor Yellow
    Remove-Item $lockPath -Force
    Write-Host "  Removed." -ForegroundColor Green
}

# --- Step 2: Stage exactly the Phase-1 files ----------------------------------
$phase1Files = @(
    "desktop-app/server.py",
    "desktop-app/routes/static_routes.py",
    "desktop-app/api/session_api.py",
    "desktop-app/routes/auth_routes.py",
    "desktop-app/webview_launcher.py",
    "frontend/Welcome/welcome.html",
    "desktop-app/tests/unit/test_premium_static_gates.py",
    "desktop-app/tests/unit/test_quick_access_routes_start_session.py",
    "desktop-app/tests/unit/test_session_api_resume_restore.py",
    "desktop-app/tests/unit/test_session_routes_active_sessions.py",
    "desktop-app/tests/unit/test_static_routes_resume_redirect.py",
    "desktop-app/tests/e2e/test_ai_import_e2e.py",
    "docs/url_cleanup_plan.md",
    # Deployment helpers for Phase 1:
    "scripts/commit_phase1.ps1",
    "scripts/deploy_phase1.sh"
)

Write-Host "Staging Phase 1 files..." -ForegroundColor Cyan
foreach ($f in $phase1Files) {
    & git add -- $f
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Failed to stage: $f" -ForegroundColor Red
        exit 1
    }
}
Write-Host "  Staged $($phase1Files.Count) files." -ForegroundColor Green
Write-Host ""

# --- Step 3: Show what's staged and confirm -----------------------------------
Write-Host "Staged for commit (should be exactly 13 entries):" -ForegroundColor Cyan
& git status --short | Where-Object { $_ -match '^[MA]' }
Write-Host ""

$stagedCount = (& git status --short | Where-Object { $_ -match '^[MA]' }).Count
if ($stagedCount -ne 15) {
    Write-Host "WARNING: expected 15 staged entries, got $stagedCount" -ForegroundColor Yellow
    Write-Host "Continue anyway? (y/N): " -NoNewline -ForegroundColor Yellow
    $answer = Read-Host
    if ($answer -ne "y") {
        Write-Host "Aborted. Run 'git reset' to unstage." -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "Proceed with commit? (Y/n): " -NoNewline -ForegroundColor Cyan
$confirm = Read-Host
if ($confirm -eq "n") {
    Write-Host "Aborted. Files remain staged. Run 'git reset' to unstage." -ForegroundColor Yellow
    exit 0
}

# --- Step 4: Commit -----------------------------------------------------------
# Write the commit message to a temp file and pass via `git commit -F`.
# This avoids PowerShell here-string parsing pitfalls (BOM, encoding,
# trailing whitespace on @"/"@ markers).
$msgFile = Join-Path $env:TEMP "actra-phase1-commit-msg.txt"
$msgLines = @(
    "Phase 1: drop /ui/ prefix from internal URLs + SEO fixes",
    "",
    "- Add canonical routes without /ui/ prefix; legacy /ui/* now 301-redirects to canonical (query strings preserved).",
    "- Auth gate covers both old /ui/* and new canonical paths.",
    "- get_resume_target, OAuth callback, email URLs use new URLs.",
    "- / now returns 301 (not 302) to /welcome (was 302, which blocked Google from picking a canonical URL).",
    "- welcome.html canonical and og:url point to /welcome (were /, which created a broken canonical loop).",
    "- sitemap.xml includes /welcome.",
    "- Unit/e2e tests updated for new URLs (45/45 passed locally).",
    "",
    "Frontend internal links still reference /ui/* - they go through one 301 hop until Phase 2 updates them.",
    "",
    "See docs/url_cleanup_plan.md for the full migration plan."
)
Set-Content -Path $msgFile -Value $msgLines -Encoding UTF8

& git commit -F $msgFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "Commit failed." -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host "Commit created." -ForegroundColor Green
& git log --oneline -1
Write-Host ""

# --- Step 5: Optional push ----------------------------------------------------
Write-Host "Push to origin/online-hosting now? (Y/n): " -NoNewline -ForegroundColor Cyan
$pushConfirm = Read-Host
if ($pushConfirm -eq "n") {
    Write-Host "Skipped push. To push later: git push origin online-hosting" -ForegroundColor Yellow
    exit 0
}

& git push origin online-hosting
if ($LASTEXITCODE -ne 0) {
    Write-Host "Push failed. You may need to authenticate (use your GitHub Personal Access Token as password)." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Done. Next step: deploy on hetzner." -ForegroundColor Green
Write-Host "  ssh root@91.99.223.246" -ForegroundColor Cyan
Write-Host "  Then on the server, run: bash deploy_phase1.sh (after copying scripts/deploy_phase1.sh there)" -ForegroundColor Cyan
