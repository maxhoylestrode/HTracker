# Deploying Budgeteer on Ubuntu, behind Nginx Proxy Manager

This setup assumes Nginx Proxy Manager (NPM) is running in Docker on a **different** server, and this Ubuntu box just runs the Node app and exposes it on the network for NPM to reach. Domain used below: `tracker.apexstudio.dev` — replace it if that changes. Run everything as a user with `sudo` access.

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
Description=Budgeteer
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

By default Node's `.listen(PORT)` binds to all interfaces (`0.0.0.0`), so the app is already reachable from the network on port 3000 — nothing to change there. It is **not** exposed through any local nginx/certbot on this box; NPM on the other server handles that.

## 5. Lock the firewall down to just the NPM server

Don't leave port 3000 open to the whole internet — only the NPM server should be able to reach it. Find the NPM server's IP, then:

```bash
sudo ufw allow OpenSSH
sudo ufw allow from <NPM_SERVER_IP> to any port 3000
sudo ufw enable
sudo ufw status
```

Replace `<NPM_SERVER_IP>` with that server's actual IP (its LAN IP if both boxes share a private network, otherwise its public IP).

## 6. Add the Proxy Host in Nginx Proxy Manager

In the NPM web UI → **Proxy Hosts** → **Add Proxy Host**:

- **Domain Names**: `tracker.apexstudio.dev`
- **Scheme**: `http`
- **Forward Hostname / IP**: this Ubuntu server's IP (its LAN IP if NPM and this box share a private network — a Docker container's `127.0.0.1` means itself, not the host, so don't use that; otherwise use this server's public IP)
- **Forward Port**: `3000`
- **Websockets Support**: off (not needed, doesn't hurt if left on)

On the **SSL** tab: request a new Let's Encrypt certificate, enable **Force SSL** and **HTTP/2 Support**. Make sure the domain's DNS A/AAAA record already points at wherever NPM's server is reachable (its public IP), not at this Budgeteer box.

Save, then `tracker.apexstudio.dev` should load the app over HTTPS.

## Updating the app later

```bash
cd /opt/htracker
git pull
npm install --omit=dev
sudo systemctl restart htracker
```

## Notes

- SQLite data lives at `/opt/htracker/data/htracker.db`. Back that file up regularly (`sqlite3 data/htracker.db ".backup backup.db"` or just copy the file while the service is briefly stopped).
- `TRUST_PROXY=true` in `.env` is required once you're behind NPM — it's what lets Express correctly mark session cookies as `secure` and see the real client IP.
- To reset the login password later, just re-run `npm run create-admin` on the server.
