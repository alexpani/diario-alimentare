const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDb } = require('../database/db');
const { isAuth } = require('./auth');

// GET /api/foods/proxy-image?url=... (pubblica, non richiede autenticazione)
router.get('/proxy-image', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing url');
  try {
    const fetch = (await import('node-fetch')).default;
    const resp = await fetch(url, { timeout: 8000 });
    if (!resp.ok) return res.status(resp.status).send('Image not found');
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const buffer = await resp.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('proxy-image error:', err.message);
    res.status(502).send('Proxy error');
  }
});

router.use(isAuth);

// Configurazione multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `food-tmp-${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo immagini consentite'));
  }
});


// ── Helper: calcola macros da componenti ─────────────────────────────────────
async function calcMacrosFromComponents(db, components, recipe_yield_g) {
  let totalKcal = 0, totalProtein = 0, totalFat = 0, totalCarbs = 0, totalWeight = 0;
  for (const c of components) {
    const f = await db.get('SELECT kcal_100g,protein_100g,fat_100g,carbs_100g FROM foods WHERE id=?', c.food_id);
    if (!f) continue;
    const q = parseFloat(c.quantity_g) || 0;
    totalKcal    += (f.kcal_100g    / 100) * q;
    totalProtein += (f.protein_100g / 100) * q;
    totalFat     += (f.fat_100g     / 100) * q;
    totalCarbs   += (f.carbs_100g   / 100) * q;
    totalWeight  += q;
  }
  const yieldG = parseFloat(recipe_yield_g) || totalWeight || 100;
  return {
    kcal_100g:    Math.round((totalKcal    / yieldG) * 100 * 10) / 10,
    protein_100g: Math.round((totalProtein / yieldG) * 100 * 10) / 10,
    fat_100g:     Math.round((totalFat     / yieldG) * 100 * 10) / 10,
    carbs_100g:   Math.round((totalCarbs   / yieldG) * 100 * 10) / 10,
  };
}

// ── Helper: deserializza alimento ────────────────────────────────────────────
function deserializeFood(f) {
  return {
    ...f,
    portions:   JSON.parse(f.portions   || '[]'),
    components: JSON.parse(f.components || '[]'),
  };
}

// GET /api/foods?q=&limit=&barcode=
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const limit = parseInt(req.query.limit) || 50;

    // Ricerca per barcode esatto (ha priorità su q)
    if (req.query.barcode) {
      const includeQuick = req.query.include_quick === '1';
      const filter = includeQuick
        ? 'barcode = ? AND deleted_at IS NULL'
        : 'barcode = ? AND is_quick = 0 AND deleted_at IS NULL';
      const food = await db.get(`SELECT * FROM foods WHERE ${filter}`, req.query.barcode.trim());
      return res.json(food ? [deserializeFood(food)] : []);
    }

    const raw = (req.query.q || '').trim();
    let foods;

    if (!raw) {
      foods = await db.all('SELECT * FROM foods WHERE deleted_at IS NULL AND is_quick = 0 ORDER BY name ASC LIMIT ?', limit);
    } else {
      // Spezza in token: tutti devono comparire nel nome O nel brand (in qualsiasi ordine)
      const tokens = raw.split(/\s+/).filter(Boolean);
      const conditions = tokens.map(() => '(name LIKE ? OR brand LIKE ?)').join(' AND ');
      const params = tokens.flatMap(t => [`%${t}%`, `%${t}%`]);
      params.push(limit);
      foods = await db.all(
        `SELECT * FROM foods WHERE deleted_at IS NULL AND is_quick = 0 AND ${conditions} ORDER BY name ASC LIMIT ?`,
        ...params
      );
    }

    res.json(foods.map(deserializeFood));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/foods/:id
