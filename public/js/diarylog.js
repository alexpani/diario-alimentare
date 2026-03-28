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
    await Promise.all([
      loadDays(),
      loadWeeklyChart(),
      loadMacrosChart()
    ]);
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
      const month = date.toLocaleDateString('it-IT', { month: 'short' });
      const pct = plan.kcal_target > 0 ? Math.round((d.kcal / plan.kcal_target) * 100) : 0;
      const isOver = pct > 110;

      return `
        <div class="diary-day-card" data-date="${d.date}">
          <div class="diary-day-date">
            <div class="diary-day-num">${day}</div>
            <div class="diary-day-month">${month}</div>
          </div>
          <div class="diary-day-info">
            <div class="diary-day-kcal">${Math.round(d.kcal)} kcal</div>
            <div class="diary-day-macros">P: ${fmt(d.protein)}g · G: ${fmt(d.fat)}g · C: ${fmt(d.carbs)}g</div>
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

  // ── Grafico macros medi mensili ──────────
  async function loadMacrosChart() {
    const to = todayStr();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 29);
    const from = fromDate.toISOString().slice(0, 10);

    const data = await apiGet(`/api/diary/range?from=${from}&to=${to}`);

    if (!data || data.length === 0) {
      document.getElementById('chart-macros').parentElement.style.display = 'none';
      return;
    }
    document.getElementById('chart-macros').parentElement.style.display = '';

    const avgProtein = data.reduce((s, d) => s + d.protein, 0) / data.length;
    const avgFat = data.reduce((s, d) => s + d.fat, 0) / data.length;
    const avgCarbs = data.reduce((s, d) => s + d.carbs, 0) / data.length;

    // Calcola percentuali kcal dai macro
    const proteinKcal = avgProtein * 4;
    const fatKcal = avgFat * 9;
    const carbsKcal = avgCarbs * 4;
    const totalKcal = proteinKcal + fatKcal + carbsKcal;
    const proteinPct = totalKcal > 0 ? Math.round(proteinKcal / totalKcal * 100) : 0;
    const fatPct = totalKcal > 0 ? Math.round(fatKcal / totalKcal * 100) : 0;
    const carbsPct = totalKcal > 0 ? 100 - proteinPct - fatPct : 0;

    // Legenda con grammi e percentuali
    const legendEl = document.getElementById('chart-macros-legend');
    if (legendEl) {
      legendEl.innerHTML = `
        <div class="macros-legend-item"><span class="macros-legend-dot" style="background:${cssColor('--color-protein')}"></span>Proteine: ${Math.round(avgProtein)}g · ${proteinPct}%</div>
        <div class="macros-legend-item"><span class="macros-legend-dot" style="background:${cssColor('--color-fat')}"></span>Grassi: ${Math.round(avgFat)}g · ${fatPct}%</div>
        <div class="macros-legend-item"><span class="macros-legend-dot" style="background:${cssColor('--color-carbs')}"></span>Carboidrati: ${Math.round(avgCarbs)}g · ${carbsPct}%</div>
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

  return { refresh };
})();
