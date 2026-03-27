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
├── database/
│   ├── db.js           # Singleton connessione SQLite + migrazioni
│   └── food_diary.sqlite
├── routes/
│   ├── auth.js         # Login/logout (session-based, 30 giorni)
│   ├── diary.js        # API diario (/api/diary)
│   ├── foods.js        # API alimenti + integrazione Food Tracker (/api/foods)
│   ├── plan.js         # API piani nutrizionali (/api/plan, /api/plans)
│   └── settings.js     # API impostazioni + sync Food Tracker (/api/settings)
├── public/
│   ├── index.html      # SPA shell (5 tab)
│   ├── css/style.css   # Stili con dark mode
│   └── js/
│       ├── app.js      # Core SPA, tab switching, sessione
│       ├── diary.js    # Tab Home — diario del giorno
│       ├── diarylog.js # Tab Diario — storico e grafici
│       ├── foods.js    # Tab Alimenti — CRUD, catalogo, barcode
│       ├── plan.js     # Tab Piano — multi-piano nutrizionale
│       ├── settings.js # Tab Impostazioni — sync Food Tracker
│       └── barcode.js  # Scanner barcode (html5-qrcode)
└── uploads/            # Foto alimenti (non in git)
```

---

## Funzionalità

- **Home**: diario del giorno con navigazione data, aggiunta alimenti per pasto (6 pasti), riepilogo kcal/macros con gauge, spostamento alimenti tra pasti
- **Diario**: storico giorni, grafici settimanali e mensili (Chart.js)
- **Alimenti**: database personale con ricerca, import dal catalogo Food Tracker, barcode scanner, upload foto, porzioni decimali
- **Piano**: 7 piani nutrizionali preimpostati (calibrati su TDEE personale), attivazione singola
- **Impostazioni**: cambio password, sincronizzazione verso Food Tracker, tema chiaro/scuro

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
