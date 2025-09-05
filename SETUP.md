# Setup Guide for GitHub & DigitalOcean Auto-Deployment

This guide will help you set up your Medicare ACA Compliance System repository on GitHub and configure auto-deployment with DigitalOcean App Platform.

## 📝 Step 1: Initialize Git Repository

```bash
# Navigate to your project directory
cd C:\Users\Jimbo\Desktop\compliance

# Initialize git repository
git init

# Add all files to git
git add .

# Create initial commit
git commit -m "Initial commit: Medicare ACA Compliance System - CMS 2025 Compliant"

# Add your GitHub repository as remote origin
git remote add origin https://github.com/bbarnes4318/compliance.git

# Push to GitHub (creates main branch)
git push -u origin main
```

## 🔧 Step 2: Create Required Branches (Optional)

For a production setup, you might want separate branches:

```bash
# Create development branch
git checkout -b development
git push -u origin development

# Create staging branch
git checkout -b staging
git push -u origin staging

# Return to main branch
git checkout main
```

## 🚀 Step 3: Set Up DigitalOcean App Platform

### Option A: Via DigitalOcean Web Console

1. **Log in to DigitalOcean** at https://cloud.digitalocean.com

2. **Navigate to App Platform**
   - Click "Apps" in the left sidebar
   - Click "Create App"

3. **Connect GitHub Repository**
   - Select "GitHub" as your source
   - Authorize DigitalOcean to access your GitHub account
   - Select repository: `bbarnes4318/compliance`
   - Select branch: `main`
   - Check "Autodeploy" for automatic deployments on push

4. **Configure App**
   - DigitalOcean will detect the `app.yaml` file
   - Review the configuration
   - Click "Next"

5. **Set Environment Variables**
   - Click "Edit" next to Environment Variables
   - Add the following as **encrypted** variables:
     ```
     DATABASE_URL = (will be auto-populated when you create database)
     REDIS_URL = (will be auto-populated when you create Redis)
     JWT_SECRET = (generate a secure 256-bit key)
     ENCRYPTION_KEY = (generate a 256-bit hex key)
     DO_SPACES_KEY = (your Spaces access key)
     DO_SPACES_SECRET = (your Spaces secret key)
     ```

6. **Create Resources**
   - Database: Click "Add Database" → PostgreSQL → Basic ($15/mo)
   - Redis: Click "Add Database" → Redis → Basic ($15/mo)
   - Click "Next"

7. **Review and Launch**
   - Review your configuration
   - Click "Create Resources"
   - DigitalOcean will build and deploy your app

### Option B: Via doctl CLI

```bash
# Install doctl if not already installed
# Windows (using Chocolatey):
choco install doctl

# Authenticate doctl
doctl auth init

# Create app from app.yaml
doctl apps create --spec app.yaml

# Get your app ID
doctl apps list

# Update environment variables (replace APP_ID)
doctl apps update APP_ID --spec - <<EOF
name: medicare-aca-compliance
services:
- name: web
  envs:
  - key: DATABASE_URL
    scope: RUN_TIME
    type: SECRET
    value: "your-database-url"
  - key: JWT_SECRET
    scope: RUN_TIME
    type: SECRET
    value: "your-jwt-secret"
EOF
```

## 🗄️ Step 4: Create DigitalOcean Resources

### Create Managed Database

```bash
# Create PostgreSQL database
doctl databases create compliance-db \
  --engine pg \
  --version 15 \
  --size db-s-1vcpu-2gb \
  --region nyc3 \
  --num-nodes 1

# Get connection string
doctl databases connection compliance-db --format "Database URL"
```

### Create Redis Cache

```bash
# Create Redis instance
doctl databases create compliance-cache \
  --engine redis \
  --version 7 \
  --size db-s-1vcpu-1gb \
  --region nyc3

# Get connection string
doctl databases connection compliance-cache --format "Redis URL"
```

### Create Spaces Bucket

```bash
# Create Spaces bucket for document storage
doctl compute space create medicare-compliance-docs --region nyc3

# Generate access keys
doctl compute space-key create compliance-keys

# Save the access key and secret key shown
```

## 🔐 Step 5: Generate Security Keys

### Generate JWT Secret

```bash
# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Or using OpenSSL
openssl rand -hex 32
```

### Generate Encryption Key

