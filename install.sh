#!/usr/bin/env bash
# ============================================================
#  FoodDiary — Script di installazione automatica
#  Testato su Debian 12 / Ubuntu 22.04 LXC (Proxmox)
#  Uso: bash install.sh
# ============================================================

set -euo pipefail

# ── Colori ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}✓${RESET}  $*"; }
info() { echo -e "${CYAN}→${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
die()  { echo -e "${RED}✗  ERRORE: $*${RESET}" >&2; exit 1; }
hr()   { echo -e "${CYAN}──────────────────────────────────────────${RESET}"; }

# ── Variabili configurabili ──────────────────────────────────
APP_DIR="/opt/diario-alimentare"
REPO_URL="https://github.com/alexpani/diario-alimentare.git"
NODE_MAJOR=22
APP_USER="fooddiary"

# ── Banner ───────────────────────────────────────────────────
clear
echo -e "${BOLD}${CYAN}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     FoodDiary — Installazione LXC     ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${RESET}"

# ── Verifica root ────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "Esegui lo script come root: sudo bash install.sh"

# ── Raccolta parametri ───────────────────────────────────────
hr
echo -e "${BOLD}Configurazione iniziale${RESET}"
hr

read -rp "  Porta app  [default: 3000]: " PORT
PORT=${PORT:-3000}

read -rp "  Utente admin [default: admin]: " ADMIN_USER
ADMIN_USER=${ADMIN_USER:-admin}

while true; do
  read -rsp "  Password admin: " ADMIN_PASSWORD; echo
  read -rsp "  Conferma password: " ADMIN_PASSWORD2; echo
  [[ "$ADMIN_PASSWORD" == "$ADMIN_PASSWORD2" ]] && break
  warn "Le password non coincidono, riprova."
done
[[ -n "$ADMIN_PASSWORD" ]] || die "La password non può essere vuota."

SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))" 2>/dev/null \
  || openssl rand -hex 48)

echo ""
ok "Parametri acquisiti"

# ── Sistema ──────────────────────────────────────────────────
hr; info "Aggiornamento sistema..."
apt-get update -qq && apt-get upgrade -y -qq
apt-get install -y -qq curl git ca-certificates gnupg lsb-release
ok "Sistema aggiornato"

# ── Node.js ──────────────────────────────────────────────────
hr; info "Installazione Node.js ${NODE_MAJOR}..."
if ! command -v node &>/dev/null || [[ "$(node -e 'process.stdout.write(process.version.split(".")[0].slice(1))')" -lt "$NODE_MAJOR" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - -qq
  apt-get install -y -qq nodejs
fi
ok "Node.js $(node -v)  |  npm $(npm -v)"

# ── PM2 ──────────────────────────────────────────────────────
hr; info "Installazione PM2..."
npm install -g pm2 --silent
ok "PM2 $(pm2 -v)"

# ── Utente di sistema ────────────────────────────────────────
hr; info "Creazione utente di sistema '${APP_USER}'..."
if ! id "$APP_USER" &>/dev/null; then
  useradd --system --shell /bin/bash --create-home --home-dir "/home/${APP_USER}" "$APP_USER"
  ok "Utente '${APP_USER}' creato"
else
  ok "Utente '${APP_USER}' già esistente"
fi

# ── Clone repo ───────────────────────────────────────────────
hr; info "Clone repository da GitHub..."
if [[ -d "$APP_DIR/.git" ]]; then
  warn "Directory ${APP_DIR} già esistente — pull invece di clone"
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi
ok "Repository in ${APP_DIR}"

# ── Dipendenze npm ───────────────────────────────────────────
hr; info "Installazione dipendenze npm..."
cd "$APP_DIR"
npm ci --omit=dev --silent
ok "Dipendenze installate"

# ── .env ─────────────────────────────────────────────────────
hr; info "Creazione file .env..."
cat > "${APP_DIR}/.env" <<EOF
NODE_ENV=production
PORT=${PORT}
SESSION_SECRET=${SESSION_SECRET}
ADMIN_USER=${ADMIN_USER}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
EOF
chmod 600 "${APP_DIR}/.env"
ok ".env creato (permessi 600)"

# ── Database ─────────────────────────────────────────────────
hr; info "Inizializzazione database..."
node "${APP_DIR}/setup.js"
ok "Database inizializzato"

# ── Permessi ─────────────────────────────────────────────────
hr; info "Impostazione permessi..."
mkdir -p "${APP_DIR}/uploads"
chown -R "${APP_USER}:${APP_USER}" "$APP_DIR"
ok "Permessi impostati su ${APP_USER}"

# ── PM2 ecosystem ────────────────────────────────────────────
hr; info "Configurazione PM2..."
cat > "${APP_DIR}/ecosystem.config.js" <<EOF
module.exports = {
  apps: [{
    name: 'food-diary',
    script: 'server.js',
    cwd: '${APP_DIR}',
    env: { NODE_ENV: 'production' },
    restart_delay: 3000,
    max_restarts: 10,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};
EOF

# Avvia come utente app
su -s /bin/bash "$APP_USER" -c "cd '${APP_DIR}' && pm2 start ecosystem.config.js && pm2 save"

# Startup automatico al boot
STARTUP_CMD=$(su -s /bin/bash "$APP_USER" -c "pm2 startup systemd -u '${APP_USER}' --hp '/home/${APP_USER}'" 2>&1 | grep "sudo env")
if [[ -n "$STARTUP_CMD" ]]; then
  eval "$STARTUP_CMD"
fi
ok "PM2 configurato e avviato"

# ── Firewall (ufw opzionale) ─────────────────────────────────
if command -v ufw &>/dev/null; then
  hr; info "Configurazione firewall UFW..."
  ufw allow ssh
  ufw allow "$PORT"/tcp
  ufw --force enable
  ok "UFW attivo"
fi

# ── Riepilogo ────────────────────────────────────────────────
hr
IP=$(hostname -I | awk '{print $1}')
echo -e "${BOLD}${GREEN}"
echo "  ✅  Installazione completata!"
echo -e "${RESET}"
echo -e "  ${BOLD}App locale:${RESET}    http://${IP}:${PORT}"
echo -e "  ${BOLD}Utente admin:${RESET}  ${ADMIN_USER}"
echo -e "  ${BOLD}App dir:${RESET}       ${APP_DIR}"
echo ""
echo -e "  ${BOLD}Ora in Nginx Proxy Manager:${RESET}"
echo -e "  • Proxy Host → forward a ${IP}:${PORT}"
echo -e "  • Abilita SSL con Let's Encrypt"
echo ""
echo -e "  ${BOLD}Comandi utili:${RESET}"
echo -e "  pm2 logs food-diary      # log in tempo reale"
echo -e "  pm2 restart food-diary   # riavvia"
echo -e "  pm2 status               # stato"
echo ""
echo -e "  ${BOLD}Aggiornamento futuro:${RESET}"
echo -e "  cd ${APP_DIR} && git pull && npm ci --omit=dev && pm2 restart food-diary"
hr
