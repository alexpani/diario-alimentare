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
├── services/
│   └── vision.js          # Riconoscimento alimenti da foto (Claude / Gemini)
├── routes/
│   ├── auth.js            # Login / logout (session-based)
│   ├── diary.js           # /api/diary — voci diario + riconoscimento foto
│   ├── foods.js           # /api/foods — libreria alimenti + integrazione Food Tracker
│   ├── plan.js            # /api/plan, /api/plans — piani nutrizionali
│   └── settings.js        # /api/settings — password, sync Food Tracker
├── public/
│   ├── index.html         # Shell SPA (tab bar: home, diario, alimenti, piano; impostazioni nell'header)
│   ├── manifest.json      # Web App Manifest (PWA)
│   ├── apple-touch-icon.png  # Icona 180x180 per iOS Home Screen
│   ├── icons/             # Icone PWA (192x192, 512x512)
│   ├── foods-table.html   # Spreadsheet alimenti (standalone)
│   └── js/
│       ├── app.js         # Core: tab switching, sessione, utility globali, calendario con anelli colorati
│       ├── diary.js       # Tab Home — diario del giorno
│       ├── diarylog.js    # Tab Diario — storico e grafici
│       ├── foods.js       # Tab Alimenti — CRUD alimenti, foto, barcode, catalogo
│       ├── plan.js        # Tab Piano — multi-piano nutrizionale
│       ├── settings.js    # Tab Impostazioni (sync Food Tracker)
│       └── barcode.js     # Scanner barcode (html5-qrcode)
└── uploads/               # Foto alimenti (non in git)
```

## Database — tabelle principali

| Tabella | Descrizione |
|---------|-------------|
| `foods` | Libreria alimenti. `deleted_at` per soft-delete. `is_quick=1` per voci al volo. `source` = `app`/`openfoodfacts`/`crea` (origine del prodotto). |
| `diary_entries` | Voci del diario: `food_id`, `meal` (colazione/pranzo/cena/snack), `quantity_g`, `date` |
| `portions` | Porzioni nominate per alimento (es. "1 fetta = 30g") |
| `plans` | Piani nutrizionali. `is_active=1` sul piano corrente (uno solo alla volta). |
| `settings` | Coppia chiave/valore (es. `admin_password`) |

## API principali

### Alimenti `/api/foods`
- `GET /api/foods?q=<query>` — ricerca fuzzy multi-token (filtra `deleted_at IS NULL`, `is_quick=0`)
- `GET /api/foods?barcode=<ean>` — match esatto barcode (solo `is_quick=0`)
- `GET /api/foods?barcode=<ean>&include_quick=1` — match barcode inclusi i quick (usato nel tab Alimenti)
- `POST /api/foods` — crea alimento (multipart, supporta foto)
- `PUT /api/foods/:id` — modifica; `remove_image=1` per cancellare foto
- `DELETE /api/foods/:id` — soft-delete (imposta `deleted_at`)
- `POST /api/foods/import-catalog` — importa da Food Tracker: body `{ query }` o `{ barcode }`
- `GET /api/foods/proxy-image?url=<url>` — proxy immagini (pubblica, no auth)

### Diario `/api/diary`
- `GET /api/diary?date=YYYY-MM-DD` — voci del giorno
- `POST /api/diary` — aggiunge voce
- `PUT /api/diary/:id` — modifica quantità e/o pasto (`meal_type`)
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

### Impostazioni `/api/settings`
- `GET /api/settings` — recupera impostazioni (password mascherata)
- `PUT /api/settings/password` — cambia password
- `POST /api/settings/sync-to-tracker` — sincronizza alimenti locali verso Food Tracker
  - Invia tutti i foods (`is_quick=0`, non eliminati) tramite `POST /product` di Food Tracker
  - Foods senza barcode usano `external_id = app_<id>` per evitare duplicati
  - Source: `app` per prodotti creati nell'app, altrimenti eredita dalla fonte originale

## Flusso barcode

### Tab Home (aggiunta a un pasto)
1. Scansione barcode
2. Cerca nel DB locale (`is_quick=0`) per barcode
3. Se trovato → selezione quantità diretta
4. Se non trovato → cerca in Food Tracker via `import-catalog`
5. Se trovato nel catalogo → apre form alimento pre-compilato per modifica/salvataggio
6. Se salvato → selezione quantità → aggiunta al pasto
7. Se non trovato → mostra "Nessun risultato" + bottone "Crea questo alimento" con barcode precompilato

### Tab Alimenti (gestione libreria)
1. Scansione barcode
2. Cerca nel DB locale (inclusi `is_quick=1`) per barcode
3. Se trovato → apre form di modifica (anche per promuovere `is_quick=1` a normale)
4. Se non trovato → cerca in Food Tracker via `import-catalog`
5. Se trovato → apre form pre-compilato per modifica/salvataggio nella libreria

## Calendario Home — anelli colorati

Il calendario nella Home mostra anelli colorati (semaforo) intorno ai giorni con registrazioni:
- **Verde** (`#43A047`) — sotto il target kcal del piano
- **Giallo** (`#F9A825`) — sopra fino a +200 kcal
- **Rosso** (`#E53935`) — oltre +200 kcal sopra il target

