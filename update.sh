#!/usr/bin/env bash
# ============================================================
#  FoodDiary — Script di aggiornamento dal repository GitHub
#  Uso: bash update.sh
# ============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}✓${RESET}  $*"; }
info() { echo -e "${CYAN}→${RESET}  $*"; }
die()  { echo -e "${RED}✗  ERRORE: $*${RESET}" >&2; exit 1; }

APP_DIR="/opt/diario-alimentare"
APP_USER="fooddiary"

[[ $EUID -eq 0 ]] || die "Esegui come root: sudo bash update.sh"
[[ -d "$APP_DIR/.git" ]] || die "Directory $APP_DIR non trovata o non è un repo git"

echo -e "${BOLD}${CYAN}FoodDiary — Aggiornamento${RESET}"
echo ""

info "Pull da GitHub..."
su -s /bin/bash "$APP_USER" -c "git -C '$APP_DIR' pull --ff-only"
ok "Codice aggiornato"

info "Installazione dipendenze..."
su -s /bin/bash "$APP_USER" -c "npm ci --prefix '$APP_DIR' --omit=dev --silent"
ok "Dipendenze ok"

info "Riavvio app..."
su -s /bin/bash "$APP_USER" -c "pm2 restart food-diary"
ok "App riavviata"

echo ""
echo -e "${BOLD}${GREEN}Aggiornamento completato!${RESET}"
su -s /bin/bash "$APP_USER" -c "pm2 status food-diary"
