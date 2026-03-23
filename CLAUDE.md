# FoodDiary — Guida per Claude

## Stack
- **Runtime**: Node.js 25 (⚠️ better-sqlite3 non funziona su Node 25 — usa `sqlite` + `sqlite3`)
- **Framework**: Express 4
- **DB**: SQLite via `sqlite3` + `sqlite` (async/await wrapper)
- **Frontend**: SPA vanilla JS, nessun framework/bundler

## Comandi essenziali

```bash
# Primo avvio
npm install
node setup.js          # crea il DB e le tabelle

# Avvio server
node server.js         # → http://localhost:3000

# Import dati
node import_csv.js     # import alimenti da CSV
node import_plans.js   # inserisce piani nutrizionali preimpostati
node update_plans_kcal.js  # aggiorna kcal piani su TDEE personale
```

## Struttura progetto

```
├── server.js              # Entry point Express
├── setup.js               # Inizializzazione DB (idempotente)
├── .env                   # Segreti (non in git)
├── database/
│   ├── db.js              # Singleton SQLite + migrazioni automatiche
│   └── food_diary.sqlite  # DB (non in git)
├── routes/
│   ├── auth.js            # Login / logout (session-based)
│   ├── diary.js           # /api/diary — voci diario
│   ├── foods.js           # /api/foods — libreria alimenti
│   ├── plan.js            # /api/plan, /api/plans — piani nutrizionali
│   └── settings.js        # /api/settings — cambio password
├── public/
│   ├── index.html         # Shell SPA (tab: home, diario, alimenti, piano, impostazioni)
│   ├── foods-table.html   # Spreadsheet alimenti (standalone)
│   └── js/
│       ├── app.js         # Core: tab switching, sessione, utility globali
│       ├── diary.js       # Tab Home — diario del giorno
│       ├── diarylog.js    # Tab Diario — storico e grafici
│       ├── foods.js       # Tab Alimenti — CRUD alimenti, foto, barcode
│       ├── plan.js        # Tab Piano — multi-piano nutrizionale
│       ├── settings.js    # Tab Impostazioni
│       └── barcode.js     # Scanner barcode (html5-qrcode)
└── uploads/               # Foto alimenti (non in git)
```

## Database — tabelle principali

| Tabella | Descrizione |
|---------|-------------|
| `foods` | Libreria alimenti. `deleted_at` per soft-delete. `is_quick=1` per voci al volo. |
| `diary_entries` | Voci del diario: `food_id`, `meal` (colazione/pranzo/cena/snack), `quantity_g`, `date` |
| `portions` | Porzioni nominate per alimento (es. "1 fetta = 30g") |
| `plans` | Piani nutrizionali. `is_active=1` sul piano corrente (uno solo alla volta). |
| `settings` | Coppia chiave/valore (es. `admin_password`) |

## API principali

### Alimenti `/api/foods`
- `GET /api/foods?q=<query>` — ricerca fuzzy multi-token (filtra `deleted_at IS NULL`, `is_quick=0`)
- `GET /api/foods?barcode=<ean>` — match esatto barcode
- `POST /api/foods` — crea alimento (multipart, supporta foto)
- `PUT /api/foods/:id` — modifica; `remove_image=1` per cancellare foto
- `DELETE /api/foods/:id` — soft-delete (imposta `deleted_at`)

### Diario `/api/diary`
- `GET /api/diary?date=YYYY-MM-DD` — voci del giorno
- `POST /api/diary` — aggiunge voce
- `PUT /api/diary/:id` — modifica quantità
- `DELETE /api/diary/:id` — rimuove voce
- `POST /api/diary/quick` — crea alimento `is_quick=1` + voce diario atomicamente
- `GET /api/diary/recent?meal=<meal>` — ultimi alimenti usati per quel pasto

### Piani `/api/plan` e `/api/plans`
- `GET /api/plan` — piano attivo (backward compat)
- `PUT /api/plan` — aggiorna piano attivo
- `GET /api/plans/all` — lista tutti i piani
- `POST /api/plans/new` — crea piano
- `PUT /api/plans/:id` — modifica piano
- `POST /api/plans/:id/activate` — attiva piano (disattiva gli altri)
- `DELETE /api/plans/:id` — elimina (non il piano attivo)

## Gotcha importanti

### sqlite async
```js
// ✅ corretto — spread params
await db.run('INSERT INTO foo VALUES (?, ?)', val1, val2);
// ❌ sbagliato
await db.run('INSERT INTO foo VALUES (?, ?)', [val1, val2]);
```

### Migrazioni DB
`db.js` esegue migrazioni automatiche all'avvio tramite `PRAGMA table_info`.
Pattern usato:
```js
const cols = await _db.all('PRAGMA table_info(tabella)');
if (!cols.find(c => c.name === 'nuova_colonna')) {
  await _db.run('ALTER TABLE tabella ADD COLUMN nuova_colonna TEXT');
}
```

### Cache iOS Safari
I file JS hanno `?v=N` nell'`<script src>` di `index.html`.
Incrementa la versione ogni volta che modifichi un file JS per forzare il refresh su iOS.

### Soft-delete alimenti
`DELETE /api/foods/:id` non cancella la riga — imposta `deleted_at = datetime('now')`.
Le voci del diario (`diary_entries`) conservano il `food_id` e restano intatte.
La GET foods filtra sempre `deleted_at IS NULL`.

### Voce rapida (`is_quick`)
`POST /api/diary/quick` crea un alimento con `is_quick=1` (non appare in libreria) e la relativa voce diario.
La GET foods filtra anche `is_quick = 0`.

### Autenticazione
Session-based (express-session, 30 giorni).
`isAuth` middleware in `routes/auth.js` — usa `req.originalUrl` (non `req.path`) per rilevare route API e restituire 401 JSON invece di redirect.

## Piano nutrizionale attivo — calcolo personale
- **Utente**: maschio, 56 anni (nato giugno 1969), 180 cm, 80 kg, sedentario
- **BMR** (Mifflin-St Jeor): 1.650 kcal
- **TDEE** (×1.2 sedentario): ~1.980 kcal → arrotondato a 2.000

| Piano | Kcal | Logica |
|-------|------|--------|
| Mantenimento | 2.000 | TDEE |
| Dimagrimento | 1.500 | −500 kcal |
| Low Carb | 1.750 | −250 kcal |
| Chetogenico | 1.650 | −350 kcal |
| Mediterranea | 2.000 | TDEE bilanciato |
| Alto proteico | 2.150 | +150 kcal recomp |
| Ipertrofia muscolare | 2.300 | +300 kcal lean bulk |
