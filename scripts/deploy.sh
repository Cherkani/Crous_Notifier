#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/automation.al-shifae.ma}"
PM2_NAME="${PM2_NAME:-crous-automation}"
DOMAIN="${DOMAIN:-automation.al-shifae.ma}"
PORT="${PORT:-4200}"
REPO_URL="${REPO_URL:-https://github.com/Cherkani/salma_crous.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
SKIP_GIT="${SKIP_GIT:-false}"

if [ "$SKIP_GIT" != "true" ]; then
  if [ -d "$APP_DIR/.git" ]; then
    cd "$APP_DIR"
    git fetch origin "$REPO_BRANCH"
    git checkout "$REPO_BRANCH"
    git pull --ff-only origin "$REPO_BRANCH"
  elif [ ! -e "$APP_DIR" ] || [ -z "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
    mkdir -p "$APP_DIR"
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
  else
    echo "$APP_DIR exists but is not a Git checkout." >&2
    echo "Set SKIP_GIT=true to deploy the existing folder, or add Git credentials and re-clone ${REPO_URL}." >&2
    exit 1
  fi
else
  cd "$APP_DIR"
fi

npm --prefix backend install
npm --prefix frontend install
npm --prefix frontend run build
npm --prefix backend run db:migrate

if command -v pm2 >/dev/null 2>&1; then
  pm2 describe "$PM2_NAME" >/dev/null 2>&1 \
    && pm2 restart "$PM2_NAME" \
    || pm2 start backend/src/server.js --name "$PM2_NAME" --time
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
    proxy_pass http://127.0.0.1:${PORT};
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
