# FoodDiary — Guida per Claude

## Branch di lavoro
Lavora sempre direttamente su `main`. Non creare feature branch separati.

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
├── install.sh             # Bootstrap iniziale dell'LXC (clone, deps, DB, PM2)
├── update.sh              # Deploy aggiornamento su LXC (pull + restart PM2)
├── rotate-lxc-token.sh    # Rotazione PAT GitHub sull'LXC di produzione
├── .env                   # Segreti (non in git)
├── database/
│   ├── db.js              # Singleton SQLite + migrazioni automatiche + upsertDaySnapshot
│   └── food_diary.sqlite  # DB (non in git)
├── services/
│   └── vision.js          # Riconoscimento alimenti (foto e testo) — Claude / Gemini
├── routes/
│   ├── auth.js            # Login / logout (session-based)
│   ├── diary.js           # /api/diary — voci diario, riconoscimento foto, descrivi piatto
│   ├── foods.js           # /api/foods — libreria alimenti + integrazione Food Tracker
│   ├── plan.js            # /api/plan, /api/plans — piani nutrizionali + snapshot giornaliero
│   └── settings.js        # /api/settings — password, sync Food Tracker, prompt e modello IA
├── public/
│   ├── index.html         # Shell SPA (tab bar: home, diario, alimenti, piano; impostazioni nell'header)
│   ├── manifest.json      # Web App Manifest (PWA)
│   ├── sw.js              # Service worker (shell cache, SWR asset, API read-only offline)
│   ├── apple-touch-icon.png  # Icona 180x180 per iOS Home Screen
│   ├── icons/             # Icone PWA (192x192, 512x512)
│   ├── img/
│   │   ├── logo.png       # Logo app (usato nell'header)
│   │   └── meals/         # Illustrazioni SVG dei 6 pasti (colazione, spuntino, pranzo, merenda, cena, extra)
│   ├── css/style.css      # Stili con dark mode e layout max 430px
│   ├── foods-table.html   # Spreadsheet alimenti (standalone, con colonne Foto/Fonte/Data)
│   └── js/
│       ├── app.js         # Core: tab switching, sessione, utility globali, calendario con anelli colorati
│       ├── diary.js       # Tab Home — diario del giorno + flussi IA (riconosci / descrivi)
│       ├── diarylog.js    # Tab Diario — storico e grafici
│       ├── foods.js       # Tab Alimenti — CRUD alimenti, foto, barcode, catalogo
│       ├── plan.js        # Tab Piano — multi-piano nutrizionale
│       ├── settings.js    # Tab Impostazioni (sync Food Tracker, prompt IA, modello IA)
│       ├── scanner-config.js  # Configurazione condivisa scanner html5-qrcode
│       └── barcode.js     # Scanner barcode (html5-qrcode)
└── uploads/               # Foto alimenti (non in git)
```

## Database — tabelle principali

| Tabella | Descrizione |
|---------|-------------|
| `foods` | Libreria alimenti. `deleted_at` per soft-delete. `is_quick=1` per voci al volo. `source` = `app`/`openfoodfacts`/`crea` (origine del prodotto). `components` JSON per le ricette. `recipe_yield_g` lasciato NULL: il peso finale ricetta è sempre la somma dei componenti. |
| `diary_entries` | Voci del diario: `food_id`, `meal_type` (6 pasti: `colazione`, `spuntino_mattino`, `pranzo`, `spuntino_pomeriggio`, `cena`, `extra`), `quantity_g`, `date` |
| `portions` | Porzioni nominate per alimento (es. "1 fetta = 30g") |
| `plans` | Piani nutrizionali. `is_active=1` sul piano corrente (uno solo alla volta). |
| `daily_plan_snapshots` | Snapshot giornaliero del piano attivo (`date` PK, `plan_name`, `kcal_target`, macro %). Scritto in `upsertDaySnapshot()` a ogni attivazione/modifica piano e a ogni inserimento diario. Permette alla home di mostrare il piano associato al giorno visualizzato anche dopo un cambio/cancellazione piano. |
| `settings` | Coppia chiave/valore: `admin_password`, `vision_provider`, `vision_model`, `vision_prompt` ecc. |

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
- `GET /api/diary?date=YYYY-MM-DD` — voci del giorno (join con `daily_plan_snapshots` per i totali del giorno)
- `GET /api/diary/range?from=&to=` — kcal/macro per giorno (usato dal calendario)
- `POST /api/diary` — aggiunge voce (scrive anche lo snapshot del giorno)
- `PUT /api/diary/:id` — modifica quantità e/o pasto (`meal_type`)
- `DELETE /api/diary/:id` — rimuove voce
- `POST /api/diary/quick` — crea alimento `is_quick=1` + voce diario atomicamente
- `GET /api/diary/recent?meal_type=<meal>` — ultimi alimenti usati per quel pasto
- `GET /api/diary/frequent?meal_type=<meal>` — alimenti più frequenti per quel pasto
- `POST /api/diary/recognize-photo` — riconoscimento piatto da foto (Claude/Gemini Vision)
- `POST /api/diary/describe-dish` — analisi testuale di un piatto (solo sorgenti CREA)
- `POST /api/diary/dish-as-recipe` — crea un food `is_quick=1` con `components` JSON + singola `diary_entry` atomicamente (usata dal flusso "Descrivi")

### Piani `/api/plan` e `/api/plans`
- `GET /api/plan` — piano attivo (backward compat)
- `PUT /api/plan` — aggiorna piano attivo
- `GET /api/plans/all` — lista tutti i piani
- `POST /api/plans/new` — crea piano
- `PUT /api/plans/:id` — modifica piano
- `POST /api/plans/:id/activate` — attiva piano (disattiva gli altri)
- `DELETE /api/plans/:id` — elimina (non il piano attivo)

### Impostazioni `/api/settings`
- `GET /api/settings/info` — versione app, descrizione, versione Node
- `PATCH /api/settings/password` — cambia password (aggiorna `ADMIN_PASSWORD` nel `.env` e chiude la sessione)
- `GET /api/settings/vision-model` — modello IA corrente + lista modelli supportati (Claude Sonnet/Haiku/Opus 4.x, Gemini 2.0/2.5 Flash/Pro)
- `PUT /api/settings/vision-model` — imposta modello IA (scrive `VISION_MODEL` + `VISION_PROVIDER` nel `.env`)
- `GET /api/settings/vision-prompt` — prompt IA corrente + prompt di default
- `PUT /api/settings/vision-prompt` — salva un prompt personalizzato in `vision-prompt.txt`
- `DELETE /api/settings/vision-prompt` — cancella il prompt personalizzato (torna al default)
- `POST /api/settings/sync-tracker` — sincronizza alimenti locali verso Food Tracker
  - Invia tutti i foods (`is_quick=0`, non eliminati) tramite `POST /product` di Food Tracker
  - Foods senza barcode usano `external_id = app_<id>` per evitare duplicati
  - Se il prodotto esiste già nel tracker, mantiene la `source` originale; prodotti nuovi vengono inviati come `app`
  - Calcola l'URL immagine risolto (upload locale o proxy) perché sia accessibile dal tracker
  - Skip se nome, brand, macro e immagine sono identici (nessuna scrittura inutile)

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

L'anello del gauge ha tratto sottile per un look più pulito. I chip dei macronutrienti sotto il gauge sono senza bordo né sfondo, con label per esteso (Proteine / Grassi / Carboidrati).

## Illustrazioni SVG dei pasti

Ogni pasto nella Home ha un'illustrazione dedicata in `public/img/meals/` (`colazione.svg`, `spuntino.svg`, `pranzo.svg`, `merenda.svg`, `cena.svg`, `extra.svg`). L'array `MEALS` in `public/js/diary.js` associa ciascun `meal_type` al file SVG. In light mode il piatto delle illustrazioni è ammorbidito per ridurre il contrasto.

## Feedback immediato aggiunta al pasto

Quando l'utente aggiunge un alimento a un pasto, la UI aggiorna la card del pasto e i totali del giorno senza attendere il ricarico completo, dando un riscontro visivo istantaneo.

## Copia da ieri

Nei pasti vuoti appare il bottone "Copia [pasto] da ieri" con anteprima:
- Mostra l'alimento più calorico di ieri + conteggio altri + kcal totali
- Es. "Copia colazione da ieri" con sotto "Muffin e 1 altro — 450 kcal"
- Se ieri il pasto era vuoto, il bottone non appare
- I dati di ieri sono caricati in `loadEntries()` via `/api/diary?date=yesterday`

## Recenti e frequenti

La modale "Aggiungi alimento" mostra fino a 12 alimenti recenti/frequenti per pasto. Se per quel pasto non ci sono abbastanza voci, la lista viene riempita con alimenti recenti/frequenti di altri pasti (fallback cross-meal).

## Ricerca predittiva — soglia 2 caratteri

Nella ricerca alimenti e nella ricerca inline ingredienti ("Descrivi" → aggiungi ingrediente) la soglia per attivare la ricerca predittiva è **2 caratteri** (era 4). Dà risultati molto più rapidi su nomi corti tipo "uova", "riso", "pane".

## Feedback aggiunta al diario

Il bottone "Aggiungi" della modale alimento (`btn-confirm-add` in `public/js/diary.js`) deve sempre dare feedback immediato, altrimenti su rete lenta l'utente non capisce se il salvataggio è in corso. Pattern da mantenere:

- Durante la richiesta il testo del bottone diventa `Aggiungo…` (o `Aggiorno…` in edit) e il bottone è disabilitato.
- Appena la POST/PUT risponde OK la modale si chiude **subito**; `refresh()` gira in background (niente `await`), così il ritorno alla Home è istantaneo anche con 3 chiamate API in cascata (`/api/diary`, `/api/plan/snapshot`, `/api/diary` di ieri).
- Su errore o rete KO (`res` null o `res.error`) il bottone torna allo stato iniziale e viene mostrato un `alert` esplicito — mai fallimento silenzioso.

## Foods table (`foods-table.html`)

Spreadsheet standalone (full-width, fuori dal frame 430px) per la gestione bulk della libreria alimenti. Colonne: Foto (thumbnail), Nome, Brand, Barcode, Kcal/100g, Proteine/100g, Grassi/100g, Carbo/100g, **Fonte** (`app`/`crea`/`openfoodfacts`), **Data** (created_at), Azioni. Permette editing inline delle macro e upload foto drag-and-drop.

## PWA

L'app è installabile come PWA su iOS (Home Screen) e funziona offline:
- `public/manifest.json` — Web App Manifest
- `public/sw.js` — service worker registrato in `index.html` dopo il `load`
- `public/apple-touch-icon.png` — 180x180 (generata da `logo.png` con `sips`)
- `public/icons/icon-192.png` e `icon-512.png` — icone manifest
- Meta tag in `index.html`: `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`, `apple-touch-icon`, `manifest`

### Service worker — strategie di cache (`public/sw.js`)

Cache suddivise in 4 bucket (`SHELL_CACHE`, `RUNTIME_CACHE`, `API_CACHE`, `UPLOADS_CACHE`) tutte taggate con `VERSION` per invalidazione atomica:
- **Shell** (precache all'install): `/`, `/index.html`, `manifest.json`, icone, logo, CDN cross-origin (`chart.js`, `html5-qrcode`, `cropperjs`) come `no-cors` (response opaque accettate)
- **Navigazioni HTML**: network-first con fallback a `/index.html` in cache
- **Asset same-origin** (JS, CSS): stale-while-revalidate su `RUNTIME_CACHE`
- **`/uploads/<foto>`**: stale-while-revalidate su `UPLOADS_CACHE`
- **`/api/*` whitelist** (`/api/plan`, `/api/plan/all`, `/api/diary`, `/api/diary/range`, `/api/diary/days`, `/api/diary/recent`, `/api/diary/frequent`, tutto `/api/foods`): **network-first** con fallback cache per uso offline. Il network-first (non SWR) garantisce che online i dati siano sempre freschi — niente risposte stantie dalla cache.
- **Altre `/api/*`** (snapshot piano, settings, login/logout): passano diritte alla rete (no cache).
- **CDN cross-origin**: cache-first con fallback rete.

Il banner **"Nuova versione disponibile"** compare quando un nuovo SW è `waiting`; il click su "Ricarica" invia il messaggio `SKIP_WAITING` al worker e ricarica la pagina. Nessuna `skipWaiting()` all'install.

## Snapshot giornaliero del piano

La tabella `daily_plan_snapshots` memorizza il piano attivo per ogni giorno (`date` PK, `plan_name`, `kcal_target`, macro %).
- `database/db.js` esporta `upsertDaySnapshot(date)` che legge il piano con `is_active=1` e fa `INSERT OR REPLACE`.
- Viene chiamata da `routes/plan.js` all'attivazione/modifica/creazione piano (`req.body.date` o oggi) e da `routes/diary.js` a ogni inserimento diario (con la data della voce).
- `upsertDaySnapshot` è self-healing: crea la tabella con `IF NOT EXISTS` per non richiedere un restart se il server è già in esecuzione prima della migrazione.
- Il `GET /api/diary/range` fa `LEFT JOIN daily_plan_snapshots` per restituire il target del giorno anche se il piano è stato cambiato o cancellato dopo.
- L'header `Cache-Control: no-store` è applicato allo snapshot + cache-buster nell'URL per evitare letture stantie.

## Modifica alimento al volo dalla modale di aggiunta

Nello step quantità della modale "Aggiungi alimento", un'icona matita (`.sfp-edit-btn`) appare a destra del nome dell'alimento selezionato:
- Visibile per tutti gli alimenti con `food.id` (non per food temporanei senza ID)
- Click → nasconde la modale diario, apre `FoodsTab.openFoodForm(food.id)` con callbacks
- `onSaved(updatedFood)` → riapre la modale e chiama `selectFood()` con i dati aggiornati e la quantità preservata
- `onClosed()` → riapre la modale senza modifiche
- Permette di correggere macro, nome, porzioni ecc. senza uscire dal flusso di aggiunta al pasto

## Modifica ricetta dal diario

Cliccando su un alimento di tipo ricetta nel pasto, il modal di modifica quantità mostra il bottone **"Modifica ricetta"**:
- Visibile solo per alimenti con `components.length > 0` **e** `is_quick=0` (le ricette generate da "Descrivi" sono `is_quick=1` e non vengono editate via food form)
- Apre `FoodsTab.openFoodForm(foodId)` — lo stesso form della tab Alimenti
- Se il food non è nella cache `allFoods` (es. tab Alimenti mai aperta), viene caricato via `GET /api/foods/:id`
- Dopo il salvataggio, il diario si aggiorna automaticamente

## Ricette — peso finale = somma ingredienti

Il campo "peso finale ricetta" è stato rimosso dall'UI: il peso totale di una ricetta è sempre la somma dei grammi dei componenti.
- `foods.recipe_yield_g` resta nello schema ma viene azzerato a `NULL` a ogni save (`POST`/`PUT /api/foods`).
- Macro (`kcal_100g`, `protein_100g`, ecc.) sono sempre ricalcolate da `calcMacrosFromComponents()` sulla somma dei pesi.
- `db.js` applica una migrazione all'avvio che ricalcola le macro di tutte le ricette esistenti azzerando `recipe_yield_g` stantio.

## Layout max 430px

L'intero frame dell'app (`.app`, header, tab bar, modali, popup, crop) è contenuto in `max-width: 430px` centrato. Su schermi desktop l'app appare come una colonna stretta centrata, rispecchiando l'esperienza mobile. Unica eccezione: la tabella `foods-table.html` resta full-width perché spreadsheet. I modal fullscreen usano `margin: 0 auto` (non `translateX(-50%)`) per restare allineati al frame.

## Riconoscimento e descrizione piatto con IA

Nella modale "Aggiungi alimento" due bottoni affiancati:
- **"Riconosci"** — fotografa il piatto, l'IA identifica gli alimenti (flusso visuale).
- **"Descrivi"** — digita una descrizione testuale (es. *"piatto medio di pasta al sugo"*) e l'IA scompone il piatto in ingredienti.

### Architettura
- **`services/vision.js`** — modulo astratto che supporta Claude e Gemini; espone `recognizeFood(base64)`, `describeDish(text)`, `getPrompt()`, `DEFAULT_PROMPT`.
- **`routes/diary.js`** — helper condiviso `matchFoodsAgainstSources(db, foods, filter)` riusato dai due flussi con filtri di sorgente parametrici.
- Provider selezionato via `VISION_PROVIDER` env var (`claude` o `gemini`).
- Modello configurabile via `VISION_MODEL` env var.
- Prompt personalizzabile: se esiste `vision-prompt.txt` nella root, viene usato al posto del `DEFAULT_PROMPT`.

### Env vars
```bash
VISION_PROVIDER=claude          # o gemini
ANTHROPIC_API_KEY=sk-ant-...    # per Claude
GEMINI_API_KEY=...              # per Gemini
VISION_MODEL=claude-sonnet-4-6  # o claude-haiku-4-5-20251001, gemini-2.5-flash, ecc.
```

### Flusso "Riconosci" (foto)
1. Click "Riconosci" → apre fotocamera (file input con `capture="environment"`).
2. Foto ridimensionata client-side (canvas, max 1024px, JPEG 80%).
3. Upload a `POST /api/diary/recognize-photo`.
4. Backend: resize con `sharp` → Claude/Gemini Vision → JSON con `dish_name` + `foods`.
5. Per ogni alimento: ricerca DB locale (token LIKE) → catalogo Food Tracker (tutte le sorgenti).
6. Frontend: step `#modal-step-ai` con nome piatto + lista risultati (checkbox, quantità editabile, alternative, kcal/macro stimati).
7. "Aggiungi selezionati" → batch `POST /api/diary` per ogni item selezionato.
8. Per match catalogo: auto-import via `POST /api/foods` (FormData).
9. Per nessun match: voce rapida via `POST /api/diary/quick`.

### Flusso "Descrivi" (testo)
1. Click "Descrivi" → step `#modal-step-describe` con textarea.
2. `POST /api/diary/describe-dish` con `{ text }`.
3. Backend: `describeDish()` riusa lo stesso provider Claude/Gemini ma con input testuale; filtro **solo CREA** (no OpenFoodFacts, no `app`) per avere dati nutrizionali puliti.
4. Frontend: step `#modal-step-describe-results` mostra nome ricetta editabile + lista ingredienti (nome, grammi, kcal/macro) con la possibilità di:
   - Modificare grammi di ogni ingrediente
   - Rimuovere ingredienti
   - Aggiungere ingredienti via input con autocomplete (ricerca inline locale + CREA)
5. "Aggiungi al pasto come ricetta" → `POST /api/diary/dish-as-recipe` crea **atomicamente** un food `is_quick=1` con `components` JSON + singola `diary_entry` (100% del peso totale).
6. La voce nel diario appare come una ricetta unica; per is_quick il bottone "Modifica ricetta" è nascosto (niente edit di food rapidi).

### Prompt IA
Il prompt chiede nomi italiani stile CREA/INRAN, stima grammi, search_terms alternativi per migliorare il matching nel DB, scompone piatti compositi in ingredienti (forma cruda), esclude ingredienti a calorie trascurabili. Visibile e modificabile dalle impostazioni.

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

### Cache iOS Safari e service worker
I file JS/CSS hanno `?v=N` nei `<script src>`/`<link href>` di `index.html`.
**Incrementa la versione ogni volta che modifichi un file** per forzare il refresh su iOS **e** per far capire al service worker che c'è una nuova shell da cacheare. Parimenti, al primo commit di un cambio significativo in `sw.js`, bump anche `VERSION` in testa al file per invalidare i bucket cache (`fd-shell-v*`, `fd-runtime-v*`, `fd-api-v*`, `fd-uploads-v*`).

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
