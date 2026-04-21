# Food Diary — API esterne

API read-only pensate per il consumo da applicazioni terze (es. **Health Tracker**). Espongono solo dati aggregati del diario alimentare e del piano nutrizionale — **nessun dato sui singoli alimenti o voci del diario**.

## Caratteristiche generali

| | |
|---|---|
| **Base URL (dev)** | `http://localhost:3000` |
| **Base URL (prod LAN)** | `http://192.168.68.173:3000` |
| **Prefisso** | `/api/external` |
| **Autenticazione** | Nessuna (solo LAN, coerente col resto dell'ecosistema domestico) |
| **Formato** | JSON (UTF-8) |
| **Metodi** | `GET` solo (read-only) |
| **CORS** | Non configurato — prevedi chiamate server-to-server o stessa origine |

> ⚠️ Non esporre questi endpoint su internet senza prima aggiungere un livello di auth (es. API key via header `Authorization: Bearer ...`).

---

## Endpoint

### 1. `GET /api/external/daily-totals`

Restituisce i totali nutrizionali giornalieri (kcal + macro in grammi) per un range di date, con il target kcal del giorno preso dal `daily_plan_snapshots` (così il target riflette il piano in vigore quel giorno, anche se è stato cambiato in seguito).

#### Query parameters

| Parametro | Tipo | Obbligatorio | Formato | Descrizione |
|-----------|------|:---:|---------|-------------|
| `from`    | string | ✓ | `YYYY-MM-DD` | Data inizio (inclusa) |
| `to`      | string | ✓ | `YYYY-MM-DD` | Data fine (inclusa) |

#### Response `200 OK`

Array di oggetti, **un elemento per ogni giorno con almeno una voce diario**. I giorni senza registrazioni non compaiono.

```json
[
  {
    "date": "2026-04-20",
    "kcal": 1442,
    "protein_g": 90.2,
    "fat_g": 103.0,
    "carbs_g": 29.4,
    "kcal_target": 1200
  },
  {
    "date": "2026-04-21",
    "kcal": 851,
    "protein_g": 35.9,
    "fat_g": 49.6,
    "carbs_g": 17.9,
    "kcal_target": 1200
  }
]
```

#### Campi

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `date` | string | Data in formato `YYYY-MM-DD` |
| `kcal` | integer | Totale calorie consumate (arrotondate all'intero) |
| `protein_g` | number | Proteine totali in grammi (1 decimale) |
| `fat_g` | number | Grassi totali in grammi (1 decimale) |
| `carbs_g` | number | Carboidrati totali in grammi (1 decimale) |
| `kcal_target` | integer \| null | Target calorie del piano attivo quel giorno (`null` se nessun snapshot) |

#### Errori

| Status | Body | Quando |
|--------|------|--------|
| `400` | `{ "error": "Parametri from e to (YYYY-MM-DD) richiesti" }` | Parametri mancanti o formato non valido |
| `500` | `{ "error": "Errore del server" }` | Errore interno (DB, ecc.) |

#### Esempio

```bash
curl -s "http://192.168.68.173:3000/api/external/daily-totals?from=2026-04-14&to=2026-04-21" | jq
```

---

### 2. `GET /api/external/active-plan`

Restituisce il piano nutrizionale attivo (quello con `is_active=1` nella tabella `plans`). Include percentuali macro e grammi target calcolati a partire da `kcal_target` (**4 kcal/g** per proteine e carboidrati, **9 kcal/g** per i grassi).

#### Query parameters

Nessuno.

#### Response `200 OK`

```json
{
  "name": "Keto Curcu",
  "kcal_target": 1200,
  "protein_pct": 25,
  "fat_pct": 68,
  "carbs_pct": 7,
  "protein_g": 75,
  "fat_g": 91,
  "carbs_g": 21,
  "updated_at": "2026-03-30 07:51:17"
}
```

#### Campi

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `name` | string | Nome del piano |
| `kcal_target` | integer | Target calorico giornaliero |
| `protein_pct` | number | % calorie da proteine |
| `fat_pct` | number | % calorie da grassi |
| `carbs_pct` | number | % calorie da carboidrati |
| `protein_g` | integer | Grammi target proteine = `round(kcal_target × protein_pct / 100 / 4)` |
| `fat_g` | integer | Grammi target grassi = `round(kcal_target × fat_pct / 100 / 9)` |
| `carbs_g` | integer | Grammi target carboidrati = `round(kcal_target × carbs_pct / 100 / 4)` |
| `updated_at` | string \| null | Timestamp dell'ultimo aggiornamento piano (UTC) |

> **Nota:** `protein_pct + fat_pct + carbs_pct = 100` per costruzione (validato dall'app alla creazione/modifica del piano). La somma dei grammi × rispettive kcal può differire lievemente da `kcal_target` a causa degli arrotondamenti.

#### Errori

| Status | Body | Quando |
|--------|------|--------|
| `404` | `{ "error": "no_active_plan" }` | Nessun piano con `is_active=1` |
| `500` | `{ "error": "Errore del server" }` | Errore interno |

#### Esempio

```bash
curl -s http://192.168.68.173:3000/api/external/active-plan | jq
```

---

## Pattern di consumo tipico (Health Tracker)

1. All'avvio o al refresh, chiamare `GET /api/external/active-plan` per ottenere `kcal_target` e i grammi target (`protein_g`, `fat_g`, `carbs_g`).
2. Chiamare `GET /api/external/daily-totals?from=...&to=...` con un range di interesse (es. ultimi 7/30 giorni).
3. Confrontare `kcal` vs `kcal_target` per ogni giorno; `kcal_target` è già contestualizzato al giorno, quindi non serve re-interrogare il piano per date passate.

### Esempio Node.js (fetch)

```js
const BASE = 'http://192.168.68.173:3000';

async function loadNutrition(from, to) {
  const [plan, daily] = await Promise.all([
    fetch(`${BASE}/api/external/active-plan`).then(r => r.ok ? r.json() : null),
    fetch(`${BASE}/api/external/daily-totals?from=${from}&to=${to}`).then(r => r.json())
  ]);
  return { plan, daily };
}

loadNutrition('2026-04-14', '2026-04-21').then(console.log);
```

### Esempio Python (requests)

```python
import requests

BASE = "http://192.168.68.173:3000"

plan = requests.get(f"{BASE}/api/external/active-plan").json()
daily = requests.get(
    f"{BASE}/api/external/daily-totals",
    params={"from": "2026-04-14", "to": "2026-04-21"}
).json()
```

---

## Versioning e stabilità

- L'API è **v1** implicita. Non esiste (ancora) un prefisso di versione.
- I campi elencati sono **stabili**: nuove chiavi possono essere aggiunte in modo non-breaking, ma nomi e semantica di quelli esistenti non cambieranno senza bump esplicito.
- Per cambiamenti breaking si introdurrà `/api/external/v2/...` mantenendo v1 in parallelo per un periodo di transizione.

## Implementazione

Codice: [routes/external.js](../routes/external.js). Montato in [server.js](../server.js) sotto `/api/external`.
