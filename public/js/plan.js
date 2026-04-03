/* ==========================================
   plan.js — Tab Piano: gestione multi-piano
   ========================================== */

window.PlanTab = (() => {
  let plans = [];
  let editingId = null;

  // ── Aggiorna nome piano attivo in home ─────
  function updateActivePlanName(name) {
    const el = document.getElementById('active-plan-name');
    if (el) el.textContent = name || '';
  }

  // ── Render lista piani ──────────────────────
  function renderList() {
    const container = document.getElementById('plans-list');
    if (!plans.length) {
      container.innerHTML = '<div class="card"><p style="color:var(--color-text-secondary)">Nessun piano. Creane uno!</p></div>';
      return;
    }
    container.innerHTML = plans.map(p => {
      const proteinG = p.kcal_target > 0 ? Math.round((p.kcal_target * p.protein_pct / 100) / 4) : 0;
      const fatG     = p.kcal_target > 0 ? Math.round((p.kcal_target * p.fat_pct    / 100) / 9) : 0;
      const carbsG   = p.kcal_target > 0 ? Math.round((p.kcal_target * p.carbs_pct  / 100) / 4) : 0;
      return `
        <div class="card plan-card${p.is_active ? ' plan-card-active' : ''}">
          <div class="plan-card-header">
            <div class="plan-card-info">
              <div class="plan-card-name">
                ${p.name}
                ${p.is_active ? '<span class="plan-badge-active">Attivo</span>' : ''}
              </div>
              <div class="plan-card-kcal">${p.kcal_target} kcal / giorno</div>
            </div>
            <div class="plan-card-actions">
              ${!p.is_active ? `<button class="btn btn-sm btn-primary" onclick="PlanTab.activate(${p.id})">Attiva</button>` : ''}
              <button class="btn btn-sm btn-outline" onclick="PlanTab.edit(${p.id})">Modifica</button>
              ${!p.is_active ? `<button class="btn btn-sm btn-danger" onclick="PlanTab.deletePlan(${p.id})">✕</button>` : ''}
            </div>
          </div>
          <div class="plan-card-macros">
            <span class="plan-macro plan-macro-p">P ${p.protein_pct}% · ≈${proteinG}g</span>
            <span class="plan-macro plan-macro-f">G ${p.fat_pct}% · ≈${fatG}g</span>
            <span class="plan-macro plan-macro-c">C ${p.carbs_pct}% · ≈${carbsG}g</span>
          </div>
        </div>`;
    }).join('');
  }

  // ── Mostra/nascondi form ────────────────────
  function showForm(plan) {
    editingId = plan ? plan.id : null;
    document.getElementById('plan-form-card').style.display = '';
    document.getElementById('plan-form-title').textContent = plan ? 'Modifica piano' : 'Nuovo piano';
    document.getElementById('plan-editing-id').value  = plan ? plan.id : '';
    document.getElementById('plan-name').value         = plan ? plan.name        : '';
    document.getElementById('plan-kcal').value         = plan ? plan.kcal_target : 2000;
    document.getElementById('plan-protein').value      = plan ? plan.protein_pct : 30;
    document.getElementById('plan-fat').value          = plan ? plan.fat_pct     : 30;
    document.getElementById('plan-carbs').value        = plan ? plan.carbs_pct   : 40;
    document.getElementById('plan-msg').classList.add('hidden');
    updateLabels();
    document.getElementById('plan-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function hideForm() {
    document.getElementById('plan-form-card').style.display = 'none';
    document.getElementById('plan-msg').classList.add('hidden');
    editingId = null;
  }

  // ── Aggiorna label + grammi live ───────────
  function updateLabels() {
    const kcal    = parseFloat(document.getElementById('plan-kcal').value)    || 0;
    const protein = parseFloat(document.getElementById('plan-protein').value) || 0;
    const fat     = parseFloat(document.getElementById('plan-fat').value)     || 0;
    const carbs   = parseFloat(document.getElementById('plan-carbs').value)   || 0;
    const total   = protein + fat + carbs;

    document.getElementById('protein-pct-label').textContent = `${protein}%`;
    document.getElementById('fat-pct-label').textContent     = `${fat}%`;
    document.getElementById('carbs-pct-label').textContent   = `${carbs}%`;

    if (kcal > 0) {
      document.getElementById('protein-grams').textContent = `≈ ${Math.round((kcal * protein / 100) / 4)}g`;
      document.getElementById('fat-grams').textContent     = `≈ ${Math.round((kcal * fat     / 100) / 9)}g`;
      document.getElementById('carbs-grams').textContent   = `≈ ${Math.round((kcal * carbs   / 100) / 4)}g`;
    }

    const badge = document.getElementById('plan-total-badge');
    const ok = Math.abs(total - 100) < 0.5;
    badge.textContent = ok ? '✓ Totale: 100%' : `Totale: ${total}% (deve essere 100%)`;
    badge.className   = `total-badge ${ok ? 'ok' : 'error'}`;
    badge.classList.remove('hidden');
  }

  // ── Refresh ─────────────────────────────────
  async function refresh() {
    plans = await apiGet('/api/plan/all') || [];
    renderList();
    const active = plans.find(p => p.is_active) || plans[0];
    if (active) {
      App.plan = active;
      updateActivePlanName(active.name);
    }
  }

  // ── Attiva piano ────────────────────────────
  async function activate(id) {
    const date = window.DiaryTab?.currentDate || new Date().toISOString().slice(0, 10);
    const res = await apiPost(`/api/plan/${id}/activate`, { date });
    if (res && !res.error) {
      App.plan = res;
      updateActivePlanName(res.name);
      await refresh();
      window.DiaryTab?.refresh();
    }
  }

  // ── Modifica piano ──────────────────────────
  function edit(id) {
    const plan = plans.find(p => p.id === id);
    if (plan) showForm(plan);
  }

  // ── Elimina piano ───────────────────────────
  async function deletePlan(id) {
    const plan = plans.find(p => p.id === id);
    if (!plan) return;
    const ok = await showConfirm('Elimina piano', `Eliminare il piano <strong>${plan.name}</strong>?`);
    if (!ok) return;
    const res = await apiDelete(`/api/plan/${id}`);
    if (res && res.ok) await refresh();
  }

  // ── Event listeners ─────────────────────────
  ['plan-kcal', 'plan-protein', 'plan-fat', 'plan-carbs'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateLabels);
  });

  document.getElementById('btn-new-plan').addEventListener('click', () => showForm(null));
  document.getElementById('btn-cancel-plan').addEventListener('click', hideForm);

  document.getElementById('plan-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('plan-msg');

    const name        = document.getElementById('plan-name').value.trim() || 'Piano';
    const kcal_target = parseFloat(document.getElementById('plan-kcal').value);
    const protein_pct = parseFloat(document.getElementById('plan-protein').value);
    const fat_pct     = parseFloat(document.getElementById('plan-fat').value);
    const carbs_pct   = parseFloat(document.getElementById('plan-carbs').value);
    const total       = protein_pct + fat_pct + carbs_pct;

    if (Math.abs(total - 100) > 0.5) {
      showMsg(msgEl, 'Le percentuali devono sommare 100%', 'error');
      return;
    }

    const date = window.DiaryTab?.currentDate || new Date().toISOString().slice(0, 10);
    const body = { name, kcal_target, protein_pct, fat_pct, carbs_pct, date };
    const res  = editingId
      ? await apiPut(`/api/plan/${editingId}`, body)
      : await apiPost('/api/plan/new', body);

    if (res && !res.error) {
      showMsg(msgEl, editingId ? 'Piano aggiornato!' : 'Piano creato!', 'success');
      // Se era il piano attivo, aggiorna App.plan
      const wasActive = plans.find(p => p.id === editingId)?.is_active;
      if (wasActive) { App.plan = { ...App.plan, ...body }; updateActivePlanName(name); }
      setTimeout(() => { hideForm(); refresh(); }, 900);
    } else {
      showMsg(msgEl, res?.error || 'Errore nel salvataggio', 'error');
    }
  });

  return { refresh, activate, edit, deletePlan };
})();
