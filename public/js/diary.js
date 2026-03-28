/* ==========================================
   diary.js — Tab Home: diario giornaliero
   ========================================== */

const MEALS = [
  { id: 'colazione',          label: 'Colazione',          icon: '☀️' },
  { id: 'spuntino_mattino',   label: 'Spuntino mattino',   icon: '🍎' },
  { id: 'pranzo',             label: 'Pranzo',             icon: '🍽️' },
  { id: 'spuntino_pomeriggio',label: 'Spuntino pomeriggio',icon: '🧃' },
  { id: 'cena',               label: 'Cena',               icon: '🌙' },
  { id: 'extra',              label: 'Extra',              icon: '🍬' }
];

window.DiaryTab = (() => {
  let currentDate = todayStr();
  let entries = [];
  let selectedMeal = null;
  let selectedFood = null;
  let editingEntryId = null;
  let searchTimeout = null;
  let catalogSearchTimeout = null;
  let _recentFoods = [];
  let _frequentFoods = [];
  let _currentRecentMode = 'recent';

  // ── Render ──────────────────────────────
  async function refresh() {
    await loadEntries();
    renderDateNav();
    renderMeals();
    renderSummary();
  }

  async function loadEntries() {
    const data = await apiGet(`/api/diary?date=${currentDate}`);
    entries = data || [];
  }

  function renderDateNav() {
    document.getElementById('current-date-text').textContent = formatDate(currentDate);
  }

  function renderSummary() {
    const plan = App.plan;
    let totalKcal = 0, totalProtein = 0, totalFat = 0, totalCarbs = 0;
    for (const e of entries) {
      totalKcal   += e.kcal;
      totalProtein += e.protein;
      totalFat    += e.fat;
      totalCarbs  += e.carbs;
    }

    // Obiettivi macro in grammi
    const targetKcal    = plan.kcal_target || 2000;
    const targetProtein = Math.round((targetKcal * (plan.protein_pct || 30) / 100) / 4);
    const targetFat     = Math.round((targetKcal * (plan.fat_pct     || 30) / 100) / 9);
    const targetCarbs   = Math.round((targetKcal * (plan.carbs_pct   || 40) / 100) / 4);

    // ── Gauge calorie ──────────────────────────────────────────────────────
    // Arco totale 270° → lunghezza = 376.99; circonferenza totale = 502.65
    const ARC = 376.99, CIRC = 502.65;
    const pct   = targetKcal > 0 ? Math.min(totalKcal / targetKcal, 1) : 0;
    const fill  = pct * ARC;

    const gaugeFill = document.getElementById('ds-gauge-fill');
    gaugeFill.style.strokeDasharray = `${fill} ${CIRC}`;
    gaugeFill.className = 'ds-gauge-fill' +
      (pct >= 1 ? ' over' : pct >= 0.9 ? ' warning' : '');

    document.getElementById('total-kcal').textContent  = Math.round(totalKcal);
    document.getElementById('ds-remaining').textContent = Math.max(0, Math.round(targetKcal - totalKcal));
    document.getElementById('target-kcal').textContent  = Math.round(targetKcal);

    // ── Barre macro ────────────────────────────────────────────────────────
    const setMacro = (totalId, targetId, barId, total, target) => {
      document.getElementById(totalId).textContent  = Math.round(total);
      document.getElementById(targetId).textContent = target;
      document.getElementById(barId).style.width =
        target > 0 ? Math.min((total / target) * 100, 100) + '%' : '0%';
    };
    setMacro('total-carbs',   'target-carbs',   'bar-carbs',   totalCarbs,   targetCarbs);
    setMacro('total-protein', 'target-protein', 'bar-protein', totalProtein, targetProtein);
    setMacro('total-fat',     'target-fat',     'bar-fat',     totalFat,     targetFat);
  }

  let openMealId = null;

  function renderMeals() {
    const container = document.getElementById('meals-container');
    container.innerHTML = '';

    for (const meal of MEALS) {
      const mealEntries = entries.filter(e => e.meal_type === meal.id);
      const mealKcal = mealEntries.reduce((s, e) => s + e.kcal, 0);
      const isOpen = openMealId === meal.id;

      const section = document.createElement('div');
      section.className = 'meal-section';
      section.innerHTML = `
        <div class="meal-header" data-meal="${meal.id}">
          <div class="meal-header-left">
            <span class="meal-icon">${meal.icon}</span>
            <span class="meal-name">${meal.label}</span>
            ${mealKcal > 0 ? `<span class="meal-kcal-badge">${Math.round(mealKcal)} kcal</span>` : ''}
          </div>
          <svg class="meal-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:16px;height:16px;color:var(--color-text-secondary);transition:transform .2s;${isOpen ? 'transform:rotate(180deg)' : ''}"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="meal-body" id="meal-body-${meal.id}" style="${isOpen ? '' : 'display:none'}">
          ${mealEntries.map(e => renderEntryRow(e)).join('')}
          <button class="btn-add-to-meal" data-meal="${meal.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:18px;height:18px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            Aggiungi alimento
          </button>
        </div>
      `;
      container.appendChild(section);
    }

    // Event delegation per add + remove
    container.querySelectorAll('.btn-add-to-meal').forEach(btn => {
      btn.addEventListener('click', () => openAddModal(btn.dataset.meal));
    });

    container.querySelectorAll('[data-remove-entry]').forEach(btn => {
      btn.addEventListener('click', () => removeEntry(parseInt(btn.dataset.removeEntry)));
    });

    container.querySelectorAll('[data-edit-entry]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = parseInt(btn.dataset.editEntry);
        const entry = entries.find(e => e.id === id);
        if (entry) openEditModal(entry);
      });
    });

    // Click su nome/dettaglio → modifica diretta
    container.querySelectorAll('.entry-info').forEach(info => {
      info.style.cursor = 'pointer';
      info.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const row = info.closest('[data-entry-id]');
        if (!row) return;
        const id = parseInt(row.dataset.entryId);
        const entry = entries.find(e => e.id === id);
        if (entry) openEditModal(entry);
      });
    });

    // Accordion: un solo pasto aperto alla volta
    container.querySelectorAll('.meal-header').forEach(h => {
      h.addEventListener('click', () => {
        const mealId  = h.dataset.meal;
        const body    = document.getElementById(`meal-body-${mealId}`);
        const isOpen  = body.style.display !== 'none';

        // Chiudi tutti
        container.querySelectorAll('.meal-body').forEach(b => { b.style.display = 'none'; });
        container.querySelectorAll('.meal-chevron').forEach(c => { c.style.transform = ''; });

        if (!isOpen) {
          body.style.display = '';
          h.querySelector('.meal-chevron').style.transform = 'rotate(180deg)';
          openMealId = mealId;
        } else {
          openMealId = null;
        }
      });
    });
  }

  function renderEntryRow(e) {
    const imgHtml = e.food.image_path
      ? `<img class="entry-food-img" src="${e.food.image_path}" alt="" loading="lazy">`
      : `<div class="entry-food-img-placeholder">🥗</div>`;

    return `
      <div class="entry-row" data-entry-id="${e.id}">
        ${imgHtml}
        <div class="entry-info">
          <div class="entry-name">${e.food.name}${e.food.brand ? ` <span style="font-weight:400;color:var(--color-text-secondary);font-size:12px">${e.food.brand}</span>` : ''}</div>
          <div class="entry-detail">${e.quantity_label || fmt(e.quantity_g, 0) + 'g'} · P:${fmt(e.protein)}g G:${fmt(e.fat)}g C:${fmt(e.carbs)}g</div>
        </div>
        <span class="entry-kcal">${Math.round(e.kcal)} kcal</span>
        <button class="btn-edit-entry" data-edit-entry="${e.id}" title="Modifica quantità">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-remove-entry" data-remove-entry="${e.id}" title="Rimuovi">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `;
  }

  // ── Navigation ──────────────────────────
  function setDate(date) {
    currentDate = date;
    refresh();
  }

  document.getElementById('prev-day').addEventListener('click', () => {
    setDate(shiftDate(currentDate, -1));
  });

  document.getElementById('next-day').addEventListener('click', () => {
    setDate(shiftDate(currentDate, +1));
  });

  // ── Remove entry ────────────────────────
  async function removeEntry(id) {
    const confirmed = await showConfirm('Rimuovi alimento', 'Sei sicuro di voler rimuovere questa voce dal diario?');
    if (!confirmed) return;
    await apiDelete(`/api/diary/${id}`);
    await refresh();
  }

  // ── Add modal ───────────────────────────
  function openAddModal(meal) {
    selectedMeal = meal;
    openMealId = meal;
    selectedFood = null;
    editingEntryId = null;

    const mealLabel = MEALS.find(m => m.id === meal)?.label || meal;
    document.getElementById('modal-meal-title').textContent = `Aggiungi a ${mealLabel}`;
    document.getElementById('btn-confirm-add').textContent = 'Aggiungi';
    document.getElementById('edit-meal-move-wrap').classList.add('hidden');

    // Reset steps
    document.getElementById('modal-step-search').classList.remove('hidden');
    document.getElementById('modal-step-qty').classList.add('hidden');
    document.getElementById('modal-food-search').value = '';
    document.getElementById('modal-search-results').innerHTML = '';
    document.getElementById('modal-recent-section').classList.add('hidden');
    document.getElementById('barcode-scanner-wrap').classList.add('hidden');

    document.getElementById('modal-add-food').classList.remove('hidden');
    setTimeout(() => document.getElementById('modal-food-search').focus(), 200);

    // Carica alimenti recenti per questo pasto
    loadRecentFoods(meal);
  }

  // ── Edit modal ─────────────────────────
  function openEditModal(entry) {
    editingEntryId = entry.id;
    selectedFood = entry.food;
    selectedMeal = entry.meal_type;

    document.getElementById('modal-meal-title').textContent = 'Modifica quantità';
    document.getElementById('btn-confirm-add').textContent = 'Aggiorna';

    // Mostra dropdown cambio pasto (escludi il pasto corrente)
    const sel = document.getElementById('edit-meal-move-select');
    sel.innerHTML = '<option value="">Cambia pasto…</option>';
    MEALS.forEach(m => {
      if (m.id !== entry.meal_type) {
        const opt = document.createElement('option');
        opt.value = m.id; opt.textContent = m.label;
        sel.appendChild(opt);
      }
    });
    sel.value = '';
    document.getElementById('edit-meal-move-wrap').classList.remove('hidden');

    document.getElementById('modal-step-search').classList.add('hidden');
    document.getElementById('modal-step-qty').classList.remove('hidden');
    document.getElementById('modal-add-food').classList.remove('hidden');

    // Porta il modal in cima per renderlo subito visibile
    requestAnimationFrame(() => {
      const sheet = document.querySelector('#modal-add-food .modal-sheet');
      if (sheet) sheet.scrollTop = 0;
    });

    selectFood(entry.food);

    // Pre-riempie con la quantità attuale
    if (entry.quantity_label) {
      // Tenta di riconoscere porzione (se ancora valida)
      document.getElementById('qty-grams').value = Math.round(entry.quantity_g);
    } else {
      document.getElementById('qty-grams').value = Math.round(entry.quantity_g);
      // Assicura tab grammi attivo
      document.querySelector('.qty-tab[data-mode="grams"]').classList.add('active');
      document.querySelector('.qty-tab[data-mode="portions"]').classList.remove('active');
      document.getElementById('qty-grams-panel').classList.remove('hidden');
      document.getElementById('qty-portions-panel').classList.add('hidden');
    }
    updateKcalPreview();
  }

  // ── Alimenti recenti / frequenti ───────────────────
  function renderRecentList(foods) {
    const list = document.getElementById('modal-recent-foods');
    list.innerHTML = foods.map(f => `
      <div class="recent-food-item" data-recent-food-id="${f.id}">
        ${f.image_path ? `<img class="sri-img" src="${f.image_path}" alt="" loading="lazy">` : `<div class="sri-placeholder">🥗</div>`}
        <div class="sri-info">
          <div class="sri-name">${f.name}</div>
          <div class="sri-detail">${f.brand ? f.brand + ' · ' : ''}${Math.round(f.kcal_100g)} kcal/100g</div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.recent-food-item').forEach(item => {
      item.addEventListener('click', () => {
        const src = _currentRecentMode === 'recent' ? _recentFoods : _frequentFoods;
        const food = src.find(f => f.id === parseInt(item.dataset.recentFoodId));
        if (food) selectFood(food);
      });
    });
  }

  function switchRecentTab(mode) {
    _currentRecentMode = mode;
    document.querySelectorAll('#modal-recent-section .recent-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.recentMode === mode);
    });
    renderRecentList(mode === 'recent' ? _recentFoods : _frequentFoods);
  }

  document.querySelectorAll('#modal-recent-section .recent-tab').forEach(t => {
    t.addEventListener('click', () => switchRecentTab(t.dataset.recentMode));
  });

  async function loadRecentFoods(meal) {
    const mealEnc = encodeURIComponent(meal);
    const [recents, frequents] = await Promise.all([
      apiGet(`/api/diary/recent?meal_type=${mealEnc}&limit=8`),
      apiGet(`/api/diary/frequent?meal_type=${mealEnc}&limit=8`)
    ]);
    _recentFoods = recents || [];
    _frequentFoods = frequents || [];

    if (_recentFoods.length === 0 && _frequentFoods.length === 0) return;

    _currentRecentMode = 'recent';
    document.querySelectorAll('#modal-recent-section .recent-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.recentMode === 'recent');
    });
    renderRecentList(_recentFoods);
    document.getElementById('modal-recent-section').classList.remove('hidden');
  }

  function closeAddModal() {
    document.getElementById('modal-add-food').classList.add('hidden');
    document.getElementById('modal-step-quick').classList.add('hidden');
    BarcodeScanner?.stop();
    editingEntryId = null;
  }

  function showAddedToast(name) {
    let toast = document.getElementById('diary-added-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'diary-added-toast';
      toast.style.cssText = `
        position:absolute; top:12px; left:50%; transform:translateX(-50%);
        background:var(--color-primary); color:#fff;
        padding:6px 16px; border-radius:20px; font-size:13px; font-weight:600;
        white-space:nowrap; pointer-events:none; z-index:10;
        opacity:0; transition:opacity .2s;
      `;
      document.getElementById('modal-add-food').appendChild(toast);
    }
    toast.textContent = `✓ ${name} aggiunto`;
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 1800);
  }

  document.getElementById('modal-add-food-close').addEventListener('click', () => {
    if (editingEntryId) {
      // Modalità modifica → chiude direttamente
      closeAddModal();
    } else {
      const stepQty   = document.getElementById('modal-step-qty');
      const stepQuick = document.getElementById('modal-step-quick');
      if (!stepQty.classList.contains('hidden') || !stepQuick.classList.contains('hidden')) {
        // Modalità aggiunta, step 2/3 → torna alla ricerca
        stepQty.classList.add('hidden');
        stepQuick.classList.add('hidden');
        document.getElementById('modal-step-search').classList.remove('hidden');
      } else {
        // Step 1 → chiude
        closeAddModal();
      }
    }
  });

  // Search
  document.getElementById('modal-food-search').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    if (q.length < 2) {
      document.getElementById('modal-search-results').innerHTML = '';
      document.getElementById('modal-recent-section').classList.toggle('hidden', document.getElementById('modal-recent-foods').children.length === 0);
      return;
    }
    document.getElementById('modal-recent-section').classList.add('hidden');
    searchTimeout = setTimeout(() => searchFoods(q), 300);
  });

  // ── Quick new food — apre il form completo della tab Alimenti ───────────
  function showQuickNewFood() {
    const q = document.getElementById('modal-food-search').value.trim();
    // Chiudi temporaneamente la modale diario (rimane in DOM, non viene resettata)
    document.getElementById('modal-add-food').classList.add('hidden');
    FoodsTab.openFoodForm(null, {
      prefillName: q,
      onSaved: (newFood) => {
        // Riapri la modale diario e seleziona il nuovo alimento
        document.getElementById('modal-add-food').classList.remove('hidden');
        selectFood(newFood);
      }
    });
  }

  document.getElementById('btn-quick-new-food').addEventListener('click', showQuickNewFood);

  // ── Ricerca ──────────────────────────────────────────────────────────────
  async function searchFoods(q) {
    const resultsEl = document.getElementById('modal-search-results');
    resultsEl.innerHTML = '<div class="spinner"></div>';
    const foods = await apiGet(`/api/foods?q=${encodeURIComponent(q)}&limit=20`);
    if (!foods) return;

    if (foods.length === 0) {
      // Fallback: cerca nel catalogo Food Tracker
      resultsEl.innerHTML = '<div class="spinner"></div>';
      await searchCatalogInModal(q, resultsEl, true);
      return;
    }

    resultsEl.innerHTML = foods.map(f => `
      <div class="search-result-item" data-food-id="${f.id}">
        ${f.image_path ? `<img class="sri-img" src="${f.image_path}" alt="" loading="lazy">` : `<div class="sri-placeholder">🥗</div>`}
        <div class="sri-info">
          <div class="sri-name">${f.name}</div>
          <div class="sri-detail">${f.brand ? f.brand + ' · ' : ''}${Math.round(f.kcal_100g)} kcal/100g</div>
        </div>
      </div>
    `).join('');

    resultsEl.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const food = foods.find(f => f.id === parseInt(item.dataset.foodId));
        if (food) selectFood(food);
      });
    });
  }

  // ── Ricerca catalogo nel popup ─────────────────────────────────────────────
  async function searchCatalogInModal(q, targetEl, isFallback) {
    if (!targetEl) targetEl = document.getElementById('modal-catalog-results');
    const isBarcode = /^\d{8,14}$/.test(q);
    const body = isBarcode ? { barcode: q } : { query: q };

    try {
      const res = await fetch('/api/foods/import-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        targetEl.innerHTML = `<div class="empty-state"><p>${err?.error || 'Errore nella ricerca catalogo.'}</p></div>`;
        return;
      }
      const products = await res.json();
      if (!products.length) {
        let html = '<div class="empty-state"><p>Nessun risultato nel catalogo.</p>';
        if (isFallback) html += '<button class="btn btn-primary btn-sm" id="btn-empty-new-food" style="margin-top:8px">+ Crea questo alimento</button>';
        html += '</div>';
        targetEl.innerHTML = html;
        if (isFallback) document.getElementById('btn-empty-new-food')?.addEventListener('click', showQuickNewFood);
        return;
      }

      const headerHtml = isFallback ? '<div class="recent-label" style="margin-bottom:8px">Risultati dal catalogo</div>' : '';
      targetEl.innerHTML = headerHtml + products.map((p, i) => `
        <div class="catalog-result-item">
          ${p.image_url ? `<img src="${p.image_url}" alt="" loading="lazy">` : '<div style="width:50px;height:50px;border-radius:8px;background:var(--color-border);flex-shrink:0"></div>'}
          <div class="catalog-result-info">
            <div class="catalog-result-name">${p.name}</div>
            ${p.brand ? `<div class="catalog-result-brand">${p.brand}</div>` : ''}
            <div class="catalog-result-macros">${Math.round(p.kcal_100g)} kcal · P:${(p.protein_100g||0).toFixed(1)}g G:${(p.fat_100g||0).toFixed(1)}g C:${(p.carbs_100g||0).toFixed(1)}g</div>
          </div>
          <button class="btn btn-primary btn-sm btn-catalog-modal-import" data-idx="${i}">Importa</button>
        </div>
      `).join('');

      if (isFallback) {
        targetEl.innerHTML += '<div style="text-align:center;margin-top:8px"><button class="btn btn-outline btn-sm" id="btn-empty-new-food">+ Crea questo alimento</button></div>';
        document.getElementById('btn-empty-new-food')?.addEventListener('click', showQuickNewFood);
      }

      targetEl.querySelectorAll('.btn-catalog-modal-import').forEach(btn => {
        btn.addEventListener('click', () => {
          const product = products[parseInt(btn.dataset.idx)];
          document.getElementById('modal-add-food').classList.add('hidden');
          FoodsTab.openFoodFormWithData(product, {
            onSaved: (newFood) => {
              document.getElementById('modal-add-food').classList.remove('hidden');
              selectFood(newFood);
            }
          });
        });
      });
    } catch (e) {
      console.warn('Catalog search error:', e);
      targetEl.innerHTML = '<div class="empty-state"><p>Catalogo non raggiungibile.</p></div>';
    }
  }

  // Listener ricerca catalogo
  document.getElementById('modal-catalog-search').addEventListener('input', (e) => {
    clearTimeout(catalogSearchTimeout);
    const q = e.target.value.trim();
    const resultsEl = document.getElementById('modal-catalog-results');
    if (q.length < 2) {
      resultsEl.innerHTML = '';
      return;
    }
    document.getElementById('modal-recent-section').classList.add('hidden');
    catalogSearchTimeout = setTimeout(async () => {
      resultsEl.innerHTML = '<div class="spinner"></div>';
      await searchCatalogInModal(q, resultsEl, false);
    }, 400);
  });

  function selectFood(food) {
    selectedFood = food;

    // Mostra anteprima
    const preview = document.getElementById('selected-food-preview');
    preview.innerHTML = `
      ${food.image_path ? `<img src="${food.image_path}" alt="" style="width:42px;height:42px;border-radius:8px;object-fit:cover">` : '<div style="width:42px;height:42px;background:var(--color-bg);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:20px">🥗</div>'}
      <div class="sfp-info">
        <div class="sfp-name">${food.name}</div>
        <div class="sfp-macros">${Math.round(food.kcal_100g)} kcal · P:${fmt(food.protein_100g)}g G:${fmt(food.fat_100g)}g C:${fmt(food.carbs_100g)}g per 100g</div>
      </div>
    `;

    // Gestione porzioni
    const portionsTab = document.getElementById('qty-tab-portions');
    const portionsPanel = document.getElementById('qty-portions-panel');
    const portions = food.portions || [];

    if (portions.length > 0) {
      portionsTab.style.display = '';
      const select = document.getElementById('qty-portion-select');
      select.innerHTML = portions.map(p => `<option value="${p.grams}">${p.name} (${p.grams}g)</option>`).join('');
      // Attiva di default il tab porzioni
      document.querySelector('.qty-tab[data-mode="portions"]').classList.add('active');
      document.querySelector('.qty-tab[data-mode="grams"]').classList.remove('active');
      portionsPanel.classList.remove('hidden');
      document.getElementById('qty-grams-panel').classList.add('hidden');
    } else {
      portionsTab.style.display = 'none';
      portionsPanel.classList.add('hidden');
      document.getElementById('qty-grams-panel').classList.remove('hidden');
      document.querySelector('.qty-tab[data-mode="grams"]').classList.add('active');
      document.querySelector('.qty-tab[data-mode="portions"]').classList.remove('active');
    }

    document.getElementById('qty-grams').value = 100;
    document.getElementById('qty-portion-count').value = 1;
    updateKcalPreview();

    // Cambia step
    document.getElementById('modal-step-search').classList.add('hidden');
    document.getElementById('modal-step-qty').classList.remove('hidden');
  }

  // Qty tabs
  document.querySelectorAll('.qty-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.qty-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      document.getElementById('qty-grams-panel').classList.toggle('hidden', mode !== 'grams');
      document.getElementById('qty-portions-panel').classList.toggle('hidden', mode !== 'portions');
      updateKcalPreview();
    });
  });

  // Aggiorna preview kcal
  document.getElementById('qty-grams').addEventListener('input', updateKcalPreview);
  document.getElementById('qty-portion-count').addEventListener('input', updateKcalPreview);
  document.getElementById('qty-portion-select').addEventListener('change', updateKcalPreview);

  function updateKcalPreview() {
    if (!selectedFood) return;
    const { quantity_g, label } = getQuantity();
    const kcal = (selectedFood.kcal_100g / 100) * quantity_g;
    document.getElementById('kcal-preview').textContent = `~${Math.round(kcal)} kcal`;
    if (document.querySelector('.qty-tab[data-mode="portions"]').classList.contains('active')) {
      document.getElementById('qty-calculated-g').textContent = fmt(quantity_g, 0);
    }
  }

  function getQuantity() {
    const gramsMode = document.querySelector('.qty-tab[data-mode="grams"]').classList.contains('active');
    if (gramsMode) {
      const g = parseFloat(document.getElementById('qty-grams').value) || 100;
      return { quantity_g: g, label: `${g}g` };
    } else {
      const select = document.getElementById('qty-portion-select');
      const count = parseFloat(document.getElementById('qty-portion-count').value) || 1;
      const portionGrams = parseFloat(select.value) || 100;
      const portionName = select.options[select.selectedIndex]?.text || '';
      const g = portionGrams * count;
      const label = count === 1 ? portionName : `${count}× ${portionName}`;
      return { quantity_g: g, label };
    }
  }

  document.getElementById('btn-confirm-add').addEventListener('click', async () => {
    if (!selectedFood) return;
    const { quantity_g, label } = getQuantity();
    const btn = document.getElementById('btn-confirm-add');
    btn.disabled = true;

    let res;
    if (editingEntryId) {
      const moveTo = document.getElementById('edit-meal-move-select').value;
      const body = { quantity_g, quantity_label: label };
      if (moveTo) body.meal_type = moveTo;
      res = await apiPut(`/api/diary/${editingEntryId}`, body);
    } else {
      res = await apiPost('/api/diary', {
        date: currentDate,
        meal_type: selectedMeal,
        food_id: selectedFood.id,
        quantity_g,
        quantity_label: label
      });
    }

    btn.disabled = false;
    if (res && !res.error) {
      if (editingEntryId) {
        // Modifica: chiudi la modale
        closeAddModal();
      } else {
        // Aggiunta: torna alla ricerca e mostra feedback
        const addedName = selectedFood.name;
        selectedFood = null;
        editingEntryId = null;
        document.getElementById('modal-step-qty').classList.add('hidden');
        document.getElementById('modal-step-search').classList.remove('hidden');
        document.getElementById('modal-food-search').value = '';
        document.getElementById('modal-search-results').innerHTML = '';
        loadRecentFoods(selectedMeal);
        showAddedToast(addedName);
        setTimeout(() => document.getElementById('modal-food-search').focus(), 100);
      }
      await refresh();
    }
  });

  // ── Voce rapida ──────────────────────────
  function showQuickEntryStep() {
    document.getElementById('modal-step-search').classList.add('hidden');
    document.getElementById('modal-step-qty').classList.add('hidden');
    document.getElementById('modal-step-quick').classList.remove('hidden');
    document.getElementById('quick-kcal').value = '';
    document.getElementById('quick-desc').value = '';
    document.getElementById('quick-protein-pct').value = 20;
    document.getElementById('quick-fat-pct').value = 30;
    document.getElementById('quick-carbs-pct').value = 50;
    updateQuickPreview();
    document.getElementById('quick-kcal').focus();
  }

  function hideQuickEntryStep() {
    document.getElementById('modal-step-quick').classList.add('hidden');
    document.getElementById('modal-step-search').classList.remove('hidden');
  }

  function updateQuickPreview() {
    const kcal       = parseFloat(document.getElementById('quick-kcal').value) || 0;
    const proteinPct = parseFloat(document.getElementById('quick-protein-pct').value) || 0;
    const fatPct     = parseFloat(document.getElementById('quick-fat-pct').value) || 0;
    const carbsPct   = parseFloat(document.getElementById('quick-carbs-pct').value) || 0;
    const total      = proteinPct + fatPct + carbsPct;

    const proteinG = Math.round((kcal * proteinPct / 100) / 4);
    const fatG     = Math.round((kcal * fatPct     / 100) / 9);
    const carbsG   = Math.round((kcal * carbsPct   / 100) / 4);

    const warn = total !== 100 ? `<span style="color:var(--color-danger);font-size:12px">⚠️ Le % non sommano a 100 (totale: ${total}%)</span>` : '';
    document.getElementById('quick-macro-preview').innerHTML = kcal > 0
      ? `<div class="quick-preview-row">
           <span>P: <strong>${proteinG}g</strong></span>
           <span>G: <strong>${fatG}g</strong></span>
           <span>C: <strong>${carbsG}g</strong></span>
           <span style="margin-left:auto;font-weight:700;color:var(--color-primary)">${Math.round(kcal)} kcal</span>
         </div>${warn}`
      : '';
  }

  document.getElementById('btn-open-quick-entry').addEventListener('click', showQuickEntryStep);
  ['quick-kcal','quick-protein-pct','quick-fat-pct','quick-carbs-pct'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateQuickPreview);
  });

  document.getElementById('btn-quick-confirm').addEventListener('click', async () => {
    const kcal       = parseFloat(document.getElementById('quick-kcal').value);
    const proteinPct = parseFloat(document.getElementById('quick-protein-pct').value) || 0;
    const fatPct     = parseFloat(document.getElementById('quick-fat-pct').value) || 0;
    const carbsPct   = parseFloat(document.getElementById('quick-carbs-pct').value) || 0;
    const description = document.getElementById('quick-desc').value.trim();

    if (!kcal || kcal <= 0) { alert('Inserisci le calorie totali.'); return; }

    const btn = document.getElementById('btn-quick-confirm');
    btn.disabled = true;

    const res = await apiPost('/api/diary/quick', {
      date: currentDate,
      meal_type: selectedMeal,
      description,
      kcal,
      protein_pct: proteinPct,
      fat_pct: fatPct,
      carbs_pct: carbsPct
    });

    btn.disabled = false;
    if (res && !res.error) {
      // Torna alla ricerca
      document.getElementById('modal-step-quick').classList.add('hidden');
      document.getElementById('modal-step-search').classList.remove('hidden');
      document.getElementById('modal-food-search').value = '';
      document.getElementById('modal-search-results').innerHTML = '';
      loadRecentFoods(selectedMeal);
      showAddedToast(description || `${Math.round(kcal)} kcal`);
      setTimeout(() => document.getElementById('modal-food-search').focus(), 100);
      await refresh();
    }
  });

  // ── Barcode scanner ──────────────────────
  document.getElementById('btn-scan-barcode').addEventListener('click', () => {
    BarcodeScanner.start(async (barcode) => {
      const resultsEl = document.getElementById('modal-search-results');
      resultsEl.innerHTML = '<div class="spinner"></div>';

      // 1. Cerca nel DB locale per barcode esatto
      const local = await apiGet(`/api/foods?barcode=${encodeURIComponent(barcode)}`);
      if (local && local.length > 0) {
        resultsEl.innerHTML = '';
        selectFood(local[0]);
        return;
      }

      // 2. Non trovato in locale → cerca nel catalogo Food Tracker
      try {
        const catalogRes = await fetch('/api/foods/import-catalog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ barcode })
        });
        if (catalogRes.ok) {
          const products = await catalogRes.json();
          if (products.length > 0) {
            const p = products[0];
            // Apri il form alimento pre-compilato: l'utente può modificare, aggiungere porzioni e salvare
            resultsEl.innerHTML = '';
            document.getElementById('modal-add-food').classList.add('hidden');
            FoodsTab.openFoodFormWithData(p, {
              onSaved: (newFood) => {
                document.getElementById('modal-add-food').classList.remove('hidden');
                selectFood(newFood);
              }
            });
            return;
          }
        }
      } catch (e) {
        console.warn('Catalog lookup error:', e);
      }

      resultsEl.innerHTML = `<div class="empty-state"><p>Barcode <strong>${barcode}</strong> non trovato nel catalogo.</p></div>`;
    });
  });

  return { refresh, setDate, get currentDate() { return currentDate; } };
})();
