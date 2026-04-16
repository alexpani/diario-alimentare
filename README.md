# Food Diary

Diario alimentare personale — web app in Node.js + SQLite con integrazione [Food Tracker](https://github.com/alexpani/food-tracker) come catalogo nutrizionale.

## Installazione

```bash
# 1. Installa le dipendenze
npm install

# 2. Crea il database e le tabelle
node setup.js

# 3. Crea il file .env (vedi sotto)

# 4. Avvia il server
node server.js
```

Apri il browser su: **http://localhost:3000**

---

## Configurazione .env

```env
PORT=3000
SESSION_SECRET=una-stringa-casuale-lunga-e-sicura-almeno-32-caratteri
ADMIN_USER=admin
ADMIN_PASSWORD=la-tua-password-sicura
CATALOG_URL=http://192.168.68.153:3001   # URL del catalogo Food Tracker

# Riconoscimento piatto IA (opzionale)
VISION_PROVIDER=claude                    # o gemini
VISION_MODEL=claude-sonnet-4-6            # modificabile anche dalla UI
ANTHROPIC_API_KEY=sk-ant-...              # se VISION_PROVIDER=claude
GEMINI_API_KEY=...                        # se VISION_PROVIDER=gemini
```

> Genera `SESSION_SECRET` con:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

---

## Struttura del progetto

```
food-diary/
├── server.js           # Entry point Express
├── setup.js            # Script di inizializzazione DB
├── .env                # Configurazione (non committare!)
├── logo.png            # Logo app (sorgente per icone PWA)
├── vision-prompt.txt   # Prompt IA personalizzato (opzionale, non committato)
├── database/
│   ├── db.js           # Singleton connessione SQLite + migrazioni + upsertDaySnapshot
│   └── food_diary.sqlite
├── services/
│   └── vision.js       # Riconoscimento e descrizione piatto (Claude / Gemini)
├── routes/
│   ├── auth.js         # Login/logout (session-based, 30 giorni)
│   ├── diary.js        # API diario, riconoscimento foto, descrivi piatto (/api/diary)
│   ├── foods.js        # API alimenti + integrazione Food Tracker (/api/foods)
│   ├── plan.js         # API piani nutrizionali + snapshot giornaliero (/api/plan, /api/plans)
│   └── settings.js     # API impostazioni, sync Food Tracker, prompt/modello IA (/api/settings)
├── public/
│   ├── index.html      # SPA shell (4 tab + impostazioni in header)
│   ├── manifest.json   # Web App Manifest (PWA)
│   ├── sw.js           # Service worker — supporto offline
│   ├── apple-touch-icon.png  # Icona 180x180 per iOS
│   ├── icons/
│   │   ├── icon-192.png      # Icona 192x192 (manifest)
│   │   └── icon-512.png      # Icona 512x512 (manifest/splash)
│   ├── img/logo.png    # Logo usato nell'header
│   ├── foods-table.html # Spreadsheet alimenti (gestione bulk con colonne Foto/Fonte/Data)
│   ├── css/style.css   # Stili con dark mode e layout max 430px
│   └── js/
│       ├── app.js      # Core SPA, tab switching, sessione, calendario
│       ├── diary.js    # Tab Home — diario del giorno + flussi IA
│       ├── diarylog.js # Tab Diario — storico e grafici
│       ├── foods.js    # Tab Alimenti — CRUD, catalogo, barcode
│       ├── plan.js     # Tab Piano — multi-piano nutrizionale
│       ├── settings.js # Tab Impostazioni — sync Food Tracker, prompt IA, modello IA
│       ├── scanner-config.js  # Configurazione condivisa scanner barcode
│       └── barcode.js  # Scanner barcode (html5-qrcode)
└── uploads/            # Foto alimenti (non in git)
```

---

## Funzionalità

- **Home**: diario del giorno con navigazione data, aggiunta alimenti per pasto (6 pasti), riepilogo kcal/macros con gauge (mostra "Oltre +XXX" in eccesso), spostamento alimenti tra pasti; il bottone "Aggiungi" mostra `Aggiungo…` durante il salvataggio e la modale si chiude subito al successo (refresh in background), con alert esplicito in caso di errore
- **Calendario**: anelli colorati semaforo (verde/giallo/rosso) sui giorni in base alle kcal vs target del piano del giorno (via snapshot); il giorno selezionato usa il colore dell'anello come sfondo
- **Snapshot piano giornaliero**: il target kcal del giorno è memorizzato alla scrittura delle voci, così la home mostra sempre il piano corretto anche se il piano attivo viene cambiato in seguito
- **Copia da ieri**: nei pasti vuoti mostra anteprima con alimento top + conteggio + kcal (es. "Copia colazione da ieri — Muffin e 1 altro — 450 kcal")
- **Diario**: storico giorni, grafici settimanali e mensili (Chart.js)
- **Alimenti**: database personale con ricerca (soglia 2 caratteri), import dal catalogo Food Tracker, barcode scanner, upload foto, porzioni decimali; recenti/frequenti fino a 12 alimenti con fallback cross-meal
- **Gestione alimenti avanzata** (`foods-table.html`): spreadsheet full-width con colonne Foto, Fonte e Data, editing inline
- **Barcode**: se non trovato nel DB locale né nel catalogo, mostra "Crea questo alimento" con barcode precompilato
- **Ricette**: il peso finale è sempre la somma degli ingredienti; modifica ricetta direttamente dal diario cliccando sull'alimento nel pasto
- **Riconosci piatto IA** (foto): fotografa un piatto, l'IA identifica gli alimenti con stima quantità, match automatico nel DB locale e catalogo Food Tracker
- **Descrivi piatto IA** (testo): descrivi a parole cosa stai mangiando (es. "piatto medio di pasta al sugo"), l'IA scompone il piatto in ingredienti (solo dati CREA) e lo aggiunge come ricetta unica al pasto
- **IA configurabile**: selezione modello (Claude Sonnet/Haiku/Opus 4.x, Gemini 2.0/2.5 Flash/Pro) e prompt editabile dalle impostazioni
- **Piano**: 7 piani nutrizionali preimpostati (calibrati su TDEE personale), attivazione singola
- **Impostazioni**: cambio password, sincronizzazione verso Food Tracker, selezione modello e prompt IA, tema chiaro/scuro
- **PWA offline**: service worker con pre-cache shell + CDN, stale-while-revalidate per asset e uploads, network-first con fallback cache per le API read-only. Banner "Nuova versione disponibile" quando il SW si aggiorna
- **Layout mobile-first**: l'intero frame è contenuto in max-width 430px anche su desktop, per rispecchiare l'esperienza mobile

## Integrazione Food Tracker

L'app usa **Food Tracker** come unica fonte dati esterna — un catalogo locale di 210.000+ prodotti italiani (OFF + CREA + APP).

- **Ricerca**: dal tab Alimenti o dal tab Home, cerca nel catalogo Food Tracker
- **Barcode**: scansione barcode cerca prima nel DB locale, poi nel catalogo
- **Sync**: dal tab Impostazioni, sincronizza i prodotti locali verso Food Tracker (etichetta APP)

---

## Deploy (produzione su LXC Proxmox)

```bash
# Aggiornamento su LXC (192.168.68.173)
bash /opt/diario-alimentare/update.sh

# Log e gestione PM2
su -s /bin/bash fooddiary -c "pm2 logs food-diary --lines 50"
su -s /bin/bash fooddiary -c "pm2 restart food-diary"
su -s /bin/bash fooddiary -c "pm2 status"
```

Il workflow è: Mac → commit+push → GitHub → `update.sh` su LXC.