Il giorno selezionato usa il colore dell'anello come sfondo (non sempre verde).
I dati vengono da `/api/diary/range` che restituisce kcal per giorno.

## Gauge — "Oltre" in eccesso

Quando le kcal consumate superano il target del piano, il gauge mostra:
- Label: "Oltre" (invece di "Rimanenti")
- Valore: "+XXX" (kcal in eccesso)
- Il colore del testo rimane invariato (non cambia in rosso)

## Copia da ieri

Nei pasti vuoti appare il bottone "Copia [pasto] da ieri" con anteprima:
- Mostra l'alimento più calorico di ieri + conteggio altri + kcal totali
- Es. "Copia colazione da ieri" con sotto "Muffin e 1 altro — 450 kcal"
- Se ieri il pasto era vuoto, il bottone non appare
- I dati di ieri sono caricati in `loadEntries()` via `/api/diary?date=yesterday`

## Recenti e frequenti

La modale "Aggiungi alimento" mostra fino a 12 alimenti recenti/frequenti per pasto (era 8).

## PWA

L'app è installabile come PWA su iOS (Home Screen):
- `public/manifest.json` — Web App Manifest
- `public/apple-touch-icon.png` — 180x180 (generata da `logo.png` con `sips`)
- `public/icons/icon-192.png` e `icon-512.png` — icone manifest
- Meta tag in `index.html`: `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`, `apple-touch-icon`, `manifest`

## Modifica ricetta dal diario

Cliccando su un alimento di tipo ricetta nel pasto, il modal di modifica quantità mostra il bottone **"Modifica ricetta"**:
- Visibile solo per alimenti con `components.length > 0`
- Apre `FoodsTab.openFoodForm(foodId)` — lo stesso form della tab Alimenti
- Se il food non è nella cache `allFoods` (es. tab Alimenti mai aperta), viene caricato via `GET /api/foods/:id`
- Dopo il salvataggio, il diario si aggiorna automaticamente

## Riconoscimento piatto con IA

Bottone "Riconosci piatto" nella modale aggiungi alimento. L'utente fotografa un piatto, l'IA identifica gli alimenti.

### Architettura
- **`services/vision.js`** — modulo astratto che supporta Claude e Gemini
- **`POST /api/diary/recognize-photo`** — endpoint che riceve la foto, la ridimensiona (sharp, max 1024px), chiama l'IA, matcha i risultati
- Provider selezionato via `VISION_PROVIDER` env var (`claude` o `gemini`)
- Modello configurabile via `VISION_MODEL` env var

