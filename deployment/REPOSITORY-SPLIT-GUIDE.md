# 📦 Splitting Monorepo into Separate Frontend & Backend Repositories

## Why Split?

- **Independent deployments**: Deploy frontend changes without touching backend
- **Separate version control**: Different release cycles for frontend/backend
- **Clearer ownership**: Easier to manage permissions and CI/CD
- **Smaller clones**: Faster git operations

---

## 🚀 Step-by-Step Guide

### Phase 1: Create New Repositories on GitHub

#### 1.1 Create Backend Repository

1. Go to GitHub: https://github.com/RabbaniMohammad
2. Click **"New repository"**
3. Settings:
   - **Repository name**: `Emailify_Backend`
   - **Description**: "Backend API for Emailify - Email template generation service"
   - **Visibility**: Private (recommended)
   - **Don't initialize** with README, .gitignore, or license
4. Click **"Create repository"**
5. **Copy the repository URL** (e.g., `https://github.com/RabbaniMohammad/Emailify_Backend.git`)

#### 1.2 Create Frontend Repository

1. Click **"New repository"** again
2. Settings:
   - **Repository name**: `Emailify_Frontend`
   - **Description**: "Angular frontend for Emailify - Email template generation service"
   - **Visibility**: Private (recommended)
   - **Don't initialize** with README, .gitignore, or license
3. Click **"Create repository"**
4. **Copy the repository URL** (e.g., `https://github.com/RabbaniMohammad/Emailify_Frontend.git`)

---

### Phase 2: Extract Backend to New Repository

#### 2.1 Create a Fresh Clone for Backend

```powershell
# Navigate to a working directory (NOT your current project)
cd C:\Users\"Rabbani Mohammad"\Downloads\temp

# Create fresh clone
git clone https://github.com/RabbaniMohammad/Emailify_MVP.git Emailify_Backend_New

cd Emailify_Backend_New
```

#### 2.2 Remove Frontend Files

```powershell
# Remove frontend folder
Remove-Item -Recurse -Force frontend

# Remove deployment folder (or move specific files if needed)
Remove-Item -Recurse -Force deployment

# Keep only: backend/, .gitignore, and add a new README
```

#### 2.3 Move Backend Files to Root

```powershell
# Move all backend contents to root
Move-Item backend\* . -Force

# Remove empty backend folder
Remove-Item backend
```

#### 2.4 Update .gitignore for Backend Only

Create a clean `.gitignore`:

```
# Node modules
node_modules/
.npm/
.pnp/

# Build outputs
dist/
build/
.tmp/
tmp/
.cache/

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*

# Environment variables
.env
.env.*.local
.env.local
*.env

# Tests
coverage/
.nyc_output/

# TypeScript
*.tsbuildinfo

# IDE
.vscode/*
!.vscode/settings.json
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db
```

#### 2.5 Create Backend README

Create `README.md`:

```markdown
# Emailify Backend API

Backend service for Emailify email template generation.

## Tech Stack
- Node.js + Express
- TypeScript
- MongoDB
- MJML for email templates

## Setup

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

2. Create `.env` file:
   \`\`\`
   PORT=5000
   MONGODB_URI=your_mongodb_uri
   JWT_SECRET=your_jwt_secret
   # Add other environment variables
   \`\`\`

3. Run development:
   \`\`\`bash
   npm run dev
   \`\`\`

4. Build for production:
   \`\`\`bash
   npm run build
   npm start
   \`\`\`

## Deployment

See deployment documentation for Lightsail setup.
```

#### 2.6 Push to New Backend Repository

```powershell
# Remove old remote
git remote remove origin

# Add new remote
git remote add origin https://github.com/RabbaniMohammad/Emailify_Backend.git

# Stage changes
git add .
git commit -m "Initial backend repository setup"

# Push to new repo
git branch -M main
git push -u origin main
```

---

### Phase 3: Extract Frontend to New Repository

#### 3.1 Create a Fresh Clone for Frontend

```powershell
# Navigate to working directory
cd C:\Users\"Rabbani Mohammad"\Downloads\temp

# Create fresh clone
git clone https://github.com/RabbaniMohammad/Emailify_MVP.git Emailify_Frontend_New

cd Emailify_Frontend_New
```

#### 3.2 Remove Backend Files

```powershell
# Remove backend folder
Remove-Item -Recurse -Force backend

# Remove deployment folder
Remove-Item -Recurse -Force deployment
```

#### 3.3 Move Frontend Files to Root

```powershell
# Move all frontend contents to root
Move-Item frontend\* . -Force

# Remove empty frontend folder
Remove-Item frontend
```

#### 3.4 Update .gitignore for Frontend Only

Use the existing Angular `.gitignore` or create:

