# Deployment Guide - DigitalOcean App Platform

This guide provides step-by-step instructions for deploying the Medicare ACA Compliance System on DigitalOcean App Platform.

## 🎯 Pre-Deployment Checklist

- [ ] DigitalOcean account with App Platform enabled
- [ ] GitHub repository with source code
- [ ] Domain name (optional, can use DO subdomain)
- [ ] SSL certificate requirements identified
- [ ] Database size requirements estimated
- [ ] Expected traffic volume calculated

## 🏗️ Infrastructure Setup

### 1. Create Managed Database (PostgreSQL)

```bash
# Using doctl CLI
doctl databases create medicare-compliance-db \
  --engine pg \
  --version 15 \
  --size db-s-1vcpu-2gb \
  --region nyc3 \
  --num-nodes 1

# Or via DigitalOcean Control Panel:
# Databases → Create Database → PostgreSQL 15 → Basic ($15/mo)
```

### 2. Create Redis Cache

```bash
# Create managed Redis instance
doctl databases create medicare-compliance-cache \
  --engine redis \
  --version 7 \
  --size db-s-1vcpu-1gb \
  --region nyc3 \
  --num-nodes 1
```

### 3. Create DigitalOcean Space (S3-compatible storage)

```bash
# Create Spaces bucket for document storage
doctl compute space create medicare-compliance-docs \
  --region nyc3

# Generate Spaces access keys
doctl compute space key create compliance-system-key
```

## 🚀 Application Deployment

### 1. Prepare Repository

Ensure your repository has these files:
- `app.yaml` (App Platform specification)
- `package.json` (Node.js dependencies)
- `.env.example` (Environment variables template)
- `Dockerfile` (optional, for custom builds)

### 2. Configure Environment Variables

Create production environment configuration:

```bash
# Database Configuration
DATABASE_URL=postgresql://username:password@host:25060/db?sslmode=require
REDIS_URL=rediss://default:password@host:25061

# DigitalOcean Spaces
DO_SPACES_KEY=your-spaces-access-key
DO_SPACES_SECRET=your-spaces-secret-key
DO_SPACES_BUCKET=medicare-compliance-docs
DO_SPACES_ENDPOINT=nyc3.digitaloceanspaces.com
DO_SPACES_REGION=nyc3

# Security Keys (Generate strong keys!)
JWT_SECRET=your-256-bit-jwt-secret-key
REFRESH_TOKEN_SECRET=your-refresh-token-secret
ENCRYPTION_KEY=your-256-bit-aes-encryption-key

# Application Configuration
NODE_ENV=production
PORT=3000
ALLOWED_ORIGINS=https://your-domain.com,https://your-app-name.ondigitalocean.app

# Optional Third-Party Services
PROVIDERTRUST_API_KEY=your-providertrust-key
TWILIO_ACCOUNT_SID=your-twilio-sid
TWILIO_AUTH_TOKEN=your-twilio-token
```

### 3. Deploy Application

#### Option A: Using doctl CLI

```bash
# Deploy from local directory
doctl apps create --spec app.yaml

# Or deploy from GitHub (recommended)
doctl apps create --spec app.yaml \
  --github-repo https://github.com/bbarnes4318/compliance \
  --github-branch main
```

#### Option B: Using DigitalOcean Control Panel

1. Go to **App Platform** in DigitalOcean Control Panel
2. Click **Create App**
3. Connect your GitHub repository
4. Select branch (main/production)
5. Upload or paste `app.yaml` configuration
6. Set environment variables as secrets
7. Review and create

### 4. Configure Environment Secrets

Set sensitive environment variables as encrypted secrets:

```bash
# Set database URL as secret
doctl apps update YOUR_APP_ID --spec - <<EOF
name: medicare-aca-compliance
services:
- name: web
  envs:
  - key: DATABASE_URL
    scope: RUN_TIME
    type: SECRET
    value: "postgresql://user:pass@host:25060/db?sslmode=require"
  - key: JWT_SECRET
    scope: RUN_TIME
    type: SECRET
    value: "your-jwt-secret"
EOF
```

## 🗄️ Database Setup

### 1. Run Initial Migrations

After deployment, run database migrations:

```bash
# Connect to your app
doctl apps logs YOUR_APP_ID --type run

# Or trigger migration job
doctl apps run-command YOUR_APP_ID --component web --command "npm run migrate"
```

