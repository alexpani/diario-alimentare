# Food Diary

Diario alimentare personale — web app locale in Node.js + SQLite.

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

Crea un file `.env` nella root del progetto:

```env
PORT=3000
SESSION_SECRET=una-stringa-casuale-lunga-e-sicura-almeno-32-caratteri
ADMIN_USER=admin
ADMIN_PASSWORD=la-tua-password-sicura
```

> **Nota**: `SESSION_SECRET` deve essere una stringa casuale lunga. Puoi generarla con:
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
├── .env.example        # Template configurazione
├── package.json
├── database/
│   ├── db.js           # Singleton connessione SQLite
│   └── food_diary.sqlite  # DB creato da setup.js
├── routes/
│   ├── auth.js         # Login/logout
│   ├── diary.js        # API diario
│   ├── foods.js        # API alimenti
│   ├── plan.js         # API piano nutrizionale
│   └── settings.js     # API impostazioni
├── public/
│   ├── index.html      # SPA shell
│   ├── css/style.css
│   └── js/
│       ├── app.js      # Core SPA
│       ├── diary.js    # Tab Home
│       ├── diarylog.js # Tab Diario
│       ├── foods.js    # Tab Alimenti
│       ├── plan.js     # Tab Piano
│       ├── settings.js # Tab Impostazioni
│       └── barcode.js  # Scanner barcode
└── uploads/            # Foto alimenti
```

---

## Avvio con PM2 (produzione)

```bash
# Installa PM2 globalmente
npm install -g pm2

# Avvia l'app
pm2 start server.js --name food-diary

# Avvio automatico al riavvio del sistema
pm2 startup
pm2 save

# Comandi utili
pm2 status
pm2 logs food-diary
pm2 restart food-diary
pm2 stop food-diary
```

---

## Funzionalità

- **Home**: diario del giorno corrente con navigazione ±1 giorno, aggiunta alimenti per pasto, riepilogo kcal/macros con barra di progresso
- **Diario**: storico giorni, grafici settimanali e mensili (Chart.js)
- **Alimenti**: database personale con ricerca, import da OpenFoodFacts, upload foto, scanner barcode
- **Piano**: impostazione target kcal e % macros
- **Impostazioni**: cambio password
