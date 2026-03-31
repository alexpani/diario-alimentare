/* ==========================================
   settings.js — Tab Impostazioni
   ========================================== */

window.SettingsTab = (() => {
  async function refresh() {
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