### 2. Create Initial Admin User

```bash
# Run seed script to create admin user
doctl apps run-command YOUR_APP_ID --component web --command "npm run seed"
```

### 3. Verify Database Connection

Check application logs to ensure successful database connection:

```bash
doctl apps logs YOUR_APP_ID --type build
doctl apps logs YOUR_APP_ID --type deploy
```

## 🔒 SSL/TLS Configuration

### Automatic SSL (Recommended)

DigitalOcean App Platform automatically provides SSL certificates:
- Uses Let's Encrypt for custom domains
- Automatic renewal
- No additional configuration required

### Custom SSL Certificate

If you need a specific SSL certificate:

```bash
# Upload custom certificate via API or Control Panel
doctl apps update YOUR_APP_ID --spec app-with-custom-cert.yaml
```

## 📊 Monitoring Setup

### 1. Enable Application Insights

Configure monitoring and alerting:

```yaml
# Add to app.yaml
alerts:
- rule: DEPLOYMENT_FAILED
- rule: DOMAIN_FAILED
- rule: CPU_UTILIZATION
  value: 85
  window: 5m
- rule: MEM_UTILIZATION
  value: 85
  window: 5m
```

### 2. Log Management

Configure structured logging:

```bash
# View real-time logs
doctl apps logs YOUR_APP_ID --type run --follow

# View specific component logs
doctl apps logs YOUR_APP_ID --type run --component web
```

### 3. Health Checks

Ensure health check endpoint is configured:

```yaml
# In app.yaml
health_check:
  http_path: /health
  initial_delay_seconds: 30
  period_seconds: 10
  timeout_seconds: 5
  success_threshold: 1
  failure_threshold: 3
```

## 🔧 Post-Deployment Configuration

### 1. Verify Core Functionality

Test critical endpoints:

```bash
# Health check
curl https://your-app.ondigitalocean.app/health

# Authentication
curl -X POST https://your-app.ondigitalocean.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"secure_password"}'

# Consent verification (with auth token)
curl https://your-app.ondigitalocean.app/api/consent/verify \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"beneficiary_phone":"+15551234567","transfer_to_organization":"Test Org"}'
```

### 2. Configure Scheduled Jobs

Set up cron jobs for compliance tasks:

```yaml
# Add to app.yaml
jobs:
- name: daily-screening
  kind: POST_DEPLOY
  run_command: npm run screening:daily
  instance_count: 1
  instance_size_slug: basic-xxs
  
- name: document-cleanup
  kind: POST_DEPLOY  
  run_command: npm run documents:cleanup
  instance_count: 1
  instance_size_slug: basic-xxs
```

### 3. Backup Configuration

Set up automated backups:

```bash
# Configure database backups (automatic with managed databases)
doctl databases backup list YOUR_DB_ID

# Configure Spaces backup policies
doctl compute space lifecycle set medicare-compliance-docs \
  --rule 'transition:30:STANDARD_IA,expiration:3650'
```

## 📈 Scaling Configuration

### Horizontal Scaling

Configure auto-scaling based on demand:

```yaml
# In app.yaml
services:
- name: web
  instance_count: 2  # Start with 2 instances
  instance_size_slug: professional-xs  # $12/month each
  autoscaling:
    min_instance_count: 1
    max_instance_count: 10
    metrics:
    - cpu:
        threshold: 70
    - memory:
        threshold: 80
```

### Database Scaling

Scale managed database as needed:

```bash
# Vertical scaling (upgrade instance size)
doctl databases resize YOUR_DB_ID --size db-s-2vcpu-4gb

# Add read replicas for read-heavy workloads
doctl databases replica create YOUR_DB_ID compliance-db-replica --region nyc3
```

## 🛡️ Security Hardening

### 1. Network Security

Configure trusted sources:

```yaml
# Restrict access to specific IPs (optional)
ingress:
  rules:
  - component:
      name: web
    match:
      path:
        prefix: /api/admin
    cors:
      allow_origins:
      - https://admin.yourcompany.com
```

### 2. Environment Security

Secure sensitive configuration:

```bash
# Rotate JWT secrets regularly
doctl apps update YOUR_APP_ID --spec updated-app.yaml

# Monitor for security vulnerabilities
npm audit
npm audit fix
```

