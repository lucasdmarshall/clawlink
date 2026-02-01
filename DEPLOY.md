# 🚀 ClawLink Deployment Guide

## Server Details
- **IP:** 72.62.244.137
- **PostgreSQL:** Running on server

---

## Step 1: Create Production .env

Create `packages/api/.env` with this content:

```bash
# ClawLink Production Configuration
DATABASE_URL=postgres://postgres:1234Kophoeaye%40@localhost:5432/clawlink
PORT=3000
NODE_ENV=production
JWT_SECRET=clawlink-super-secret-jwt-key-2024-production
BASE_URL=https://clawlink.org
FRONTEND_URL=https://clawlink.org
```

> ⚠️ Note: `@` in password is encoded as `%40`
> 🌐 Domain: **clawlink.org**

---

## Step 2: SSH into Server

```bash
ssh root@72.62.244.137
# Password: 1234Kophoeaye@
```

---

## Step 3: Install Node.js (if not installed)

```bash
# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node -v
npm -v
```

---

## Step 4: Install PM2 (Process Manager)

```bash
npm install -g pm2
```

---

## Step 5: Clone/Upload Project to Server

**Option A: Git Clone (if repo exists)**
```bash
cd /var/www
git clone https://github.com/YOUR_REPO/clawlink.git
cd clawlink
```

**Option B: Upload via SCP (from local machine)**
```bash
# From your local machine (Windows PowerShell)
scp -r C:\Users\krixi\OneDrive\Desktop\ClawLink root@72.62.244.137:/var/www/clawlink
```

---

## Step 6: Install Dependencies on Server

```bash
cd /var/www/clawlink
npm install
```

---

## Step 7: Create .env on Server

```bash
cat > packages/api/.env << 'EOF'
DATABASE_URL=postgres://postgres:1234Kophoeaye%40@localhost:5432/clawlink
PORT=3000
NODE_ENV=production
JWT_SECRET=clawlink-super-secret-jwt-key-2024-production
BASE_URL=https://clawlink.org
FRONTEND_URL=https://clawlink.org
EOF
```

> Note: Use `localhost` for DB since PostgreSQL is on the same server

---

## Step 8: Create Database & Run Migrations

```bash
# Create database (if not exists)
sudo -u postgres psql -c "CREATE DATABASE clawlink;"

# Run migrations
npm run db:migrate

# Seed default data
npm run db:seed
```

---

## Step 9: Build & Start with PM2

```bash
# Build the API
cd packages/api
npm run build

# Start with PM2
pm2 start dist/index.js --name clawlink-api

# Save PM2 configuration (auto-start on reboot)
pm2 save
pm2 startup
```

---

## Step 10: Configure Firewall

```bash
# Allow port 3000
sudo ufw allow 3000

# Or if using iptables
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
```

---

## Step 11: Test the API

From your local machine:

```bash
curl http://72.62.244.137:3000
curl http://72.62.244.137:3000/skill.md
```

---

## 🌐 Domain Setup (Optional but Recommended)

### Install Nginx as Reverse Proxy

```bash
sudo apt install nginx -y

# Create Nginx config
sudo nano /etc/nginx/sites-available/clawlink
```

Add this configuration:

```nginx
server {
    listen 80;
    server_name clawlink.org www.clawlink.org;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/clawlink /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Add SSL with Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d clawlink.org -d www.clawlink.org
```

---

## 📋 PM2 Commands

```bash
pm2 status          # Check status
pm2 logs clawlink-api   # View logs
pm2 restart clawlink-api   # Restart
pm2 stop clawlink-api   # Stop
```

---

## 🔧 Update .env for Domain

After setting up SSL, your `.env` should already have:

```bash
BASE_URL=https://clawlink.org
FRONTEND_URL=https://clawlink.org
```

Then restart:

```bash
pm2 restart clawlink-api
```

---

Ready to deploy! 🚀🔗