### Env vars
```bash
VISION_PROVIDER=claude          # o gemini
ANTHROPIC_API_KEY=sk-ant-...    # per Claude
GEMINI_API_KEY=...              # per Gemini
VISION_MODEL=claude-sonnet-4-20250514  # opzionale
```

### Flusso
1. Click "Riconosci piatto" → apre fotocamera (file input con `capture="environment"`)
2. Foto ridimensionata client-side (canvas, max 1024px, JPEG 80%)
3. Upload a `POST /api/diary/recognize-photo`
4. Backend: resize con sharp → Claude/Gemini Vision → JSON con alimenti
5. Per ogni alimento: ricerca DB locale (token LIKE) → catalogo Food Tracker
6. Frontend: step `#modal-step-ai` con lista risultati, checkbox, quantità editabile, alternative
7. "Aggiungi N alimenti" → batch POST /api/diary per ogni item selezionato
8. Per match catalogo: auto-import via POST /api/foods (FormData)
9. Per nessun match: voce rapida via POST /api/diary/quick

### Prompt IA
Il prompt chiede nomi italiani stile CREA/INRAN, stima grammi, e search_terms alternativi per migliorare il matching nel DB.

## Deduplicazione ricerca catalogo

Quando si cercano alimenti, i risultati del catalogo Food Tracker vengono filtrati per evitare doppioni:
- Prodotti con barcode già presente nel DB locale → esclusi
- Prodotti con `source: app` e stesso nome (case-insensitive) di un alimento locale → esclusi

## Palette colori (WCAG AA)

Tutti i colori sono definiti come CSS custom properties in `style.css` (`:root` e `[data-theme="dark"]`).
Non usare mai colori hardcoded — usa sempre `var(--color-xxx)`.

### Light mode

| Variabile | Hex | Uso |
|-----------|-----|-----|
| `--color-primary` | `#2E7D32` 🟩 | Bottoni, link, accenti principali |
| `--color-primary-dark` | `#1B5E20` 🟩 | Gradienti, hover |
| `--color-primary-light` | `#C8E6C9` 🟩 | Sfondo tap/active |
| `--color-primary-surface` | `#4CAF50` 🟩 | Gradienti hero (daily summary) |
| `--color-text` | `#212121` ⬛ | Testo principale |
| `--color-text-secondary` | `#616161` 🔘 | Testo secondario, dettagli |
| `--color-text-on-primary` | `#ffffff` ⬜ | Testo su sfondi primary |
| `--color-bg` | `#F5F5F5` ⬜ | Sfondo pagina |
| `--color-card` | `#ffffff` ⬜ | Sfondo card |
| `--color-input` | `#ffffff` ⬜ | Sfondo input |
| `--color-border` | `#8E8E8E` 🔘 | Bordi (3:1 su card) |
| `--color-danger` | `#D32F2F` 🟥 | Errori, eliminazione |
| `--color-danger-bg` | `#FFEBEE` 🟥 | Sfondo messaggi errore |
| `--color-danger-text` | `#B71C1C` 🟥 | Testo errore su danger-bg |
| `--color-warning` | `#E65100` 🟧 | Avvisi |
| `--color-warning-bg` | `#FFF8E1` 🟨 | Sfondo avvisi |
| `--color-warning-text` | `#4E342E` 🟫 | Testo avvisi |
| `--color-success-bg` | `#E8F5E9` 🟩 | Sfondo messaggi successo |
| `--color-success-text` | `#1B5E20` 🟩 | Testo successo |
| `--color-protein` | `#C2185B` 🩷 | Macro: proteine (rosa/fucsia) |
| `--color-fat` | `#E65100` 🟧 | Macro: grassi (arancione) |
| `--color-carbs` | `#1565C0` 🔵 | Macro: carboidrati (blu) |

### Dark mode

