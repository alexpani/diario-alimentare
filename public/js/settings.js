/* ==========================================
   settings.js — Tab Impostazioni
   ========================================== */

window.SettingsTab = (() => {
  async function refresh() {
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

    // Carica credenziali OFF
    const off = await apiGet('/api/settings/off');
    if (off) {
      document.getElementById('off-user').value = off.user || '';
      document.getElementById('off-pass').value = off.pass || '';
    }
  }

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

  // Clear cache
  document.getElementById('btn-clear-cache').addEventListener('click', async () => {
    const msgEl = document.getElementById('clear-cache-msg');
    const res = await apiPost('/api/foods/clear-cache', {});
    if (res && !res.error) {
      showMsg(msgEl, 'Cache azzerate', 'success');
    } else {
      showMsg(msgEl, res?.error || 'Errore', 'error');
    }
  });

  // OFF credentials form
  document.getElementById('off-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('off-msg');
    msgEl.classList.add('hidden');

    const user = document.getElementById('off-user').value.trim();
    const pass = document.getElementById('off-pass').value;

    const res = await apiPut('/api/settings/off', { user, pass });
    if (res && !res.error) {
      showMsg(msgEl, 'Credenziali OFF salvate', 'success');
    } else {
      showMsg(msgEl, res?.error || 'Errore nel salvataggio', 'error');
    }
  });

  return { refresh };
})();
