const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const { isAuth } = require('./auth');

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
        f.image_path, f.portions
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
        portions: JSON.parse(e.portions || '[]')
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
             f.portions, f.image_path, latest.last_used, latest.quantity_g AS last_qty_g, latest.quantity_label AS last_qty_label
      FROM (
        SELECT food_id, MAX(date || ' ' || created_at) AS max_ts, MAX(date) AS last_used
        FROM diary_entries WHERE meal_type = ? GROUP BY food_id
      ) agg
      JOIN diary_entries latest ON latest.food_id = agg.food_id
        AND (latest.date || ' ' || latest.created_at) = agg.max_ts
        AND latest.meal_type = ?
      JOIN foods f ON f.id = agg.food_id
      WHERE f.is_quick = 0
      ORDER BY agg.last_used DESC
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
        FROM diary_entries
        WHERE meal_type = ?
        AND id IN (
          SELECT MAX(id) FROM diary_entries WHERE meal_type = ? GROUP BY food_id
        )
      ) latest ON latest.food_id = de.food_id
      WHERE de.meal_type = ? AND f.is_quick = 0
      GROUP BY de.food_id
      ORDER BY use_count DESC
      LIMIT ?
    `, meal_type, meal_type, meal_type, parseInt(limit));

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

module.exports = router;
