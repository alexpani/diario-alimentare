/* ==========================================
   app.js — Core SPA: routing, auth, utils
   ========================================== */

// Stato globale
window.App = {
  currentTab: 'home',
  plan: { kcal_target: 2000, protein_pct: 30, fat_pct: 30, carbs_pct: 40 }
};

// ── Fetch wrapper ──────────────────────────
async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options
    });
    if (res.status === 401) {
      localStorage.removeItem('fd-auth-ok');
      showLogin();
      return null;
    }
    return res;
  } catch (err) {
    // Errore di rete (offline, server down): non invalidiamo la sessione
    console.warn('Fetch error (offline?):', url);
    return null;
  }
}

async function apiGet(url) {
  const res = await apiFetch(url);
  if (!res) return null;
  return res.json();
}

async function apiPost(url, body) {
  const res = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
  if (!res) return null;
  return res.json();
}

async function apiPut(url, body) {
  const res = await apiFetch(url, { method: 'PUT', body: JSON.stringify(body) });
  if (!res) return null;
  return res.json();
}

async function apiDelete(url) {
  const res = await apiFetch(url, { method: 'DELETE' });
  if (!res) return null;
  return res.json();
}

async function apiPatch(url, body) {
  const res = await apiFetch(url, { method: 'PATCH', body: JSON.stringify(body) });
  if (!res) return null;
  return res.json();
}

// ── Utility ───────────────────────────────
function fmt(n, decimals = 1) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return parseFloat(n.toFixed(decimals)).toString();
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const todayStr = today.toISOString().slice(0, 10);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const dayMonth = d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }).toUpperCase();

  if (dateStr === todayStr) return `OGGI, ${dayMonth}`;
  if (dateStr === yesterdayStr) return `IERI, ${dayMonth}`;

  const weekday = d.toLocaleDateString('it-IT', { weekday: 'long' }).toUpperCase();
  return `${weekday}, ${dayMonth}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function showMsg(el, text, type = 'success') {
  el.textContent = text;
  el.className = `msg ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

// ── Confirm dialog ─────────────────────────
function showConfirm(title, message) {
  return new Promise(resolve => {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').innerHTML = message;
    const modal = document.getElementById('modal-confirm');
    modal.classList.remove('hidden');

    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    const backdrop = document.getElementById('modal-confirm-backdrop');

    function cleanup(result) {
      modal.classList.add('hidden');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onCancel);
      resolve(result);
    }
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onCancel);
  });
}

// ── Auth ──────────────────────────────────
function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

async function checkAuth() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      localStorage.setItem('fd-auth-ok', '1');
      showApp();
      initApp();
    } else {
      localStorage.removeItem('fd-auth-ok');
      showLogin();
    }
  } catch (err) {
    // Errore di rete (offline): se eravamo loggati prima, mostra comunque
    // la shell dell'app. Le singole chiamate API degradano a null.
    if (localStorage.getItem('fd-auth-ok') === '1') {
      console.warn('Offline: mostro shell da cache');
      showApp();
      initApp();
    } else {
      showLogin();
    }
  }
}

// ── Login form ────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');

  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  if (res.ok) {
    localStorage.setItem('fd-auth-ok', '1');
    showApp();
    initApp();
  } else {
    const data = await res.json();
    errEl.textContent = data.error || 'Credenziali non valide';
    errEl.classList.remove('hidden');
  }
});

// ── Logout ────────────────────────────────
document.getElementById('btn-logout').addEventListener('click', async () => {
  try { await fetch('/logout', { method: 'POST' }); } catch (e) { /* offline: procediamo comunque */ }
  localStorage.removeItem('fd-auth-ok');
  showLogin();
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
});

// ── Header settings button ───────────────
document.getElementById('btn-header-settings').addEventListener('click', () => {
  switchTab('impostazioni');
});

// ── Tab routing ───────────────────────────
const tabTitles = {
  home: 'FoodDiary',
  diario: 'Diario',
  alimenti: 'Alimenti',
  piano: 'Piano',
  impostazioni: 'Impostazioni'
};

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    switchTab(tab);
  });
});

function switchTab(tab) {
  App.currentTab = tab;

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  document.getElementById('header-title').textContent = tabTitles[tab] || 'FoodDiary';

  // Refresh del tab attivato
  if (tab === 'home') window.DiaryTab?.refresh();
  if (tab === 'diario') window.DiaryLog?.refresh();
  if (tab === 'alimenti') {
    const searchEl = document.getElementById('foods-search');
    if (searchEl) searchEl.value = '';
    window.FoodsTab?.refresh();
  }
  if (tab === 'piano') window.PlanTab?.refresh();
  if (tab === 'impostazioni') {
    window.SettingsTab?.refresh();
    const saved = localStorage.getItem('fd-theme') || 'auto';
    document.querySelectorAll('.theme-btn').forEach(btn => {
      const active = btn.dataset.themeVal === saved;
      btn.classList.toggle('btn-primary', active);
      btn.classList.toggle('btn-outline', !active);
    });
  }
}

