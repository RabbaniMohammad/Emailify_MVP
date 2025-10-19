# Automated Screenshot Capture - Fixed Version
Write-Host "`n=== Automated Screenshot Capture ===`n" -ForegroundColor Cyan

$APP_URL = "http://localhost:4200/auth"
$CURRENT_DIR = Get-Location
$OUTPUT_DIR = Join-Path $CURRENT_DIR "screenshots"
$TIMESTAMP = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$SESSION_DIR = Join-Path $OUTPUT_DIR $TIMESTAMP

# Create directories
New-Item -ItemType Directory -Path $SESSION_DIR -Force | Out-Null
Write-Host "Output: $SESSION_DIR`n" -ForegroundColor Green

# Find Chrome
$chromePath = $null
$chromePaths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

foreach ($path in $chromePaths) {
    if (Test-Path $path) {
        $chromePath = $path
        break
    }
}

if (-not $chromePath) {
    Write-Host "ERROR: Chrome not found`n" -ForegroundColor Red
    exit 1
}

Write-Host "Chrome: $chromePath`n" -ForegroundColor Gray

# Check if app is running
Write-Host "Checking app..." -NoNewline
try {
    $null = Invoke-WebRequest -Uri "http://localhost:4200" -Method Head -TimeoutSec 3 -ErrorAction Stop
    Write-Host " Running`n" -ForegroundColor Green
} catch {
    Write-Host " NOT RUNNING`n" -ForegroundColor Red
    Write-Host "Start app: cd frontend; ng serve`n" -ForegroundColor Yellow
    exit 1
}

# Viewports
$viewports = @(
    @{Name="mobile-375x667"; Width=375; Height=667; Label="Mobile 375"},
    @{Name="mobile-414x896"; Width=414; Height=896; Label="Mobile 414"},
    @{Name="tablet-768x1024"; Width=768; Height=1024; Label="Tablet 768"},
    @{Name="tablet-1024x768"; Width=1024; Height=768; Label="Tablet 1024"},
    @{Name="desktop-1366x768"; Width=1366; Height=768; Label="Desktop 1366"},
    @{Name="desktop-1920x1080"; Width=1920; Height=1080; Label="Desktop 1920"}
)

Write-Host "Capturing screenshots...`n" -ForegroundColor Cyan

$captured = 0
foreach ($vp in $viewports) {
    $filename = "login-$($vp.Name).png"
    $filepath = Join-Path $SESSION_DIR $filename
    
    Write-Host "  $($vp.Label) ($($vp.Width)x$($vp.Height))..." -NoNewline
    
    # Build Chrome arguments
    $arguments = @(
        "--headless=new"
        "--disable-gpu"
        "--disable-software-rasterizer"
        "--screenshot=`"$filepath`""
        "--window-size=$($vp.Width),$($vp.Height)"
        "--hide-scrollbars"
        "--force-device-scale-factor=1"
        "--disable-dev-shm-usage"
        "--no-sandbox"
        $APP_URL
    )
    
    try {
        # Start Chrome process
        $process = Start-Process -FilePath $chromePath -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
        
        # Wait a moment for file to be written
        Start-Sleep -Milliseconds 1000
        
        # Check if screenshot was created
        if (Test-Path $filepath) {
            $fileSize = (Get-Item $filepath).Length
            if ($fileSize -gt 0) {
                Write-Host " ✓ ($([math]::Round($fileSize/1KB, 1)) KB)" -ForegroundColor Green
                $captured++
            } else {
                Write-Host " ✗ (Empty file)" -ForegroundColor Red
                Remove-Item $filepath -ErrorAction SilentlyContinue
            }
        } else {
            Write-Host " ✗ (Not created)" -ForegroundColor Red
        }
    }
    catch {
        Write-Host " ✗ (Error: $_)" -ForegroundColor Red
    }
    
    Start-Sleep -Milliseconds 500
}

Write-Host "`n=== Results ===`n" -ForegroundColor Cyan
Write-Host "Captured: $captured / $($viewports.Count)" -ForegroundColor $(if($captured -eq $viewports.Count){"Green"}else{"Yellow"})
Write-Host "Location: $SESSION_DIR`n" -ForegroundColor Gray

if ($captured -gt 0) {
    # Create simple HTML viewer
    $htmlPath = Join-Path $SESSION_DIR "view.html"
    $html = @"
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Screenshots - $TIMESTAMP</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui; background: #1a1a1a; color: white; padding: 20px; }
        h1 { margin-bottom: 20px; color: #667eea; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .card { background: #2a2a2a; border-radius: 8px; padding: 15px; border: 1px solid #444; }
        .card h3 { margin-bottom: 10px; color: #aaa; font-size: 14px; }
        .card img { width: 100%; border-radius: 4px; border: 1px solid #555; cursor: pointer; transition: transform 0.2s; }
        .card img:hover { transform: scale(1.02); }
    </style>
</head>
<body>
    <h1>📸 Login Page Screenshots - $TIMESTAMP</h1>
    <div class="grid">
"@

    foreach ($vp in $viewports) {
        $filename = "login-$($vp.Name).png"
        $filepath = Join-Path $SESSION_DIR $filename
        if (Test-Path $filepath) {
            $html += @"
        <div class="card">
            <h3>$($vp.Label) - $($vp.Width) × $($vp.Height)</h3>
            <img src="$filename" alt="$($vp.Label)" onclick="window.open(this.src)">
        </div>
"@
        }
    }

    $html += @"
    </div>
    <script>
        console.log('Screenshots loaded: $captured');
    </script>
</body>
</html>
"@

    $html | Out-File -FilePath $htmlPath -Encoding UTF8
    
    Write-Host "Opening viewer...`n" -ForegroundColor Yellow
    Start-Process $htmlPath
    Start-Process explorer.exe $SESSION_DIR
    
    Write-Host "✓ Done! Check the browser and folder.`n" -ForegroundColor Green
} else {
    Write-Host "✗ No screenshots captured. Check if Chrome headless works:`n" -ForegroundColor Red
    Write-Host "  Try: chrome --headless=new --screenshot=test.png --window-size=800,600 http://localhost:4200/auth`n" -ForegroundColor Yellow
}
