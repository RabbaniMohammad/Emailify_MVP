#!/bin/bash

# Add Swap Space to AWS Lightsail Server
# Run this on your production server to prevent memory crashes
# Adds 2GB swap file (virtual memory overflow)

set -e

echo "🔧 Adding swap space to prevent memory crashes..."

# Check if swap already exists
if [ $(swapon --show | wc -l) -gt 0 ]; then
    echo "⚠️  Swap already exists:"
    swapon --show
    free -h
    echo ""
    read -p "Remove existing swap and create new? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo swapoff -a
        sudo rm -f /swapfile
        echo "✅ Existing swap removed"
    else
        echo "Exiting..."
        exit 0
    fi
fi

# Create 2GB swap file
SWAP_SIZE="2G"
echo "📝 Creating ${SWAP_SIZE} swap file at /swapfile..."
sudo fallocate -l ${SWAP_SIZE} /swapfile

# Set proper permissions
echo "🔒 Setting permissions..."
sudo chmod 600 /swapfile

# Make it a swap file
echo "💾 Formatting as swap..."
sudo mkswap /swapfile

# Enable swap
echo "✅ Enabling swap..."
sudo swapon /swapfile

# Verify
echo ""
echo "✅ Swap enabled successfully!"
echo ""
free -h
echo ""

# Make permanent (survives reboot)
if grep -q '/swapfile' /etc/fstab; then
    echo "⚠️  /etc/fstab already has swap entry"
else
    echo "📝 Adding to /etc/fstab for persistence..."
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "✅ Swap will persist after reboot"
fi

# Configure swappiness (how aggressively to use swap)
# 10 = only use swap when RAM is 90% full (recommended for servers)
echo ""
echo "⚙️  Configuring swappiness..."
sudo sysctl vm.swappiness=10
echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf

echo ""
echo "🎉 DONE! Your server now has:"
echo "   - 1.9GB RAM (physical memory)"
echo "   - 2GB Swap (virtual memory)"
echo "   - Total: 3.9GB available memory"
echo ""
echo "This prevents crashes when memory spikes!"