router.get('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const food = await db.get('SELECT * FROM foods WHERE id = ?', req.params.id);
    if (!food) return res.status(404).json({ error: 'Alimento non trovato' });
    res.json(deserializeFood(food));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// POST /api/foods
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const db = await getDb();
    const { name, brand, kcal_100g, protein_100g, fat_100g, carbs_100g,
            portions, barcode, components, recipe_yield_g, source } = req.body;

    if (!name) return res.status(400).json({ error: 'Il nome è obbligatorio' });

    const portionsJson   = portions   ? (typeof portions   === 'string' ? portions   : JSON.stringify(portions))   : '[]';
    const componentsArr  = components ? (typeof components === 'string' ? JSON.parse(components) : components) : [];
    const componentsJson = JSON.stringify(componentsArr);

    // Se ha componenti, calcola macros automaticamente
    let macros = {
      kcal_100g:    parseFloat(kcal_100g)    || 0,
      protein_100g: parseFloat(protein_100g) || 0,
      fat_100g:     parseFloat(fat_100g)     || 0,
      carbs_100g:   parseFloat(carbs_100g)   || 0,
    };
    if (componentsArr.length > 0) {
      macros = await calcMacrosFromComponents(db, componentsArr, recipe_yield_g);
    }

    const result = await db.run(
      `INSERT INTO foods (name, brand, kcal_100g, protein_100g, fat_100g, carbs_100g,
        portions, barcode, components, recipe_yield_g, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      name, brand || null,
      macros.kcal_100g, macros.protein_100g, macros.fat_100g, macros.carbs_100g,
      portionsJson, barcode || null,
      componentsJson, parseFloat(recipe_yield_g) || null,
      source || 'app'
    );

    const newId = result.lastID;
    let imagePath = null;
    if (req.file) {
      const ext = path.extname(req.file.filename);
      const newFilename = `food-${newId}${ext}`;
      fs.renameSync(req.file.path, path.join(__dirname, '..', 'uploads', newFilename));
      imagePath = `/uploads/${newFilename}`;
      await db.run('UPDATE foods SET image_path = ? WHERE id = ?', imagePath, newId);
    } else if (req.body.image_url) {
      imagePath = req.body.image_url;
      await db.run('UPDATE foods SET image_path = ? WHERE id = ?', imagePath, newId);
    }

    const food = await db.get('SELECT * FROM foods WHERE id = ?', newId);
    res.json(deserializeFood(food));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// PUT /api/foods/:id
router.put('/:id', upload.single('image'), async (req, res) => {
  try {
    const db = await getDb();
    const id = req.params.id;
    const existing = await db.get('SELECT * FROM foods WHERE id = ?', id);
    if (!existing) return res.status(404).json({ error: 'Alimento non trovato' });

    const { name, brand, kcal_100g, protein_100g, fat_100g, carbs_100g,
            portions, barcode, image_url, components, recipe_yield_g } = req.body;

    const portionsJson  = portions   ? (typeof portions   === 'string' ? portions   : JSON.stringify(portions))   : existing.portions;
    const componentsArr = components ? (typeof components === 'string' ? JSON.parse(components) : components) : JSON.parse(existing.components || '[]');
    const componentsJson = JSON.stringify(componentsArr);
    const yieldG = recipe_yield_g !== undefined ? (parseFloat(recipe_yield_g) || null) : existing.recipe_yield_g;

    // Ricalcola macros se ci sono componenti
    let macros = {
      kcal_100g:    parseFloat(kcal_100g)    || existing.kcal_100g,
      protein_100g: parseFloat(protein_100g) || existing.protein_100g,
      fat_100g:     parseFloat(fat_100g)     || existing.fat_100g,
      carbs_100g:   parseFloat(carbs_100g)   || existing.carbs_100g,
    };
    if (componentsArr.length > 0) {
      macros = await calcMacrosFromComponents(db, componentsArr, yieldG);
    }

    let imagePath = existing.image_path;
    if (req.body.remove_image === '1') {
      // Elimina il file fisico se è un upload locale
      if (existing.image_path && existing.image_path.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '..', existing.image_path);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      imagePath = null;
    } else if (req.file) {
      const ext = path.extname(req.file.filename);
      const newFilename = `food-${id}-${Date.now()}${ext}`;
      fs.renameSync(req.file.path, path.join(__dirname, '..', 'uploads', newFilename));
      imagePath = `/uploads/${newFilename}`;
    } else if (image_url) {
      imagePath = image_url;
    }

    await db.run(
      `UPDATE foods SET name=?, brand=?, kcal_100g=?, protein_100g=?, fat_100g=?, carbs_100g=?,
       portions=?, barcode=?, image_path=?,
       components=?, recipe_yield_g=?, is_quick=0, updated_at=datetime('now') WHERE id=?`,
      name || existing.name,
      brand !== undefined ? brand : existing.brand,
      macros.kcal_100g, macros.protein_100g, macros.fat_100g, macros.carbs_100g,
      portionsJson,
      barcode !== undefined ? barcode : existing.barcode,
      imagePath,
      componentsJson, yieldG,
      id
    );

    const food = await db.get('SELECT * FROM foods WHERE id = ?', id);
    res.json(deserializeFood(food));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// GET /api/foods/:id/diary-count
router.get('/:id/diary-count', async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get(
      'SELECT COUNT(*) AS count FROM diary_entries WHERE food_id = ?',
      req.params.id
    );
    res.json({ count: row ? row.count : 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// DELETE /api/foods/:id  (soft delete: mantiene i dati per le voci del diario)
router.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const food = await db.get('SELECT * FROM foods WHERE id = ?', req.params.id);
    if (!food) return res.status(404).json({ error: 'Alimento non trovato' });

    // Controlla se l'alimento è usato in qualche voce del diario
    const usedInDiary = await db.get(
      'SELECT id FROM diary_entries WHERE food_id = ? LIMIT 1', req.params.id
    );

    if (usedInDiary) {
      // Soft delete: l'alimento resta nel DB per preservare le voci del diario
      await db.run("UPDATE foods SET deleted_at = datetime('now') WHERE id = ?", req.params.id);
    } else {
      // Hard delete: nessuna voce di diario lo usa, elimina fisicamente
      if (food.image_path && food.image_path.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '..', food.image_path);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      await db.run('DELETE FROM foods WHERE id = ?', req.params.id);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore del server' });
  }
});

// ── Import da Catalogo locale (food-tracker) ────────────────────────────────
const CATALOG_BASE = process.env.CATALOG_URL || 'http://192.168.68.153:3001';

// POST /api/foods/import-catalog
router.post('/import-catalog', async (req, res) => {
  const { query, barcode } = req.body;
  if (!query && !barcode) return res.status(400).json({ error: 'Fornisci query o barcode' });

  try {
    const fetch = (await import('node-fetch')).default;
    let url;

    if (barcode) {
      url = `${CATALOG_BASE}/product/${encodeURIComponent(barcode)}`;
    } else {
      url = `${CATALOG_BASE}/search?q=${encodeURIComponent(query)}&limit=100`;
    }

    const resp = await fetch(url, { timeout: 10000 });

    if (barcode) {
      // /product/{barcode} restituisce un singolo oggetto (o 404)
      if (resp.status === 404) return res.json([]);
      if (!resp.ok) return res.status(502).json({ error: 'Catalogo non raggiungibile' });
      const product = await resp.json();
      const mapped = mapCatalogProduct(product);
      return res.json(mapped ? [mapped] : []);
    }

    // /search restituisce { results: [...], total, ... }
    if (!resp.ok) return res.status(502).json({ error: 'Catalogo non raggiungibile' });
    const data = await resp.json();
    const products = (data.results || []).filter(p => p.product_name);
    const mapped = products.map(mapCatalogProduct).filter(Boolean);
    res.json(mapped);
  } catch (err) {
    console.error('Catalog search error:', err);
    res.status(500).json({ error: 'Errore nella ricerca sul catalogo locale' });
  }
});

function mapCatalogProduct(p) {
  if (!p || !p.product_name) return null;
  // L'immagine può essere un path locale del food-tracker o un URL completo
  let imageUrl = p.image_url || '';
  if (imageUrl && !imageUrl.startsWith('http')) {
    imageUrl = CATALOG_BASE + imageUrl;
  }
  // Proxy attraverso Food Diary per evitare problemi di rete locale su mobile
  if (imageUrl) {
    imageUrl = `/api/foods/proxy-image?url=${encodeURIComponent(imageUrl)}`;
  }
  return {
    name:         p.product_name,
    brand:        p.brands || '',
    barcode:      p.external_id || '',
    kcal_100g:    p.energy_kcal || 0,
    protein_100g: p.proteins_100g || 0,
    fat_100g:     p.fat_100g || 0,
    carbs_100g:   p.carbohydrates_100g || 0,
    image_url:    imageUrl,
    source:       p.source || '',
    nutriscore:   p.nutrition_grades || '',
  };
}


module.exports = router;
