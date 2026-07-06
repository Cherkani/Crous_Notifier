#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/automation.al-shifae.ma}"
PM2_NAME="${PM2_NAME:-crous-automation}"
DOMAIN="${DOMAIN:-automation.al-shifae.ma}"

cd "$APP_DIR"

npm --prefix backend install
npm --prefix frontend install
npm --prefix frontend run build

if command -v pm2 >/dev/null 2>&1; then
  pm2 describe "$PM2_NAME" >/dev/null 2>&1 \
    && pm2 restart "$PM2_NAME" \
    || pm2 start backend/src/server.js --name "$PM2_NAME"
  pm2 save
else
  echo "pm2 is required to run the backend process" >&2
  exit 1
fi

cat <<NGINX

Nginx reminder for ${DOMAIN}:

server {
  server_name ${DOMAIN};

  location / {
    proxy_pass http://127.0.0.1:4100;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}

NGINX