// ── Init ──────────────────────────────────
async function initApp() {
  // Carica piano attivo
  const plan = await apiGet('/api/plan');
  if (plan) {
    App.plan = plan;
    // Mostra nome piano attivo sotto il gauge
    const nameEl = document.getElementById('active-plan-name');
    if (nameEl && plan.name) nameEl.textContent = plan.name;
  }

  // Avvia tab home
  switchTab('home');

  // Pre-cache di tutto il contenuto per uso offline (background, non bloccante)
  setTimeout(() => { warmCache().catch(() => {}); }, 1500);
}

// ── Offline warm-cache ────────────────────
// Scarica proattivamente in background tutte le risorse che il SW tiene
// in cache, così l'app funziona completamente offline anche per giorni/foods
// mai aperti dall'utente. Rispetta navigator.onLine e limita la concorrenza.
async function warmCache() {
  if (!navigator.onLine) return;
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;

  const MEALS = ['colazione','spuntino_mattino','pranzo','spuntino_pomeriggio','cena','extra'];
  const urls = [];

  // Piano
  urls.push('/api/plan', '/api/plan/all');

  // Libreria alimenti completa
  urls.push('/api/foods?limit=10000');

  // Recenti e frequenti per ogni pasto
  for (const m of MEALS) {
    urls.push(`/api/diary/recent?meal_type=${m}&limit=12`);
    urls.push(`/api/diary/frequent?meal_type=${m}&limit=12`);
  }

  // Range calendario: ultimi 3 mesi
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  for (let offset = -2; offset <= 0; offset++) {
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const last  = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    urls.push(`/api/diary/range?from=${fmt(first)}&to=${fmt(last)}`);
  }

  // Lista di tutti i giorni con voci (per scoprire cosa c'è da pre-cacheare)
  try {
    const daysRes = await fetch('/api/diary/days?limit=1000');
    if (daysRes.ok) {
      const days = await daysRes.json();
      for (const d of days) urls.push(`/api/diary?date=${d.date}`);
      console.log('[warmCache]', days.length, 'giorni di diario da pre-cacheare');
    }
  } catch (e) { /* offline o errore, proseguiamo con il resto */ }

  // Esegui i fetch con concorrenza limitata (max 6) per non saturare il server
  await fetchBatch(urls, 6);
  console.log('[warmCache] completato');
}

async function fetchBatch(urls, concurrency = 6) {
  const queue = urls.slice();
  const workers = Array(Math.min(concurrency, queue.length)).fill(null).map(async () => {
    while (queue.length) {
      const url = queue.shift();
      try { await fetch(url); } catch (e) { /* ignora, il SW farà fallback */ }
    }
  });
  await Promise.all(workers);
}

