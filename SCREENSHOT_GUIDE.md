# 📸 Quick Screenshot Capture Guide

## Method 1: PowerShell Script (Automated) ⚡

### Run the automated script:
```powershell
.\capture-screenshots.ps1
```

This will:
- ✅ Automatically capture all pages at all viewport sizes
- ✅ Generate an HTML report
- ✅ Open the screenshots folder
- ✅ Save everything with timestamps

---

## Method 2: Manual Chrome DevTools (Fast & Simple) 🎯

### Steps:
1. **Start your app** (if not running):
   ```powershell
   cd frontend
   ng serve --port 4200
   ```

2. **Open Chrome** and navigate to: `http://localhost:4200/auth`

3. **Open DevTools**: Press `F12`

4. **Enable Device Toolbar**: Press `Ctrl+Shift+M` (or click mobile icon)

5. **For each viewport**, take a screenshot:

   ### Mobile Small (375x667)
   - Set dimensions: `375 x 667`
   - Press `Ctrl+Shift+P` → Type "Capture screenshot" → Enter
   - Save as: `login-mobile-small.png`

   ### Mobile Large (414x896)
   - Set dimensions: `414 x 896`
   - Capture screenshot
   - Save as: `login-mobile-large.png`

   ### Tablet Portrait (768x1024)
   - Set dimensions: `768 x 1024`
   - Capture screenshot
   - Save as: `login-tablet-portrait.png`

   ### Tablet Landscape (1024x768)
   - Set dimensions: `1024 x 768`
   - Capture screenshot
   - Save as: `login-tablet-landscape.png`

   ### Desktop Small (1366x768)
   - Set dimensions: `1366 x 768`
   - Capture screenshot
   - Save as: `login-desktop-small.png`

   ### Desktop Large (1920x1080)
   - Set dimensions: `1920 x 1080`
   - Capture screenshot
   - Save as: `login-desktop-large.png`

6. **Paste screenshots in VS Code chat** and I'll analyze them!

---

## Method 3: Browser Extension (Easy) 🔌

### Install Extension:
1. Chrome Web Store → Search "GoFullPage" or "Awesome Screenshot"
2. Install extension
3. Click extension icon → Select viewport size → Capture

---

## 🎯 Recommended Workflow

**FASTEST**: Use Method 2 (Manual DevTools)
- Takes 2-3 minutes per page
- Most reliable
- No setup needed

**EASIEST**: Use Method 1 (PowerShell script)
- Fully automated
- Captures all pages at once
- Generates nice report

---

## After Capturing:

1. **Paste screenshots** in the VS Code chat
2. **I will analyze** and identify responsive issues
3. **I will make fixes** to the SCSS/HTML
4. **You test** and take new screenshots
5. **Repeat** until perfect!

---

## 📋 Pages to Capture (Priority Order):

1. ✅ Login Page (`/auth`) - **START HERE**
2. Templates Page (`/templates`)
3. Visual Editor (`/visual-editor`)
4. Admin Page (`/admin`)

---

## 💡 Pro Tips:

- **Zoom Level**: Keep at 100% when capturing
- **Clear Cache**: Press `Ctrl+Shift+Delete` before capturing
- **Wait for Load**: Let page fully load before screenshot
- **Hide DevTools**: Press `F12` to hide before capture (for cleaner shots)

---

## 🚀 Let's Start!

Choose your method and capture the **login page** first!
Paste the screenshots here and I'll identify all responsive issues.
