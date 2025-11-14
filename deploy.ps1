# Deployment Script for AWS Lightsail
# Server: 3.148.176.240 (ubuntu)
# Backend runs on port 5000 (proxied through Nginx)
# Frontend uses Nginx proxy to route /api to backend:5000

$SERVER = "ubuntu@3.148.176.240"
$PEM_FILE = "LightsailDefaultKey-us-east-2.pem"
$BACKEND_PATH = "/var/www/emailify-backend/backend"
$FRONTEND_PATH = "/var/www/html/emailify"

Write-Host "`n================================" -ForegroundColor Cyan
Write-Host "Emailify Deployment to Lightsail" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Step 1: Deploy Backend
Write-Host "`nStep 1: Deploying Backend..." -ForegroundColor Yellow

Write-Host "  Copying backend dist folder..."
scp -i $PEM_FILE -r backend/dist "${SERVER}:${BACKEND_PATH}/"

Write-Host "  Copying package files..."
scp -i $PEM_FILE backend/package.json "${SERVER}:${BACKEND_PATH}/"
scp -i $PEM_FILE backend/package-lock.json "${SERVER}:${BACKEND_PATH}/"

Write-Host "  Installing dependencies on server..."
ssh -i $PEM_FILE $SERVER "cd $BACKEND_PATH && npm install --production --legacy-peer-deps"

Write-Host "  Restarting PM2 process..."
ssh -i $PEM_FILE $SERVER "pm2 restart emailify-backend"

Write-Host "Backend deployed successfully!" -ForegroundColor Green

# Step 2: Deploy Frontend
Write-Host "`nStep 2: Deploying Frontend..." -ForegroundColor Yellow

Write-Host "  Creating temp deployment folder..."
ssh -i $PEM_FILE $SERVER "mkdir -p /tmp/frontend-deploy"

Write-Host "  Copying new frontend build..."
scp -i $PEM_FILE -r frontend/dist/frontend/browser/* "${SERVER}:/tmp/frontend-deploy/"

Write-Host "  Removing old frontend files (keeping emailify subfolder)..."
ssh -i $PEM_FILE $SERVER "sudo find $FRONTEND_PATH -maxdepth 1 -type f -delete"

Write-Host "  Deploying new frontend files..."
ssh -i $PEM_FILE $SERVER "sudo rm -rf $FRONTEND_PATH/assets $FRONTEND_PATH/chunk-* && sudo mv /tmp/frontend-deploy/* $FRONTEND_PATH/ && sudo rm -rf /tmp/frontend-deploy"

Write-Host "  Setting permissions..."
ssh -i $PEM_FILE $SERVER "sudo chown -R www-data:www-data $FRONTEND_PATH && sudo chmod -R 755 $FRONTEND_PATH"

Write-Host "  Reloading Nginx..."
ssh -i $PEM_FILE $SERVER "sudo systemctl reload nginx"

Write-Host "Frontend deployed successfully!" -ForegroundColor Green

# Step 3: Verify
Write-Host "`nStep 3: Verifying Deployment..." -ForegroundColor Yellow
Write-Host "`nPM2 Status:"
ssh -i $PEM_FILE $SERVER "pm2 list"

Write-Host "`nBackend Memory Usage:"
ssh -i $PEM_FILE $SERVER "pm2 show emailify-backend | grep -E 'memory|cpu|uptime|restarts'"

Write-Host "`n================================" -ForegroundColor Green
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host "Frontend: http://3.148.176.240" -ForegroundColor White
Write-Host "Backend: Running on port 5000 (proxied via Nginx /api)" -ForegroundColor White
Write-Host "`nDeployed Features:" -ForegroundColor Yellow
Write-Host "  - Modern UI improvements" -ForegroundColor White
Write-Host "  - Multi-channel campaigns (SMS, WhatsApp, Instagram)" -ForegroundColor White
Write-Host "  - Auto-select organization audience" -ForegroundColor White
Write-Host "  - Website scraper with cache, queue, browser pool" -ForegroundColor White
Write-Host "  - Material Design snackbars" -ForegroundColor White
Write-Host "`n"