| Variabile | Hex | Note |
|-----------|-----|------|
| `--color-primary` | `#66BB6A` 🟩 | Più chiaro per contrasto su scuro |
| `--color-primary-dark` | `#43A047` 🟩 | Gradienti, hover |
| `--color-primary-light` | `#1B3A1F` 🟩 | Sfondo tap/active (scuro) |
| `--color-primary-surface` | `#388E3C` 🟩 | Gradienti hero |
| `--color-text-on-primary` | `#000000` ⬛ | Testo scuro su primary chiaro |
| `--color-bg` | `#0F0F0F` ⬛ | Sfondo pagina |
| `--color-card` | `#1C1C1E` ⬛ | Sfondo card |
| `--color-text` | `#F2F2F7` ⬜ | Testo principale |
| `--color-text-secondary` | `#A1A1A6` 🔘 | Testo secondario |
| `--color-border` | `#6A6A6C` 🔘 | Bordi (3:1 su card) |
| `--color-input` | `#2C2C2E` ⬛ | Sfondo input |
| `--color-protein` | `#F06292` 🩷 | Macro: proteine (rosa chiaro) |
| `--color-fat` | `#FFB74D` 🟧 | Macro: grassi (arancione chiaro) |
| `--color-carbs` | `#42A5F5` 🔵 | Macro: carboidrati (blu chiaro) |

### Hero e gauge (ispirato a Yazio)

**Light mode**:
- **Hero**: gradiente `linear-gradient(180deg, #47E95F 0%, #81C784 50%, var(--color-bg) 100%)`
- **Gauge**: arco `#2E7D32` (verde scuro), sfondo `rgba(0,0,0,0.08)`
- **Macro box**: sfondo `rgba(255,255,255,0.85)`, testo `var(--color-text)` (scuro)
- **Testi hero**: `var(--color-text)` (scuro su verde chiaro)

**Dark mode**:
- **Hero**: gradiente `linear-gradient(180deg, #2E7D32 0%, #1a4a1e 35%, #0F0F0F 100%)`
- **Gauge**: arco `var(--color-primary)`, sfondo `rgba(255,255,255,0.12)`
- **Macro box**: sfondo `rgba(0,0,0,0.5)` con `backdrop-filter: blur(8px)`
- **Testi hero**: forzati a `#ffffff`

