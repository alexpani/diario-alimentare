const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const DB_PATH = path.join(__dirname, 'food_diary.sqlite');

let _db = null;

async function getDb() {
  if (!_db) {
    _db = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });
    await _db.run('PRAGMA foreign_keys = ON');
    // Migrazione: aggiungi colonne se non esistono
    const cols = await _db.all("PRAGMA table_info(foods)");
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('components'))
      await _db.run("ALTER TABLE foods ADD COLUMN components TEXT NOT NULL DEFAULT '[]'");
    if (!colNames.includes('recipe_yield_g'))
      await _db.run("ALTER TABLE foods ADD COLUMN recipe_yield_g REAL");
    if (!colNames.includes('deleted_at'))
      await _db.run("ALTER TABLE foods ADD COLUMN deleted_at TEXT");
    if (!colNames.includes('is_quick'))
      await _db.run("ALTER TABLE foods ADD COLUMN is_quick INTEGER NOT NULL DEFAULT 0");
    if (!colNames.includes('source'))
      await _db.run("ALTER TABLE foods ADD COLUMN source TEXT NOT NULL DEFAULT 'app'");

    // Migrazione tabella plans (multi-piano)
    const tables = (await _db.all("SELECT name FROM sqlite_master WHERE type='table'")).map(t => t.name);
    if (!tables.includes('plans')) {
      await _db.run(`CREATE TABLE plans (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL DEFAULT 'Piano',
        kcal_target REAL NOT NULL DEFAULT 2000,
        protein_pct REAL NOT NULL DEFAULT 30,
        fat_pct     REAL NOT NULL DEFAULT 30,
        carbs_pct   REAL NOT NULL DEFAULT 40,
        is_active   INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
      )`);
      // Migra piano esistente
      const old = await _db.get('SELECT * FROM plan WHERE id = 1');
      if (old) {
        await _db.run(
          `INSERT INTO plans (name, kcal_target, protein_pct, fat_pct, carbs_pct, is_active)
           VALUES ('Piano principale', ?, ?, ?, ?, 1)`,
          old.kcal_target, old.protein_pct, old.fat_pct, old.carbs_pct
        );
      } else {
        await _db.run(
          `INSERT INTO plans (name, kcal_target, protein_pct, fat_pct, carbs_pct, is_active)
           VALUES ('Piano principale', 2000, 30, 30, 40, 1)`
        );
      }
    }

    // Migrazione tabella plans — aggiungi user_id
    const planCols = await _db.all("PRAGMA table_info(plans)");
    if (!planCols.map(c => c.name).includes('user_id')) {
      await _db.run("ALTER TABLE plans ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1");
      await _db.run("CREATE INDEX IF NOT EXISTS idx_plans_user_active ON plans(user_id, is_active)");
    }

    // Migrazione tabella diary_entries — aggiungi user_id
    const diaryCols = await _db.all("PRAGMA table_info(diary_entries)");
    if (!diaryCols.map(c => c.name).includes('user_id')) {
      await _db.run("ALTER TABLE diary_entries ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1");
      await _db.run("CREATE INDEX IF NOT EXISTS idx_diary_user_date ON diary_entries(user_id, date)");
    }

    // Migrazione tabella daily_plan_snapshots
    if (!tables.includes('daily_plan_snapshots')) {
      await _db.run(`CREATE TABLE daily_plan_snapshots (
        date        TEXT PRIMARY KEY,
        plan_name   TEXT NOT NULL DEFAULT 'Piano',
        kcal_target REAL NOT NULL DEFAULT 2000,
        protein_pct REAL NOT NULL DEFAULT 30,
        fat_pct     REAL NOT NULL DEFAULT 30,
        carbs_pct   REAL NOT NULL DEFAULT 40,
        user_id     INTEGER NOT NULL DEFAULT 1,
        updated_at  TEXT DEFAULT (datetime('now'))
      )`);
    } else {
      // Migrazione daily_plan_snapshots — aggiungi user_id se tabella esiste
      const snapshotCols = await _db.all("PRAGMA table_info(daily_plan_snapshots)");
      if (!snapshotCols.map(c => c.name).includes('user_id')) {
        await _db.run("ALTER TABLE daily_plan_snapshots ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1");
        await _db.run("CREATE INDEX IF NOT EXISTS idx_snapshot_user_date ON daily_plan_snapshots(user_id, date)");
      }
    }

    // Fix macro ricette: ricalcola kcal/macro da componenti per ricette con recipe_yield_g stantio
    const recipes = await _db.all(
      `SELECT id, components FROM foods WHERE components IS NOT NULL AND components != '[]' AND deleted_at IS NULL`
    );
    for (const r of recipes) {
      let comps;
      try { comps = JSON.parse(r.components || '[]'); } catch { continue; }
      if (!comps.length || comps[0].kcal_100g === undefined) continue;
      let totalKcal = 0, totalP = 0, totalF = 0, totalC = 0, totalW = 0;
      for (const c of comps) {
        const q = parseFloat(c.quantity_g) || 0;
        totalKcal += (c.kcal_100g    / 100) * q;
        totalP    += (c.protein_100g / 100) * q;
        totalF    += (c.fat_100g     / 100) * q;
        totalC    += (c.carbs_100g   / 100) * q;
        totalW    += q;
      }
      const yieldG = totalW || 100;
      await _db.run(
        `UPDATE foods SET kcal_100g=?, protein_100g=?, fat_100g=?, carbs_100g=?, recipe_yield_g=NULL WHERE id=?`,
        Math.round((totalKcal / yieldG) * 100 * 10) / 10,
        Math.round((totalP    / yieldG) * 100 * 10) / 10,
        Math.round((totalF    / yieldG) * 100 * 10) / 10,
        Math.round((totalC    / yieldG) * 100 * 10) / 10,
        r.id
      );
    }
  }
  return _db;
}

async function upsertDaySnapshot(date) {
  const db = await getDb();
  // Crea la tabella se non esiste (per server già in esecuzione senza restart)
  await db.run(`CREATE TABLE IF NOT EXISTS daily_plan_snapshots (
    date        TEXT PRIMARY KEY,
    plan_name   TEXT NOT NULL DEFAULT 'Piano',
    kcal_target REAL NOT NULL DEFAULT 2000,
    protein_pct REAL NOT NULL DEFAULT 30,
    fat_pct     REAL NOT NULL DEFAULT 30,
    carbs_pct   REAL NOT NULL DEFAULT 40,
    updated_at  TEXT DEFAULT (datetime('now'))
  )`);
  const plan = await db.get('SELECT * FROM plans WHERE is_active = 1 ORDER BY id LIMIT 1');
  if (!plan) return;
  await db.run(
    `INSERT OR REPLACE INTO daily_plan_snapshots (date, plan_name, kcal_target, protein_pct, fat_pct, carbs_pct, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    date, plan.name, plan.kcal_target, plan.protein_pct, plan.fat_pct, plan.carbs_pct
  );
}

module.exports = { getDb, upsertDaySnapshot };