### 3. Database Security

Configure database security:

```bash
# Enable firewall rules
doctl databases firewalls add YOUR_DB_ID \
  --rule "type:app,value:YOUR_APP_ID"

# Regular security updates (automatic with managed databases)
doctl databases maintenance-window update YOUR_DB_ID \
  --day sunday --hour 02:00
```

## 📋 Troubleshooting

### Common Deployment Issues

#### Build Failures
```bash
# Check build logs
doctl apps logs YOUR_APP_ID --type build

# Common fixes:
# 1. Verify Node.js version in package.json
# 2. Check for missing dependencies
# 3. Ensure build command is correct
```

#### Database Connection Issues
```bash
# Verify connection string format
# Correct: postgresql://user:pass@host:25060/db?sslmode=require
# Check firewall rules allow app access
doctl databases firewalls list YOUR_DB_ID
```

#### Memory/CPU Issues
```bash
# Monitor resource usage
doctl apps tier list
doctl apps upgrade YOUR_APP_ID --tier professional

# Optimize application:
# 1. Add Redis caching
# 2. Optimize database queries
# 3. Implement connection pooling
```

### Debugging Production Issues

```bash
# Access application logs
doctl apps logs YOUR_APP_ID --type run --follow

# Check specific errors
doctl apps logs YOUR_APP_ID --type run | grep ERROR

# Access via SSH (if enabled)
doctl apps exec YOUR_APP_ID --component web -- /bin/bash
```

### Rollback Procedures

```bash
# Rollback to previous deployment
doctl apps update YOUR_APP_ID --spec previous-working-app.yaml

# Or rollback via Control Panel:
# App Platform → Your App → Deployments → Previous Version → Deploy
```

## 💰 Cost Optimization

### Right-sizing Resources

Monitor and adjust resource allocation:

```bash
# Monitor usage metrics
doctl monitoring metrics cpu YOUR_APP_ID
doctl monitoring metrics memory YOUR_APP_ID

# Adjust instance sizes based on actual usage
# Start small and scale up as needed
```

### Database Optimization

```bash
# Monitor database performance
doctl databases pool list YOUR_DB_ID

# Optimize queries and add indexes
# Consider read replicas for read-heavy workloads
# Use connection pooling to reduce overhead
```

### Storage Optimization

```bash
# Monitor Spaces usage
doctl compute space usage medicare-compliance-docs

# Implement lifecycle policies for document archival
doctl compute space lifecycle set medicare-compliance-docs \
  --rule 'transition:90:GLACIER,expiration:3650'
```

## 📞 Support and Maintenance

### Regular Maintenance Tasks

Weekly:
- [ ] Review application logs for errors
- [ ] Monitor resource utilization
- [ ] Check compliance dashboard metrics
- [ ] Verify backup integrity

Monthly:
- [ ] Review security logs
- [ ] Update dependencies
- [ ] Performance optimization review
- [ ] Cost analysis and optimization

Quarterly:
- [ ] Security audit
- [ ] Compliance certification review
- [ ] Disaster recovery testing
- [ ] Documentation updates

### Getting Help

- **DigitalOcean Support:** Available 24/7 for infrastructure issues
- **Community Forums:** DigitalOcean Community for best practices
- **Documentation:** Comprehensive guides at docs.digitalocean.com
- **Application Support:** See README.md for application-specific support

---

## 📋 Deployment Checklist

Pre-deployment:
- [ ] Repository configured with proper app.yaml
- [ ] Environment variables documented
- [ ] Database migration scripts tested
- [ ] SSL certificate requirements identified

Infrastructure:
- [ ] PostgreSQL database created and configured
- [ ] Redis cache instance provisioned
- [ ] DigitalOcean Spaces bucket created
- [ ] Network security rules configured

Deployment:
- [ ] Application deployed successfully
- [ ] Environment variables set as secrets
- [ ] Database migrations executed
- [ ] Initial admin user created
- [ ] Health checks passing

Post-deployment:
- [ ] Core functionality verified
- [ ] Monitoring and alerting configured
- [ ] Backup procedures validated
- [ ] Performance baseline established
- [ ] Documentation updated

This completes your DigitalOcean App Platform deployment. The system is now ready for production use with full CMS 2025 compliance capabilities.