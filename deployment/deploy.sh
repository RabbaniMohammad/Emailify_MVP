#!/bin/bash

##############################################################################
# Emailify Deployment Script
# Run this ON THE SERVER after git pull
# This copies built files and restarts services
##############################################################################

set -e  # Exit on error

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_info() { echo -e "${YELLOW}ℹ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }

echo "============================================"
echo "🚀 Emailify Deployment"
echo "============================================"
echo ""

# Configuration
APP_DIR="/var/www/emailify-backend"
BACKEND_SRC="$APP_DIR/backend/temp"
BACKEND_DEST="$APP_DIR/backend/dist"
FRONTEND_SRC="$APP_DIR/frontend/dist/frontend/browser"
FRONTEND_DEST="/var/www/html/emailify"

##############################################################################
# 1. VERIFY WE'RE IN THE RIGHT DIRECTORY
##############################################################################
if [ ! -d "$APP_DIR" ]; then
    print_error "App directory not found: $APP_DIR"
    exit 1
fi

cd $APP_DIR
print_success "In app directory: $APP_DIR"
echo ""

##############################################################################
# 2. PULL LATEST CODE
##############################################################################
print_info "Pulling latest code from GitHub..."
git pull origin main
print_success "Code updated"
echo ""

##############################################################################
# 3. COPY BACKEND BUILD
##############################################################################
print_info "Deploying backend..."

if [ ! -d "$BACKEND_SRC" ]; then
    print_error "Backend build not found: $BACKEND_SRC"
    print_error "Did you build locally and commit the temp/ folder?"
    exit 1
fi

# Create dist directory if it doesn't exist
mkdir -p $BACKEND_DEST

# Copy compiled backend files
cp -r $BACKEND_SRC/* $BACKEND_DEST/
print_success "Backend deployed to $BACKEND_DEST"
echo ""

##############################################################################
# 4. INSTALL BACKEND DEPENDENCIES (production only)
##############################################################################
print_info "Installing backend dependencies..."
cd $APP_DIR/backend
npm ci --production
print_success "Backend dependencies installed"
echo ""

##############################################################################
# 5. COPY FRONTEND BUILD
##############################################################################
print_info "Deploying frontend..."

if [ ! -d "$FRONTEND_SRC" ]; then
    print_error "Frontend build not found: $FRONTEND_SRC"
    print_error "Did you build locally and commit the dist/ folder?"
    exit 1
fi

# Create frontend directory
sudo mkdir -p $FRONTEND_DEST

# Copy frontend files
sudo cp -r $FRONTEND_SRC/* $FRONTEND_DEST/
sudo chown -R www-data:www-data $FRONTEND_DEST
print_success "Frontend deployed to $FRONTEND_DEST"
echo ""

##############################################################################
# 6. RESTART BACKEND WITH PM2
##############################################################################
print_info "Restarting backend with PM2..."

cd $APP_DIR/backend

# Check if PM2 process exists
if pm2 describe emailify-backend > /dev/null 2>&1; then
    print_info "Restarting existing PM2 process..."
    pm2 restart emailify-backend
else
    print_info "Starting new PM2 process..."
    pm2 start ecosystem.config.js
    pm2 save
fi

print_success "Backend restarted"
echo ""

##############################################################################
# 7. RELOAD NGINX
##############################################################################
print_info "Reloading Nginx..."
sudo nginx -t && sudo systemctl reload nginx
print_success "Nginx reloaded"
echo ""

##############################################################################
# 8. SHOW STATUS
##############################################################################
echo "============================================"
print_success "✓ Deployment Complete!"
echo "============================================"
echo ""
echo "📊 Status:"
pm2 status
echo ""
echo "📋 Logs:"
echo "  Backend: pm2 logs emailify-backend"
echo "  Nginx: sudo tail -f /var/log/nginx/emailify-*.log"
echo ""
print_success "Application is running! 🚀"
echo ""