// ── Calendario custom ─────────────────────
const Cal = (() => {
  let viewYear = 0;
  let viewMonth = 0; // 0-11
  let daysData = {}; // { 'YYYY-MM-DD': { kcal } }

  const overlay  = document.getElementById('cal-overlay');
  const popup    = document.getElementById('cal-popup');
  const grid     = document.getElementById('cal-grid');
  const monthLbl = document.getElementById('cal-month-label');

  // Fix iOS: position:fixed non funziona bene dentro contenitori con
  // -webkit-overflow-scrolling: touch (.tab-content). Lo spostiamo al body.
  if (overlay && overlay.parentElement !== document.body) {
    document.body.appendChild(overlay);
  }

  const MONTHS_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                     'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

  async function loadDaysWithEntries(year, month) {
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const to   = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;
    const data = await apiGet(`/api/diary/range?from=${from}&to=${to}`);
    if (data) data.forEach(d => { daysData[d.date] = { kcal: d.kcal, kcal_target: d.kcal_target }; });
  }

  function render() {
    monthLbl.textContent = `${MONTHS_IT[viewMonth]} ${viewYear}`;

    const firstDay = new Date(viewYear, viewMonth, 1);
    // lunedì = 0 ... domenica = 6
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const today = todayStr();
    const selected = window.DiaryTab?.currentDate || today;

    let html = '';
    // Celle vuote prima del primo giorno
    for (let i = 0; i < startOffset; i++) html += '<div class="cal-cell cal-empty"></div>';

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isSel   = dateStr === selected;
      const isToday = dateStr === today;
      const dayInfo = daysData[dateStr];
      const isFuture = dateStr > today;

      let ringClass = '';
      if (dayInfo) {
        const target = dayInfo.kcal_target ?? App.plan?.kcal_target ?? 2000;
        const diff = dayInfo.kcal - target;
        if (diff <= 0) ringClass = 'cal-ring-green';
        else if (diff <= 200) ringClass = 'cal-ring-yellow';
        else ringClass = 'cal-ring-red';
      }

      html += `<div class="cal-cell${isSel ? ' cal-selected' : ''}${isToday ? ' cal-today' : ''}${isFuture ? ' cal-future' : ''}${ringClass ? ' ' + ringClass : ''}" data-date="${dateStr}">
        <span>${d}</span>
      </div>`;
    }

    grid.innerHTML = html;

    grid.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', () => {
        if (_pickResolve) {
          const r = _pickResolve; _pickResolve = null;
          overlay.classList.add('hidden');
          overlay.classList.remove('cal-pick-mode');
          overlay.style.zIndex = '';
          r(cell.dataset.date);
        } else {
          window.DiaryTab?.setDate(cell.dataset.date);
          close();
        }
      });
    });
  }

  // Modalità "picker": se attiva, il click su un giorno risolve la Promise invece di chiamare setDate.
  let _pickResolve = null;

  async function open(initialDate) {
    // Se chiamato come event listener, initialDate può essere un MouseEvent → ignora
    if (typeof initialDate !== 'string') initialDate = null;
    const cur = initialDate || window.DiaryTab?.currentDate || todayStr();
    const [y, m] = cur.split('-').map(Number);
    viewYear  = y;
    viewMonth = m - 1;
    daysData = {};
    await loadDaysWithEntries(viewYear, viewMonth);
    render();
    overlay.classList.remove('hidden');
  }

  function close() {
    overlay.classList.add('hidden');
    overlay.classList.remove('cal-pick-mode');
    overlay.style.zIndex = '';
    if (_pickResolve) { const r = _pickResolve; _pickResolve = null; r(null); }
  }

  // Apre il calendario come picker: ritorna Promise<string|null> con la data scelta o null se annullato.
  async function pick(initialDate) {
    overlay.style.zIndex = '500'; // sopra ai modali (z-index 200)
    overlay.classList.add('cal-pick-mode'); // sblocca giorni futuri
    await open(initialDate);
    return new Promise(resolve => { _pickResolve = resolve; });
  }

  async function changeMonth(delta) {
    viewMonth += delta;
    if (viewMonth < 0)  { viewMonth = 11; viewYear--; }
    if (viewMonth > 11) { viewMonth = 0;  viewYear++; }
    await loadDaysWithEntries(viewYear, viewMonth);
    render();
  }

  document.getElementById('cal-prev-month').addEventListener('click', (e) => { e.stopPropagation(); changeMonth(-1); });
  document.getElementById('cal-next-month').addEventListener('click', (e) => { e.stopPropagation(); changeMonth(+1); });
  document.getElementById('cal-today').addEventListener('click', (e) => {
    e.stopPropagation();
    if (_pickResolve) {
      const r = _pickResolve; _pickResolve = null;
      overlay.classList.add('hidden');
      overlay.style.zIndex = '';
      r(todayStr());
    } else {
      window.DiaryTab?.setDate(todayStr());
      close();
    }
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  popup.addEventListener('click', (e) => e.stopPropagation());

  document.getElementById('current-date-btn').addEventListener('click', open);

  return { open, close, pick, refresh: () => { daysData = {}; loadDaysWithEntries(viewYear, viewMonth).then(render); } };
})();
window.Cal = Cal;

// ── Theme ──────────────────────────────────
const Theme = (() => {
  const STORAGE_KEY = 'fd-theme'; // 'auto' | 'light' | 'dark'
  let _mq = null;

  function apply(mode) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = mode === 'dark' || (mode === 'auto' && prefersDark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    // Aggiorna meta theme-color
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#4CAF50';
  }

  function set(mode) {
    localStorage.setItem(STORAGE_KEY, mode);
    apply(mode);
    updateButtons(mode);
    // Listener sistema (solo in auto)
    if (_mq) { _mq.removeEventListener('change', _onSystemChange); _mq = null; }
    if (mode === 'auto') {
      _mq = window.matchMedia('(prefers-color-scheme: dark)');
      _mq.addEventListener('change', _onSystemChange);
    }
  }

  function _onSystemChange() { apply('auto'); }

  function init() {
    const saved = localStorage.getItem(STORAGE_KEY) || 'auto';
    set(saved);
  }

  function updateButtons(mode) {
    document.querySelectorAll('.theme-btn').forEach(btn => {
      const active = btn.dataset.themeVal === mode;
      btn.classList.toggle('btn-primary', active);
      btn.classList.toggle('btn-outline', !active);
    });
  }

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => set(btn.dataset.themeVal));
  });

  return { init, set };
})();

Theme.init();

// ── Start ─────────────────────────────────
checkAuth();
