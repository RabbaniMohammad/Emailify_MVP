# Simple Screenshot Capture Script
Write-Host "==============================================`n" -ForegroundColor Cyan
Write-Host "  Responsive Screenshot Capture Tool`n" -ForegroundColor Cyan
Write-Host "==============================================`n" -ForegroundColor Cyan

# Configuration
$APP_URL = "http://localhost:4200"
$OUTPUT_DIR = "screenshots"
$TIMESTAMP = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"

# Viewports to test
$VIEWPORTS = @(
    @{ Name = "mobile-small"; Width = 375; Height = 667; Label = "Mobile Small" },
    @{ Name = "mobile-large"; Width = 414; Height = 896; Label = "Mobile Large" },
    @{ Name = "tablet-portrait"; Width = 768; Height = 1024; Label = "Tablet Portrait" },
    @{ Name = "tablet-landscape"; Width = 1024; Height = 768; Label = "Tablet Landscape" },
    @{ Name = "desktop-small"; Width = 1366; Height = 768; Label = "Desktop Small" },
    @{ Name = "desktop-large"; Width = 1920; Height = 1080; Label = "Desktop Large" }
)

# Pages to capture
$PAGES = @(
    @{ Path = "/auth"; Name = "login-page" },
    @{ Path = "/templates"; Name = "templates-page" },
    @{ Path = "/admin"; Name = "admin-page" },
    @{ Path = "/visual-editor"; Name = "visual-editor" }
)

# Create output directory
if (-not (Test-Path $OUTPUT_DIR)) {
    New-Item -ItemType Directory -Path $OUTPUT_DIR | Out-Null
    Write-Host "Created screenshots directory`n" -ForegroundColor Green
}

# Create session directory
$SESSION_DIR = Join-Path $OUTPUT_DIR $TIMESTAMP
New-Item -ItemType Directory -Path $SESSION_DIR | Out-Null
Write-Host "Session directory: $SESSION_DIR`n" -ForegroundColor Green

# Check if app is running
Write-Host "Checking if app is running at $APP_URL..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri $APP_URL -Method Head -TimeoutSec 2 -ErrorAction Stop
    Write-Host "App is running!`n" -ForegroundColor Green
}
catch {
    Write-Host "ERROR: App is not running at $APP_URL" -ForegroundColor Red
    Write-Host "Please start your app with: cd frontend; ng serve`n" -ForegroundColor Yellow
    exit 1
}

# Find Chrome
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromePath)) {
    $chromePath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}

if (-not (Test-Path $chromePath)) {
    Write-Host "ERROR: Chrome not found. Please install Google Chrome.`n" -ForegroundColor Red
    exit 1
}

Write-Host "Starting screenshot capture...`n" -ForegroundColor Cyan
$totalScreenshots = 0

foreach ($page in $PAGES) {
    Write-Host "Page: $($page.Name)" -ForegroundColor Magenta
    Write-Host "URL: $APP_URL$($page.Path)" -ForegroundColor Gray
    
    foreach ($viewport in $VIEWPORTS) {
        $filename = "$($page.Name)_$($viewport.Name)_${TIMESTAMP}.png"
        $filepath = Join-Path $SESSION_DIR $filename
        
        Write-Host "  Capturing: $($viewport.Label) ($($viewport.Width)x$($viewport.Height))..." -NoNewline
        
        $url = "$APP_URL$($page.Path)"
        
        try {
            $chromeArgs = @(
                "--headless",
                "--disable-gpu",
                "--screenshot=$filepath",
                "--window-size=$($viewport.Width),$($viewport.Height)",
                "--hide-scrollbars",
                $url
            )
            
            Start-Process -FilePath $chromePath -ArgumentList $chromeArgs -Wait -WindowStyle Hidden
            
            if (Test-Path $filepath) {
                Write-Host " Done" -ForegroundColor Green
                $totalScreenshots++
            } else {
                Write-Host " Failed" -ForegroundColor Red
            }
        }
        catch {
            Write-Host " Error" -ForegroundColor Red
        }
        
        Start-Sleep -Milliseconds 500
    }
    
    Write-Host ""
}

Write-Host "`n==============================================`n" -ForegroundColor Cyan
Write-Host "Capture complete!" -ForegroundColor Green
Write-Host "Total screenshots: $totalScreenshots" -ForegroundColor Cyan
Write-Host "Location: $SESSION_DIR`n" -ForegroundColor Cyan

Write-Host "Opening screenshots folder...`n" -ForegroundColor Yellow
Start-Process explorer.exe $SESSION_DIR

# Create simple HTML report
$reportPath = Join-Path $SESSION_DIR "report.html"
$htmlStart = "<!DOCTYPE html><html><head><title>Screenshot Report - $TIMESTAMP</title><style>body{font-family:sans-serif;padding:20px;background:#f5f5f5}.header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:20px;border-radius:10px;margin-bottom:20px}.page{background:white;padding:20px;margin-bottom:20px;border-radius:10px}.viewport{display:inline-block;margin:10px;text-align:center}img{max-width:300px;border:1px solid #ddd;border-radius:5px}</style></head><body><div class='header'><h1>Screenshot Report</h1><p>Generated: $TIMESTAMP</p><p>URL: $APP_URL</p></div>"
$htmlBody = ""

foreach ($page in $PAGES) {
    $htmlBody += "<div class='page'><h2>$($page.Name)</h2>"
    
    foreach ($viewport in $VIEWPORTS) {
        $filename = "$($page.Name)_$($viewport.Name)_${TIMESTAMP}.png"
        $htmlBody += "<div class='viewport'><h3>$($viewport.Label)</h3><p>$($viewport.Width) x $($viewport.Height)</p><img src='$filename' alt='$($viewport.Label)' onclick='window.open(this.src)'></div>"
    }
    
    $htmlBody += "</div>"
}

$htmlEnd = "</body></html>"
$fullHtml = $htmlStart + $htmlBody + $htmlEnd

$fullHtml | Out-File -FilePath $reportPath -Encoding UTF8
Write-Host "Generated HTML report: $reportPath`n" -ForegroundColor Green

Write-Host "Opening report in browser...`n" -ForegroundColor Yellow
Start-Process $reportPath

Write-Host "==============================================`n" -ForegroundColor Cyan
Write-Host "Done! Review the screenshots and report`n" -ForegroundColor Cyan
Write-Host "==============================================`n" -ForegroundColor Cyan
