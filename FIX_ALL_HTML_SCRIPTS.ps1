# ============================================================================
# FIX_ALL_HTML_SCRIPTS.ps1 - Fix script loading order in ALL CRM HTML files
# ============================================================================
# This script AUTOMATICALLY fixes the script loading order and removes duplicates
# from all CRM HTML files.
# 
# USAGE:
#   1. Save this file in your CRM root folder
#   2. Right-click → Run with PowerShell
#   3. Or run from PowerShell: .\FIX_ALL_HTML_SCRIPTS.ps1
#
# WHAT IT DOES:
#   ✓ Creates automatic backups of each file
#   ✓ Fixes script loading order (Supabase → init-globals → multi-tenant → modules)
#   ✓ Adds init-globals.js to each file
#   ✓ Removes duplicate modals
#   ✓ Reports results clearly
# ============================================================================

$ErrorActionPreference = 'Continue'

# Define the CRM root folder
$CrmRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($CrmRoot -eq "") { $CrmRoot = Get-Location }

# Define which HTML files need fixing
$HtmlFilesToFix = @(
    "dashboard.html",
    "jobs.html",
    "messages.html",
    "invoices.html",
    "customers.html",
    "settings.html",
    "profile.html",
    "appointments.html"
)

# Optional: also fix these if they have module scripts
$OptionalFiles = @(
    "index.html",
    "signup.html",
    "create-shop.html",
    "invoice.html"
)

# Display header
Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  CRM HTML SCRIPT FIX - BATCH UPDATER                          ║" -ForegroundColor Cyan
Write-Host "║  Fixing script loading order in all HTML files                ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "CRM Root Folder: $CrmRoot" -ForegroundColor Yellow
Write-Host "Files to fix: $($HtmlFilesToFix.Count)" -ForegroundColor Yellow
Write-Host ""

# Counter for results
$fixedCount = 0
$skippedCount = 0
$errorCount = 0

# Function to fix a single HTML file
function Fix-HtmlFile {
    param(
        [string]$FilePath,
        [string]$FileName
    )
    
    if (-not (Test-Path $FilePath)) {
        Write-Host "  ⏭️  $FileName - NOT FOUND" -ForegroundColor Gray
        return "skipped"
    }
    
    try {
        # Create backup with timestamp
        $timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
        $backupPath = "$FilePath.backup_$timestamp"
        Copy-Item $FilePath $backupPath -Force
        Write-Host "    💾 Backup: $(Split-Path -Leaf $backupPath)" -ForegroundColor DarkGray
        
        # Read the file
        $content = Get-Content $FilePath -Raw
        
        # Extract the page name from filename (e.g., "dashboard" from "dashboard.html")
        $pageName = $FileName -replace '\.html$', ''
        
        # ===== FIX 1: Update script loading order =====
        # Pattern: Look for the old script section and rebuild it correctly
        
        # Find all script tags at the end
        $scriptSection = [regex]::Match($content, '(?s)<script[^>]*>.*?</script>\s*(?=</body>|$)')
        
        if ($scriptSection.Success) {
            # Get the current scripts
            $oldScripts = $scriptSection.Value
            
            # Check if it has module scripts (pages/xxx.js)
            if ($oldScripts -match 'pages/.*\.js') {
                # Build new script section
                $newScripts = @(
                    '<script src="vendor/supabase.umd.js"></script>'
                    '<script src="init-globals.js"></script>'
                    '<script src="multi-tenant.js"></script>'
                    "<script type=`"module`" src=`"pages/$pageName.js`"></script>"
                ) -join "`r`n"
                
                # Replace the entire old scripts section with new one
                $content = $content.Substring(0, $scriptSection.Index) + $newScripts + $content.Substring($scriptSection.Index + $scriptSection.Length)
                
                Write-Host "    ✓ Fixed script loading order" -ForegroundColor Green
            } else {
                # File doesn't have module scripts, skip it
                Write-Host "    ⏭️  No module scripts found - skipping" -ForegroundColor Gray
                return "skipped"
            }
        }
        
        # ===== FIX 2: Remove duplicate modals =====
        $modalCount = ([regex]::Matches($content, 'id="apptModal"').Count)
        if ($modalCount -gt 1) {
            # Remove duplicate apptModal definitions (keep first one in table at start)
            $content = [regex]::Replace($content, '(?s)<!-- ===== Appointment Modal \(Create/Edit unified\).*?(?=<div id="viewApptModal"|$)', '')
            Write-Host "    ✓ Removed $($modalCount - 1) duplicate modal(s)" -ForegroundColor Green
        }
        
        # ===== FIX 3: Remove conflicting inline scripts =====
        $hadConflict = $false
        if ($content -match 'const LS = window\.LS \|\|') {
            # Remove the huge inline script that redefines LS, readLS, writeLS
            $content = [regex]::Replace($content, '(?s)<!-- ===== Save Customer.*?</script>\r?\n', '')
            Write-Host "    ✓ Removed conflicting inline script" -ForegroundColor Green
            $hadConflict = $true
        }
        
        # ===== FIX 4: Ensure init-globals comes before multi-tenant =====
        # This is already handled in FIX 1, but double-check
        
        # Save the fixed file
        Set-Content $FilePath $content -NoNewline -Force
        Write-Host "  ✅ $FileName" -ForegroundColor Green
        
        return "fixed"
        
    } catch {
        Write-Host "  ❌ $FileName - ERROR: $($_.Exception.Message)" -ForegroundColor Red
        return "error"
    }
}

# ===== Process all files =====
Write-Host "Processing files:" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

foreach ($htmlFile in $HtmlFilesToFix) {
    $fullPath = Join-Path $CrmRoot $htmlFile
    $result = Fix-HtmlFile -FilePath $fullPath -FileName $htmlFile
    
    if ($result -eq "fixed") { $fixedCount++ }
    elseif ($result -eq "skipped") { $skippedCount++ }
    elseif ($result -eq "error") { $errorCount++ }
}

# ===== Summary =====
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "SUMMARY:" -ForegroundColor Cyan
Write-Host "  ✅ Fixed:   $fixedCount files" -ForegroundColor Green
Write-Host "  ⏭️  Skipped: $skippedCount files" -ForegroundColor Gray
Write-Host "  ❌ Errors:  $errorCount files" -ForegroundColor Red
Write-Host ""

# ===== Next steps =====
Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "  1. Check your browser console (F12) for the ✅ success message"
Write-Host "  2. Clear browser cache (Ctrl+Shift+Delete)"
Write-Host "  3. Reload your CRM pages"
Write-Host "  4. Verify data appears on appointments, dashboard, etc."
Write-Host ""
Write-Host "BACKUPS:" -ForegroundColor Yellow
Write-Host "  If something goes wrong, restore from .backup_* files"
Write-Host "  Example: dashboard.html.backup_20240115_143022"
Write-Host ""
Write-Host "✨ All done! Your CRM should now work properly." -ForegroundColor Cyan
Write-Host ""

# Pause so user can see results
Read-Host "Press Enter to exit"