```
# Node
/node_modules
npm-debug.log
yarn-error.log

# Build output
/dist
/tmp
/out-tsc
/bazel-out

# Angular
/.angular/cache
.sass-cache/

# Environment
.env
.env.*.local

# IDE
.vscode/*
!.vscode/settings.json
.idea/

# OS
.DS_Store
Thumbs.db
```

#### 3.5 Create Frontend README

Create `README.md`:

```markdown
# Emailify Frontend

Angular frontend for Emailify email template generation service.

## Tech Stack
- Angular 18+
- TailwindCSS
- TypeScript

## Setup

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

2. Update `proxy.conf.json` for backend API URL

3. Run development:
   \`\`\`bash
   npm start
   \`\`\`

4. Build for production:
   \`\`\`bash
   npm run build
   \`\`\`

## Deployment

See deployment documentation for Lightsail setup.
```

#### 3.6 Push to New Frontend Repository

```powershell
# Remove old remote
git remote remove origin

# Add new remote
git remote add origin https://github.com/RabbaniMohammad/Emailify_Frontend.git

# Stage changes
git add .
git commit -m "Initial frontend repository setup"

# Push to new repo
git branch -M main
git push -u origin main
```

---

### Phase 4: Update Lightsail Deployment

#### 4.1 SSH into Lightsail

```bash
ssh ubuntu@your-lightsail-ip
```

#### 4.2 Backup Current Setup

```bash
# Stop services
pm2 stop all

# Backup everything
cd /var/www
sudo cp -r emailify-backend emailify-backend-backup
```

#### 4.3 Set Up New Backend

```bash
# Remove old backend (careful!)
sudo rm -rf /var/www/emailify-backend

# Clone new backend repo
sudo git clone https://github.com/RabbaniMohammad/Emailify_Backend.git /var/www/emailify-backend

cd /var/www/emailify-backend

# Copy your .env from backup
sudo cp /var/www/emailify-backend-backup/.env .env

# Install and build
sudo npm install
sudo npm run build

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
```

#### 4.4 Set Up New Frontend (If Needed)

```bash
# Clone frontend repo
sudo git clone https://github.com/RabbaniMohammad/Emailify_Frontend.git /var/www/emailify-frontend

cd /var/www/emailify-frontend

# Install and build
sudo npm install
sudo npm run build

# Configure Nginx to serve from /var/www/emailify-frontend/dist
```

---

### Phase 5: Update Your Local Development

#### 5.1 Clone New Repositories Locally

```powershell
# Navigate to your projects folder
cd C:\Users\"Rabbani Mohammad"\Documents\Projects

# Clone backend
git clone https://github.com/RabbaniMohammad/Emailify_Backend.git

# Clone frontend  
git clone https://github.com/RabbaniMohammad/Emailify_Frontend.git

# Open each in VS Code as needed
```

#### 5.2 Update Frontend API Configuration

In `Emailify_Frontend/proxy.conf.json`, ensure backend URL is correct:

```json
{
  "/api": {
    "target": "http://localhost:5000",
    "secure": false
  }
}
```

---

## 🎯 Benefits After Split

### Independent Deployment

**Before:**
```bash
git pull origin main  # pulls both frontend and backend
npm run build         # have to rebuild everything
```

**After:**
```bash
# Deploy only frontend
cd /var/www/emailify-frontend
git pull origin main
npm run build
# Backend unchanged!

# Or deploy only backend
cd /var/www/emailify-backend
git pull origin main
npm run build
pm2 restart emailify-backend
# Frontend unchanged!
```

### Cleaner Git History

- Frontend commits don't clutter backend history
- Easier to track changes in each layer
- Better for code reviews

### Environment Variable Safety

- Each repo has its own `.env`
- No risk of accidentally pulling wrong environment config
- Backend and frontend can have different deployment schedules

---

## ⚠️ Important Notes

1. **Backup First**: Always backup your current setup before making changes
2. **Test Locally**: Test the split repositories locally before deploying
3. **Update CI/CD**: If you have CI/CD pipelines, update them for new repos
4. **Environment Variables**: Manually copy `.env` files - they're not in git
5. **Dependencies**: Each repo now has independent `package.json`

---

## 🔄 Alternative: Keep Monorepo

If splitting seems too complex right now, you can:
- Stay with monorepo
- Pull all changes
- Only rebuild the part that changed
- Use feature flags or deployment scripts

The monorepo approach is simpler but less flexible for large teams.

---

## 📞 Need Help?

If you encounter issues during the split:
1. Don't delete your original `Emailify_MVP` repo until everything works
2. Test new repos in a separate directory first
3. Keep backups of your `.env` files
4. Document any custom configurations you have
