const express = require('express');
const router = express.Router();
const { getDb, upsertDaySnapshot } = require('../database/db');
const { isAuth } = require('./auth');

router.use(isAuth);

// GET /api/plan/snapshot?date=YYYY-MM-DD — snapshot piano per la data
router.get('/snapshot', async (req, res) => {
  try {
    const db = await getDb();
    await db.run(`CREATE TABLE IF NOT EXISTS daily_plan_snapshots (
      date        TEXT PRIMARY KEY,
      plan_name   TEXT NOT NULL DEFAULT 'Piano',
      kcal_target REAL NOT NULL DEFAULT 2000,
      protein_pct REAL NOT NULL DEFAULT 30,
      fat_pct     REAL NOT NULL DEFAULT 30,
      carbs_pct   REAL NOT NULL DEFAULT 40,
      updated_at  TEXT DEFAULT (datetime('now'))
    )`);
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const snap = await db.get('SELECT * FROM daily_plan_snapshots WHERE date = ?', date);
    if (snap) return res.json(snap);
    // fallback: piano attivo corrente
    const plan = await db.get('SELECT * FROM plans WHERE is_active = 1 ORDER BY id LIMIT 1');
    res.json(plan
      ? { date, plan_name: plan.name, kcal_target: plan.kcal_target,
          protein_pct: plan.protein_pct, fat_pct: plan.fat_pct, carbs_pct: plan.carbs_pct }
      : { date, plan_name: 'Piano', kcal_target: 2000, protein_pct: 30, fat_pct: 30, carbs_pct: 40 }
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/plan  — piano attivo (compatibilità con codice esistente)
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const plan = await db.get('SELECT * FROM plans WHERE is_active = 1 ORDER BY id LIMIT 1');
    if (plan) return res.json(plan);
    // fallback se nessuno attivo
    const any = await db.get('SELECT * FROM plans ORDER BY id LIMIT 1');
    res.json(any || { id: 0, name: 'Piano', kcal_target: 2000, protein_pct: 30, fat_pct: 30, carbs_pct: 40 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// PUT /api/plan  — aggiorna piano attivo (compatibilità)
router.put('/', async (req, res) => {
  try {
    const db = await getDb();
    const { kcal_target, protein_pct, fat_pct, carbs_pct, name, date } = req.body;
    const total = parseFloat(protein_pct) + parseFloat(fat_pct) + parseFloat(carbs_pct);
    if (Math.abs(total - 100) > 0.1)
      return res.status(400).json({ error: 'Le percentuali devono sommare 100' });

    const active = await db.get('SELECT id FROM plans WHERE is_active = 1 ORDER BY id LIMIT 1');
    if (active) {
      await db.run(
        `UPDATE plans SET name=?, kcal_target=?, protein_pct=?, fat_pct=?, carbs_pct=?, updated_at=datetime('now') WHERE id=?`,
        name || 'Piano', parseFloat(kcal_target), parseFloat(protein_pct), parseFloat(fat_pct), parseFloat(carbs_pct), active.id
      );
      const plan = await db.get('SELECT * FROM plans WHERE id = ?', active.id);
      await upsertDaySnapshot(date || new Date().toISOString().slice(0, 10));
      return res.json(plan);
    }
    res.status(404).json({ error: 'Nessun piano attivo' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/plans  — lista tutti i piani
router.get('/all', async (req, res) => {
  try {
    const db = await getDb();
    const plans = await db.all('SELECT * FROM plans ORDER BY id ASC');
    res.json(plans);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// POST /api/plans  — crea nuovo piano
router.post('/new', async (req, res) => {
  try {
    const db = await getDb();
    const { name, kcal_target, protein_pct, fat_pct, carbs_pct } = req.body;
    const total = parseFloat(protein_pct) + parseFloat(fat_pct) + parseFloat(carbs_pct);
    if (Math.abs(total - 100) > 0.1)
      return res.status(400).json({ error: 'Le percentuali devono sommare 100' });

    const result = await db.run(
      `INSERT INTO plans (name, kcal_target, protein_pct, fat_pct, carbs_pct, is_active)
       VALUES (?, ?, ?, ?, ?, 0)`,
      name || 'Nuovo piano', parseFloat(kcal_target), parseFloat(protein_pct),
      parseFloat(fat_pct), parseFloat(carbs_pct)
    );
    const plan = await db.get('SELECT * FROM plans WHERE id = ?', result.lastID);
    res.json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// PUT /api/plans/:id  — aggiorna piano
router.put('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const { name, kcal_target, protein_pct, fat_pct, carbs_pct, date } = req.body;
    const total = parseFloat(protein_pct) + parseFloat(fat_pct) + parseFloat(carbs_pct);
    if (Math.abs(total - 100) > 0.1)
      return res.status(400).json({ error: 'Le percentuali devono sommare 100' });

    await db.run(
      `UPDATE plans SET name=?, kcal_target=?, protein_pct=?, fat_pct=?, carbs_pct=?, updated_at=datetime('now') WHERE id=?`,
      name, parseFloat(kcal_target), parseFloat(protein_pct),
      parseFloat(fat_pct), parseFloat(carbs_pct), req.params.id
    );
    const plan = await db.get('SELECT * FROM plans WHERE id = ?', req.params.id);
    if (!plan) return res.status(404).json({ error: 'Piano non trovato' });
    if (plan.is_active) {
      await upsertDaySnapshot(date || new Date().toISOString().slice(0, 10));
    }
    res.json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// POST /api/plans/:id/activate  — imposta piano attivo
router.post('/:id/activate', async (req, res) => {
  try {
    const db = await getDb();
    await db.run('UPDATE plans SET is_active = 0');
    await db.run('UPDATE plans SET is_active = 1 WHERE id = ?', req.params.id);
    const plan = await db.get('SELECT * FROM plans WHERE id = ?', req.params.id);
    if (!plan) return res.status(404).json({ error: 'Piano non trovato' });
    await upsertDaySnapshot(req.body.date || new Date().toISOString().slice(0, 10));
    res.json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// DELETE /api/plans/:id  — elimina piano
router.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const plan = await db.get('SELECT * FROM plans WHERE id = ?', req.params.id);
    if (!plan) return res.status(404).json({ error: 'Piano non trovato' });
    if (plan.is_active) return res.status(400).json({ error: 'Non puoi eliminare il piano attivo' });
    await db.run('DELETE FROM plans WHERE id = ?', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

module.exports = router;
