/* ==========================================
   foods.js — Tab Alimenti: CRUD + import catalogo Food Tracker
   ========================================== */

window.FoodsTab = (() => {
  let allFoods = [];
  let editingId = null;
  let searchTimeout = null;

  // ── Refresh ─────────────────────────────
  async function refresh(q = '') {
    let url;
    if (!q) {
      url = '/api/foods?limit=100';
    } else if (/^\d{8,14}$/.test(q)) {
      url = `/api/foods?barcode=${encodeURIComponent(q)}&include_quick=1`;
    } else {
      url = `/api/foods?q=${encodeURIComponent(q)}&limit=100`;
    }
    const foods = await apiGet(url);
    allFoods = foods || [];
    renderList(allFoods);
  }

  function renderList(foods) {
    const container = document.getElementById('foods-list');
    if (foods.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">🥗</div>
          <p>Nessun alimento nel database.<br>Aggiungine uno con il pulsante "Nuovo".</p>
        </div>`;
      return;
    }

    container.innerHTML = foods.map(f => `
      <div class="food-card">
        ${f.image_path
          ? `<img class="catalog-result-img" src="${f.image_path}" alt="" loading="lazy">`
          : `<div class="catalog-result-img-placeholder">🥗</div>`}
        <div class="catalog-result-info">
          <div class="catalog-result-name">${f.name}</div>
          ${f.brand ? `<div class="catalog-result-brand">${f.brand}</div>` : ''}
          <div class="catalog-result-macros">${Math.round(f.kcal_100g)} kcal · P:${fmt(f.protein_100g)}g G:${fmt(f.fat_100g)}g C:${fmt(f.carbs_100g)}g</div>
          <div class="catalog-result-source">${formatSource(f.source)}${f.barcode ? ' · ' + f.barcode : ''}</div>
        </div>
        <div class="food-card-actions">
          <button class="btn-icon btn-edit-food" data-id="${f.id}" title="Modifica" style="color:var(--color-primary)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon btn-del-food" data-id="${f.id}" data-name="${f.name}" title="Elimina" style="color:var(--color-danger)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.btn-edit-food').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); openFoodForm(parseInt(btn.dataset.id)); });
    });

    container.querySelectorAll('.btn-del-food').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); deleteFood(parseInt(btn.dataset.id), btn.dataset.name); });
    });

    container.querySelectorAll('.food-card').forEach(card => {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        const editBtn = card.querySelector('.btn-edit-food');
        if (editBtn) openFoodForm(parseInt(editBtn.dataset.id));
      });
    });
  }

  // ── Search ──────────────────────────────
  document.getElementById('foods-search').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    searchTimeout = setTimeout(() => refresh(q), 300);
  });

  // ── Delete ──────────────────────────────
  async function deleteFood(id, name) {
    const countRes = await apiGet(`/api/foods/${id}/diary-count`);
    const count = countRes ? countRes.count : 0;
    const detail = count > 0
      ? `ℹ️ È presente in <strong>${count} ${count === 1 ? 'voce' : 'voci'}</strong> del diario. Le voci esistenti verranno preservate, l'alimento verrà rimosso solo dalla libreria.`
      : 'Non è presente in nessuna voce del diario.';
    const confirmed = await showConfirm('Elimina alimento', `Vuoi eliminare "<strong>${name}</strong>"?<br><br>${detail}`);
    if (!confirmed) return;
    const res = await apiDelete(`/api/foods/${id}`);
    if (res && !res.error) {
      refresh(document.getElementById('foods-search').value.trim());
    }
  }

  // ── Food form modal ──────────────────────
  let _onFoodSaved = null; // callback opzionale(food) dopo salvataggio

  function openFoodForm(id = null, { prefillName = '', onSaved = null } = {}) {
    editingId = id;
    _onFoodSaved = onSaved || null;
    const titleEl = document.getElementById('food-form-title');
    titleEl.textContent = id ? 'Modifica alimento' : 'Nuovo alimento';

    // Reset form
    document.getElementById('food-form').reset();
    document.getElementById('food-form-id').value = '';
    document.getElementById('ff-image-url').value = '';
    document.getElementById('ff-source').value = 'app';
    document.getElementById('ff-image-preview').classList.add('hidden');
    document.getElementById('ff-image-preview').dataset.removed = '';
    _croppedBlob = null;
    document.getElementById('portions-list').innerHTML = '';
    document.getElementById('ff-portions-nutrition').classList.add('hidden');
    document.getElementById('ff-portions-nutrition-list').innerHTML = '';
    document.getElementById('food-form-msg').classList.add('hidden');
    // Reset ricetta
    recipeIngredients = [];
    setRecipeMode(false);
    document.getElementById('ff-ingredients-list').innerHTML = '';
    document.getElementById('ff-recipe-totals').classList.add('hidden');
    document.getElementById('ff-recipe-yield').value = '';

    if (id) {
      const food = allFoods.find(f => f.id === id);
      if (food) fillFoodForm(food);
    } else if (prefillName) {
      document.getElementById('ff-name').value = prefillName;
    }

    document.getElementById('modal-food-form').classList.remove('hidden');
  }

  function fillFoodForm(food) {
    document.getElementById('food-form-id').value = food.id;
    document.getElementById('ff-name').value = food.name || '';
    document.getElementById('ff-brand').value = food.brand || '';
    document.getElementById('ff-barcode').value = food.barcode || '';
    document.getElementById('ff-kcal').value = food.kcal_100g || 0;
    document.getElementById('ff-protein').value = food.protein_100g || 0;
    document.getElementById('ff-fat').value = food.fat_100g || 0;
    document.getElementById('ff-carbs').value = food.carbs_100g || 0;
    document.getElementById('ff-image-url').value = food.image_path || '';
    document.getElementById('ff-source').value = food.source || 'app';

    if (food.image_path) {
      document.getElementById('ff-preview-img').src = food.image_path;
      document.getElementById('ff-image-preview').classList.remove('hidden');
    }

    (food.portions || []).forEach(p => addPortionRow(p.name, p.grams));

    // Ricetta
    const components = food.components || [];
    if (components.length > 0) {
      // Carica i dettagli nutrizionali di ciascun componente
      (async () => {
        recipeIngredients = [];
        for (const c of components) {
          const f = await apiGet(`/api/foods/${c.food_id}`);
          if (f) recipeIngredients.push({
            food_id: c.food_id, name: f.name, quantity_g: c.quantity_g,
            kcal_100g: f.kcal_100g, protein_100g: f.protein_100g,
            fat_100g: f.fat_100g, carbs_100g: f.carbs_100g,
          });
        }
        if (food.recipe_yield_g) document.getElementById('ff-recipe-yield').value = food.recipe_yield_g;
        setRecipeMode(true);
        renderIngredients();
      })();
    }
  }

  function closeFoodForm() {
    document.getElementById('modal-food-form').classList.add('hidden');
    editingId = null;
  }

  document.getElementById('modal-food-form-close').addEventListener('click', closeFoodForm);
  document.getElementById('modal-food-form-backdrop').addEventListener('click', closeFoodForm);
  document.getElementById('btn-cancel-food').addEventListener('click', closeFoodForm);
  document.getElementById('btn-new-food').addEventListener('click', () => openFoodForm());

  // ── Scanner barcode nel form alimento ────────────────────────────────────
  (function initFfBarcodeScanner() {
    const scanBtn     = document.getElementById('btn-ff-scan-barcode');
    const scanFileBtn = document.getElementById('btn-ff-scan-barcode-file');
    const fileInput   = document.getElementById('ff-barcode-file-input');
    const wrap        = document.getElementById('ff-barcode-scanner-wrap');
    const readerEl    = document.getElementById('ff-barcode-reader');
    const stopBtn     = document.getElementById('btn-ff-stop-scan');
    let ffScanner     = null;
    let ffRunning     = false;

    function onBarcodeResult(text) {
      document.getElementById('ff-barcode').value = text;
      stopFfScanner();
    }

    function stopFfScanner() {
      if (ffScanner && ffRunning) {
        ffScanner.stop().catch(() => {}).finally(() => {
          ffRunning = false;
          ffScanner = null;
          window.ScannerConfig.removeTorch(wrap);
          wrap.classList.add('hidden');
        });
      } else {
        wrap.classList.add('hidden');
      }
    }

    scanBtn.addEventListener('click', () => {
      if (ffRunning) return;
      window.ScannerConfig.removeTorch(wrap);
      readerEl.innerHTML = '';
      wrap.classList.remove('hidden');
      ffScanner = new Html5Qrcode('ff-barcode-reader');
      ffRunning = true;
      ffScanner.start(
        window.ScannerConfig.CAMERA_CONSTRAINTS,
        window.ScannerConfig.SCAN_CONFIG,
        (text) => onBarcodeResult(text),
        () => {}
      ).then(() => {
        window.ScannerConfig.initTorch(ffScanner, wrap);
      }).catch(err => {
        ffRunning = false; ffScanner = null;
        wrap.classList.add('hidden');
        console.warn('Webcam non disponibile nel form:', err);
        scanBtn.classList.add('hidden');
        scanFileBtn.classList.remove('hidden');
      });
    });

    stopBtn.addEventListener('click', stopFfScanner);

    // Fallback file input (iOS)
    scanFileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      fileInput.value = '';
      try {
        const qr = new Html5Qrcode('ff-barcode-reader', {
          formatsToSupport: window.ScannerConfig.SCAN_CONFIG.formatsToSupport,
          verbose: false,
        });
        const result = await qr.scanFile(file, false);
        onBarcodeResult(result);
      } catch (e) {
        alert('Barcode non riconosciuto. Riprova con una foto più nitida.');
      }
    });
  })();

  // ── Crop immagine ────────────────────────────────────────────────────────
  let _cropper = null;
  let _croppedBlob = null;

  function openCropModal(dataUrl) {
    const modal   = document.getElementById('modal-crop');
    const cropImg = document.getElementById('crop-image');
    if (_cropper) { _cropper.destroy(); _cropper = null; }
    cropImg.src = dataUrl;
    modal.classList.remove('hidden');
    cropImg.onload = () => {
      _cropper = new Cropper(cropImg, {
        aspectRatio: 1,
        viewMode: 1,
        autoCropArea: 0.9,
        movable: true,
        zoomable: true,
        rotatable: false,
        scalable: false,
        guides: true,
        background: false,
      });
    };
  }

  document.getElementById('btn-crop-cancel').addEventListener('click', () => {
    document.getElementById('modal-crop').classList.add('hidden');
    if (_cropper) { _cropper.destroy(); _cropper = null; }
    document.getElementById('ff-image').value = '';
  });

  document.getElementById('btn-crop-confirm').addEventListener('click', () => {
    if (!_cropper) return;
    const canvas = _cropper.getCroppedCanvas({ width: 600, height: 600, imageSmoothingQuality: 'high' });
    canvas.toBlob((blob) => {
      _croppedBlob = blob;
      const url = URL.createObjectURL(blob);
      document.getElementById('ff-preview-img').src = url;
      document.getElementById('ff-image-preview').classList.remove('hidden');
      document.getElementById('ff-image-preview').dataset.removed = '';
      document.getElementById('modal-crop').classList.add('hidden');
      _cropper.destroy(); _cropper = null;
    }, 'image/jpeg', 0.88);
  });

  // Image preview — mostra anteprima direttamente (crop disabilitato per compatibilità iOS)
  document.getElementById('ff-image').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    _croppedBlob = null;
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('ff-preview-img').src = ev.target.result;
      document.getElementById('ff-image-preview').classList.remove('hidden');
      document.getElementById('ff-image-preview').dataset.removed = '';
    };
    reader.readAsDataURL(file);
  });

  // Rimuovi foto
  document.getElementById('btn-remove-image').addEventListener('click', () => {
    document.getElementById('ff-image').value = '';
    document.getElementById('ff-image-url').value = '';
    document.getElementById('ff-preview-img').src = '';
    document.getElementById('ff-image-preview').classList.add('hidden');
    document.getElementById('ff-image-preview').dataset.removed = '1';
  });

  // ── Valori per porzione ──────────────────────────────────────────────────
  function updatePortionsNutrition() {
    const kcal    = parseFloat(document.getElementById('ff-kcal').value)    || 0;
    const protein = parseFloat(document.getElementById('ff-protein').value) || 0;
    const fat     = parseFloat(document.getElementById('ff-fat').value)     || 0;
    const carbs   = parseFloat(document.getElementById('ff-carbs').value)   || 0;

    const rows = document.querySelectorAll('#portions-list .portion-row');
    const portions = [];
    rows.forEach(row => {
      const name  = row.querySelector('.portion-name').value.trim();
      const grams = parseFloat(row.querySelector('.portion-grams').value) || 0;
      if (name && grams > 0) portions.push({ name, grams });
    });

    const container = document.getElementById('ff-portions-nutrition');
    const listEl    = document.getElementById('ff-portions-nutrition-list');

    if (portions.length === 0) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');
    listEl.innerHTML = portions.map(p => {
      const k = Math.round((kcal    / 100) * p.grams * 10) / 10;
      const pr = Math.round((protein / 100) * p.grams * 10) / 10;
      const f  = Math.round((fat     / 100) * p.grams * 10) / 10;
      const c  = Math.round((carbs   / 100) * p.grams * 10) / 10;
      return `
        <div class="portion-nutrition-row">
          <div class="pnr-label">1 ${p.name} <span class="pnr-grams">(${p.grams}g)</span></div>
          <div class="pnr-values">
            <span class="pnr-kcal">⚡ ${k} kcal</span>
            <span>P: ${pr}g</span>
            <span>G: ${f}g</span>
            <span>C: ${c}g</span>
          </div>
        </div>`;
    }).join('');
  }

  // Portions
  function addPortionRow(name = '', grams = '') {
    const div = document.createElement('div');
    div.className = 'portion-row';
    div.innerHTML = `
      <input type="text" placeholder="Nome (es. cucchiaio)" value="${name}" class="portion-name">
      <input type="number" placeholder="Grammi" value="${grams}" min="0.1" step="0.1" class="portion-grams" style="max-width:90px">
      <button type="button" class="btn-remove-portion">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    div.querySelector('.btn-remove-portion').addEventListener('click', () => {
      div.remove();
      updatePortionsNutrition();
    });
    // Aggiorna preview al cambio nome o grammi
    div.querySelector('.portion-name').addEventListener('input', updatePortionsNutrition);
    div.querySelector('.portion-grams').addEventListener('input', updatePortionsNutrition);
    document.getElementById('portions-list').appendChild(div);
    updatePortionsNutrition();
  }

  // Aggiorna anche quando cambiano i valori nutrizionali
  ['ff-kcal','ff-protein','ff-fat','ff-carbs'].forEach(id => {
    document.getElementById(id).addEventListener('input', updatePortionsNutrition);
  });

  document.getElementById('btn-add-portion').addEventListener('click', () => addPortionRow());

  // ── Ricetta / Alimento composto ──────────────────────────────────────────
  let recipeIngredients = []; // [{food_id, name, quantity_g, kcal_100g, protein_100g, fat_100g, carbs_100g}]
  let ingSearchTimeout = null;

  const recipeToggle  = document.getElementById('ff-recipe-toggle');
  const recipeSection = document.getElementById('ff-recipe-section');
  const nutritionFields = document.getElementById('ff-nutrition-fields');
  const nutritionTitle  = document.getElementById('ff-nutrition-title');

  function setRecipeMode(on) {
    recipeToggle.checked = on;
    recipeSection.classList.toggle('hidden', !on);
    if (on) {
      nutritionTitle.textContent = 'Valori per 100g (calcolati automaticamente)';
      nutritionFields.classList.add('ff-nutrition-readonly');
    } else {
      nutritionTitle.textContent = 'Valori nutrizionali per 100g';
      nutritionFields.classList.remove('ff-nutrition-readonly');
    }
  }

  recipeToggle.addEventListener('change', () => setRecipeMode(recipeToggle.checked));

  // Ricerca ingrediente
  const ingSearchInput = document.getElementById('ff-ing-search');
  const ingResultsEl   = document.getElementById('ff-ing-results');

  ingSearchInput.addEventListener('input', () => {
    clearTimeout(ingSearchTimeout);
    const q = ingSearchInput.value.trim();
    if (q.length < 2) { ingResultsEl.innerHTML = ''; return; }
    ingSearchTimeout = setTimeout(async () => {
      const foods = await apiGet(`/api/foods?q=${encodeURIComponent(q)}&limit=20`);
      if (!foods) return;
      ingResultsEl.innerHTML = foods.map(f => `
        <div class="search-result-item" data-id="${f.id}" data-name="${f.name.replace(/"/g,'&quot;')}"
          data-kcal="${f.kcal_100g}" data-protein="${f.protein_100g}"
          data-fat="${f.fat_100g}" data-carbs="${f.carbs_100g}">
          <div class="sri-info">
            <div class="sri-name">${f.name}</div>
            <div class="sri-detail">${Math.round(f.kcal_100g)} kcal/100g</div>
          </div>
        </div>
      `).join('');
      ingResultsEl.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          const qty = parseFloat(document.getElementById('ff-ing-qty').value) || 100;
          recipeIngredients.push({
            food_id:      parseInt(item.dataset.id),
            name:         item.dataset.name,
            quantity_g:   qty,
            kcal_100g:    parseFloat(item.dataset.kcal),
            protein_100g: parseFloat(item.dataset.protein),
            fat_100g:     parseFloat(item.dataset.fat),
            carbs_100g:   parseFloat(item.dataset.carbs),
          });
          ingSearchInput.value = '';
          ingResultsEl.innerHTML = '';
          renderIngredients();
        });
      });
    }, 280);
  });

  // Chiudi risultati cliccando fuori
  document.addEventListener('click', (e) => {
    if (!ingSearchInput.contains(e.target) && !ingResultsEl.contains(e.target))
      ingResultsEl.innerHTML = '';
  });

  function renderIngredients() {
    const listEl = document.getElementById('ff-ingredients-list');
    const totalsEl = document.getElementById('ff-recipe-totals');

    if (recipeIngredients.length === 0) {
      listEl.innerHTML = '<p style="font-size:0.83rem;color:var(--color-text-secondary);text-align:center;padding:8px 0">Nessun ingrediente aggiunto</p>';
      totalsEl.classList.add('hidden');
      return;
    }

    listEl.innerHTML = recipeIngredients.map((ing, i) => {
      const kcalTot = (ing.kcal_100g / 100) * ing.quantity_g;
      return `
        <div class="ingredient-row" data-idx="${i}">
          <span class="ing-name">${ing.name}</span>
          <input type="number" class="ing-qty-input form-control" value="${ing.quantity_g}"
            min="1" step="1" style="width:72px;text-align:right;padding:4px 6px;font-size:0.85rem" data-idx="${i}">
          <span style="font-size:0.78rem;color:var(--color-text-secondary)">g</span>
          <span class="ing-kcal">${Math.round(kcalTot)} kcal</span>
          <button type="button" class="btn-icon btn-remove-ing" data-idx="${i}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.btn-remove-ing').forEach(btn => {
      btn.addEventListener('click', () => {
        recipeIngredients.splice(parseInt(btn.dataset.idx), 1);
        renderIngredients();
      });
    });

    listEl.querySelectorAll('.ing-qty-input').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx);
        recipeIngredients[idx].quantity_g = parseFloat(input.value) || 1;
        renderIngredients();
      });
    });

    updateRecipeTotals();
    totalsEl.classList.remove('hidden');
  }

  function updateRecipeTotals() {
    let totalWeight = 0, totalKcal = 0, totalP = 0, totalF = 0, totalC = 0;
    for (const ing of recipeIngredients) {
      const q = ing.quantity_g;
      totalWeight  += q;
      totalKcal    += (ing.kcal_100g    / 100) * q;
      totalP       += (ing.protein_100g / 100) * q;
      totalF       += (ing.fat_100g     / 100) * q;
      totalC       += (ing.carbs_100g   / 100) * q;
    }

    const yieldInput = document.getElementById('ff-recipe-yield');
    const yieldG = parseFloat(yieldInput.value) || totalWeight || 1;

    document.getElementById('ff-recipe-total-weight').textContent =
      `Peso totale ingredienti: ${Math.round(totalWeight)}g`;
    document.getElementById('rt-kcal').textContent    = `⚡ ${Math.round(totalKcal)} kcal`;
    document.getElementById('rt-protein').textContent = `P: ${fmt(totalP)}g`;
    document.getElementById('rt-fat').textContent     = `G: ${fmt(totalF)}g`;
    document.getElementById('rt-carbs').textContent   = `C: ${fmt(totalC)}g`;

    const p100 = {
      kcal:    Math.round((totalKcal / yieldG) * 100 * 10) / 10,
      protein: Math.round((totalP    / yieldG) * 100 * 10) / 10,
      fat:     Math.round((totalF    / yieldG) * 100 * 10) / 10,
      carbs:   Math.round((totalC    / yieldG) * 100 * 10) / 10,
    };
    document.getElementById('rt-per100g').textContent =
      `${p100.kcal} kcal · P:${p100.protein}g G:${p100.fat}g C:${p100.carbs}g`;

    // Aggiorna i campi read-only
    document.getElementById('ff-kcal').value    = p100.kcal;
    document.getElementById('ff-protein').value = p100.protein;
    document.getElementById('ff-fat').value     = p100.fat;
    document.getElementById('ff-carbs').value   = p100.carbs;
    updatePortionsNutrition();
  }

  document.getElementById('ff-recipe-yield').addEventListener('input', () => {
    if (recipeIngredients.length > 0) updateRecipeTotals();
  });

  // Submit form
  document.getElementById('food-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('food-form-msg');
    msgEl.classList.add('hidden');

    // Raccoglie porzioni
    const portions = [];
    document.querySelectorAll('#portions-list .portion-row').forEach(row => {
      const name = row.querySelector('.portion-name').value.trim();
      const grams = parseFloat(row.querySelector('.portion-grams').value);
      if (name && grams > 0) portions.push({ name, grams });
    });

    const formData = new FormData();
    formData.append('name', document.getElementById('ff-name').value.trim());
    formData.append('brand', document.getElementById('ff-brand').value.trim());
    formData.append('barcode', document.getElementById('ff-barcode').value.trim());
    formData.append('kcal_100g', document.getElementById('ff-kcal').value);
    formData.append('protein_100g', document.getElementById('ff-protein').value);
    formData.append('fat_100g', document.getElementById('ff-fat').value);
    formData.append('carbs_100g', document.getElementById('ff-carbs').value);
    formData.append('portions', JSON.stringify(portions));
    formData.append('source', document.getElementById('ff-source').value || 'app');

    // Ricetta
    if (recipeToggle.checked && recipeIngredients.length > 0) {
      formData.append('components', JSON.stringify(
        recipeIngredients.map(i => ({ food_id: i.food_id, quantity_g: i.quantity_g }))
      ));
      const yieldVal = document.getElementById('ff-recipe-yield').value;
      if (yieldVal) formData.append('recipe_yield_g', yieldVal);
    } else {
      formData.append('components', '[]');
    }

    const imagePreview = document.getElementById('ff-image-preview');
    const imageRemoved = imagePreview.dataset.removed === '1';

    if (imageRemoved) {
      formData.append('remove_image', '1');
    } else {
      const imageUrl = document.getElementById('ff-image-url').value;
      if (imageUrl) formData.append('image_url', imageUrl);

      if (_croppedBlob) {
        formData.append('image', _croppedBlob, 'photo.jpg');
      } else {
        const imageFile = document.getElementById('ff-image').files[0];
        if (imageFile) formData.append('image', imageFile);
      }
    }

    const id = document.getElementById('food-form-id').value;
    const url = id ? `/api/foods/${id}` : '/api/foods';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, { method, body: formData });
    const data = await res.json();

    if (!res.ok) {
      showMsg(msgEl, data.error || 'Errore durante il salvataggio', 'error');
      return;
    }

    closeFoodForm();
    if (_onFoodSaved) {
      const cb = _onFoodSaved;
      _onFoodSaved = null;
      cb(data);
    } else {
      refresh(document.getElementById('foods-search').value.trim());
    }
  });

  // ── Import Catalogo locale (food-tracker) ──────────────────────────────────
  const toolbar = document.querySelector('.foods-toolbar');

  const catalogBtn = document.createElement('button');
  catalogBtn.id = 'btn-import-catalog';
  catalogBtn.className = 'btn btn-outline btn-sm';
  catalogBtn.title = 'Cerca nel catalogo locale (265K+ prodotti)';
  catalogBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;vertical-align:-2px"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> Catalogo`;
  toolbar.insertBefore(catalogBtn, document.getElementById('btn-new-food'));

  catalogBtn.addEventListener('click', () => {
    document.getElementById('catalog-query').value = '';
    document.getElementById('catalog-results').innerHTML = '';
    document.getElementById('modal-catalog').classList.remove('hidden');
    setTimeout(() => document.getElementById('catalog-query').focus(), 100);
  });

  const closeCatalogModal = () => {
    document.getElementById('modal-catalog').classList.add('hidden');
  };
  document.getElementById('modal-catalog-close').addEventListener('click', closeCatalogModal);

  document.getElementById('catalog-query').addEventListener('keydown', e => { if (e.key === 'Enter') searchCatalog(); });

  // Ricerca predittiva catalogo (4+ caratteri)
  let catalogSearchTimeout = null;
  document.getElementById('catalog-query').addEventListener('input', (e) => {
    clearTimeout(catalogSearchTimeout);
    const q = e.target.value.trim();
    if (q.length < 4) {
      if (q.length === 0) document.getElementById('catalog-results').innerHTML = '';
      return;
    }
    catalogSearchTimeout = setTimeout(() => searchCatalog(), 400);
  });

  async function searchCatalog() {
    const q = document.getElementById('catalog-query').value.trim();
    if (!q) return;

    const resultsEl = document.getElementById('catalog-results');
    resultsEl.innerHTML = '<div class="spinner"></div>';

    // Determina se è un barcode
    const isBarcode = /^\d{8,14}$/.test(q);
    const body = isBarcode ? { barcode: q } : { query: q };

    const res = await fetch('/api/foods/import-catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null);
      resultsEl.innerHTML = `<div class="empty-state"><p>${err?.error || 'Errore nella ricerca.'}</p></div>`;
      return;
    }

    const products = await res.json();
    if (!products.length) {
      resultsEl.innerHTML = '<div class="empty-state"><p>Nessun prodotto trovato nel catalogo.</p></div>';
      return;
    }

    // Ordina per sorgente: APP > CREA > OFF
    const sourceOrder = { app: 0, crea: 1 };
    products.sort((a, b) => (sourceOrder[a.source] ?? 2) - (sourceOrder[b.source] ?? 2));

    // Barcodes già presenti nel DB locale
    const localBarcodes = new Set(allFoods.filter(f => f.barcode).map(f => f.barcode));

    resultsEl.innerHTML = products.map((p, i) => {
      const inDb = p.barcode && localBarcodes.has(p.barcode);
      const action = inDb
        ? `<span style="font-size:0.75rem;color:var(--color-primary);font-weight:600;white-space:nowrap">✓ Già presente</span>`
        : `<button class="btn btn-primary btn-sm btn-catalog-import" data-idx="${i}">Importa</button>`;
      return `
        <div class="catalog-result-item">
          ${p.image_url ? `<img src="${p.image_url}" alt="" loading="lazy">` : '<div style="width:50px;height:50px;border-radius:8px;background:var(--color-border);flex-shrink:0"></div>'}
          <div class="catalog-result-info">
            <div class="catalog-result-name">${p.name}</div>
            ${p.brand ? `<div class="catalog-result-brand">${p.brand}</div>` : ''}
            <div class="catalog-result-macros">${Math.round(p.kcal_100g)} kcal · P:${fmt(p.protein_100g)}g G:${fmt(p.fat_100g)}g C:${fmt(p.carbs_100g)}g</div>
            <div style="font-size:0.7rem;color:var(--color-text-secondary);margin-top:2px">
              ${p.source === 'crea' ? 'CREA' : p.source === 'app' ? 'APP' : 'OpenFoodFacts'}${p.barcode ? ' · ' + p.barcode : ''}${p.nutriscore ? ' · Nutriscore ' + p.nutriscore.toUpperCase() : ''}
            </div>
          </div>
          ${action}
        </div>`;
    }).join('');

    resultsEl.querySelectorAll('.btn-catalog-import').forEach(btn => {
      btn.addEventListener('click', () => {
        const product = products[parseInt(btn.dataset.idx)];
        closeCatalogModal();
        openFoodFormWithData(product);
      });
    });
  }


  function openFoodFormWithData(product, { onSaved = null } = {}) {
    openFoodForm(null, { onSaved });
    document.getElementById('ff-name').value = product.name || '';
    document.getElementById('ff-brand').value = product.brand || '';
    document.getElementById('ff-barcode').value = product.barcode || '';
    document.getElementById('ff-kcal').value = product.kcal_100g || 0;
    document.getElementById('ff-protein').value = product.protein_100g || 0;
    document.getElementById('ff-fat').value = product.fat_100g || 0;
    document.getElementById('ff-carbs').value = product.carbs_100g || 0;
    document.getElementById('ff-source').value = product.source || 'app';

    if (product.image_url) {
      document.getElementById('ff-image-url').value = product.image_url;
      document.getElementById('ff-preview-img').src = product.image_url;
      document.getElementById('ff-image-preview').classList.remove('hidden');
    }
  }

  // ── Barcode scanner (tab Alimenti) ───────────────────────────────────────
  let _foodsScanner = null;
  let _foodsScannerRunning = false;

  document.getElementById('btn-scan-barcode-foods').addEventListener('click', () => {
    if (_foodsScannerRunning) return;
    const wrap = document.getElementById('barcode-scanner-foods-wrap');
    const readerEl = document.getElementById('barcode-reader-foods');
    readerEl.innerHTML = '';
    wrap.classList.remove('hidden');

    _foodsScanner = new Html5Qrcode('barcode-reader-foods');
    _foodsScannerRunning = true;

    _foodsScanner.start(
      window.ScannerConfig.CAMERA_CONSTRAINTS,
      window.ScannerConfig.SCAN_CONFIG,
      async (barcode) => {
        _foodsScannerRunning = false;
        wrap.classList.add('hidden');
        _foodsScanner.stop().catch(() => {}).finally(() => { _foodsScanner = null; });
        await _handleFoodBarcode(barcode);
      },
      () => {}
    ).catch(err => {
      _foodsScannerRunning = false;
      _foodsScanner = null;
      wrap.classList.add('hidden');
      console.warn('Webcam non disponibile, uso fallback file:', err);
      document.getElementById('barcode-file-input-foods').click();
    });
  });

  document.getElementById('btn-stop-scan-foods').addEventListener('click', () => {
    if (_foodsScanner && _foodsScannerRunning) {
      _foodsScannerRunning = false;
      _foodsScanner.stop().catch(() => {}).finally(() => {
        _foodsScanner = null;
        document.getElementById('barcode-scanner-foods-wrap').classList.add('hidden');
      });
    }
  });

  document.getElementById('barcode-file-input-foods').addEventListener('change', async () => {
    const input = document.getElementById('barcode-file-input-foods');
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    try {
      const qr = new Html5Qrcode('barcode-reader-foods', { verbose: false });
      const result = await qr.scanFile(file, false);
      await _handleFoodBarcode(result);
    } catch (e) {
      alert('Barcode non riconosciuto nell\'immagine. Riprova con una foto più nitida.');
    }
  });

  async function _handleFoodBarcode(barcode) {
    // 1. Cerca nel DB locale (include anche is_quick — il PUT promuoverà a food reale)
    const local = await apiGet(`/api/foods?barcode=${encodeURIComponent(barcode)}&include_quick=1`);
    if (local && local.length > 0) {
      openFoodForm(local[0].id);
      fillFoodForm(local[0]); // garantisce i campi anche se allFoods è vuoto
      return;
    }

    // 2. Cerca nel catalogo Food Tracker
    try {
      const res = await fetch('/api/foods/import-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode })
      });
      if (res.ok) {
        const products = await res.json();
        if (products.length > 0) {
          openFoodFormWithData(products[0]);
          return;
        }
      }
    } catch (e) {
      console.warn('Catalog lookup error:', e);
    }

    // 3. Non trovato
    const container = document.getElementById('foods-list');
    container.innerHTML = `<div class="empty-state"><p>Barcode <strong>${barcode}</strong> non trovato nel catalogo.</p></div>`;
  }

  return { refresh, openFoodForm, openFoodFormWithData };
})();
