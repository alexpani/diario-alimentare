#!/usr/bin/env bash
# ============================================================
#  FoodDiary — Rotazione del GitHub PAT usato dall'LXC
# ============================================================
#
#  Sostituisce il Personal Access Token embedded nell'URL del
#  remote (`.git/config`) sull'LXC di produzione. Va eseguito
#  dal Mac quando il PAT "food-diary-lxc" sta per scadere o è
#  stato revocato.
#
#  Uso:
#      bash rotate-lxc-token.sh
#
#  Il nuovo token viene letto via prompt silenzioso (niente
#  echo, niente history, niente argv) e inviato all'LXC via
#  stdin. Lo script:
#    1. fa SSH come root sull'LXC
#    2. passa a fooddiary (che possiede il repo) con su -p
#    3. aggiorna remote.origin.url con il nuovo token
#    4. verifica con `git fetch origin`
#
#  Variabili di ambiente opzionali per override:
#      LXC_HOST       default: root@192.168.68.173
#      LXC_PATH       default: /opt/diario-alimentare
#      LXC_APP_USER   default: fooddiary
#      GITHUB_USER    default: alexpani
#      REPO           default: alexpani/diario-alimentare
#
#  Prerequisiti:
#    - Il vecchio token è stato REVOCATO su
#      https://github.com/settings/tokens
#    - Hai generato un nuovo PAT (consigliato: fine-grained,
#      scope "Contents: Read" sul solo repo)
#    - Accesso SSH root all'LXC funzionante (ssh-agent OK)
# ============================================================

set -euo pipefail

LXC_HOST="${LXC_HOST:-root@192.168.68.173}"
LXC_PATH="${LXC_PATH:-/opt/diario-alimentare}"
LXC_APP_USER="${LXC_APP_USER:-fooddiary}"
GITHUB_USER="${GITHUB_USER:-alexpani}"
REPO="${REPO:-alexpani/diario-alimentare}"

echo "Target LXC:   ${LXC_HOST}"
echo "Repo path:    ${LXC_PATH}"
echo "Repo owner:   ${LXC_APP_USER}"
echo "GitHub repo:  ${REPO}  (user ${GITHUB_USER})"
echo
echo "⚠  Prima di continuare, assicurati che il VECCHIO token sia stato"
echo "   REVOCATO su https://github.com/settings/tokens"
echo
read -rp "Procedere? [y/N] " confirm
case "${confirm}" in [yY]|[yY][eE][sS]) ;; *) echo "Annullato."; exit 1;; esac

# Prompt silenzioso: il token non viene mai mostrato, né salvato in history.
read -rsp "Incolla il nuovo GitHub PAT (input nascosto): " NEW_TOKEN
echo
[[ -n "${NEW_TOKEN}" ]] || { echo "Token vuoto. Annullato." >&2; exit 1; }

# Sanity check del formato (classic ghp_… o fine-grained github_pat_…)
if ! [[ "${NEW_TOKEN}" =~ ^(ghp_|github_pat_)[A-Za-z0-9_]+$ ]]; then
  read -rp "Il token non sembra un PAT GitHub (manca prefisso ghp_/github_pat_). Continuo comunque? [y/N] " c
  case "${c}" in [yY]|[yY][eE][sS]) ;; *) echo "Annullato."; exit 1;; esac
fi

# Script eseguito sull'LXC. Non contiene segreti: il token viaggia su stdin
# e viene esportato come env var per il sub-shell `su -p fooddiary`.
REMOTE_SCRIPT=$(cat <<EOF
set -euo pipefail
read -r TOKEN
[ -n "\$TOKEN" ] || { echo "[remote] token vuoto su stdin" >&2; exit 1; }

export TOKEN
su -s /bin/bash -p '${LXC_APP_USER}' -c '
  set -euo pipefail
  cd "${LXC_PATH}"
  git remote set-url origin "https://${GITHUB_USER}:\${TOKEN}@github.com/${REPO}.git"
  echo "[remote] remote.origin.url aggiornato, verifico con git fetch..."
  git fetch origin --quiet
  echo "[remote] OK — il nuovo token funziona."
'
unset TOKEN
EOF
)

# Codifica lo script in base64 per evitare quoting hell attraverso SSH.
REMOTE_B64=$(printf '%s' "${REMOTE_SCRIPT}" | base64 | tr -d '\n')

# Manda il token su stdin; lo script viene ricostruito via base64 -d
# e passato a `bash -c`, che eredita lo stdin.
printf '%s\n' "${NEW_TOKEN}" | \
  ssh "${LXC_HOST}" "bash -c \"\$(printf %s ${REMOTE_B64} | base64 -d)\""

# Pulisci la variabile dal processo corrente
NEW_TOKEN=""
unset NEW_TOKEN

echo
echo "✔ Token ruotato."
echo
echo "Prossimi passi suggeriti:"
echo "  1. Lancia un update end-to-end:"
echo "       ssh ${LXC_HOST} bash ${LXC_PATH}/update.sh"
echo "  2. Salva il nuovo token nel tuo password manager."
echo "  3. Segnati la nuova scadenza in calendario."
