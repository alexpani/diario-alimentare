/* ==========================================
   foods.js — Tab Alimenti: CRUD + import OFF
   ========================================== */

window.FoodsTab = (() => {
  let allFoods = [];
  let editingId = null;
  let searchTimeout = null;

  // ── Refresh ─────────────────────────────
  async function refresh(q = '') {
    const url = q ? `/api/foods?q=${encodeURIComponent(q)}&limit=100` : '/api/foods?limit=100';
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
          ? `<img class="food-card-img" src="${f.image_path}" alt="" loading="lazy">`
          : `<div class="food-card-img-placeholder">🥗</div>`}
        <div class="food-card-info">
          <div class="food-card-name">${f.name}</div>
          ${f.brand ? `<div class="food-card-brand">${f.brand}</div>` : ''}
          <div class="food-card-macros">${Math.round(f.kcal_100g)} kcal · P:${fmt(f.protein_100g)}g G:${fmt(f.fat_100g)}g C:${fmt(f.carbs_100g)}g per 100g</div>
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
      btn.addEventListener('click', () => openFoodForm(parseInt(btn.dataset.id)));
    });

    container.querySelectorAll('.btn-del-food').forEach(btn => {
      btn.addEventListener('click', () => deleteFood(parseInt(btn.dataset.id), btn.dataset.name));
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

  // ── Import AlimentiNutrizione.it (INRAN/CREA) ────────────────────────────
  // Bottone nella toolbar
  const toolbar = document.querySelector('.foods-toolbar');
  const anfBtn = document.createElement('button');
  anfBtn.id = 'btn-import-anf';
  anfBtn.className = 'btn btn-outline btn-sm';
  anfBtn.title = 'Importa da AlimentiNutrizione.it (INRAN/CREA)';
  anfBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;vertical-align:-2px"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><path d="M11 7h2v6h-2zm0 8h2v2h-2z"/></svg> INRAN`;
  toolbar.insertBefore(anfBtn, document.getElementById('btn-new-food'));

  anfBtn.addEventListener('click', () => {
    document.getElementById('anf-query').value = '';
    document.getElementById('anf-results').innerHTML = '';
    document.getElementById('modal-anf').classList.remove('hidden');
    setTimeout(() => document.getElementById('anf-query').focus(), 100);
  });

  document.getElementById('modal-anf-close').addEventListener('click', () => {
    document.getElementById('modal-anf').classList.add('hidden');
  });
  document.getElementById('modal-anf-backdrop').addEventListener('click', () => {
    document.getElementById('modal-anf').classList.add('hidden');
  });

  // Ricerca live con debounce
  let anfSearchTimeout = null;
  document.getElementById('anf-query').addEventListener('input', () => {
    clearTimeout(anfSearchTimeout);
    anfSearchTimeout = setTimeout(searchANF, 500);
  });
  document.getElementById('btn-anf-search').addEventListener('click', searchANF);
  document.getElementById('anf-query').addEventListener('keydown', e => { if (e.key === 'Enter') searchANF(); });

  async function searchANF() {
    const q = document.getElementById('anf-query').value.trim();
    if (!q || q.length < 2) return;

    const resultsEl = document.getElementById('anf-results');
    resultsEl.innerHTML = '<div class="spinner"></div>';

    const res = await fetch(`/api/foods/import-anf/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      resultsEl.innerHTML = '<div class="empty-state"><p>Errore nella ricerca.</p></div>';
      return;
    }

    const foods = await res.json();
    if (!foods.length) {
      resultsEl.innerHTML = '<div class="empty-state"><p>Nessun alimento trovato.<br><small>Prova con parole più corte (es. "pollo" invece di "petto di pollo").</small></p></div>';
      return;
    }

    resultsEl.innerHTML = foods.map(f => `
      <div class="off-result-item">
        <div class="off-result-info" style="flex:1;min-width:0">
          <div class="off-result-name" style="white-space:normal;line-height:1.3">${f.name}</div>
          <div style="font-size:0.75rem;color:var(--color-text-secondary);margin-top:2px">INRAN/CREA · cod. ${f.id}</div>
        </div>
        <button class="btn btn-primary btn-sm btn-anf-import" data-id="${f.id}" data-name="${encodeURIComponent(f.name)}" style="flex-shrink:0;margin-left:8px">
          Importa
        </button>
      </div>
    `).join('');

    resultsEl.querySelectorAll('.btn-anf-import').forEach(btn => {
      btn.addEventListener('click', async () => {
        const origText = btn.textContent;
        btn.textContent = '⏳';
        btn.disabled = true;
        await importANFFood(btn.dataset.id, decodeURIComponent(btn.dataset.name));
        btn.textContent = origText;
        btn.disabled = false;
      });
    });
  }

  async function importANFFood(id, fallbackName) {
    const res = await fetch(`/api/foods/import-anf/fetch/${id}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Errore nel recupero dei dati nutrizionali.');
      return;
    }
    const product = await res.json();
    // Usa il nome dalla lista di ricerca se la pagina non lo fornisce
    if (!product.name) product.name = fallbackName;
    document.getElementById('modal-anf').classList.add('hidden');
    openFoodFormWithData(product);
  }

  // ── Import OpenFoodFacts ─────────────────
  let offMode = 'name';

  document.getElementById('btn-new-food').insertAdjacentHTML('afterend',
    // Il bottone OFF è inserito nella toolbar via JS dopo il DOM
    ''
  );

  // Aggiungi bottone OFF alla toolbar
  const offBtn = document.createElement('button');
  offBtn.id = 'btn-import-off';
  offBtn.className = 'btn btn-outline btn-sm';
  offBtn.title = 'Importa da OpenFoodFacts';
  offBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> OFF`;
  toolbar.insertBefore(offBtn, document.getElementById('btn-new-food'));

  offBtn.addEventListener('click', () => {
    document.getElementById('off-query').value = '';
    document.getElementById('off-results').innerHTML = '';
    document.getElementById('modal-off').classList.remove('hidden');
  });


  // Scanner OFF barcode
  let offScanner = null;
  let offScannerRunning = false;

  // Fallback iOS: file input
  const offFileInput = document.getElementById('off-barcode-file-input');
  offFileInput.addEventListener('change', async () => {
    const file = offFileInput.files[0];
    if (!file) return;
    offFileInput.value = '';
    try {
      const qr = new Html5Qrcode('off-barcode-reader');
      const result = await qr.scanFile(file, false);
      document.getElementById('off-query').value = result;
      searchOFF();
    } catch (e) {
      alert('Barcode non riconosciuto nell\'immagine. Riprova con una foto più nitida.');
    }
  });
  document.getElementById('btn-off-scan-file').addEventListener('click', () => offFileInput.click());

  function startOffScanner() {
    if (offScannerRunning) return;
    const wrap = document.getElementById('off-barcode-wrap');
    const readerEl = document.getElementById('off-barcode-reader');
    window.ScannerConfig.removeTorch(wrap);
    readerEl.innerHTML = '';
    wrap.classList.remove('hidden');
    offScanner = new Html5Qrcode('off-barcode-reader');
    offScannerRunning = true;
    offScanner.start(
      window.ScannerConfig.CAMERA_CONSTRAINTS,
      window.ScannerConfig.SCAN_CONFIG,
      (decodedText) => {
        stopOffScanner();
        document.getElementById('off-query').value = decodedText;
        searchOFF();
      },
      () => {}
    ).then(() => {
      window.ScannerConfig.initTorch(offScanner, wrap);
    }).catch(err => {
      offScannerRunning = false;
      offScanner = null;
      wrap.classList.add('hidden');
      console.warn('Webcam OFF non disponibile, uso fallback file:', err);
      document.getElementById('btn-off-scan-file').classList.remove('hidden');
      document.getElementById('btn-off-scan').classList.add('hidden');
    });
  }

  function stopOffScanner() {
    if (offScanner && offScannerRunning) {
      offScanner.stop().catch(() => {}).finally(() => {
        offScannerRunning = false;
        offScanner = null;
        const wrap = document.getElementById('off-barcode-wrap');
        if (wrap) {
          window.ScannerConfig.removeTorch(wrap);
          wrap.classList.add('hidden');
        }
      });
    }
  }

  document.getElementById('btn-off-scan').addEventListener('click', startOffScanner);
  document.getElementById('btn-off-stop-scan').addEventListener('click', stopOffScanner);

  // Chiudendo la modale, ferma lo scanner se attivo
  const closeOffModal = () => {
    stopOffScanner();
    document.getElementById('modal-off').classList.add('hidden');
  };
  document.getElementById('modal-off-close').addEventListener('click', closeOffModal);
  document.getElementById('modal-off-backdrop').addEventListener('click', closeOffModal);

  document.querySelectorAll('.off-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.off-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      offMode = btn.dataset.mode;
      const isBc = offMode === 'barcode';
      document.getElementById('off-query').placeholder = isBc ? 'Inserisci barcode manualmente...' : 'Nome prodotto...';
      document.getElementById('btn-off-scan').classList.toggle('hidden', !isBc);
      // Se si torna a "nome", ferma lo scanner
      if (!isBc) stopOffScanner();
    });
  });

  document.getElementById('btn-off-search').addEventListener('click', searchOFF);
  document.getElementById('off-query').addEventListener('keydown', e => { if (e.key === 'Enter') searchOFF(); });

  async function searchOFF() {
    const q = document.getElementById('off-query').value.trim();
    if (!q) return;

    const resultsEl = document.getElementById('off-results');
    resultsEl.innerHTML = '<div class="spinner"></div>';

    // Se siamo in modalità barcode, controlla in parallelo se esiste già nel DB locale
    const localCheckPromise = offMode === 'barcode'
      ? apiGet(`/api/foods?barcode=${encodeURIComponent(q)}`)
      : Promise.resolve(null);

    const body = offMode === 'barcode' ? { barcode: q } : { query: q };
    const res = await fetch('/api/foods/import-off', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      resultsEl.innerHTML = '<div class="empty-state"><p>Errore nella ricerca.</p></div>';
      return;
    }

    const [products, localMatches] = await Promise.all([res.json(), localCheckPromise]);
    const localFood = localMatches && localMatches.length > 0 ? localMatches[0] : null;

    if (products.length === 0) {
      resultsEl.innerHTML = '<div class="empty-state"><p>Nessun prodotto trovato.</p></div>';
      return;
    }

    // Banner di avviso se il barcode è già nel DB
    const warningHtml = localFood ? `
      <div class="off-duplicate-warning">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>Barcode già presente come <strong>${localFood.name}</strong>${localFood.brand ? ` (${localFood.brand})` : ''}.
        <button class="btn-link" data-existing-id="${localFood.id}">Modifica</button></span>
      </div>
    ` : '';

    resultsEl.innerHTML = warningHtml + products.map((p, i) => `
      <div class="off-result-item">
        ${p.image_url ? `<img src="${p.image_url}" alt="" loading="lazy">` : '<div style="width:50px;height:50px;border-radius:8px;background:var(--color-border);flex-shrink:0"></div>'}
        <div class="off-result-info">
          <div class="off-result-name">${p.name}</div>
          ${p.brand ? `<div class="off-result-brand">${p.brand}</div>` : ''}
          <div class="off-result-macros">${Math.round(p.kcal_100g)} kcal · P:${fmt(p.protein_100g)}g G:${fmt(p.fat_100g)}g C:${fmt(p.carbs_100g)}g</div>
        </div>
        <button class="btn ${localFood ? 'btn-outline' : 'btn-primary'} btn-sm btn-import-product" data-idx="${i}">Importa</button>
      </div>
    `).join('');

    // Click "Modifica" sull'alimento già esistente
    resultsEl.querySelector('[data-existing-id]')?.addEventListener('click', (e) => {
      document.getElementById('modal-off').classList.add('hidden');
      openFoodForm(parseInt(e.target.dataset.existingId));
    });

    resultsEl.querySelectorAll('.btn-import-product').forEach(btn => {
      btn.addEventListener('click', () => {
        const product = products[parseInt(btn.dataset.idx)];
        document.getElementById('modal-off').classList.add('hidden');
        openFoodFormWithData(product);
      });
    });
  }

  function openFoodFormWithData(product) {
    openFoodForm(null);
    document.getElementById('ff-name').value = product.name || '';
    document.getElementById('ff-brand').value = product.brand || '';
    document.getElementById('ff-barcode').value = product.barcode || '';
    document.getElementById('ff-kcal').value = product.kcal_100g || 0;
    document.getElementById('ff-protein').value = product.protein_100g || 0;
    document.getElementById('ff-fat').value = product.fat_100g || 0;
    document.getElementById('ff-carbs').value = product.carbs_100g || 0;

    if (product.image_url) {
      document.getElementById('ff-image-url').value = product.image_url;
      document.getElementById('ff-preview-img').src = product.image_url;
      document.getElementById('ff-image-preview').classList.remove('hidden');
    }
  }

  return { refresh, openFoodForm };
})();
