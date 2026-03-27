const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { isAuth } = require('./auth');
const { getDb } = require('../database/db');

router.use(isAuth);

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

  const envPath = path.join(__dirname, '..', '.env');

  try {
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('ADMIN_PASSWORD=')) {
        envContent = envContent.replace(/^ADMIN_PASSWORD=.*/m, `ADMIN_PASSWORD=${new_password}`);
      } else {
        envContent += `\nADMIN_PASSWORD=${new_password}`;
      }
    } else {
      envContent = `PORT=${process.env.PORT || 3000}\nSESSION_SECRET=${process.env.SESSION_SECRET || 'secret'}\nADMIN_USER=${process.env.ADMIN_USER || 'admin'}\nADMIN_PASSWORD=${new_password}\n`;
    }

    fs.writeFileSync(envPath, envContent, 'utf8');
    process.env.ADMIN_PASSWORD = new_password;

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

        // Controlla se le macro sono cambiate (skip se identico)
        if (existingInTracker) {
          const same =
            Math.abs((existingInTracker.energy_kcal || 0) - (food.kcal_100g || 0)) < 0.5 &&
            Math.abs((existingInTracker.proteins_100g || 0) - (food.protein_100g || 0)) < 0.5 &&
            Math.abs((existingInTracker.fat_100g || 0) - (food.fat_100g || 0)) < 0.5 &&
            Math.abs((existingInTracker.carbohydrates_100g || 0) - (food.carbs_100g || 0)) < 0.5 &&
            (existingInTracker.product_name || '') === (food.name || '') &&
            (existingInTracker.brands || '') === (food.brand || '');
          if (same) {
            skipped++;
            continue;
          }
        }

        // Upsert su Food Tracker
        const payload = {
          external_id: food.barcode || null,
          product_name: food.name,
          brands: food.brand || null,
          source,
          energy_kcal: food.kcal_100g || null,
          proteins_100g: food.protein_100g || null,
          fat_100g: food.fat_100g || null,
          carbohydrates_100g: food.carbs_100g || null,
          image_url: null  // non sincronizziamo le immagini locali
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