```bash
# Generate 256-bit AES key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 🎯 Step 6: Configure GitHub Auto-Deploy

1. **In DigitalOcean App Platform:**
   - Go to your app settings
   - Navigate to "Settings" → "App-Level Environment Variables"
   - Ensure "Deploy on Push" is enabled

2. **Set up GitHub Webhooks (automatic):**
   - DigitalOcean automatically configures webhooks
   - Every push to `main` branch triggers deployment

3. **Configure Branch Protection (optional but recommended):**
   ```bash
   # Go to GitHub repository settings
   # Settings → Branches → Add rule
   # Branch name pattern: main
   # Check: Require pull request reviews before merging
   # Check: Require status checks to pass before merging
   ```

## 📊 Step 7: Verify Deployment

### Check App Status

```bash
# View app details
doctl apps get YOUR_APP_ID

# View deployment logs
doctl apps logs YOUR_APP_ID --type deploy

# View runtime logs
doctl apps logs YOUR_APP_ID --type run --follow
```

### Test Endpoints

```bash
# Health check
curl https://medicare-aca-compliance-xxxxx.ondigitalocean.app/health

# Should return:
# {
#   "status": "healthy",
#   "timestamp": "2024-01-15T10:00:00.000Z",
#   "uptime": 123.456,
#   "environment": "production"
# }
```

## 🔄 Step 8: Set Up Continuous Deployment

### GitHub Actions Workflow (Optional Enhancement)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to DigitalOcean

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm ci
      - run: npm test
      - run: npm run lint

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v2
      - uses: digitalocean/action-doctl@v2
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
      - run: doctl apps create-deployment ${{ secrets.APP_ID }}
```

### Add GitHub Secrets

1. Go to GitHub repository settings
2. Navigate to "Secrets and variables" → "Actions"
3. Add secrets:
   - `DIGITALOCEAN_ACCESS_TOKEN`: Your DO API token
   - `APP_ID`: Your DigitalOcean app ID

## 🎉 Step 9: First Deployment

```bash
# Make a small change to trigger deployment
echo "# Deployed on $(date)" >> README.md

# Commit and push
git add README.md
git commit -m "Trigger initial deployment"
git push origin main

# Watch deployment progress in DigitalOcean console
# or via CLI:
doctl apps logs YOUR_APP_ID --type build --follow
```

## 🔍 Monitoring & Maintenance

### Set Up Monitoring Alerts

```bash
# Configure alerts via app.yaml or console
# CPU usage > 80%
# Memory usage > 80%
# Failed deployments
# Domain issues
```

### Regular Maintenance Tasks

```bash
# Weekly: Check logs for errors
doctl apps logs YOUR_APP_ID --type run | grep ERROR

# Monthly: Review resource usage
doctl monitoring metrics cpu YOUR_APP_ID
doctl monitoring metrics memory YOUR_APP_ID

# Quarterly: Update dependencies
git checkout -b dependency-updates
npm update
npm audit fix
git add package.json package-lock.json
git commit -m "Update dependencies"
git push origin dependency-updates
# Create pull request
```

## 🆘 Troubleshooting

### Common Issues

1. **Build Failures**
   - Check `package.json` for correct Node version
   - Verify all dependencies are listed
   - Check build logs: `doctl apps logs YOUR_APP_ID --type build`

2. **Database Connection Issues**
   - Verify DATABASE_URL format
   - Check firewall rules allow app access
   - Ensure SSL mode is set to 'require'

3. **Environment Variables Not Loading**
   - Ensure variables are set as "encrypted" in DigitalOcean
   - Check variable names match exactly in code
   - Restart app after changing variables

### Support Resources

- **DigitalOcean Support**: https://www.digitalocean.com/support/
- **Community**: https://www.digitalocean.com/community/
- **GitHub Issues**: https://github.com/bbarnes4318/compliance/issues

## ✅ Deployment Checklist

- [ ] Git repository initialized and pushed to GitHub
- [ ] DigitalOcean App Platform app created
- [ ] PostgreSQL database provisioned and connected
- [ ] Redis cache provisioned and connected
- [ ] Spaces bucket created for document storage
- [ ] Environment variables configured
- [ ] Security keys generated and set
- [ ] Auto-deploy enabled
- [ ] Initial deployment successful
- [ ] Health check endpoint responding
- [ ] Monitoring alerts configured
- [ ] Backup strategy in place

---

**Congratulations!** Your Medicare ACA Compliance System is now deployed and auto-deploying from GitHub to DigitalOcean App Platform.

For any issues or questions, please create an issue at: https://github.com/bbarnes4318/compliance/issues