### Layout
- **Header**: sfondo `var(--color-card)`, bordo inferiore, logo a sinistra + titolo, ingranaggio + logout a destra
- **Tab bar** (footer): 4 tab — Home, Diario, Alimenti, Piano (Impostazioni spostata nell'header)

### Regole
- Ogni combinazione testo/sfondo supera WCAG AA (4.5:1 per testo, 3:1 per UI)
- I colori macro (protein/fat/carbs) sono coerenti tra light e dark: stessa famiglia cromatica (rosa, arancione, blu)
- Chart.js legge i colori a runtime via `cssColor('--color-xxx')` in `diarylog.js`
- In dark mode i colori macro sono più chiari per mantenere contrasto su sfondi scuri

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
Il barcode lookup nel tab Alimenti usa `&include_quick=1` per trovare anche questi.

### Autenticazione
Session-based (express-session, 30 giorni).
`isAuth` middleware in `routes/auth.js` — usa `req.originalUrl` (non `req.path`) per rilevare route API e restituire 401 JSON invece di redirect.
⚠️ `router.use(isAuth)` è applicato globalmente in `routes/foods.js`. Le route pubbliche (es. `/proxy-image`) vanno definite **prima** di questa riga.

## Integrazione Food Tracker (catalogo locale)

Food Diary usa **Food Tracker** come unica fonte dati esterna (niente OFF/INRAN diretti).
Food Tracker serve ~210.000+ prodotti italiani (OFF + CREA + APP).

### Configurazione
```bash
# In .env
CATALOG_URL=http://192.168.68.153:3001   # default se non impostato
```

### Endpoint food-tracker usati da Food Diary
- `GET /search?q=<query>&limit=50` — ricerca testuale (FTS5 + brand LIKE)
- `GET /product/<barcode>` — lookup per barcode (con auto-enrichment OFF)
- `POST /product` — upsert prodotto (usato dalla sync)

### Proxy immagini
Le immagini del catalogo sono servite localmente da food-tracker (`/images/<barcode>.jpg`).
Vengono proxiate attraverso `/api/foods/proxy-image` per funzionare anche su mobile
fuori dalla rete LAN. La route è registrata **prima** di `router.use(isAuth)`.

### Food Tracker — infrastruttura
- **Repo locale**: `/Users/alessandro/food-tracker/`
- **LXC**: Debian 13, IP `192.168.68.153`, porta `3001`
- **Docker**: container `food-tracker`, immagine python:3.12-slim, FastAPI + SQLite
- **DB**: `/data/foods.db` (volume Docker `food-tracker_food-data`)
- **Immagini**: `/data/images/<barcode>.jpg` (~200K immagini scaricate da OFF)
- **Source files sul LXC**: `/opt/food-tracker/app/`
- **Repo GitHub**: privato — usa tar+scp per il deploy

### Aggiornamento Food Tracker (dal Mac)
```bash
# 1. Crea tarball e invia al LXC
cd /Users/alessandro/food-tracker && \
tar czf /tmp/ft_app.tar.gz app/ && \
scp /tmp/ft_app.tar.gz root@192.168.68.153:/tmp/

# 2. Sul LXC food-tracker (192.168.68.153):
cd /tmp && tar xzf ft_app.tar.gz && \
docker cp app/main.py food-tracker:/app/app/main.py && \
docker cp app/models.py food-tracker:/app/app/models.py && \
docker cp app/database.py food-tracker:/app/app/database.py && \
docker cp app/static/index.html food-tracker:/app/app/static/index.html && \
docker restart food-tracker
```

---

## Produzione — LXC Proxmox

### Infrastruttura
- **Proxmox**: server di virtualizzazione locale
- **LXC**: Debian 12, IP `192.168.68.173`, porta `3000`
- **Nginx Proxy Manager**: reverse proxy HTTPS con Let's Encrypt
- **Dominio**: configurato su NPM con SSL automatico
- **Process manager**: PM2, utente di sistema `fooddiary`
- **App dir**: `/opt/diario-alimentare`
- **DB**: `/opt/diario-alimentare/database/food_diary.sqlite`

### Workflow aggiornamento
```
Mac (sviluppo) → commit+push automatico → GitHub
                                              ↓
                             LXC (root): bash /opt/diario-alimentare/update.sh
```

### Comandi utili sull'LXC
```bash
su -s /bin/bash fooddiary -c "pm2 logs food-diary --lines 50"   # log
su -s /bin/bash fooddiary -c "pm2 restart food-diary"           # riavvio
su -s /bin/bash fooddiary -c "pm2 status"                       # stato
bash /opt/diario-alimentare/update.sh                           # deploy aggiornamento
```

### Copia DB da LXC a Mac (backup locale)
```bash
scp root@192.168.68.173:/opt/diario-alimentare/database/food_diary.sqlite \
    "/Users/alessandro/Claude Code/diario alimentare/database/food_diary.sqlite"
```

### Copia DB da Mac a LXC
```bash
scp "/Users/alessandro/Claude Code/diario alimentare/database/food_diary.sqlite" \
    root@192.168.68.173:/opt/diario-alimentare/database/food_diary.sqlite
ssh root@192.168.68.173 "chown fooddiary:fooddiary /opt/diario-alimentare/database/food_diary.sqlite \
    && su -s /bin/bash fooddiary -c 'pm2 restart food-diary'"
```

### Note SSH
- Login root abilitato (`PermitRootLogin yes` in `/etc/ssh/sshd_config`)
- Git richiede: `git config --global --add safe.directory /opt/diario-alimentare`

---

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
