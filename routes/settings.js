const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { isAuth } = require('./auth');
const { getDb } = require('../database/db');

router.use(isAuth);

// ── Helper: aggiorna una variabile nel .env ──────────────────────────────
const ENV_PATH = path.join(__dirname, '..', '.env');

function updateEnvVar(key, value) {
  let content = '';
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, 'utf8');
    const regex = new RegExp(`^${key}=.*`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content = content.trimEnd() + `\n${key}=${value}\n`;
    }
  } else {
    content = `${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf8');
  process.env[key] = value;
}

// ── Modelli IA disponibili ───────────────────────────────────────────────
const VISION_MODELS = [
  { key: 'claude-sonnet-4-20250514',       label: 'Claude Sonnet 4',   provider: 'claude' },
  { key: 'claude-haiku-4-20250414',        label: 'Claude Haiku 4',    provider: 'claude' },
  { key: 'claude-opus-4-20250514',         label: 'Claude Opus 4',     provider: 'claude' },
  { key: 'gemini-2.0-flash',              label: 'Gemini 2.0 Flash',  provider: 'gemini' },
  { key: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash',  provider: 'gemini' },
  { key: 'gemini-2.5-pro-preview-05-06',   label: 'Gemini 2.5 Pro',    provider: 'gemini' },
];

// GET /api/settings/vision-model
router.get('/vision-model', (req, res) => {
  const currentProvider = (process.env.VISION_PROVIDER || 'claude').toLowerCase();
  const currentModel = process.env.VISION_MODEL ||
    (currentProvider === 'gemini' ? 'gemini-2.0-flash' : 'claude-sonnet-4-20250514');
  res.json({ current: currentModel, models: VISION_MODELS });
});

// PUT /api/settings/vision-model
router.put('/vision-model', (req, res) => {
  const { model_key } = req.body;
  const entry = VISION_MODELS.find(m => m.key === model_key);
  if (!entry) return res.status(400).json({ error: 'Modello non valido' });

  try {
    updateEnvVar('VISION_MODEL', entry.key);
    updateEnvVar('VISION_PROVIDER', entry.provider);
    res.json({ ok: true, model: entry.key, provider: entry.provider });
  } catch (err) {
    console.error('Errore aggiornamento modello IA:', err);
    res.status(500).json({ error: 'Impossibile aggiornare il file .env' });
  }
});

// PATCH /api/settings/password
router.patch('/password', (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Password attuale e nuova password sono obbligatorie' });
  }

  if (current_password !== (process.env.ADMIN_PASSWORD || 'password123')) {
    return res.status(401).json({ error: 'Password attuale non corretta' });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ error: 'La nuova password deve essere lunga almeno 6 caratteri' });
  }

  try {
    updateEnvVar('ADMIN_PASSWORD', new_password);

    req.session.destroy(() => {
      res.json({ ok: true, message: 'Password aggiornata. Effettua di nuovo il login.' });
    });
  } catch (err) {
    console.error('Errore aggiornamento .env:', err);
    res.status(500).json({ error: 'Impossibile aggiornare il file .env' });
  }
});

// GET /api/settings/info
router.get('/info', (req, res) => {
  const pkg = require('../package.json');
  res.json({
    version: pkg.version,
    name: pkg.description,
    node: process.version
  });
});

// POST /api/settings/sync-tracker — sincronizza alimenti locali → Food Tracker
router.post('/sync-tracker', async (req, res) => {
  const CATALOG_BASE = process.env.CATALOG_URL || 'http://192.168.68.153:3001';
  const fetch = (await import('node-fetch')).default;

  try {
    const db = await getDb();
    const foods = await db.all(
      'SELECT * FROM foods WHERE is_quick = 0 AND deleted_at IS NULL'
    );

    let created = 0, updated = 0, skipped = 0, errors = 0;
    const detail = [];

    for (const food of foods) {
      try {
        let existingInTracker = null;
        let originalSource = 'app';

        // Controlla se esiste già in Food Tracker (solo se ha barcode)
        if (food.barcode) {
          const checkRes = await fetch(`${CATALOG_BASE}/product/${encodeURIComponent(food.barcode)}`, { timeout: 8000 });
          if (checkRes.ok) {
            existingInTracker = await checkRes.json();
            originalSource = existingInTracker.source || 'app';
          }
        }

        // Determina source finale:
        // - prodotto nuovo (non trovato in tracker) → 'app'
        // - prodotto esistente in tracker → mantieni source originale
        const source = existingInTracker ? originalSource : 'app';

        // Risolvi URL immagine accessibile da Food Tracker
        let imageUrl = null;
        if (food.image_path) {
          if (food.image_path.startsWith('http')) {
            imageUrl = food.image_path;
          } else if (food.image_path.includes('/proxy-image?url=')) {
            const match = food.image_path.match(/[?&]url=([^&]+)/);
            if (match) imageUrl = decodeURIComponent(match[1]);
          } else if (food.image_path.startsWith('/uploads/')) {
            const base = process.env.FOOD_DIARY_URL || 'http://192.168.68.173:3000';
            imageUrl = base + food.image_path;
          }
        }

        // Controlla se tutto è identico (macro + immagine) — skip se nulla è cambiato
        if (existingInTracker) {
          const same =
            Math.abs((existingInTracker.energy_kcal || 0) - (food.kcal_100g || 0)) < 0.5 &&
            Math.abs((existingInTracker.proteins_100g || 0) - (food.protein_100g || 0)) < 0.5 &&
            Math.abs((existingInTracker.fat_100g || 0) - (food.fat_100g || 0)) < 0.5 &&
            Math.abs((existingInTracker.carbohydrates_100g || 0) - (food.carbs_100g || 0)) < 0.5 &&
            (existingInTracker.product_name || '') === (food.name || '') &&
            (existingInTracker.brands || '') === (food.brand || '') &&
            (existingInTracker.image_url || '') === (imageUrl || '');
          if (same) {
            skipped++;
            continue;
          }
        }

        // Upsert su Food Tracker
        const payload = {
          external_id: food.barcode || `app_${food.id}`,
          product_name: food.name,
          brands: food.brand || null,
          source,
          energy_kcal: food.kcal_100g || null,
          proteins_100g: food.protein_100g || null,
          fat_100g: food.fat_100g || null,
          carbohydrates_100g: food.carbs_100g || null,
          image_url: imageUrl
        };

        const upsertRes = await fetch(`${CATALOG_BASE}/product`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeout: 8000
        });

        if (upsertRes.ok) {
          const result = await upsertRes.json();
          if (result.action === 'created') created++;
          else updated++;
          detail.push({ name: food.name, action: result.action, source });
        } else {
          errors++;
          detail.push({ name: food.name, action: 'error', status: upsertRes.status });
        }
      } catch (e) {
        errors++;
        detail.push({ name: food.name, action: 'error', error: e.message });
      }
    }

    res.json({ ok: true, total: foods.length, created, updated, skipped, errors, detail });
  } catch (err) {
    console.error('Sync tracker error:', err);
    res.status(500).json({ error: 'Errore durante la sincronizzazione: ' + err.message });
  }
});

module.exports = router;
