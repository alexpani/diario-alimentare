/* ==========================================
   diary.js — Tab Home: diario giornaliero
   ========================================== */

const MEALS = [
  { id: 'colazione',          label: 'Colazione',          icon: '☀️' },
  { id: 'spuntino_mattino',   label: 'Spuntino',            icon: '🍎' },
  { id: 'pranzo',             label: 'Pranzo',             icon: '🍽️' },
  { id: 'spuntino_pomeriggio',label: 'Merenda',            icon: '🧃' },
  { id: 'cena',               label: 'Cena',               icon: '🌙' },
  { id: 'extra',              label: 'Extra',              icon: '🍬' }
];

function _fmtSrc(src, components) {
  if (Array.isArray(components) && components.length > 0) return 'Ricetta';
  if (!src) return 'APP';
  const s = src.toLowerCase();
  if (s === 'crea') return 'CREA';
  if (s === 'openfoodfacts') return 'OpenFoodFacts';
  return 'APP';
}

window.DiaryTab = (() => {
  let currentDate = todayStr();
  let entries = [];
  let dayPlan = null;
  let selectedMeal = null;
  let selectedFood = null;
  let editingEntryId = null;
  let searchTimeout = null;
  let _recentFoods = [];
  let _frequentFoods = [];
  let _currentRecentMode = 'recent';
  let yesterdayEntries = [];

  // ── Render ──────────────────────────────
  async function refresh() {
    await loadEntries();
    renderDateNav();
    renderMeals();
    renderSummary();
  }

  async function loadEntries() {
    const [data, snap] = await Promise.all([
      apiGet(`/api/diary?date=${currentDate}`),
      apiGet(`/api/plan/snapshot?date=${currentDate}&_t=${Date.now()}`)
    ]);
    entries = data || [];
    dayPlan = snap || null;
    // Carica voci di ieri per l'anteprima "Copia da ieri"
    const yesterday = shiftDate(currentDate, -1);
    const yData = await apiGet(`/api/diary?date=${yesterday}`);
    yesterdayEntries = yData || [];
  }

  function renderDateNav() {
    document.getElementById('current-date-text').textContent = formatDate(currentDate);
  }

  function renderSummary() {
    const plan = dayPlan || App.plan;
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
    const remaining = Math.round(targetKcal - totalKcal);
    const remainingEl = document.getElementById('ds-remaining');
    const remainingLabel = document.querySelector('.ds-remaining-label');
    if (remaining >= 0) {
      remainingLabel.textContent = 'Rimanenti';
      remainingEl.textContent = remaining;
      remainingEl.classList.remove('ds-over');
    } else {
      remainingLabel.textContent = 'Oltre';
      remainingEl.textContent = '+' + Math.abs(remaining);
      remainingEl.classList.add('ds-over');
    }
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

    // Aggiorna nome piano (snapshot del giorno o piano attivo)
    const nameEl = document.getElementById('active-plan-name');
    if (nameEl) nameEl.textContent = dayPlan?.plan_name || App.plan?.name || '';
  }

  let openMealId = null;

  function renderMeals() {
    const container = document.getElementById('meals-container');
    container.innerHTML = '';

    for (const meal of MEALS) {
      const mealEntries = entries.filter(e => e.meal_type === meal.id);
      const mealKcal = mealEntries.reduce((s, e) => s + e.kcal, 0);
      const mealProtein = mealEntries.reduce((s, e) => s + e.protein, 0);
      const mealFat = mealEntries.reduce((s, e) => s + e.fat, 0);
      const mealCarbs = mealEntries.reduce((s, e) => s + e.carbs, 0);
      const isOpen = openMealId === meal.id;

      const macrosHtml = mealKcal > 0 ? `
        <div class="meal-macros">
          <span class="meal-kcal-badge">${Math.round(mealKcal)} kcal</span>
          <span class="meal-macro" style="color:var(--color-protein)">P:${fmt(mealProtein, 0)}g</span>
          <span class="meal-macro" style="color:var(--color-carbs)">C:${fmt(mealCarbs, 0)}g</span>
          <span class="meal-macro" style="color:var(--color-fat)">G:${fmt(mealFat, 0)}g</span>
        </div>` : '';

      const section = document.createElement('div');
      section.className = 'meal-section';
      section.innerHTML = `
        <div class="meal-header" data-meal="${meal.id}">
          <div class="meal-header-left">
            <span class="meal-name">${meal.label}</span>
          </div>
          ${macrosHtml}
        </div>
        <div class="meal-body" id="meal-body-${meal.id}" style="${isOpen ? '' : 'display:none'}">
          ${mealEntries.map(e => renderEntryRow(e)).join('')}
          ${mealEntries.length === 0 ? (() => {
            const yMeal = yesterdayEntries.filter(e => e.meal_type === meal.id);
            if (yMeal.length === 0) return '';
            const totalKcal = Math.round(yMeal.reduce((s, e) => s + e.kcal, 0));
            const top = yMeal.reduce((a, b) => b.kcal > a.kcal ? b : a);
            const topName = (top.food && top.food.name) || top.food_name || '?';
            const others = yMeal.length - 1;
            const desc = others > 0 ? `${topName} e ${others === 1 ? '1 altro' : others + ' altri'}` : topName;
            return `<button class="btn-copy-from-yesterday" data-meal="${meal.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span class="copy-yesterday-label">Copia ${meal.label.toLowerCase()} da ieri</span>
            <span class="copy-yesterday-detail">${desc} — ${totalKcal} kcal</span>
          </button>`;
          })() : ''}
          ${mealEntries.length >= 2 ? `<button class="btn-save-as-recipe" data-meal="${meal.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Salva come ricetta
          </button>` : ''}
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

    container.querySelectorAll('.btn-copy-from-yesterday').forEach(btn => {
      btn.addEventListener('click', () => copyFromYesterday(btn.dataset.meal));
    });

    container.querySelectorAll('.btn-save-as-recipe').forEach(btn => {
      btn.addEventListener('click', () => openSaveAsRecipeModal(btn.dataset.meal));
    });

    container.querySelectorAll('[data-remove-entry]').forEach(btn => {
      btn.addEventListener('click', () => removeEntry(parseInt(btn.dataset.removeEntry)));
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

        if (!isOpen) {
          body.style.display = '';
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
    await apiDelete(`/api/diary/${id}`);
    await refresh();
  }

  // ── Copy from yesterday ─────────────────
  async function copyFromYesterday(meal) {
    const yesterday = shiftDate(currentDate, -1);
    const res = await apiPost('/api/diary/copy', {
      from_date: yesterday,
      to_date: currentDate,
      meal_type: meal
    });
    if (res && !res.error) {
      openMealId = meal;
      await refresh();
    }
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
    document.getElementById('edit-recipe-wrap').classList.add('hidden');

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

    // Mostra bottone "Modifica ricetta" solo per ricette
    const isRecipe = Array.isArray(entry.food.components) && entry.food.components.length > 0;
    document.getElementById('edit-recipe-wrap').classList.toggle('hidden', !isRecipe);

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
    list.innerHTML = foods.map(f => {
      const qtyLabel = f.last_qty_label || (f.last_qty_g ? `${f.last_qty_g}g` : '');
      const portionKcal = f.last_qty_g ? Math.round(f.kcal_100g / 100 * f.last_qty_g) : null;
      const detail = f.brand ? f.brand + ' · ' : '';
      const qtyPart = qtyLabel
        ? `<span style="color:var(--color-primary)">${qtyLabel}</span>${portionKcal !== null ? ` · ${portionKcal} kcal` : ''}`
        : `${Math.round(f.kcal_100g)} kcal/100g`;
      return `
      <div class="recent-food-item" data-recent-food-id="${f.id}">
        ${f.image_path ? `<img class="sri-img" src="${f.image_path}" alt="" loading="lazy">` : `<div class="sri-placeholder">🥗</div>`}
        <div class="sri-info">
          <div class="sri-name">${f.name}</div>
          <div class="sri-detail">${detail}${qtyPart}</div>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.recent-food-item').forEach(item => {
      item.addEventListener('click', () => {
        const src = _currentRecentMode === 'recent' ? _recentFoods : _frequentFoods;
        const food = src.find(f => f.id === parseInt(item.dataset.recentFoodId));
        if (food) selectFood(food, { qty_g: food.last_qty_g, qty_label: food.last_qty_label });
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
      apiGet(`/api/diary/recent?meal_type=${mealEnc}&limit=12`),
      apiGet(`/api/diary/frequent?meal_type=${mealEnc}&limit=12`)
    ]);

    // Escludi alimenti già presenti in questo pasto oggi
    const mealFoodIds = new Set(entries.filter(e => e.meal_type === meal).map(e => e.food?.id));
    _recentFoods = (recents || []).filter(f => !mealFoodIds.has(f.id)).slice(0, 12);
    _frequentFoods = (frequents || []).filter(f => !mealFoodIds.has(f.id)).slice(0, 12);

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
        background:var(--color-primary); color:var(--color-text-on-primary);
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
      const stepAi    = document.getElementById('modal-step-ai');
      if (!stepQty.classList.contains('hidden') || !stepQuick.classList.contains('hidden') || !stepAi.classList.contains('hidden')) {
        // Modalità aggiunta, step 2/3/AI → torna alla ricerca
        stepQty.classList.add('hidden');
        stepQuick.classList.add('hidden');
        stepAi.classList.add('hidden');
        document.getElementById('modal-step-search').classList.remove('hidden');
      } else {
        // Step 1 → chiude
        closeAddModal();
      }
    }
  });

  // Search — unica casella: DB locale + catalogo
  document.getElementById('modal-food-search').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    if (q.length < 2) {
      document.getElementById('modal-search-results').innerHTML = '';
      document.getElementById('modal-recent-section').classList.toggle('hidden', document.getElementById('modal-recent-foods').children.length === 0);
      return;
    }
    document.getElementById('modal-recent-section').classList.add('hidden');
    searchTimeout = setTimeout(() => searchUnified(q), 400);
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

  // Modifica ricetta dal modal quantità
  document.getElementById('btn-edit-recipe').addEventListener('click', () => {
    if (!selectedFood) return;
    const foodId = selectedFood.id;
    closeAddModal();
    FoodsTab.openFoodForm(foodId, {
      onSaved: async () => {
        await refresh();
      }
    });
  });

  // ── Ricerca unificata: DB locale + catalogo ─────────────────────────────
  async function searchUnified(q) {
    const resultsEl = document.getElementById('modal-search-results');
    resultsEl.innerHTML = '<div class="spinner"></div>';

    const isBarcode = /^\d{8,14}$/.test(q);

    // 1. Cerca nel DB locale
    let localFoods;
    if (isBarcode) {
      const r = await apiGet(`/api/foods?barcode=${encodeURIComponent(q)}`);
      localFoods = r || [];
    } else {
      localFoods = await apiGet(`/api/foods?q=${encodeURIComponent(q)}&limit=20`) || [];
    }

    // Set per evitare doppioni dal catalogo
    const localBarcodes = new Set(localFoods.filter(f => f.barcode).map(f => f.barcode));
    const localNames = new Set(localFoods.map(f => (f.name || '').toLowerCase().trim()));

    // 2. Cerca in parallelo nel catalogo Food Tracker
    let catalogProducts = [];
    try {
      const body = isBarcode ? { barcode: q } : { query: q };
      const res = await fetch('/api/foods/import-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const products = await res.json();
        // Filtra doppioni: escludi prodotti con barcode già presenti nel DB locale
        // Ordina per sorgente: APP > CREA > OFF
        const sourceOrder = { app: 0, crea: 1 };
        products.sort((a, b) => (sourceOrder[a.source] ?? 2) - (sourceOrder[b.source] ?? 2));
        catalogProducts = products.filter(p => {
          // Escludi se barcode già presente in locale
          if (p.barcode && localBarcodes.has(p.barcode)) return false;
          // Escludi prodotti APP con stesso nome (sincronizzati da questa app)
          if (p.source === 'app' && localNames.has((p.name || '').toLowerCase().trim())) return false;
          return true;
        });
      }
    } catch (e) {
      console.warn('Catalog search error:', e);
    }

    // 3. Render risultati
    let html = '';

    // Sezione DB locale
    if (localFoods.length > 0) {
      html += '<div class="recent-label" style="margin-bottom:6px">Nel tuo database</div>';
      html += localFoods.map(f => `
        <div class="search-result-item" data-food-id="${f.id}">
          ${f.image_path ? `<img class="catalog-result-img" src="${f.image_path}" alt="" loading="lazy">` : '<div class="catalog-result-img-placeholder">🥗</div>'}
          <div class="catalog-result-info">
            <div class="catalog-result-name">${f.name}</div>
            ${f.brand ? `<div class="catalog-result-brand">${f.brand}</div>` : ''}
            <div class="catalog-result-macros">${Math.round(f.kcal_100g)} kcal · P:${fmt(f.protein_100g)}g G:${fmt(f.fat_100g)}g C:${fmt(f.carbs_100g)}g</div>
            <div class="catalog-result-source">${_fmtSrc(f.source, f.components)}${f.barcode ? ' · ' + f.barcode : ''}</div>
          </div>
        </div>
      `).join('');
    }

    // Sezione catalogo
    if (catalogProducts.length > 0) {
      html += '<div class="recent-label" style="margin:14px 0 6px">Dal catalogo</div>';
      html += catalogProducts.map((p, i) => `
        <div class="catalog-result-item">
          ${p.image_url ? `<img src="${p.image_url}" alt="" loading="lazy">` : '<div class="catalog-result-img-placeholder">🥗</div>'}
          <div class="catalog-result-info">
            <div class="catalog-result-name">${p.name}</div>
            ${p.brand ? `<div class="catalog-result-brand">${p.brand}</div>` : ''}
            <div class="catalog-result-macros">${Math.round(p.kcal_100g)} kcal · P:${(p.protein_100g||0).toFixed(1)}g G:${(p.fat_100g||0).toFixed(1)}g C:${(p.carbs_100g||0).toFixed(1)}g</div>
            <div class="catalog-result-source">${_fmtSrc(p.source)}${p.barcode ? ' · ' + p.barcode : ''}</div>
          </div>
          <button class="btn btn-primary btn-sm btn-catalog-modal-import" data-idx="${i}">Importa</button>
        </div>
      `).join('');
    }

    // Nessun risultato da nessuna parte
    if (localFoods.length === 0 && catalogProducts.length === 0) {
      html = '<div class="empty-state"><p>Nessun risultato.</p><button class="btn btn-primary btn-sm" id="btn-empty-new-food" style="margin-top:8px">+ Crea questo alimento</button></div>';
    }

    resultsEl.innerHTML = html;

    // Listener: risultati DB locale → selectFood
    resultsEl.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const food = localFoods.find(f => f.id === parseInt(item.dataset.foodId));
        if (food) selectFood(food);
      });
    });

    // Listener: risultati catalogo → importa
    resultsEl.querySelectorAll('.btn-catalog-modal-import').forEach(btn => {
      btn.addEventListener('click', () => {
        const product = catalogProducts[parseInt(btn.dataset.idx)];
        document.getElementById('modal-add-food').classList.add('hidden');
        FoodsTab.openFoodFormWithData(product, {
          onSaved: (newFood) => {
            document.getElementById('modal-add-food').classList.remove('hidden');
            selectFood(newFood);
          }
        });
      });
    });

    // Listener: crea nuovo
    document.getElementById('btn-empty-new-food')?.addEventListener('click', showQuickNewFood);
  }

  function selectFood(food, { qty_g = null, qty_label = null } = {}) {
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

    let usePortionMode = false;
    if (portions.length > 0) {
      portionsTab.style.display = '';
      const select = document.getElementById('qty-portion-select');
      select.innerHTML = portions.map(p => `<option value="${p.grams}">${p.name} (${p.grams}g)</option>`).join('');

      // Prova a matchare la quantità ricordata con una porzione
      if (qty_g) {
        for (const p of portions) {
          const count = Math.round(qty_g / p.grams * 4) / 4;
          if (count >= 0.25 && count <= 99 && Math.abs(p.grams * count - qty_g) < 1) {
            select.value = p.grams;
            document.getElementById('qty-portion-count').value = count;
            usePortionMode = true;
            break;
          }
        }
      }

      // Default: tab porzioni attivo
      if (!usePortionMode) document.getElementById('qty-portion-count').value = 1;
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

    document.getElementById('qty-grams').value = qty_g || 100;
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
      // Chiudi la modale e torna alla Home col pasto aggiornato
      closeAddModal();
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
      document.getElementById('modal-recent-section').classList.add('hidden');

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

      resultsEl.innerHTML = `<div class="empty-state"><p>Nessun risultato per <strong>${barcode}</strong></p><button class="btn btn-primary btn-sm" id="btn-barcode-new-food" style="margin-top:8px">+ Crea questo alimento</button></div>`;
      document.getElementById('btn-barcode-new-food').addEventListener('click', () => {
        document.getElementById('modal-add-food').classList.add('hidden');
        FoodsTab.openFoodForm(null, {
          prefillBarcode: barcode,
          onSaved: (newFood) => {
            document.getElementById('modal-add-food').classList.remove('hidden');
            selectFood(newFood);
          }
        });
      });
    });
  });

  // ── AI: Riconosci piatto ──────────────────────────────────────────────────
  let _aiItems = []; // risultati AI correnti
  let _aiDishName = '';

  document.getElementById('btn-ai-recognize').addEventListener('click', () => {
    document.getElementById('ai-photo-input').click();
  });

  document.getElementById('ai-photo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // reset per permettere ri-selezione stesso file

    // Nascondi ricerca e recenti, mostra spinner
    document.getElementById('modal-step-search').classList.add('hidden');
    document.getElementById('modal-step-qty').classList.add('hidden');
    document.getElementById('modal-step-ai').classList.remove('hidden');
    document.getElementById('ai-results-list').innerHTML = '<div class="spinner"></div><p style="text-align:center;color:var(--color-text-secondary);margin-top:8px">Analisi in corso…</p>';
    document.getElementById('btn-ai-confirm').classList.add('hidden');

    try {
      // Resize client-side per ridurre upload
      const resized = await resizeImage(file, 1024);

      const formData = new FormData();
      formData.append('image', resized, 'photo.jpg');

      const res = await fetch('/api/diary/recognize-photo', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Errore nel riconoscimento');
      }

      const data = await res.json();
      _aiItems = data.items || [];
      _aiDishName = data.dish_name || '';

      if (_aiItems.length === 0) {
        document.getElementById('ai-results-list').innerHTML = '<div class="empty-state"><p>Nessun alimento riconosciuto nella foto.</p></div>';
        return;
      }

      renderAiResults();
      document.getElementById('btn-ai-confirm').classList.remove('hidden');
    } catch (err) {
      console.error('AI recognize error:', err);
      document.getElementById('ai-results-list').innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
    }
  });

  function _aiItemNut(item) {
    const match = item.local_matches[0] || item.catalog_matches[0] || null;
    return match || { kcal_100g: item.ai_kcal_100g || 0, protein_100g: item.ai_protein_100g || 0, fat_100g: item.ai_fat_100g || 0, carbs_100g: item.ai_carbs_100g || 0 };
  }

  function renderAiResults() {
    const container = document.getElementById('ai-results-list');
    let html = '';

    // ── Riepilogo totale piatto ────────────────────────────────────────
    let totKcal = 0, totP = 0, totG = 0, totC = 0;
    _aiItems.forEach(item => {
      const nut = _aiItemNut(item);
      const qty = parseFloat(document.querySelector(`[data-ai-qty="${_aiItems.indexOf(item)}"]`)?.value) || item.ai_quantity_g;
      totKcal += nut.kcal_100g / 100 * qty;
      totP += nut.protein_100g / 100 * qty;
      totG += nut.fat_100g / 100 * qty;
      totC += nut.carbs_100g / 100 * qty;
    });

    html += `
      <div class="ai-total-summary">
        <div>
          ${_aiDishName ? `<div class="ai-dish-name">${_aiDishName}</div>` : ''}
          <span class="ai-total-kcal">${Math.round(totKcal)} kcal</span>
        </div>
        <span class="ai-total-macros">
          <span style="color:var(--color-protein)">P:${fmt(totP, 0)}g</span>
          <span style="color:var(--color-fat)">G:${fmt(totG, 0)}g</span>
          <span style="color:var(--color-carbs)">C:${fmt(totC, 0)}g</span>
        </span>
      </div>
    `;

    _aiItems.forEach((item, i) => {
      const bestMatch = item.local_matches[0] || null;
      const catalogMatch = item.catalog_matches[0] || null;
      const match = bestMatch || catalogMatch;

      const matchName = match ? match.name : item.ai_name;
      // Usa dati nutrizionali dal match, oppure stime AI come fallback
      const nut = _aiItemNut(item);
      const qty = parseFloat(document.querySelector(`[data-ai-qty="${i}"]`)?.value) || item.ai_quantity_g;
      const estKcal = Math.round(nut.kcal_100g / 100 * qty);
      const matchDetail = nut.kcal_100g > 0
        ? `${estKcal} kcal · P:${fmt(nut.protein_100g / 100 * qty)}g G:${fmt(nut.fat_100g / 100 * qty)}g C:${fmt(nut.carbs_100g / 100 * qty)}g`
        : '';
      const matchSource = bestMatch ? 'DB locale' : (catalogMatch ? (_fmtSrc(catalogMatch.source)) : (nut.kcal_100g > 0 ? 'stima IA' : ''));
      const matchImg = match?.image_path || match?.image_url || null;

      const hasAlternatives = (item.local_matches.length + item.catalog_matches.length) > 1;

      html += `
        <div class="ai-result-item" data-ai-idx="${i}">
          <div class="ai-result-header">
            <label class="ai-result-check">
              <input type="checkbox" checked data-ai-check="${i}">
            </label>
            <div class="ai-result-info">
              <div class="ai-result-ai-name">${item.ai_name}</div>
              <div class="ai-result-match">
                ${matchImg ? `<img src="${matchImg}" class="ai-result-img" alt="">` : ''}
                <div>
                  <div class="ai-result-match-name">${matchName}${matchSource ? ` <span class="ai-result-source">${matchSource}</span>` : ''}</div>
                  <div class="ai-result-match-detail">${matchDetail}</div>
                </div>
              </div>
              ${!match ? '<div class="ai-result-no-match">Nessun match trovato</div>' : ''}
              ${hasAlternatives ? `<button class="btn-ai-alternatives" data-ai-alt="${i}">Altre opzioni ▾</button>` : ''}
              <div class="ai-alternatives-list hidden" id="ai-alt-${i}"></div>
            </div>
            <div class="ai-result-qty">
              <input type="number" class="form-input" value="${item.ai_quantity_g}" data-ai-qty="${i}" style="width:70px;text-align:center">
              <span style="font-size:11px;color:var(--color-text-secondary)">g</span>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Conta selezionati per il bottone
    updateAiConfirmButton();

    // Listener checkbox
    container.querySelectorAll('[data-ai-check]').forEach(cb => {
      cb.addEventListener('change', () => { updateAiConfirmButton(); updateAiTotalSummary(); });
    });

    // Listener quantità — aggiorna riepilogo
    container.querySelectorAll('[data-ai-qty]').forEach(inp => {
      inp.addEventListener('input', () => updateAiTotalSummary());
    });

    // Listener alternative
    container.querySelectorAll('.btn-ai-alternatives').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.aiAlt);
        toggleAiAlternatives(idx);
      });
    });
  }

  function updateAiTotalSummary() {
    const el = document.querySelector('.ai-total-summary');
    if (!el) return;
    let totKcal = 0, totP = 0, totG = 0, totC = 0;
    _aiItems.forEach((item, i) => {
      const cb = document.querySelector(`[data-ai-check="${i}"]`);
      if (cb && !cb.checked) return;
      const nut = _aiItemNut(item);
      const qty = parseFloat(document.querySelector(`[data-ai-qty="${i}"]`)?.value) || item.ai_quantity_g;
      totKcal += nut.kcal_100g / 100 * qty;
      totP += nut.protein_100g / 100 * qty;
      totG += nut.fat_100g / 100 * qty;
      totC += nut.carbs_100g / 100 * qty;
    });
    el.querySelector('.ai-total-kcal').textContent = `${Math.round(totKcal)} kcal`;
    el.querySelector('.ai-total-macros').innerHTML = `
      <span style="color:var(--color-protein)">P:${fmt(totP, 0)}g</span>
      <span style="color:var(--color-fat)">G:${fmt(totG, 0)}g</span>
      <span style="color:var(--color-carbs)">C:${fmt(totC, 0)}g</span>
    `;
  }

  function updateAiConfirmButton() {
    const checked = document.querySelectorAll('[data-ai-check]:checked').length;
    const btn = document.getElementById('btn-ai-confirm');
    btn.textContent = checked > 0 ? `Aggiungi ${checked} aliment${checked === 1 ? 'o' : 'i'}` : 'Nessun alimento selezionato';
    btn.disabled = checked === 0;
  }

  function toggleAiAlternatives(idx) {
    const listEl = document.getElementById(`ai-alt-${idx}`);
    if (!listEl.classList.contains('hidden')) {
      listEl.classList.add('hidden');
      return;
    }

    const item = _aiItems[idx];
    const allMatches = [
      ...item.local_matches.map((m, mi) => ({ ...m, _type: 'local', _idx: mi })),
      ...item.catalog_matches.map((m, mi) => ({ ...m, _type: 'catalog', _idx: mi }))
    ];

    listEl.innerHTML = allMatches.map((m, j) => `
      <div class="ai-alt-option" data-ai-parent="${idx}" data-alt-idx="${j}" data-alt-type="${m._type}" data-alt-src-idx="${m._idx}">
        <div class="ai-alt-name">${m.name}${m.brand ? ` <span style="color:var(--color-text-secondary)">${m.brand}</span>` : ''}</div>
        <div class="ai-alt-detail">${Math.round(m.kcal_100g)} kcal/100g · ${m._type === 'local' ? 'DB locale' : _fmtSrc(m.source)}</div>
      </div>
    `).join('');

    listEl.classList.remove('hidden');

    listEl.querySelectorAll('.ai-alt-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const parentIdx = parseInt(opt.dataset.aiParent);
        const altType = opt.dataset.altType;
        const srcIdx = parseInt(opt.dataset.altSrcIdx);

        // Sposta il match selezionato in cima
        const parentItem = _aiItems[parentIdx];
        if (altType === 'local') {
          const selected = parentItem.local_matches.splice(srcIdx, 1)[0];
          parentItem.local_matches.unshift(selected);
        } else {
          const selected = parentItem.catalog_matches.splice(srcIdx, 1)[0];
          parentItem.local_matches = []; // Preferisci catalogo
          parentItem.catalog_matches.unshift(selected);
        }

        renderAiResults();
      });
    });
  }

  // Conferma batch
  document.getElementById('btn-ai-confirm').addEventListener('click', async () => {
    const btn = document.getElementById('btn-ai-confirm');
    btn.disabled = true;
    btn.textContent = 'Aggiunta in corso...';

    let added = 0;

    for (let i = 0; i < _aiItems.length; i++) {
      const cb = document.querySelector(`[data-ai-check="${i}"]`);
      if (!cb || !cb.checked) continue;

      const item = _aiItems[i];
      const qtyInput = document.querySelector(`[data-ai-qty="${i}"]`);
      const qty = parseInt(qtyInput?.value) || item.ai_quantity_g;

      const localMatch = item.local_matches[0];
      const catalogMatch = item.catalog_matches[0];

      let foodId = null;

      if (localMatch) {
        foodId = localMatch.id;
      } else if (catalogMatch) {
        // Auto-importa dal catalogo
        try {
          const fd = new FormData();
          fd.append('name', catalogMatch.name);
          fd.append('brand', catalogMatch.brand || '');
          fd.append('barcode', catalogMatch.barcode || '');
          fd.append('kcal_100g', catalogMatch.kcal_100g);
          fd.append('protein_100g', catalogMatch.protein_100g);
          fd.append('fat_100g', catalogMatch.fat_100g);
          fd.append('carbs_100g', catalogMatch.carbs_100g);
          fd.append('source', catalogMatch.source || 'openfoodfacts');
          const importRes = await fetch('/api/foods', { method: 'POST', body: fd });
          if (importRes.ok) {
            const newFood = await importRes.json();
            foodId = newFood.id;
          }
        } catch (e) {
          console.warn('Auto-import error:', e);
        }
      }

      if (!foodId) {
        // Nessun match: crea voce rapida
        try {
          const qRes = await apiPost('/api/diary/quick', {
            date: currentDate,
            meal_type: selectedMeal,
            description: item.ai_name,
            kcal: Math.round((item.local_matches[0]?.kcal_100g || 100) / 100 * qty),
            quantity_g: qty
          });
          if (qRes && !qRes.error) added++;
        } catch (e) { console.warn(e); }
        continue;
      }

      // Aggiungi al diario
      const res = await apiPost('/api/diary', {
        food_id: foodId,
        date: currentDate,
        meal_type: selectedMeal,
        quantity_g: qty
      });
      if (res && !res.error) added++;
    }

    // Torna alla ricerca
    document.getElementById('modal-step-ai').classList.add('hidden');
    document.getElementById('modal-step-search').classList.remove('hidden');
    document.getElementById('modal-food-search').value = '';
    document.getElementById('modal-search-results').innerHTML = '';
    loadRecentFoods(selectedMeal);

    if (added > 0) {
      showAddedToast(`${added} aliment${added === 1 ? 'o' : 'i'} aggiunti`);
      openMealId = selectedMeal;
      await refresh();
    }
  });

  // Resize immagine client-side
  function resizeImage(file, maxSize) {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.8);
      };
      img.src = URL.createObjectURL(file);
    });
  }

  // ── Salva come ricetta ────────────────────────────────────────────────────
  let _recipeMealType = null;

  function openSaveAsRecipeModal(mealType) {
    _recipeMealType = mealType;
    const mealEntries = entries.filter(e => e.meal_type === mealType);
    if (mealEntries.length < 2) return;

    const modal = document.getElementById('modal-save-recipe');
    const nameInput = document.getElementById('recipe-name-input');
    const summaryEl = document.getElementById('recipe-ingredients-summary');
    const totalsEl = document.getElementById('recipe-totals-summary');

    nameInput.value = '';

    // Riepilogo ingredienti
    summaryEl.innerHTML = `
      <div style="font-size:0.82rem;font-weight:600;margin-bottom:6px;color:var(--color-text-secondary)">INGREDIENTI</div>
      ${mealEntries.map(e => `
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.85rem;border-bottom:1px solid var(--color-border)">
          <span>${e.food.name}</span>
          <span style="color:var(--color-text-secondary)">${e.quantity_label || fmt(e.quantity_g, 0) + 'g'}</span>
        </div>
      `).join('')}
    `;

    // Totali
    const totalKcal = mealEntries.reduce((s, e) => s + e.kcal, 0);
    const totalP = mealEntries.reduce((s, e) => s + e.protein, 0);
    const totalF = mealEntries.reduce((s, e) => s + e.fat, 0);
    const totalC = mealEntries.reduce((s, e) => s + e.carbs, 0);
    const totalG = mealEntries.reduce((s, e) => s + e.quantity_g, 0);

    totalsEl.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:0.82rem">
        <span class="recipe-macro-badge">⚡ ${Math.round(totalKcal)} kcal</span>
        <span class="recipe-macro-badge" style="color:var(--color-protein)">P: ${fmt(totalP)}g</span>
        <span class="recipe-macro-badge" style="color:var(--color-fat)">G: ${fmt(totalF)}g</span>
        <span class="recipe-macro-badge" style="color:var(--color-carbs)">C: ${fmt(totalC)}g</span>
      </div>
      <div style="font-size:0.78rem;color:var(--color-text-secondary);margin-top:6px">
        Peso totale: ${Math.round(totalG)}g — verrà salvata come 1 porzione
      </div>
    `;

    modal.classList.remove('hidden');
    setTimeout(() => nameInput.focus(), 100);
  }

  function closeSaveAsRecipeModal() {
    document.getElementById('modal-save-recipe').classList.add('hidden');
    _recipeMealType = null;
  }

  document.getElementById('btn-cancel-recipe').addEventListener('click', closeSaveAsRecipeModal);
  document.getElementById('modal-recipe-backdrop').addEventListener('click', closeSaveAsRecipeModal);

  document.getElementById('btn-confirm-recipe').addEventListener('click', async () => {
    const name = document.getElementById('recipe-name-input').value.trim();
    if (!name) {
      document.getElementById('recipe-name-input').focus();
      return;
    }

    const btn = document.getElementById('btn-confirm-recipe');
    btn.disabled = true;
    btn.textContent = 'Salvataggio...';

    try {
      const res = await fetch('/api/foods/recipe-from-meal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, date: currentDate, meal_type: _recipeMealType })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.error || 'Errore nel salvataggio');
        return;
      }

      closeSaveAsRecipeModal();
      await refresh();
    } catch (e) {
      console.error('Save recipe error:', e);
      alert('Errore di rete');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Salva';
    }
  });

  return { refresh, setDate, get currentDate() { return currentDate; } };
})();
