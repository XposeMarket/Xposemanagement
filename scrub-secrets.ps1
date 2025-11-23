<#
PowerShell helper script to (a) stage sanitized files, (b) remove .env from history and replace secret-like lines using git-filter-repo, and (c) force-push cleaned history.

USAGE: Run from the repo root in PowerShell (as your normal user). Inspect before running. You must have git and python (for git-filter-repo) installed.

This script will:
- Create a backup branch `backup-main` and push it (optional)
- Commit current sanitized files (.env.sample and .gitignore)
- Attempt to run git-filter-repo to remove .env and replace secret-like patterns using `replacements.txt`
- Verify a few checks and force-push all refs

WARNING: This rewrites history. Make sure you have backups and coordinate with collaborators. If you do not have `git-filter-repo`, follow the guidance in comments.
#>

# Ensure script runs from repo root
Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Definition)

Write-Host "Scrub script starting in: $(Get-Location)" -ForegroundColor Cyan

# 1) Create backup branch
git checkout -b backup-main
git push origin backup-main

# 2) Stage sanitized files
git add .env.sample .gitignore replacements.txt scrub-secrets.ps1
git rm --cached .env -f 2>$null

git commit -m "Sanitize .env.sample, ignore .env, add replacements for secret scrub" -q

# 3) Ensure git-filter-repo is installed
$filterRepoAvailable = $false
try {
    git filter-repo --version > $null 2>&1
    $filterRepoAvailable = $true
} catch {
    $filterRepoAvailable = $false
}

if (-not $filterRepoAvailable) {
    Write-Host "git-filter-repo not found. Attempting to install via pip..." -ForegroundColor Yellow
    python -m pip install --user git-filter-repo
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Automatic install failed. Please install git-filter-repo manually: https://github.com/newren/git-filter-repo" -ForegroundColor Red
        exit 1
    }
}

# 4) Run git-filter-repo to remove .env from history and replace secret-like text
# Make sure replacements.txt path is absolute
$replacePath = Join-Path (Get-Location) "replacements.txt"

Write-Host "Running git-filter-repo to remove .env and replace secrets..." -ForegroundColor Cyan

git filter-repo --invert-paths --paths .env --replace-text "$replacePath"

if ($LASTEXITCODE -ne 0) {
    Write-Host "git-filter-repo failed. Inspect output above." -ForegroundColor Red
    exit 1
}

# 5) Clean up and GC
Write-Host "Expiring reflog and running gc..." -ForegroundColor Cyan
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 6) Quick verification (search for common patterns)
Write-Host "Verifying common patterns are removed..." -ForegroundColor Cyan
$hasSk = git rev-list --all | ForEach-Object { git grep -n "sk-" $_ } 2>$null
if ($hasSk) {
    Write-Host "Found sk- occurrences in history (first few):" -ForegroundColor Red
    $hasSk | Select-Object -First 10 | ForEach-Object { Write-Host $_ }
} else {
    Write-Host "No sk- occurrences found across history." -ForegroundColor Green
}

# 7) Force-push cleaned history
Write-Host "Force-pushing all branches and tags to origin. This is destructive." -ForegroundColor Yellow
git push origin --force --all
git push origin --force --tags

Write-Host "Done. If GitHub still reports secrets, contact GitHub Support and rotate affected keys immediately." -ForegroundColor Green
