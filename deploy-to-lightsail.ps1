# Automated Deployment Script for Lightsail
# This script builds locally and deploys to Lightsail via SSH

param(
    [string]$ServerUser = "ubuntu",
    [string]$ServerHost = "mailgen.duckdns.org",
    [string]$ServerPath = "/var/www/emailify-backend"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Emailify - Automated Deployment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build Frontend
Write-Host "1. Building Frontend..." -ForegroundColor Yellow
Set-Location frontend
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Frontend built successfully" -ForegroundColor Green
Set-Location ..

# Step 2: Build Backend
Write-Host ""
Write-Host "2. Building Backend..." -ForegroundColor Yellow
Set-Location backend
npx tsc -p tsconfig.prod.json
if ($LASTEXITCODE -ne 0) {
    Write-Host "Backend build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Backend built successfully" -ForegroundColor Green
Set-Location ..

# Step 3: Commit and Push to Git
Write-Host ""
Write-Host "3. Committing builds to Git..." -ForegroundColor Yellow
git add -f backend/temp frontend/dist backend/src/repos/UserRepo.ts frontend/angular.json
git commit -m "Automated deployment build - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
git push origin main
Write-Host "✓ Pushed to GitHub" -ForegroundColor Green

# Step 4: Deploy to Lightsail
Write-Host ""
Write-Host "4. Deploying to Lightsail..." -ForegroundColor Yellow
Write-Host "Connecting to $ServerHost..." -ForegroundColor Cyan

# SSH command to pull and deploy
$deployCommands = @"
cd $ServerPath && \
git pull origin main && \
sudo cp -r frontend/dist/frontend/browser/* /var/www/html/emailify/ && \
sudo chown -R www-data:www-data /var/www/html/emailify && \
cd backend && \
npm install --legacy-peer-deps --production && \
pm2 restart emailify-backend && \
sudo nginx -t && \
sudo systemctl reload nginx && \
pm2 status
"@

ssh "${ServerUser}@${ServerHost}" $deployCommands

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  ✓ Deployment Successful!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Your application is live at: http://$ServerHost" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "Deployment failed! Check the logs above." -ForegroundColor Red
    exit 1
}
