const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/external/daily-totals?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/daily-totals', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      return res.status(400).json({ error: 'Parametri from e to (YYYY-MM-DD) richiesti' });
    }
    const db = await getDb();
    const entries = await db.all(`
      SELECT de.date, de.quantity_g,
        f.kcal_100g, f.protein_100g, f.fat_100g, f.carbs_100g,
        dps.kcal_target AS snapshot_kcal_target
      FROM diary_entries de
      JOIN foods f ON f.id = de.food_id
      LEFT JOIN daily_plan_snapshots dps ON dps.date = de.date
      WHERE de.date >= ? AND de.date <= ?
      ORDER BY de.date ASC
    `, from, to);

    const byDate = {};
    for (const e of entries) {
      if (!byDate[e.date]) byDate[e.date] = { date: e.date, kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0, kcal_target: e.snapshot_kcal_target || null };
      byDate[e.date].kcal += (e.kcal_100g / 100) * e.quantity_g;
      byDate[e.date].protein_g += (e.protein_100g / 100) * e.quantity_g;
      byDate[e.date].fat_g += (e.fat_100g / 100) * e.quantity_g;
      byDate[e.date].carbs_g += (e.carbs_100g / 100) * e.quantity_g;
    }

    res.json(Object.values(byDate).map(d => ({
      date: d.date,
      kcal: Math.round(d.kcal),
      protein_g: Math.round(d.protein_g * 10) / 10,
      fat_g: Math.round(d.fat_g * 10) / 10,
      carbs_g: Math.round(d.carbs_g * 10) / 10,
      kcal_target: d.kcal_target
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/external/active-plan
router.get('/active-plan', async (req, res) => {
  try {
    const db = await getDb();
    const plan = await db.get('SELECT * FROM plans WHERE is_active = 1 ORDER BY id LIMIT 1');
    if (!plan) return res.status(404).json({ error: 'no_active_plan' });

    const kcal = plan.kcal_target;
    const protein_g = Math.round((kcal * plan.protein_pct / 100) / 4);
    const fat_g = Math.round((kcal * plan.fat_pct / 100) / 9);
    const carbs_g = Math.round((kcal * plan.carbs_pct / 100) / 4);

    res.json({
      name: plan.name,
      kcal_target: plan.kcal_target,
      protein_pct: plan.protein_pct,
      fat_pct: plan.fat_pct,
      carbs_pct: plan.carbs_pct,
      protein_g,
      fat_g,
      carbs_g,
      updated_at: plan.updated_at || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

module.exports = router;
