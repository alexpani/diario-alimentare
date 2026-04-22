/* ==========================================
   diarylog.js — Tab Diario: storico + grafici
   ========================================== */

window.DiaryLog = (() => {
  let weeklyChart = null;
  let macrosChart = null;

  // Leggi colori dalla palette CSS
  function cssColor(name, alpha = 1) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (alpha >= 1) return v;
    // Converte hex → rgba
    const r = parseInt(v.slice(1, 3), 16), g = parseInt(v.slice(3, 5), 16), b = parseInt(v.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  async function refresh() {
    _rangeCache = {};
    await Promise.all([
      loadDays(),
      loadWeeklyAvg(),
      loadWeeklyChart(),
      loadMacrosChart()
    ]);
  }

  // ── Media 7 giorni (rolling) ───────────────
  // Esclude il giorno corrente perché potenzialmente non completo.
  // Intervallo: da ieri-6 a ieri (7 giorni completi).
  async function loadWeeklyAvg() {
    const toDate = new Date();
    toDate.setDate(toDate.getDate() - 1);
    const to = toDate.toISOString().slice(0, 10);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 7);
    const from = fromDate.toISOString().slice(0, 10);

    const data = await apiGet(`/api/diary/range?from=${from}&to=${to}`);
    const plan = App.plan || {};

    // Costruisce 7 giorni consecutivi: kcal effettive + target del giorno (snapshot → fallback piano attivo)
    const days = [];
    for (let i = 7; i >= 1; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const entry = data?.find(e => e.date === dateStr);
      days.push({
        date: dateStr,
        kcal: entry ? entry.kcal : 0,
        target: entry?.kcal_target || plan.kcal_target || 0,
        hasEntry: !!entry
      });
    }

    const daysWithEntries = days.filter(d => d.hasEntry).length;
    const avgKcal = days.reduce((s, d) => s + d.kcal, 0) / 7;
    const avgTarget = days.reduce((s, d) => s + d.target, 0) / 7;
    const cumDiff = days.reduce((s, d) => s + (d.kcal - d.target), 0);
    const dailyDiff = avgKcal - avgTarget;

    // Semaforo (stessa logica del calendario Home)
    let dotClass = '';
    let diffClass = 'under';
    if (avgTarget > 0) {
      if (dailyDiff <= 0)       { dotClass = 'green';  diffClass = 'under'; }
      else if (dailyDiff <= 200) { dotClass = 'yellow'; diffClass = 'mild';  }
      else                       { dotClass = 'red';    diffClass = 'over';  }
    }

    const fmtSigned = v => (v > 0 ? '+' : '') + Math.round(v);

    document.getElementById('weekly-avg-kcal').textContent = avgTarget > 0 ? Math.round(avgKcal) : '—';
    document.getElementById('weekly-avg-target').textContent = avgTarget > 0
      ? `${Math.round(avgTarget)} kcal`
      : '—';

    const diffEl = document.getElementById('weekly-avg-diff');
    diffEl.className = 'weekly-avg-diff ' + diffClass;
    diffEl.textContent = avgTarget > 0 ? `${fmtSigned(dailyDiff)} kcal/giorno` : '—';

    const cumEl = document.getElementById('weekly-avg-cum');
    // Bilancio settimanale: stessa classe di scostamento
    cumEl.className = 'weekly-avg-cum ' + diffClass;
    cumEl.textContent = avgTarget > 0 ? `${fmtSigned(cumDiff)} kcal` : '—';

    const dot = document.getElementById('weekly-avg-dot');
    dot.className = 'weekly-avg-dot ' + dotClass;

    // Hint interpretativo: converte il bilancio in grammi di grasso (~7700 kcal/kg)
    const hint = document.getElementById('weekly-avg-hint');
    if (avgTarget > 0 && daysWithEntries > 0) {
      const kgEq = Math.abs(cumDiff) / 7700;
      const grams = Math.round(kgEq * 1000);
      let msg = '';
      if (daysWithEntries < 7) {
        msg = `Dati da ${daysWithEntries}/7 giorni: i giorni senza voci contano come 0 kcal.`;
      } else if (Math.abs(cumDiff) < 300) {
        msg = 'Settimana in linea col target.';
      } else if (cumDiff < 0) {
        msg = `Deficit settimanale ≈ ${grams} g di grasso.`;
      } else {
        msg = `Surplus settimanale ≈ ${grams} g di grasso.`;
      }
      hint.textContent = msg;
    } else {
      hint.textContent = '';
    }
  }

  // ── Lista giorni ────────────────────────
  async function loadDays() {
    const days = await apiGet('/api/diary/days?limit=60');
    const plan = App.plan;
    const container = document.getElementById('diary-list');

    if (!days || days.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">📅</div>
          <p>Nessun dato registrato ancora.</p>
        </div>`;
      return;
    }

    container.innerHTML = days.map(d => {
      const date = new Date(d.date + 'T00:00:00');
      const day = date.getDate();
      const weekday = date.toLocaleDateString('it-IT', { weekday: 'short' }).toUpperCase();
      const month = date.toLocaleDateString('it-IT', { month: 'short' });
      const pct = plan.kcal_target > 0 ? Math.round((d.kcal / plan.kcal_target) * 100) : 0;
      const isOver = pct > 110;

      return `
        <div class="diary-day-card" data-date="${d.date}">
          <div class="diary-day-date">
            <div class="diary-day-weekday">${weekday}</div>
            <div class="diary-day-num">${day}</div>
            <div class="diary-day-month">${month}</div>
          </div>
          <div class="diary-day-info">
            <div class="diary-day-kcal">${Math.round(d.kcal)} kcal</div>
            <div class="diary-day-macros">P:${fmt(d.protein)}g · G:${fmt(d.fat)}g · C:${fmt(d.carbs)}g</div>
          </div>
          <div class="diary-day-pct ${isOver ? 'over' : ''}">${pct}%</div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.diary-day-card').forEach(card => {
      card.addEventListener('click', () => {
        window.DiaryTab?.setDate(card.dataset.date);
        switchTab('home');
      });
    });
  }

  // ── Grafico settimanale kcal ─────────────
  async function loadWeeklyChart() {
    const to = todayStr();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 6);
    const from = fromDate.toISOString().slice(0, 10);

    const data = await apiGet(`/api/diary/range?from=${from}&to=${to}`);
    const plan = App.plan;

    // Genera tutti i 7 giorni (anche quelli senza dati)
    const labels = [];
    const kcalValues = [];
    const targetValues = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' });
      labels.push(label);

      const entry = data?.find(e => e.date === dateStr);
      kcalValues.push(entry ? Math.round(entry.kcal) : 0);
      targetValues.push(plan.kcal_target);
    }

    // Aggiorna titolo con target
    const titleEl = document.getElementById('chart-weekly-title');
    if (titleEl) titleEl.textContent = `Calorie ultimi 7 giorni. Target: ${Math.round(plan.kcal_target)} kcal`;

    const ctx = document.getElementById('chart-weekly').getContext('2d');

    if (weeklyChart) weeklyChart.destroy();

    weeklyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Kcal',
            data: kcalValues,
            backgroundColor: kcalValues.map((v, i) => {
              if (i === 6) return cssColor('--color-primary', 0.9);
              return cssColor('--color-primary', 0.5);
            }),
            borderRadius: 6,
            order: 2
          },
          {
            label: 'Target',
            data: targetValues,
            type: 'line',
            borderColor: cssColor('--color-danger', 0.7),
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false,
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ctx.dataset.label === 'Target'
                ? `Target: ${ctx.raw} kcal`
                : `${ctx.raw} kcal`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: cssColor('--color-border', 0.5) },
            ticks: { maxTicksLimit: 5 }
          },
          x: { grid: { display: false } }
        }
      }
    });
  }

  // ── Grafico macros medi ─────────────────
  let _macrosDays = 7;
  let _rangeCache = {}; // { '7': [...], '30': [...] }

  async function loadMacrosChart(days) {
    if (days !== undefined) _macrosDays = days;
    const numDays = _macrosDays;

    const to = todayStr();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - (numDays - 1));
    const from = fromDate.toISOString().slice(0, 10);

    // Cache per evitare chiamate duplicate
    if (!_rangeCache[numDays]) {
      _rangeCache[numDays] = await apiGet(`/api/diary/range?from=${from}&to=${to}`);
    }
    const data = _rangeCache[numDays];

    const canvasEl = document.getElementById('chart-macros');
    const card = canvasEl.parentElement;
    const legendEl = document.getElementById('chart-macros-legend');
    const devEl = document.getElementById('chart-macros-deviation');
    const emptyEl = document.getElementById('chart-macros-empty');
    card.style.display = '';

    // Aggiorna tab attivo e titolo
    document.querySelectorAll('.macros-tab').forEach(t => {
      t.classList.toggle('active', parseInt(t.dataset.macrosDays) === numDays);
    });
    const titleMacros = document.getElementById('chart-macros-title');
    if (titleMacros) titleMacros.textContent = `Macro medi ultimi ${numDays} giorni`;

    // Stato vuoto: nessun dato nel periodo
    if (!data || data.length === 0) {
      if (macrosChart) { macrosChart.destroy(); macrosChart = null; }
      canvasEl.classList.add('hidden');
      if (legendEl) { legendEl.innerHTML = ''; legendEl.classList.add('hidden'); }
      if (devEl) { devEl.innerHTML = ''; devEl.classList.add('hidden'); }
      if (emptyEl) {
        const otherDays = numDays === 7 ? 30 : 7;
        emptyEl.classList.remove('hidden');
        emptyEl.innerHTML = `
          <div class="chart-empty-icon">📊</div>
          <div class="chart-empty-msg">Nessuna voce negli ultimi ${numDays} giorni.</div>
          <button class="btn btn-outline chart-empty-btn" data-switch-days="${otherDays}">
            Prova ultimi ${otherDays} giorni
          </button>
        `;
        const switchBtn = emptyEl.querySelector('[data-switch-days]');
        if (switchBtn) switchBtn.addEventListener('click', () => loadMacrosChart(otherDays));
      }
      return;
    }

    // Dati presenti: mostra chart e nascondi empty state
    canvasEl.classList.remove('hidden');
    if (legendEl) legendEl.classList.remove('hidden');
    if (devEl) devEl.classList.remove('hidden');
    if (emptyEl) { emptyEl.classList.add('hidden'); emptyEl.innerHTML = ''; }

    const avgProtein = data.reduce((s, d) => s + d.protein, 0) / data.length;
    const avgFat = data.reduce((s, d) => s + d.fat, 0) / data.length;
    const avgCarbs = data.reduce((s, d) => s + d.carbs, 0) / data.length;

    // Percentuali kcal dai macro
    const proteinKcal = avgProtein * 4;
    const fatKcal = avgFat * 9;
    const carbsKcal = avgCarbs * 4;
    const totalKcal = proteinKcal + fatKcal + carbsKcal;
    const proteinPct = totalKcal > 0 ? Math.round(proteinKcal / totalKcal * 100) : 0;
    const fatPct = totalKcal > 0 ? Math.round(fatKcal / totalKcal * 100) : 0;
    const carbsPct = totalKcal > 0 ? 100 - proteinPct - fatPct : 0;

    // Legenda con grammi e percentuali
    if (legendEl) {
      legendEl.innerHTML = `
        <div class="macros-legend-item"><span class="macros-legend-dot" style="background:${cssColor('--color-protein')}"></span>Proteine: ${Math.round(avgProtein)}g · ${proteinPct}%</div>
        <div class="macros-legend-item"><span class="macros-legend-dot" style="background:${cssColor('--color-fat')}"></span>Grassi: ${Math.round(avgFat)}g · ${fatPct}%</div>
        <div class="macros-legend-item"><span class="macros-legend-dot" style="background:${cssColor('--color-carbs')}"></span>Carboidrati: ${Math.round(avgCarbs)}g · ${carbsPct}%</div>
      `;
    }

    // Scostamento dal piano
    const plan = App.plan;
    if (devEl && plan) {
      const diffP = proteinPct - (plan.protein_pct || 0);
      const diffF = fatPct - (plan.fat_pct || 0);
      const diffC = carbsPct - (plan.carbs_pct || 0);
      const fmtDiff = (v) => (v > 0 ? '+' : '') + v;
      devEl.innerHTML = `
        <div class="macros-deviation-title">Scostamento dal piano (${plan.name || 'attivo'})</div>
        <div class="macros-deviation-row">
          <span style="color:var(--color-protein)">P: ${fmtDiff(diffP)}%</span>
          <span style="color:var(--color-fat)">G: ${fmtDiff(diffF)}%</span>
          <span style="color:var(--color-carbs)">C: ${fmtDiff(diffC)}%</span>
        </div>
      `;
    }

    const ctx = document.getElementById('chart-macros').getContext('2d');
    if (macrosChart) macrosChart.destroy();

    macrosChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Proteine', 'Grassi', 'Carboidrati'],
        datasets: [{
          data: [Math.round(avgProtein), Math.round(avgFat), Math.round(avgCarbs)],
          backgroundColor: [cssColor('--color-protein', 0.8), cssColor('--color-fat', 0.8), cssColor('--color-carbs', 0.8)],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const pct = [proteinPct, fatPct, carbsPct][ctx.dataIndex];
                return `${ctx.label}: ${ctx.raw}g · ${pct}%`;
              }
            }
          }
        }
      }
    });
  }

  // Tab listener
  document.querySelectorAll('.macros-tab').forEach(btn => {
    btn.addEventListener('click', () => loadMacrosChart(parseInt(btn.dataset.macrosDays)));
  });

  return { refresh };
})();
