const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { getDb } = require('../database/db');
const { isAuth } = require('./auth');
const { recognizeFood } = require('../services/vision');

const CATALOG_BASE = process.env.CATALOG_URL || 'http://192.168.68.153:3001';

// Multer per foto AI (temp)
const aiUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.use(isAuth);

// GET /api/diary?date=YYYY-MM-DD
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const entries = await db.all(`
      SELECT
        de.id, de.date, de.meal_type, de.quantity_g, de.quantity_label, de.created_at,
        f.id AS food_id, f.name, f.brand, f.kcal_100g, f.protein_100g, f.fat_100g, f.carbs_100g,
        f.image_path, f.portions, f.components
      FROM diary_entries de
      JOIN foods f ON f.id = de.food_id
      WHERE de.date = ?
      ORDER BY de.created_at ASC
    `, date);

    const result = entries.map(e => ({
      id: e.id,
      date: e.date,
      meal_type: e.meal_type,
      quantity_g: e.quantity_g,
      quantity_label: e.quantity_label,
      created_at: e.created_at,
      food: {
        id: e.food_id,
        name: e.name,
        brand: e.brand,
        kcal_100g: e.kcal_100g,
        protein_100g: e.protein_100g,
        fat_100g: e.fat_100g,
        carbs_100g: e.carbs_100g,
        image_path: e.image_path,
        portions: JSON.parse(e.portions || '[]'),
        components: JSON.parse(e.components || '[]')
      },
      kcal: Math.round((e.kcal_100g / 100) * e.quantity_g * 10) / 10,
      protein: Math.round((e.protein_100g / 100) * e.quantity_g * 10) / 10,
      fat: Math.round((e.fat_100g / 100) * e.quantity_g * 10) / 10,
      carbs: Math.round((e.carbs_100g / 100) * e.quantity_g * 10) / 10
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/diary/range?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/range', async (req, res) => {
  try {
    const db = await getDb();
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'Parametri from e to richiesti' });

    const entries = await db.all(`
      SELECT de.date, de.quantity_g,
        f.kcal_100g, f.protein_100g, f.fat_100g, f.carbs_100g
      FROM diary_entries de
      JOIN foods f ON f.id = de.food_id
      WHERE de.date >= ? AND de.date <= ?
      ORDER BY de.date ASC
    `, from, to);

    const byDate = {};
    for (const e of entries) {
      if (!byDate[e.date]) byDate[e.date] = { date: e.date, kcal: 0, protein: 0, fat: 0, carbs: 0 };
      byDate[e.date].kcal += (e.kcal_100g / 100) * e.quantity_g;
      byDate[e.date].protein += (e.protein_100g / 100) * e.quantity_g;
      byDate[e.date].fat += (e.fat_100g / 100) * e.quantity_g;
      byDate[e.date].carbs += (e.carbs_100g / 100) * e.quantity_g;
    }

    res.json(Object.values(byDate).map(d => ({
      date: d.date,
      kcal: Math.round(d.kcal),
      protein: Math.round(d.protein * 10) / 10,
      fat: Math.round(d.fat * 10) / 10,
      carbs: Math.round(d.carbs * 10) / 10
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/diary/days
router.get('/days', async (req, res) => {
  try {
    const db = await getDb();
    const limit = parseInt(req.query.limit) || 30;

    const days = await db.all(`
      SELECT
        de.date,
        SUM(f.kcal_100g / 100 * de.quantity_g) AS kcal,
        SUM(f.protein_100g / 100 * de.quantity_g) AS protein,
        SUM(f.fat_100g / 100 * de.quantity_g) AS fat,
        SUM(f.carbs_100g / 100 * de.quantity_g) AS carbs,
        COUNT(*) AS entry_count
      FROM diary_entries de
      JOIN foods f ON f.id = de.food_id
      GROUP BY de.date
      ORDER BY de.date DESC
      LIMIT ?
    `, limit);

    res.json(days.map(d => ({
      date: d.date,
      kcal: Math.round(d.kcal),
      protein: Math.round(d.protein * 10) / 10,
      fat: Math.round(d.fat * 10) / 10,
      carbs: Math.round(d.carbs * 10) / 10,
      entry_count: d.entry_count
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// POST /api/diary
router.post('/', async (req, res) => {
  try {
    const db = await getDb();
    const { date, meal_type, food_id, quantity_g, quantity_label } = req.body;

    if (!date || !meal_type || !food_id || !quantity_g) {
      return res.status(400).json({ error: 'Campi obbligatori: date, meal_type, food_id, quantity_g' });
    }

    const validMeals = ['colazione', 'spuntino_mattino', 'pranzo', 'spuntino_pomeriggio', 'cena', 'extra'];
    if (!validMeals.includes(meal_type)) return res.status(400).json({ error: 'meal_type non valido' });

    const food = await db.get('SELECT id FROM foods WHERE id = ?', food_id);
    if (!food) return res.status(404).json({ error: 'Alimento non trovato' });

    const result = await db.run(
      'INSERT INTO diary_entries (date, meal_type, food_id, quantity_g, quantity_label) VALUES (?, ?, ?, ?, ?)',
      date, meal_type, food_id, parseFloat(quantity_g), quantity_label || null
    );

    res.json({ id: result.lastID, ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// POST /api/diary/quick — crea alimento temporaneo + voce diario in un colpo solo
router.post('/quick', async (req, res) => {
  try {
    const db = await getDb();
    const { date, meal_type, description, kcal, protein_pct, fat_pct, carbs_pct } = req.body;

    if (!date || !meal_type || !kcal) {
      return res.status(400).json({ error: 'Campi obbligatori: date, meal_type, kcal' });
    }

    const kcalVal      = parseFloat(kcal) || 0;
    const proteinPct   = parseFloat(protein_pct) || 0;
    const fatPct       = parseFloat(fat_pct) || 0;
    const carbsPct     = parseFloat(carbs_pct) || 0;

    // Calcola grammi per 100 kcal (poi quantity_g=100 darà esattamente kcalVal)
    const protein_100g = (kcalVal * proteinPct / 100) / 4;
    const fat_100g     = (kcalVal * fatPct    / 100) / 9;
    const carbs_100g   = (kcalVal * carbsPct  / 100) / 4;

    const name = (description || '').trim() || 'Voce rapida';

    const foodRes = await db.run(
      `INSERT INTO foods (name, kcal_100g, protein_100g, fat_100g, carbs_100g, is_quick, portions, components)
       VALUES (?, ?, ?, ?, ?, 1, '[]', '[]')`,
      name, kcalVal, protein_100g, fat_100g, carbs_100g
    );

    const validMeals = ['colazione','spuntino_mattino','pranzo','spuntino_pomeriggio','cena','extra'];
    if (!validMeals.includes(meal_type)) return res.status(400).json({ error: 'meal_type non valido' });

    const entryRes = await db.run(
      `INSERT INTO diary_entries (date, meal_type, food_id, quantity_g, quantity_label) VALUES (?, ?, ?, 100, ?)`,
      date, meal_type, foodRes.lastID, `${Math.round(kcalVal)} kcal (stima)`
    );

    res.json({ id: entryRes.lastID, ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/diary/recent?meal_type=xxx&limit=10
router.get('/recent', async (req, res) => {
  try {
    const db = await getDb();
    const { meal_type, limit = 10 } = req.query;
    if (!meal_type) return res.status(400).json({ error: 'meal_type obbligatorio' });

    const rows = await db.all(`
      SELECT f.id, f.name, f.brand, f.kcal_100g, f.protein_100g, f.fat_100g, f.carbs_100g,
             f.portions, f.image_path, agg.last_used, latest.quantity_g AS last_qty_g, latest.quantity_label AS last_qty_label
      FROM (
        SELECT food_id, MAX(id) AS max_id, MAX(date) AS last_used
        FROM diary_entries WHERE meal_type = ? GROUP BY food_id
      ) agg
      JOIN diary_entries latest ON latest.id = agg.max_id
      JOIN foods f ON f.id = agg.food_id
      WHERE f.is_quick = 0
      ORDER BY agg.last_used DESC
      LIMIT ?
    `, meal_type, parseInt(limit));

    res.json(rows.map(r => ({
      ...r,
      portions: r.portions ? JSON.parse(r.portions) : []
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/diary/frequent?meal_type=xxx&limit=8
router.get('/frequent', async (req, res) => {
  try {
    const db = await getDb();
    const { meal_type, limit = 8 } = req.query;
    if (!meal_type) return res.status(400).json({ error: 'meal_type obbligatorio' });

    const rows = await db.all(`
      SELECT f.id, f.name, f.brand, f.kcal_100g, f.protein_100g, f.fat_100g, f.carbs_100g,
             f.portions, f.image_path, COUNT(de.id) as use_count,
             latest.quantity_g AS last_qty_g, latest.quantity_label AS last_qty_label
      FROM diary_entries de
      JOIN foods f ON f.id = de.food_id
      JOIN (
        SELECT food_id, quantity_g, quantity_label
        FROM diary_entries WHERE id IN (
          SELECT MAX(id) FROM diary_entries WHERE meal_type = ? GROUP BY food_id
        )
      ) latest ON latest.food_id = de.food_id
      WHERE de.meal_type = ? AND f.is_quick = 0
      GROUP BY de.food_id
      ORDER BY use_count DESC
      LIMIT ?
    `, meal_type, meal_type, parseInt(limit));

    res.json(rows.map(r => ({
      ...r,
      portions: r.portions ? JSON.parse(r.portions) : []
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// PUT /api/diary/:id
router.put('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const { quantity_g, quantity_label, meal_type } = req.body;
    const entry = await db.get('SELECT * FROM diary_entries WHERE id = ?', req.params.id);
    if (!entry) return res.status(404).json({ error: 'Voce non trovata' });
    const validMeals = ['colazione','spuntino_mattino','pranzo','spuntino_pomeriggio','cena','extra'];
    const newMeal = meal_type && validMeals.includes(meal_type) ? meal_type : entry.meal_type;
    await db.run(
      'UPDATE diary_entries SET quantity_g = ?, quantity_label = ?, meal_type = ? WHERE id = ?',
      parseFloat(quantity_g), quantity_label || null, newMeal, req.params.id
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// POST /api/diary/copy — copia le voci di un pasto da un'altra data
router.post('/copy', async (req, res) => {
  try {
    const db = await getDb();
    const { from_date, to_date, meal_type } = req.body;

    if (!from_date || !to_date || !meal_type) {
      return res.status(400).json({ error: 'Campi obbligatori: from_date, to_date, meal_type' });
    }

    const sourceEntries = await db.all(
      'SELECT food_id, quantity_g, quantity_label FROM diary_entries WHERE date = ? AND meal_type = ?',
      from_date, meal_type
    );

    if (sourceEntries.length === 0) {
      return res.status(404).json({ error: 'Nessuna voce trovata per il pasto di origine' });
    }

    for (const e of sourceEntries) {
      await db.run(
        'INSERT INTO diary_entries (date, meal_type, food_id, quantity_g, quantity_label) VALUES (?, ?, ?, ?, ?)',
        to_date, meal_type, e.food_id, e.quantity_g, e.quantity_label
      );
    }

    res.json({ ok: true, copied: sourceEntries.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// DELETE /api/diary/:id
router.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.run('DELETE FROM diary_entries WHERE id = ?', req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Entry non trovata' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// POST /api/diary/recognize-photo — riconoscimento alimenti da foto con IA
router.post('/recognize-photo', aiUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nessuna immagine' });

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key IA non configurata' });

    // Ridimensiona immagine a max 1024px per ridurre costi API
    const resized = await sharp(req.file.buffer)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Chiama il servizio AI
    const foods = await recognizeFood(resized, 'image/jpeg');

    if (foods.length === 0) {
      return res.json({ items: [] });
    }

    // Per ogni alimento riconosciuto, cerca match nel DB locale e nel catalogo
    const db = await getDb();
    const items = [];

    for (const food of foods) {
      // Termini di ricerca: nome principale + alternative
      const searchTerms = [food.name, ...food.search_terms];

      // 1. Cerca nel DB locale
      let localMatches = [];
      for (const term of searchTerms) {
        if (localMatches.length >= 3) break;
        const tokens = term.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) continue;
        const conditions = tokens.map(() => '(name LIKE ? OR brand LIKE ?)').join(' AND ');
        const params = tokens.flatMap(t => [`%${t}%`, `%${t}%`]);
        params.push(5);
        const found = await db.all(
          `SELECT * FROM foods WHERE deleted_at IS NULL AND is_quick = 0 AND ${conditions} ORDER BY name ASC LIMIT ?`,
          ...params
        );
        // Aggiungi solo quelli non già trovati
        const existingIds = new Set(localMatches.map(m => m.id));
        for (const f of found) {
          if (!existingIds.has(f.id)) {
            localMatches.push({
              id: f.id, name: f.name, brand: f.brand,
              kcal_100g: f.kcal_100g, protein_100g: f.protein_100g,
              fat_100g: f.fat_100g, carbs_100g: f.carbs_100g,
              image_path: f.image_path, source: f.source,
              portions: JSON.parse(f.portions || '[]')
            });
            existingIds.add(f.id);
          }
        }
      }
      localMatches = localMatches.slice(0, 5);

      // 2. Cerca nel catalogo Food Tracker (se pochi risultati locali)
      let catalogMatches = [];
      if (localMatches.length < 3) {
        try {
          const fetch = (await import('node-fetch')).default;
          for (const term of searchTerms) {
            if (catalogMatches.length >= 5) break;
            const url = `${CATALOG_BASE}/search?q=${encodeURIComponent(term)}&limit=10`;
            const resp = await fetch(url, { timeout: 5000 });
            if (resp.ok) {
              const data = await resp.json();
              const products = (data.results || []).filter(p => p.product_name);
              // Filtra prodotti già nel DB locale
              const localBarcodes = new Set(localMatches.filter(m => m.barcode).map(m => m.barcode));
              for (const p of products) {
                if (catalogMatches.length >= 5) break;
                if (p.barcode && localBarcodes.has(p.barcode)) continue;
                const imageUrl = p.image_url
                  ? `/api/foods/proxy-image?url=${encodeURIComponent(p.image_url)}`
                  : null;
                catalogMatches.push({
                  name: p.product_name, brand: p.brand || '',
                  barcode: p.barcode || '',
                  kcal_100g: p.kcal_100g || 0,
                  protein_100g: p.protein_100g || 0,
                  fat_100g: p.fat_100g || 0,
                  carbs_100g: p.carbs_100g || 0,
                  source: p.source || 'openfoodfacts',
                  image_url: imageUrl
                });
              }
            }
          }
        } catch (e) {
          console.warn('Catalog search error in recognize:', e.message);
        }
      }

      items.push({
        ai_name: food.name,
        ai_quantity_g: food.quantity_g,
        ai_kcal_100g: food.kcal_100g || 0,
        ai_protein_100g: food.protein_100g || 0,
        ai_fat_100g: food.fat_100g || 0,
        ai_carbs_100g: food.carbs_100g || 0,
        local_matches: localMatches,
        catalog_matches: catalogMatches
      });
    }

    res.json({ items });
  } catch (err) {
    console.error('Recognize photo error:', err);
    res.status(500).json({ error: err.message || 'Errore nel riconoscimento' });
  }
});

module.exports = router;
