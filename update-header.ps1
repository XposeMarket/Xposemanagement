$files = @(
    "dashboard.html",
    "appointments.html", 
    "customers.html",
    "jobs.html",
    "messages.html",
    "invoices.html",
    "settings.html",
    "profile.html"
)

foreach ($file in $files) {
    if (Test-Path $file) {
        $content = Get-Content $file -Raw
        
        # Add the menu toggle button and update nav structure
        $oldNav = '<nav>'
        $newNav = '<button id="menuToggle" class="menu-toggle" aria-label="Toggle menu"><span></span><span></span><span></span></button><nav id="mainNav">'
        
        $content = $content -replace '<nav>', $newNav
        
        Set-Content -Path $file -Value $content -NoNewline
        Write-Host "Updated $file"
    }
}
