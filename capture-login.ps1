# Quick Login Page Screenshot Capture
Write-Host "`nCapturing Login Page Screenshots...`n" -ForegroundColor Cyan

$APP_URL = "http://localhost:4200/auth"
$OUTPUT_DIR = Join-Path (Get-Location) "screenshots"
$TIMESTAMP = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"

# Create directories
if (-not (Test-Path $OUTPUT_DIR)) {
    New-Item -ItemType Directory -Path $OUTPUT_DIR | Out-Null
}
$SESSION_DIR = Join-Path $OUTPUT_DIR $TIMESTAMP
New-Item -ItemType Directory -Path $SESSION_DIR | Out-Null

# Find Chrome
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromePath)) {
    $chromePath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}

if (-not (Test-Path $chromePath)) {
    Write-Host "ERROR: Chrome not found`n" -ForegroundColor Red
    exit 1
}

# Check app
try {
    Invoke-WebRequest -Uri "http://localhost:4200" -Method Head -TimeoutSec 2 -ErrorAction Stop | Out-Null
} catch {
    Write-Host "ERROR: App not running. Start with: cd frontend; ng serve`n" -ForegroundColor Red
    exit 1
}

# Capture screenshots
$viewports = @(
    @{Name="mobile-375"; Width=375; Height=667},
    @{Name="mobile-414"; Width=414; Height=896},
    @{Name="tablet-768"; Width=768; Height=1024},
    @{Name="tablet-1024"; Width=1024; Height=768},
    @{Name="desktop-1366"; Width=1366; Height=768},
    @{Name="desktop-1920"; Width=1920; Height=1080}
)

foreach ($vp in $viewports) {
    $file = Join-Path $SESSION_DIR "login_$($vp.Name).png"
    Write-Host "Capturing $($vp.Width)x$($vp.Height)..." -NoNewline
    
    $args = "--headless", "--disable-gpu", "--screenshot=$file", "--window-size=$($vp.Width),$($vp.Height)", "--hide-scrollbars", $APP_URL
    Start-Process -FilePath $chromePath -ArgumentList $args -Wait -WindowStyle Hidden
    
    if (Test-Path $file) {
        Write-Host " Done" -ForegroundColor Green
    } else {
        Write-Host " Failed" -ForegroundColor Red
    }
    
    Start-Sleep -Milliseconds 300
}

Write-Host "`nScreenshots saved to: $SESSION_DIR`n" -ForegroundColor Green
Start-Process explorer.exe $SESSION_DIR
