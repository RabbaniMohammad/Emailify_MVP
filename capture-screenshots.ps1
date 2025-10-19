# Automated Responsive Screenshot Capture Script
# Captures screenshots at multiple viewport sizes for responsive testing

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Responsive Screenshot Capture Tool" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$APP_URL = "http://localhost:4200"
$OUTPUT_DIR = "screenshots"
$TIMESTAMP = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"

# Viewport configurations
$VIEWPORTS = @(
    @{ Name = "mobile-small"; Width = 375; Height = 667; Label = "Mobile (iPhone SE)" }
    @{ Name = "mobile-large"; Width = 414; Height = 896; Label = "Mobile (iPhone 11)" }
    @{ Name = "tablet-portrait"; Width = 768; Height = 1024; Label = "Tablet Portrait" }
    @{ Name = "tablet-landscape"; Width = 1024; Height = 768; Label = "Tablet Landscape" }
    @{ Name = "desktop-small"; Width = 1366; Height = 768; Label = "Desktop Small" }
    @{ Name = "desktop-large"; Width = 1920; Height = 1080; Label = "Desktop Large" }
)

# Pages to capture
$PAGES = @(
    @{ Path = "/auth"; Name = "login-page" }
    @{ Path = "/templates"; Name = "templates-page" }
    @{ Path = "/admin"; Name = "admin-page" }
    @{ Path = "/visual-editor"; Name = "visual-editor" }
)

# Create output directory
if (-not (Test-Path $OUTPUT_DIR)) {
    New-Item -ItemType Directory -Path $OUTPUT_DIR | Out-Null
    Write-Host "✓ Created screenshots directory" -ForegroundColor Green
}

# Create timestamped subdirectory
$SESSION_DIR = Join-Path $OUTPUT_DIR $TIMESTAMP
New-Item -ItemType Directory -Path $SESSION_DIR | Out-Null
Write-Host "✓ Session directory: $SESSION_DIR" -ForegroundColor Green
Write-Host ""

# Function to check if app is running
function Test-AppRunning {
    try {
        $response = Invoke-WebRequest -Uri $APP_URL -Method Head -TimeoutSec 2 -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

# Check if app is running
Write-Host "Checking if app is running at $APP_URL..." -ForegroundColor Yellow
if (-not (Test-AppRunning)) {
    Write-Host "✗ App is not running at $APP_URL" -ForegroundColor Red
    Write-Host "  Please start your app with: cd frontend; ng serve" -ForegroundColor Yellow
    exit 1
}
Write-Host "✓ App is running!" -ForegroundColor Green
Write-Host ""

# Check if Chrome is installed
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromePath)) {
    $chromePath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}

if (-not (Test-Path $chromePath)) {
    Write-Host "✗ Chrome not found. Please install Google Chrome." -ForegroundColor Red
    exit 1
}

Write-Host "Starting screenshot capture..." -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

$totalScreenshots = 0

foreach ($page in $PAGES) {
    Write-Host "📄 Page: $($page.Name)" -ForegroundColor Magenta
    Write-Host "   URL: $APP_URL$($page.Path)" -ForegroundColor Gray
    
    foreach ($viewport in $VIEWPORTS) {
        $filename = "$($page.Name)_$($viewport.Name)_${TIMESTAMP}.png"
        $filepath = Join-Path $SESSION_DIR $filename
        
        Write-Host "  📸 Capturing: $($viewport.Label) ($($viewport.Width)x$($viewport.Height))..." -NoNewline
        
        # Launch Chrome in headless mode to capture screenshot
        $url = "$APP_URL$($page.Path)"
        
        try {
            # Use Chrome DevTools Protocol to capture screenshot
            $chromeArgs = @(
                "--headless"
                "--disable-gpu"
                "--screenshot=$filepath"
                "--window-size=$($viewport.Width),$($viewport.Height)"
                "--default-background-color=0"
                "--hide-scrollbars"
                $url
            )
            
            Start-Process -FilePath $chromePath -ArgumentList $chromeArgs -Wait -WindowStyle Hidden
            
            if (Test-Path $filepath) {
                Write-Host " ✓" -ForegroundColor Green
                $totalScreenshots++
            } else {
                Write-Host " ✗ Failed" -ForegroundColor Red
            }
        }
        catch {
            Write-Host " ✗ Error: $_" -ForegroundColor Red
        }
        
        Start-Sleep -Milliseconds 500
    }
    
    Write-Host ""
}

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "✓ Capture complete!" -ForegroundColor Green
Write-Host "  Total screenshots: $totalScreenshots" -ForegroundColor Cyan
Write-Host "  Location: $SESSION_DIR" -ForegroundColor Cyan
Write-Host ""
Write-Host "Opening screenshots folder..." -ForegroundColor Yellow
Start-Process explorer.exe $SESSION_DIR

