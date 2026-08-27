# Deploying Htracker on Ubuntu + nginx

Domain used below: `tracker.apexstudio.dev` — replace it if that changes. Run everything as a user with `sudo` access.

## 1. Install Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v   # should print v22.x
```

## 2. Clone and set up the app

```bash
cd /opt
sudo git clone https://github.com/maxhoylestrode/HTracker.git htracker
sudo chown -R $USER:$USER /opt/htracker
cd /opt/htracker

npm install --omit=dev
npm run init-db
npm run create-admin   # follow the prompts to set your login — must be run in a real terminal (SSH is fine)
```

## 3. Configure environment

```bash
cp .env.example .env
# Generate a real secret and drop it straight into .env:
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
nano .env   # confirm NODE_ENV=production and TRUST_PROXY=true
```

## 4. Run it as a service (systemd)

```bash
sudo tee /etc/systemd/system/htracker.service > /dev/null << 'EOF'
[Unit]
Description=Htracker
After=network.target

[Service]
Type=simple
User=USERNAME
WorkingDirectory=/opt/htracker
ExecStart=/usr/bin/node server.js
Restart=on-failure
EnvironmentFile=/opt/htracker/.env

[Install]
WantedBy=multi-user.target
EOF
```

Replace `USERNAME` in that file with your actual Ubuntu username (`whoami`), then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now htracker
sudo systemctl status htracker   # should show "active (running)"
```

The app is now listening on `127.0.0.1:3000` only — not exposed to the internet yet.

## 5. nginx reverse proxy

```bash
sudo apt-get install -y nginx
```

Create `/etc/nginx/sites-available/htracker`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name tracker.apexstudio.dev;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    client_max_body_size 1m;
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/htracker /etc/nginx/sites-enabled/htracker
sudo nginx -t
sudo systemctl reload nginx
```

At this point `http://tracker.apexstudio.dev` should load the app (make sure the domain's DNS A/AAAA record already points at this server).

## 6. HTTPS via Let's Encrypt

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tracker.apexstudio.dev
```

Certbot rewrites the nginx config to add the 443 block and an automatic HTTP→HTTPS redirect, and sets up auto-renewal. Confirm renewal works:

```bash
sudo certbot renew --dry-run
```

## 7. Firewall (if ufw is in use)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## Updating the app later

```bash
cd /opt/htracker
git pull
npm install --omit=dev
sudo systemctl restart htracker
```

## Notes

- SQLite data lives at `/opt/htracker/data/htracker.db`. Back that file up regularly (`sqlite3 data/htracker.db ".backup backup.db"` or just copy the file while the service is briefly stopped).
- `TRUST_PROXY=true` in `.env` is required once you're behind nginx — it's what lets Express correctly mark session cookies as `secure` and see the real client IP.
- To reset the login password later, just re-run `npm run create-admin` on the server.
