const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDb } = require('../database/db');
const { isAuth } = require('./auth');

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

// ── Cache in-memory per la lista alimenti INRAN/CREA ────────────────────────
let anfFoodsCache = null;
let anfCacheTimestamp = 0;
const ANF_CACHE_TTL = 60 * 60 * 1000; // 1 ora

// ── Cache in-memory per ricerche OpenFoodFacts ───────────────────────────────
const offSearchCache = new Map(); // key → { results, ts }
const OFF_CACHE_TTL = 30 * 60 * 1000; // 30 minuti
const OFF_CACHE_MAX = 100; // max query in cache

function offCacheGet(key) {
  const entry = offSearchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > OFF_CACHE_TTL) { offSearchCache.delete(key); return null; }
  return entry.results;
}

function offCacheSet(key, results) {
  if (offSearchCache.size >= OFF_CACHE_MAX) {
    // Rimuovi la entry più vecchia
    const oldest = [...offSearchCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) offSearchCache.delete(oldest[0]);
  }
  offSearchCache.set(key, { results, ts: Date.now() });
}

// Decodifica HTML entities di base
function decodeHtmlEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&agrave;/g, 'à').replace(/&egrave;/g, 'è').replace(/&eacute;/g, 'é')
    .replace(/&igrave;/g, 'ì').replace(/&ograve;/g, 'ò').replace(/&ugrave;/g, 'ù')
    .replace(/&Agrave;/g, 'À').replace(/&Egrave;/g, 'È').replace(/&Eacute;/g, 'É');
}

// GET /api/foods/import-anf/search?q=
router.get('/import-anf/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);

  try {
    const fetch = (await import('node-fetch')).default;
    const now = Date.now();

    // Aggiorna cache se scaduta
    if (!anfFoodsCache || now - anfCacheTimestamp > ANF_CACHE_TTL) {
      const resp = await fetch(
        'https://www.alimentinutrizione.it/tabelle-nutrizionali/ricerca-per-alimento',
        { headers: { 'User-Agent': 'FoodDiary/1.0' }, timeout: 15000 }
      );
      const html = await resp.text();
      // Estrai tutti i link: <a href="/tabelle-nutrizionali/000870">Nome alimento</a>
      const regex = /href="\/tabelle-nutrizionali\/(\d+)"[^>]*>([^<]+)</g;
      const foods = [];
      let m;
      while ((m = regex.exec(html)) !== null) {
        const name = decodeHtmlEntities(m[2].trim());
        if (name) foods.push({ id: m[1], name });
      }
      anfFoodsCache = foods;
      anfCacheTimestamp = now;
      console.log(`[ANF] Cache aggiornata: ${foods.length} alimenti caricati`);
    }

    const ql = q.toLowerCase();
    const results = anfFoodsCache
      .filter(f => f.name.toLowerCase().includes(ql))
      .slice(0, 25);

    res.json(results);
  } catch (err) {
    console.error('ANF search error:', err);
    res.status(500).json({ error: 'Errore nella ricerca su AlimentiNutrizione.it' });
  }
});

