#!/bin/bash

##############################################################################
# AWS Lightsail Instance Setup Script
# For: Emailify MVP Backend Deployment
# OS: Ubuntu 22.04 LTS
# Purpose: Install and configure Node.js backend (MongoDB Atlas via API)
##############################################################################

set -e  # Exit on any error

echo "============================================"
echo "🚀 Emailify Backend - Lightsail Setup"
echo "============================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then 
    print_error "Please run with sudo: sudo bash setup-lightsail.sh"
    exit 1
fi

print_info "Starting setup process..."
echo ""

##############################################################################
# 1. UPDATE SYSTEM
##############################################################################
print_info "Step 1: Updating system packages..."
apt update && apt upgrade -y
print_success "System updated"
echo ""

##############################################################################
# 2. INSTALL ESSENTIAL TOOLS
##############################################################################
print_info "Step 2: Installing essential tools..."
apt install -y curl wget git build-essential software-properties-common ufw
print_success "Essential tools installed"
echo ""

##############################################################################
# 3. INSTALL NODE.JS 20.x LTS
##############################################################################
print_info "Step 3: Installing Node.js 20.x LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify installation
NODE_VERSION=$(node -v)
NPM_VERSION=$(npm -v)
print_success "Node.js installed: $NODE_VERSION"
print_success "NPM installed: $NPM_VERSION"
echo ""

##############################################################################
# 4. INSTALL PM2 PROCESS MANAGER
##############################################################################
print_info "Step 4: Installing PM2 process manager..."
npm install -g pm2

# Configure PM2 to start on boot
pm2 startup systemd -u ubuntu --hp /home/ubuntu
print_success "PM2 installed and configured"
echo ""

##############################################################################
# 5. INSTALL NGINX
##############################################################################
print_info "Step 5: Installing Nginx..."
apt install -y nginx
systemctl enable nginx
systemctl start nginx
print_success "Nginx installed and started"
echo ""

##############################################################################
# 6. INSTALL CERTBOT (for SSL certificates)
##############################################################################
print_info "Step 6: Installing Certbot for SSL..."
apt install -y certbot python3-certbot-nginx
print_success "Certbot installed"
echo ""

##############################################################################
# 7. CONFIGURE FIREWALL (UFW)
##############################################################################
print_info "Step 7: Configuring firewall..."
ufw --force enable
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow http
ufw allow https
ufw allow 5000  # Node.js app (backend communication)
print_success "Firewall configured"
echo ""

##############################################################################
# 8. CREATE APPLICATION DIRECTORY
##############################################################################
print_info "Step 8: Creating application directory..."
mkdir -p /var/www/emailify-backend
chown -R ubuntu:ubuntu /var/www/emailify-backend
print_success "Application directory created: /var/www/emailify-backend"
echo ""

##############################################################################
# 9. CREATE LOG DIRECTORIES
##############################################################################
print_info "Step 9: Creating log directories..."
mkdir -p /var/log/emailify
chown -R ubuntu:ubuntu /var/log/emailify
print_success "Log directories created"
echo ""

##############################################################################
# 10. CONFIGURE NGINX (BASIC)
##############################################################################
print_info "Step 10: Creating Nginx configuration..."

cat > /etc/nginx/sites-available/emailify-backend <<'EOF'
server {
    listen 80;
    server_name _;  # Replace with your domain later

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Logging
    access_log /var/log/nginx/emailify-access.log;
    error_log /var/log/nginx/emailify-error.log;

    # Proxy settings
    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts for long-running AI requests
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
        proxy_read_timeout 300;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:5000/health;
        access_log off;
    }

    # Client max body size (for file uploads)
    client_max_body_size 10M;
}
EOF

# Enable the site
ln -sf /etc/nginx/sites-available/emailify-backend /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration
nginx -t
systemctl reload nginx

print_success "Nginx configured"
echo ""

##############################################################################
# 11. CONFIGURE SWAP (for 2GB instance)
##############################################################################
print_info "Step 11: Configuring swap space..."

# Check if swap already exists
if [ $(swapon --show | wc -l) -eq 0 ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    print_success "Swap configured (2GB)"
else
    print_info "Swap already configured, skipping..."
fi
echo ""

##############################################################################
# 12. OPTIMIZE SYSTEM SETTINGS
##############################################################################
print_info "Step 12: Optimizing system settings..."

# Increase file descriptors
cat >> /etc/security/limits.conf <<EOF
* soft nofile 65536
* hard nofile 65536
EOF

# Set timezone (adjust as needed)
timedatectl set-timezone America/Chicago
print_success "Timezone set to America/Chicago"
echo ""

##############################################################################
# 13. CREATE DEPLOYMENT USER (ubuntu should already exist)
##############################################################################
print_info "Step 13: Verifying deployment user..."
if id "ubuntu" &>/dev/null; then
    print_success "User 'ubuntu' exists"
    
    # Add to required groups
    usermod -aG www-data ubuntu
else
    print_error "User 'ubuntu' not found. Creating..."
    useradd -m -s /bin/bash ubuntu
    usermod -aG sudo,www-data ubuntu
fi
echo ""

##############################################################################
# 14. INSTALL MONITORING TOOLS (Optional)
##############################################################################
print_info "Step 14: Installing monitoring tools..."
apt install -y htop ncdu

print_success "Monitoring tools installed"
echo ""

##############################################################################
# SETUP COMPLETE
##############################################################################
echo ""
echo "============================================"
print_success "✓ Lightsail Instance Setup Complete!"
echo "============================================"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Clone your repository:"
echo "   cd /var/www/emailify-backend"
echo "   git clone https://github.com/RabbaniMohammad/Emailify_MVP.git ."
echo ""
echo "2. Create .env file with your credentials"
echo ""
echo "3. Install dependencies and build:"
echo "   cd /var/www/emailify-backend/backend"
echo "   npm install"
echo "   npm run build"
echo ""
echo "4. Start with PM2:"
echo "   pm2 start ecosystem.config.js"
echo "   pm2 save"
echo ""
echo "5. Setup SSL certificate:"
echo "   sudo certbot --nginx -d yourdomain.com"
echo ""
echo "6. Update Nginx config with your domain:"
echo "   sudo nano /etc/nginx/sites-available/emailify-backend"
echo ""
print_info "System Info:"
echo "  - Node.js: $NODE_VERSION"
echo "  - NPM: $NPM_VERSION"
echo "  - PM2: $(pm2 -v)"
echo "  - Nginx: $(nginx -v 2>&1 | cut -d'/' -f2)"
echo ""
print_success "Ready for deployment! 🚀"
echo ""
