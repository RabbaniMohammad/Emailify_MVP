# Automated Screenshot Capture
Write-Host ""
Write-Host "=== Automated Screenshot Capture ===" -ForegroundColor Cyan
Write-Host ""

$APP_URL = "http://localhost:4200"
$CURRENT_DIR = Get-Location
$OUTPUT_DIR = Join-Path $CURRENT_DIR "screenshots"
$TIMESTAMP = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$SESSION_DIR = Join-Path $OUTPUT_DIR $TIMESTAMP

# Create directories
New-Item -ItemType Directory -Path $SESSION_DIR -Force | Out-Null
Write-Host "Output: $SESSION_DIR" -ForegroundColor Green
Write-Host ""

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
    Write-Host "ERROR: Chrome not found" -ForegroundColor Red
    Write-Host ""
    exit 1
}

Write-Host "Chrome: $chromePath" -ForegroundColor Gray
Write-Host ""

# Check if app is running
Write-Host "Checking app..." -NoNewline
try {
    $null = Invoke-WebRequest -Uri "http://localhost:4200" -Method Head -TimeoutSec 3 -ErrorAction Stop
    Write-Host " Running" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host " NOT RUNNING" -ForegroundColor Red
    Write-Host ""
    Write-Host "Start app: cd frontend; ng serve" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# Viewports
$viewports = @(
    @{Name="mobile-375"; Width=375; Height=667; Label="Mobile 375"},
    @{Name="mobile-414"; Width=414; Height=896; Label="Mobile 414"},
    @{Name="tablet-768"; Width=768; Height=1024; Label="Tablet 768"},
    @{Name="tablet-1024"; Width=1024; Height=768; Label="Tablet 1024"},
    @{Name="desktop-1366"; Width=1366; Height=768; Label="Desktop 1366"},
    @{Name="desktop-1920"; Width=1920; Height=1080; Label="Desktop 1920"}
)

Write-Host "Capturing screenshots..." -ForegroundColor Cyan
Write-Host ""

$captured = 0
foreach ($vp in $viewports) {
    $filename = "home-$($vp.Name).png"
    $filepath = Join-Path $SESSION_DIR $filename
    
    Write-Host "  $($vp.Label) ($($vp.Width)x$($vp.Height))..." -NoNewline
    
    # Build Chrome arguments with delay for animations
    $arguments = @(
        "--new-window"
        "--window-size=$($vp.Width),$($vp.Height)"
        $APP_URL
    )
    
    try {
        # Start Chrome process
        $process = Start-Process -FilePath $chromePath -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
        
        # Wait for animations to complete (3 seconds)
        Start-Sleep -Milliseconds 3500
        
        # Check if screenshot was created
        if (Test-Path $filepath) {
            $fileSize = (Get-Item $filepath).Length
            if ($fileSize -gt 0) {
                $sizeKB = [math]::Round($fileSize/1KB, 1)
                Write-Host " OK ($sizeKB KB)" -ForegroundColor Green
                $captured++
            } else {
                Write-Host " FAILED (Empty file)" -ForegroundColor Red
                Remove-Item $filepath -ErrorAction SilentlyContinue
            }
        } else {
            Write-Host " FAILED (Not created)" -ForegroundColor Red
        }
    }
    catch {
        Write-Host " FAILED (Error)" -ForegroundColor Red
    }
    
    Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host "=== Results ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Captured: $captured / $($viewports.Count)" -ForegroundColor $(if($captured -eq $viewports.Count){"Green"}else{"Yellow"})
Write-Host "Location: $SESSION_DIR" -ForegroundColor Gray
Write-Host ""

if ($captured -gt 0) {
    Write-Host "Opening folder..." -ForegroundColor Yellow
    Start-Process explorer.exe $SESSION_DIR
    Write-Host ""
    Write-Host "DONE! Screenshots are ready." -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "ERROR: No screenshots captured." -ForegroundColor Red
    Write-Host ""
    Write-Host "Try manual test:" -ForegroundColor Yellow
    Write-Host "  & '$chromePath' --headless=new --screenshot=test.png --window-size=800,600 $APP_URL" -ForegroundColor Gray
    Write-Host ""
}