// GET /api/foods/import-anf/fetch/:id
router.get('/import-anf/fetch/:id', async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'ID non valido' });

  try {
    const fetch = (await import('node-fetch')).default;
    const resp = await fetch(
      `https://www.alimentinutrizione.it/tabelle-nutrizionali/${id}`,
      { headers: { 'User-Agent': 'FoodDiary/1.0' }, timeout: 15000 }
    );
    const html = await resp.text();

    // ── Nome alimento ──────────────────────────────────────────────────────
    // Il sito ha due <h1>: il primo è il titolo del sito, il secondo è il nome dell'alimento
    let name = '';
    const h1All = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)];
    const h1Target = h1All.length >= 2 ? h1All[1] : h1All[0];
    if (h1Target) name = decodeHtmlEntities(h1Target[1].replace(/<[^>]+>/g, '').trim());

    // ── Parser tabella nutrienti ───────────────────────────────────────────
    // Estrae le celle di testo da una riga <tr>
    function extractCells(rowHtml) {
      const cells = [];
      const tdPat = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let m;
      while ((m = tdPat.exec(rowHtml)) !== null) {
        cells.push(m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
      }
      return cells;
    }

    // Raccoglie tutte le righe con almeno 3 celle
    const allRows = [];
    const rowPat = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rMatch;
    while ((rMatch = rowPat.exec(html)) !== null) {
      const cells = extractCells(rMatch[1]);
      if (cells.length >= 3) allRows.push(cells);
    }

    // Cerca un nutriente: cells[0] contiene labelPart, cells[1] contiene unitPart,
    // cells[2] è il valore per 100g
    function findNutrient(labelPart, unitPart) {
      for (const cells of allRows) {
        const label = cells[0].toLowerCase();
        const unit  = (cells[1] || '').toLowerCase();
        if (label.includes(labelPart.toLowerCase())) {
          if (!unitPart || unit.includes(unitPart.toLowerCase())) {
            const raw = (cells[2] || '').replace(',', '.');
            const val = parseFloat(raw);
            if (!isNaN(val)) return val;
          }
        }
      }
      return 0;
    }

    const kcal    = findNutrient('energia',               'kcal');
    const protein = findNutrient('proteine',              'g');
    const fat     = findNutrient('lipidi',                'g');
    const carbs   = findNutrient('carboidrati disponibili', 'g');

    res.json({ id, name, kcal_100g: kcal, protein_100g: protein, fat_100g: fat, carbs_100g: carbs });
  } catch (err) {
    console.error('ANF fetch error:', err);
    res.status(500).json({ error: 'Errore nel recupero dati da AlimentiNutrizione.it' });
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
      const food = await db.get(
        'SELECT * FROM foods WHERE barcode = ?',
        req.query.barcode.trim()
      );
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
            portions, barcode, openfoodfacts_id, components, recipe_yield_g } = req.body;

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
        portions, barcode, openfoodfacts_id, components, recipe_yield_g)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      name, brand || null,
      macros.kcal_100g, macros.protein_100g, macros.fat_100g, macros.carbs_100g,
      portionsJson, barcode || null, openfoodfacts_id || null,
      componentsJson, parseFloat(recipe_yield_g) || null
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
            portions, barcode, openfoodfacts_id, image_url, components, recipe_yield_g } = req.body;

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
       portions=?, barcode=?, openfoodfacts_id=?, image_path=?,
       components=?, recipe_yield_g=?, updated_at=datetime('now') WHERE id=?`,
      name || existing.name,
      brand !== undefined ? brand : existing.brand,
      macros.kcal_100g, macros.protein_100g, macros.fat_100g, macros.carbs_100g,
      portionsJson,
      barcode !== undefined ? barcode : existing.barcode,
      openfoodfacts_id !== undefined ? openfoodfacts_id : existing.openfoodfacts_id,
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

// POST /api/foods/import-off
router.post('/import-off', async (req, res) => {
  const { query, barcode } = req.body;
  try {
    const fetch = (await import('node-fetch')).default;
    let products = [];

    if (barcode) {
      const cacheKey = `barcode:${barcode}`;
      const cached = offCacheGet(cacheKey);
      if (cached) return res.json(cached);

      const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'FoodDiary/1.0' } });
      const data = await resp.json();
      if (data.status === 1 && data.product) products = [data.product];
    } else if (query) {
      const cacheKey = `query:${query.toLowerCase().trim()}`;
      const cached = offCacheGet(cacheKey);
      if (cached) return res.json(cached);

      const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&json=1&page_size=50&fields=id,product_name,brands,nutriments,image_url,code`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'FoodDiary/1.0' } });
      const data = await resp.json();
      products = data.products || [];
    } else {
      return res.status(400).json({ error: 'Fornisci query o barcode' });
    }

    const mapped = products.filter(p => p.product_name).map(p => {
      const n = p.nutriments || {};
      return {
        openfoodfacts_id: p._id || p.id || p.code,
        name: p.product_name || '',
        brand: p.brands || '',
        kcal_100g: parseFloat(n['energy-kcal_100g'] || n['energy-kcal'] || 0),
        protein_100g: parseFloat(n['proteins_100g'] || n['proteins'] || 0),
        fat_100g: parseFloat(n['fat_100g'] || n['fat'] || 0),
        carbs_100g: parseFloat(n['carbohydrates_100g'] || n['carbohydrates'] || 0),
        barcode: p.code || p._id || '',
        image_url: p.image_url || p.image_front_url || ''
      };
    });

    const cacheKey = barcode ? `barcode:${barcode}` : `query:${query.toLowerCase().trim()}`;
    offCacheSet(cacheKey, mapped);

    res.json(mapped);
  } catch (err) {
    console.error('OpenFoodFacts error:', err);
    res.status(500).json({ error: 'Errore nel contattare OpenFoodFacts' });
  }
});

module.exports = router;
