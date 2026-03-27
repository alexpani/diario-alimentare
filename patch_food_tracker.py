#!/usr/bin/env python3
"""
Aggiunge endpoint POST /product (upsert) a Food Tracker.

Deploy:
  scp patch_food_tracker.py root@192.168.68.153:/tmp/
  ssh root@192.168.68.153 "docker cp /tmp/patch_food_tracker.py food-tracker:/tmp/ && docker exec food-tracker python3 /tmp/patch_food_tracker.py && docker restart food-tracker"
"""

MAIN_PY = '/app/main.py'
PATCH_MARKER = '# ── FoodDiary sync patch ──'

with open(MAIN_PY, 'r') as f:
    content = f.read()

if PATCH_MARKER in content:
    print('Patch già applicata.')
    exit(0)

NEW_CODE = '''

# ── FoodDiary sync patch ─────────────────────────────────────────────────────
import sqlite3 as _sqlite3
from pydantic import BaseModel as _BaseModel
from typing import Optional as _Optional

_DB_PATH = '/data/foods.db'

class _UpsertRequest(_BaseModel):
    external_id: _Optional[str] = None
    product_name: str
    brands: _Optional[str] = None
    source: str = "app"
    energy_kcal: _Optional[float] = None
    proteins_100g: _Optional[float] = None
    fat_100g: _Optional[float] = None
    carbohydrates_100g: _Optional[float] = None
    image_url: _Optional[str] = None

def _get_sync_db():
    conn = _sqlite3.connect(_DB_PATH)
    conn.row_factory = _sqlite3.Row
    return conn

def _fts_update(conn, rowid, product_name, old_name=None):
    """Aggiorna l\'indice FTS5 se esiste."""
    try:
        fts_tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type=\'table\' AND name LIKE \'%fts%\'"
        ).fetchall()]
        for tbl in fts_tables:
            try:
                if old_name:
                    conn.execute(f"INSERT INTO {tbl}({tbl}, rowid, product_name) VALUES(\'delete\', ?, ?)", (rowid, old_name))
                conn.execute(f"INSERT INTO {tbl}(rowid, product_name) VALUES(?, ?)", (rowid, product_name))
            except Exception:
                pass
    except Exception:
        pass

@app.post("/product", tags=["products"])
def upsert_product(req: _UpsertRequest):
    """Crea o aggiorna un prodotto. Match per external_id (barcode) se fornito."""
    conn = _get_sync_db()
    cur = conn.cursor()

    existing = None
    if req.external_id:
        existing = cur.execute(
            "SELECT id, product_name, source FROM foods WHERE external_id = ?",
            (req.external_id,)
        ).fetchone()

    if existing:
        cur.execute(
            """UPDATE foods SET product_name=?, brands=?, source=?, energy_kcal=?,
               proteins_100g=?, fat_100g=?, carbohydrates_100g=?, image_url=?,
               last_updated=datetime(\'now\') WHERE external_id=?""",
            (req.product_name, req.brands, req.source, req.energy_kcal,
             req.proteins_100g, req.fat_100g, req.carbohydrates_100g,
             req.image_url, req.external_id)
        )
        conn.commit()
        _fts_update(conn, existing[\'id\'], req.product_name, existing[\'product_name\'])
        conn.close()
        return {"action": "updated", "id": existing["id"], "external_id": req.external_id}

    cur.execute(
        """INSERT INTO foods (source, external_id, product_name, brands, energy_kcal,
           proteins_100g, fat_100g, carbohydrates_100g, image_url, last_updated)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))""",
        (req.source, req.external_id, req.product_name, req.brands,
         req.energy_kcal, req.proteins_100g, req.fat_100g,
         req.carbohydrates_100g, req.image_url)
    )
    conn.commit()
    new_id = cur.lastrowid
    _fts_update(conn, new_id, req.product_name)
    conn.close()
    return {"action": "created", "id": new_id, "external_id": req.external_id}
# ── Fine patch ───────────────────────────────────────────────────────────────
'''

with open(MAIN_PY, 'w') as f:
    f.write(content.rstrip() + '\n' + NEW_CODE)

print('Patch applicata con successo. Riavvia il container con: docker restart food-tracker')
