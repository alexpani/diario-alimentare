/* ==========================================
   settings.js — Tab Impostazioni
   ========================================== */

window.SettingsTab = (() => {
  // ── V4 Customization Setup ────────────────────────────────────────────
  function initV4Customization() {
    // Hero style buttons
    const heroStyle = localStorage.getItem('fd-hero-style') || 'ring';
    document.querySelectorAll('.hero-style-btn').forEach(btn => {
      btn.classList.toggle('btn-primary', btn.dataset.hero === heroStyle);
      btn.classList.toggle('btn-outline', btn.dataset.hero !== heroStyle);
      btn.addEventListener('click', () => {
        setHeroStyle(btn.dataset.hero);
        updateHeroStyleButtons();
      });
    });

    // Meal style buttons
    const mealStyle = localStorage.getItem('fd-meal-style') || 'photo';
    document.querySelectorAll('.meal-style-btn').forEach(btn => {
      btn.classList.toggle('btn-primary', btn.dataset.meal === mealStyle);
      btn.classList.toggle('btn-outline', btn.dataset.meal !== mealStyle);
      btn.addEventListener('click', () => {
        setMealStyle(btn.dataset.meal);
        updateMealStyleButtons();
      });
    });

    // Density buttons
    const density = localStorage.getItem('fd-density') || 'normal';
    document.querySelectorAll('.density-btn').forEach(btn => {
      btn.classList.toggle('btn-primary', btn.dataset.density === density);
      btn.classList.toggle('btn-outline', btn.dataset.density !== density);
      btn.addEventListener('click', () => {
        setDensity(btn.dataset.density);
        updateDensityButtons();
      });
    });

    // Palette color swatches
    const PALETTES = {
      green: 'oklch(48% 0.13 155)',
      olive: 'oklch(52% 0.09 125)',
      teal: 'oklch(52% 0.11 195)',
      forest: 'oklch(42% 0.10 150)',
      matcha: 'oklch(62% 0.14 140)',
      amber: 'oklch(58% 0.14 65)',
      terra: 'oklch(54% 0.14 35)',
      rose: 'oklch(58% 0.14 10)',
      plum: 'oklch(46% 0.13 340)',
      indigo: 'oklch(48% 0.16 275)',
      slate: 'oklch(40% 0.02 250)',
      graphite: 'oklch(28% 0.01 150)',
    };

    const palette = localStorage.getItem('fd-v4-palette') || 'green';
    const paletteEl = document.getElementById('palette-colors');
    paletteEl.innerHTML = Object.entries(PALETTES).map(([key, color]) => `
      <button class="palette-swatch ${key === palette ? 'active' : ''}" data-palette="${key}"
              style="width:100%;aspect-ratio:1/1;border-radius:8px;border:${key === palette ? '2px solid var(--v4p-accent-dark)' : '1px solid var(--color-border)'}; background:${color};cursor:pointer;transition:transform 0.12s ease" title="${key}"></button>
    `).join('');

    document.querySelectorAll('.palette-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        applyPalette(btn.dataset.palette);
        localStorage.setItem('fd-v4-palette', btn.dataset.palette);
        updatePaletteSwatches();
      });
    });
  }

  function updateHeroStyleButtons() {
    const style = localStorage.getItem('fd-hero-style') || 'ring';
    document.querySelectorAll('.hero-style-btn').forEach(btn => {
      btn.classList.toggle('btn-primary', btn.dataset.hero === style);
      btn.classList.toggle('btn-outline', btn.dataset.hero !== style);
    });
  }

  function updateMealStyleButtons() {
    const style = localStorage.getItem('fd-meal-style') || 'photo';
    document.querySelectorAll('.meal-style-btn').forEach(btn => {
      btn.classList.toggle('btn-primary', btn.dataset.meal === style);
      btn.classList.toggle('btn-outline', btn.dataset.meal !== style);
    });
    // Re-render meals to apply new style
    if (window.DiaryTab) window.DiaryTab.refresh?.();
  }

  function updateDensityButtons() {
    const level = localStorage.getItem('fd-density') || 'normal';
    document.querySelectorAll('.density-btn').forEach(btn => {
      btn.classList.toggle('btn-primary', btn.dataset.density === level);
      btn.classList.toggle('btn-outline', btn.dataset.density !== level);
    });
  }

  function updatePaletteSwatches() {
    const palette = localStorage.getItem('fd-v4-palette') || 'green';
    document.querySelectorAll('.palette-swatch').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.palette === palette);
      btn.style.border = btn.dataset.palette === palette ? '2px solid var(--v4p-accent-dark)' : '1px solid var(--color-border)';
    });
  }

  async function refresh() {
    // Initialize V4 customization
    initV4Customization();

    // ── Info app ─────────────────────────────────────────────────────────
    const info = await apiGet('/api/settings/info');
    if (info) {
      document.getElementById('app-info').innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;justify-content:space-between">
            <span style="color:var(--color-text-secondary);font-size:14px">Versione</span>
            <span style="font-weight:600;font-size:14px">v${info.version}</span>
          </div>
          <div style="display:flex;justify-content:space-between">
            <span style="color:var(--color-text-secondary);font-size:14px">Node.js</span>
            <span style="font-weight:600;font-size:14px">${info.node}</span>
          </div>
          <div style="display:flex;justify-content:space-between">
            <span style="color:var(--color-text-secondary);font-size:14px">App</span>
            <span style="font-weight:600;font-size:14px">${info.name}</span>
          </div>
        </div>
      `;
    }

    // ── Modello IA ───────────────────────────────────────────────────────
    const vm = await apiGet('/api/settings/vision-model');
    if (vm) {
      const sel = document.getElementById('vision-model-select');
      sel.innerHTML = vm.models.map(m =>
        `<option value="${m.key}"${m.key === vm.current ? ' selected' : ''}>${m.label}</option>`
      ).join('');
    }

    // ── Prompt IA ────────────────────────────────────────────────────────
    const vp = await apiGet('/api/settings/vision-prompt');
    if (vp) {
      document.getElementById('vision-prompt-text').value = vp.prompt;
      _defaultPrompt = vp.default_prompt;
    }
  }

  let _defaultPrompt = '';

  // ── Cambio modello IA ──────────────────────────────────────────────────
  document.getElementById('vision-model-select').addEventListener('change', async (e) => {
    const msgEl = document.getElementById('vision-model-msg');
    msgEl.classList.add('hidden');
    const res = await apiPut('/api/settings/vision-model', { model_key: e.target.value });
    if (res && !res.error) {
      showMsg(msgEl, 'Modello aggiornato', 'success');
    } else {
      showMsg(msgEl, res?.error || 'Errore', 'error');
    }
  });

  // ── Toggle prompt IA ──────────────────────────────────────────────────
  document.getElementById('btn-toggle-prompt').addEventListener('click', () => {
    const wrap = document.getElementById('vision-prompt-wrap');
    const btn = document.getElementById('btn-toggle-prompt');
    const visible = !wrap.classList.toggle('hidden');
    btn.textContent = visible ? 'Nascondi prompt' : 'Mostra prompt';
  });

  // ── Salva prompt ──────────────────────────────────────────────────────
  document.getElementById('btn-save-prompt').addEventListener('click', async () => {
    const msgEl = document.getElementById('vision-prompt-msg');
    msgEl.classList.add('hidden');
    const prompt = document.getElementById('vision-prompt-text').value;
    const res = await apiPut('/api/settings/vision-prompt', { prompt });
    if (res && !res.error) {
      showMsg(msgEl, 'Prompt salvato', 'success');
    } else {
      showMsg(msgEl, res?.error || 'Errore', 'error');
    }
  });

  // ── Ripristina default ────────────────────────────────────────────────
  document.getElementById('btn-reset-prompt').addEventListener('click', async () => {
    const msgEl = document.getElementById('vision-prompt-msg');
    msgEl.classList.add('hidden');
    const res = await fetch('/api/settings/vision-prompt', { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      document.getElementById('vision-prompt-text').value = _defaultPrompt;
      showMsg(msgEl, 'Prompt ripristinato al default', 'success');
    } else {
      showMsg(msgEl, data.error || 'Errore', 'error');
    }
  });

  document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('pass-msg');
    msgEl.classList.add('hidden');

    const current = document.getElementById('curr-pass').value;
    const newPass = document.getElementById('new-pass').value;
    const confirm = document.getElementById('confirm-pass').value;

    if (newPass !== confirm) {
      showMsg(msgEl, 'Le password non coincidono', 'error');
      return;
    }
    if (newPass.length < 6) {
      showMsg(msgEl, 'La password deve essere di almeno 6 caratteri', 'error');
      return;
    }

    const res = await apiPatch('/api/settings/password', {
      current_password: current,
      new_password: newPass
    });

    if (res && !res.error) {
      showMsg(msgEl, 'Password aggiornata. Effettua di nuovo il login.', 'success');
      document.getElementById('password-form').reset();
      setTimeout(() => {
        showLogin();
      }, 2000);
    } else {
      showMsg(msgEl, res?.error || 'Errore durante l\'aggiornamento', 'error');
    }
  });

  // ── Sync verso Food Tracker ─────────────────────────────────────────────
  document.getElementById('btn-sync-tracker').addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync-tracker');
    const resultEl = document.getElementById('sync-tracker-result');
    btn.disabled = true;
    btn.textContent = '⏳ Sincronizzazione in corso…';
    resultEl.classList.add('hidden');

    try {
      const res = await fetch('/api/settings/sync-tracker', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        showMsg(resultEl, data.error || 'Errore durante la sincronizzazione', 'error');
      } else {
        const { total, created, updated, skipped, errors } = data;
        const lines = [
          `Totale alimenti: ${total}`,
          created  ? `✓ Creati: ${created}`    : '',
          updated  ? `✓ Aggiornati: ${updated}` : '',
          skipped  ? `— Invariati: ${skipped}`  : '',
          errors   ? `✗ Errori: ${errors}`      : '',
        ].filter(Boolean).join('<br>');
        showMsg(resultEl, lines, errors ? 'error' : 'success');
      }
    } catch (e) {
      showMsg(resultEl, 'Impossibile raggiungere il server', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '↑ Sincronizza verso Food Tracker';
    }
  });

  return { refresh };
})();