# Generate HTML report
$reportPath = Join-Path $SESSION_DIR "report.html"
$htmlContent = @"
<!DOCTYPE html>
<html>
<head>
    <title>Responsive Screenshot Report - $TIMESTAMP</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #f5f5f5;
            padding: 2rem;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem;
            border-radius: 12px;
            margin-bottom: 2rem;
        }
        .header h1 { margin-bottom: 0.5rem; }
        .header p { opacity: 0.9; }
        .page-section {
            background: white;
            border-radius: 12px;
            padding: 2rem;
            margin-bottom: 2rem;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .page-section h2 {
            color: #667eea;
            margin-bottom: 1.5rem;
            padding-bottom: 0.5rem;
            border-bottom: 2px solid #667eea;
        }
        .viewport-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
            margin-top: 1rem;
        }
        .viewport-card {
            background: #f9f9f9;
            border-radius: 8px;
            padding: 1rem;
            border: 2px solid #e0e0e0;
        }
        .viewport-card h3 {
            color: #333;
            margin-bottom: 0.5rem;
            font-size: 0.9rem;
        }
        .viewport-card .size {
            color: #666;
            font-size: 0.85rem;
            margin-bottom: 0.5rem;
        }
        .viewport-card img {
            width: 100%;
            border-radius: 4px;
            border: 1px solid #ddd;
            cursor: pointer;
            transition: transform 0.2s;
        }
        .viewport-card img:hover {
            transform: scale(1.02);
        }
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.9);
            justify-content: center;
            align-items: center;
        }
        .modal img {
            max-width: 90%;
            max-height: 90%;
            object-fit: contain;
        }
        .modal:target { display: flex; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📸 Responsive Screenshot Report</h1>
        <p>Generated: $TIMESTAMP</p>
        <p>App URL: $APP_URL</p>
    </div>
"@

foreach ($page in $PAGES) {
    $htmlContent += @"
    <div class="page-section">
        <h2>$($page.Name)</h2>
        <div class="viewport-grid">
"@
    
    foreach ($viewport in $VIEWPORTS) {
        $filename = "$($page.Name)_$($viewport.Name)_${TIMESTAMP}.png"
        
        $htmlContent += @"
            <div class="viewport-card">
                <h3>$($viewport.Label)</h3>
                <div class="size">$($viewport.Width) × $($viewport.Height)</div>
                <img src="$filename" alt="$($viewport.Label)" onclick="window.open('$filename', '_blank')">
            </div>
"@
    }
    
    $htmlContent += @"
        </div>
    </div>
"@
}

$htmlContent += @"
    <script>
        // Add zoom functionality
        document.querySelectorAll('img').forEach(img => {
            img.addEventListener('click', function() {
                window.open(this.src, '_blank');
            });
        });
    </script>
</body>
</html>
"@

$htmlContent | Out-File -FilePath $reportPath -Encoding UTF8
Write-Host "✓ Generated HTML report: $reportPath" -ForegroundColor Green
Write-Host ""
Write-Host "Opening report in browser..." -ForegroundColor Yellow
Start-Process $reportPath

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Done! Review the screenshots and report" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
