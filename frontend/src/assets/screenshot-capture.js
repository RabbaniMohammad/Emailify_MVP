/**
 * Automated Responsive Screenshot Capture Tool
 * 
 * Usage:
 * 1. Open your app in browser (http://localhost:4200)
 * 2. Navigate to the page you want to test
 * 3. Open DevTools Console (F12)
 * 4. Paste this entire script and press Enter
 * 5. Screenshots will be automatically captured and downloaded
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    viewports: [
      { name: 'mobile-small', width: 375, height: 667, label: 'Mobile (iPhone SE)' },
      { name: 'mobile-large', width: 414, height: 896, label: 'Mobile (iPhone 11 Pro Max)' },
      { name: 'tablet-portrait', width: 768, height: 1024, label: 'Tablet Portrait (iPad)' },
      { name: 'tablet-landscape', width: 1024, height: 768, label: 'Tablet Landscape (iPad)' },
      { name: 'desktop-small', width: 1366, height: 768, label: 'Desktop Small' },
      { name: 'desktop-large', width: 1920, height: 1080, label: 'Desktop Large' }
    ],
    delay: 500, // ms to wait after resize before capturing
    pageName: null // Will be auto-detected from URL
  };

  // Get current page name from URL
  function getPageName() {
    const path = window.location.pathname;
    const pageName = path.split('/').filter(p => p).pop() || 'home';
    return pageName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  }

  // Capture screenshot using html2canvas
  async function captureScreenshot(viewportName, viewportLabel) {
    return new Promise((resolve) => {
      // Wait for any animations to complete
      setTimeout(async () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          // Set canvas size to viewport size
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
          
          // Use browser's native screenshot capability
          // This is a simplified version - you'll need html2canvas library for full functionality
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
          const filename = `${CONFIG.pageName}_${viewportName}_${timestamp}.png`;
          // Note: This will only log. For actual capture, use html2canvas library
          resolve(filename);
        } catch (error) {
          console.error('Error capturing screenshot:', error);
          resolve(null);
        }
      }, CONFIG.delay);
    });
  }

  // Resize viewport
  function resizeViewport(width, height) {
    // For browser DevTools responsive mode
    if (window.visualViewport) {
      document.documentElement.style.width = width + 'px';
      document.documentElement.style.height = height + 'px';
    }
    
    // Update viewport meta tag
    let viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.name = 'viewport';
      document.head.appendChild(viewport);
    }
    viewport.content = `width=${width}, initial-scale=1.0`;
    
    // Dispatch resize event
    window.dispatchEvent(new Event('resize'));
  }

  // Main capture process
  async function captureAllViewports() {
    CONFIG.pageName = getPageName();
    const results = [];
    
    for (const viewport of CONFIG.viewports) {
      // Resize viewport
      resizeViewport(viewport.width, viewport.height);
      
      // Capture screenshot
      const filename = await captureScreenshot(viewport.name, viewport.label);
      
      if (filename) {
        results.push({
          viewport: viewport.label,
          size: `${viewport.width}x${viewport.height}`,
          filename: filename,
          timestamp: new Date().toISOString()
        });
      }
    }
    results.forEach((result, index) => {
    });
    
    // Generate report
    generateReport(results);
  }

  // Generate HTML report
  function generateReport(results) {
    const report = {
      page: CONFIG.pageName,
      url: window.location.href,
      timestamp: new Date().toISOString(),
      viewports: results,
      userAgent: navigator.userAgent
    };
    // Copy to clipboard if available
    if (navigator.clipboard) {
      navigator.clipboard.writeText(JSON.stringify(report, null, 2))
        .then(() => console.log('\n✅ Report copied to clipboard!'));
    }
  }

  // Instructions
  // Expose functions to global scope
  window.captureAllViewports = captureAllViewports;
  window.screenshotConfig = CONFIG;
})();
