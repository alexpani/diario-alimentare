require('dotenv').config();
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const DB_PATH = path.join(__dirname, 'database', 'food_diary.sqlite');

async function main() {
  const dbDir = path.join(__dirname, 'database');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.run('PRAGMA foreign_keys = ON');

  console.log('Creazione tabelle...');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS foods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT,
      kcal_100g REAL NOT NULL DEFAULT 0,
      protein_100g REAL NOT NULL DEFAULT 0,
      fat_100g REAL NOT NULL DEFAULT 0,
      carbs_100g REAL NOT NULL DEFAULT 0,
      portions TEXT NOT NULL DEFAULT '[]',
      image_path TEXT,
      barcode TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS diary_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      meal_type TEXT NOT NULL,
      food_id INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
      quantity_g REAL NOT NULL,
      quantity_label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS plan (
      id INTEGER PRIMARY KEY DEFAULT 1,
      kcal_target REAL NOT NULL DEFAULT 2000,
      protein_pct REAL NOT NULL DEFAULT 30,
      fat_pct REAL NOT NULL DEFAULT 30,
      carbs_pct REAL NOT NULL DEFAULT 40,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.exec('CREATE INDEX IF NOT EXISTS idx_diary_date ON diary_entries(date)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_foods_name ON foods(name)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_foods_barcode ON foods(barcode)');

  const existingPlan = await db.get('SELECT id FROM plan WHERE id = 1');
  if (!existingPlan) {
    await db.run('INSERT INTO plan (id, kcal_target, protein_pct, fat_pct, carbs_pct) VALUES (1, 2000, 30, 30, 40)');
    console.log('Piano di default inserito: 2000 kcal, 30% proteine, 30% grassi, 40% carbs');
  } else {
    console.log('Piano già presente, non modificato.');
  }

  await db.close();

  console.log('\n✅ Database creato con successo: database/food_diary.sqlite\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PASSO SUCCESSIVO: crea il file .env nella root del progetto');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Contenuto del file .env:\n');
  console.log('  PORT=3000');
  console.log('  SESSION_SECRET=una-stringa-casuale-lunga-e-sicura');
  console.log('  ADMIN_USER=admin');
  console.log('  ADMIN_PASSWORD=la-tua-password\n');
  console.log('Poi avvia il server con: node server.js');
  console.log('E apri nel browser: http://localhost:3000\n');
}

main().catch(err => {
  console.error('Errore durante il setup:', err);
  process.exit(1);
});
