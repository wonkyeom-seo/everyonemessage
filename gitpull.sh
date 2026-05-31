#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/everyonemessage}"
API_SERVICE="${API_SERVICE:-everyonemessage-api}"
CADDY_SERVICE="${CADDY_SERVICE:-caddy}"
CADDYFILE_SOURCE="${CADDYFILE_SOURCE:-Caddyfile.linux}"

log() {
  printf '\n==> %s\n' "$1"
}

cd "$APP_DIR"

log "Pull latest code"
sudo git config --global --add safe.directory "$APP_DIR" >/dev/null 2>&1 || true
sudo git pull --ff-only

log "Install npm packages"
sudo npm ci

log "Build shared, API, and web"
sudo npm run build

log "Install systemd service file"
if [[ -f "$APP_DIR/deploy/everyonemessage-api.service" ]]; then
  sudo install -m 0644 "$APP_DIR/deploy/everyonemessage-api.service" "/etc/systemd/system/${API_SERVICE}.service"
fi
sudo systemctl daemon-reload
sudo systemctl enable "$API_SERVICE" >/dev/null

log "Restart API"
sudo systemctl restart "$API_SERVICE"
sudo systemctl --no-pager --full status "$API_SERVICE"

log "Install and reload Caddy config"
if [[ -f "$APP_DIR/$CADDYFILE_SOURCE" ]]; then
  sudo install -m 0644 "$APP_DIR/$CADDYFILE_SOURCE" /etc/caddy/Caddyfile
fi
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload "$CADDY_SERVICE" || sudo systemctl restart "$CADDY_SERVICE"

log "Local API health check"
curl -fsS http://127.0.0.1:4000/api/health
printf '\n'

if [[ -f /etc/caddy/caddy.env ]]; then
  # shellcheck disable=SC1091
  set -a
  . /etc/caddy/caddy.env
  set +a
fi

if [[ -n "${APP_DOMAIN:-}" ]]; then
  log "Public HTTPS health check"
  curl -fsS "https://${APP_DOMAIN}/api/health"
  printf '\n'
fi

log "Done"
