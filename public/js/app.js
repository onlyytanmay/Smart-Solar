/* Application shell: routing, module views, live data bindings, charts.
 * Every energy number comes from the browser-side simulator (DEMO DATA).
 * Sharing, maintenance, notifications and profile data are stored by the API. */
(function () {
  if (!Session.isLoggedIn()) { location.replace('login.html'); return; }

  const ROUTES = {
    dashboard: 'Dashboard',
    monitoring: 'Energy Monitoring',
    community: 'Community Sharing',
    maintenance: 'Maintenance',
    notifications: 'Notifications',
    profile: 'Profile & Settings',
    admin: 'Admin Dashboard'
  };
  const ADMIN_ROUTES = ['admin', 'notifications', 'profile'];

  const fmt = {
    kw: (v) => `${v.toFixed(2)} kW`,
    kwh: (v) => `${v.toFixed(1)} kWh`,
    pct: (v) => `${Math.round(v)}%`
  };
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const fmtTime = (d) => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  const main = document.getElementById('main');

  const app = {
    user: null,
    sim: null,
    charts: {},
    range: 'day',
    notifFilter: 'all',
    residents: [],
    residentSurplus: {}
  };

  /* ---------- Utilities ---------- */
  function toast(msg, type = 'ok') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3200);
  }

  function chartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.color = '#9BAFC3';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';
    Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  }

  const baseOpts = () => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 900, easing: 'easeOutQuart' },
    plugins: { legend: { labels: { boxWidth: 10, usePointStyle: true } } },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }
    }
  });

  function destroyCharts() {
    Object.values(app.charts).forEach((c) => c.destroy());
    app.charts = {};
  }

  function currentRoute() {
    const hash = (location.hash || '').slice(1);
    const isAdmin = app.user.role === 'admin';
    if (!hash) return isAdmin ? 'admin' : 'dashboard';
    if (!ROUTES[hash]) return isAdmin ? 'admin' : 'dashboard';
    if (isAdmin && !ADMIN_ROUTES.includes(hash)) return 'admin';
    if (!isAdmin && hash === 'admin') return 'dashboard';
    return hash;
  }

  function buildNav() {
    const isAdmin = app.user.role === 'admin';
    const keys = isAdmin ? ADMIN_ROUTES : Object.keys(ROUTES).filter((k) => k !== 'admin');
    $('#nav').innerHTML = keys.map((k) =>
      `<a class="nav-item" href="#${k}" data-route="${k}"><span class="nav-dot"></span><span>${ROUTES[k]}</span></a>`
    ).join('');
    $('#user-name').textContent = app.user.name;
    $('#user-meta').textContent = `${app.user.flat} · ${app.user.building}`;
    $('#user-initial').textContent = app.user.name.charAt(0).toUpperCase();
    document.body.classList.toggle('theme-light', app.user.prefs?.theme === 'light');
  }

  /* ---------- Stat helpers ---------- */
  function stat(label, key, fmtKey, span, sub) {
    return `<div class="glass stat-card tilt ${span}">
      <p class="muted label">${label}</p>
      <p class="big" data-bind="${key}" data-fmt="${fmtKey}">—</p>
      <p class="muted small">${sub}</p>
    </div>`;
  }

  function batteryCard(span) {
    return `<div class="glass stat-card tilt ${span}">
      <p class="muted label">Battery storage</p>
      <div class="ring-wrap">
        <div class="ring" data-ring><span data-bind="batteryPct" data-fmt="pct">—</span></div>
        <div>
          <p class="big-sm" data-bind="batteryKwh" data-fmt="kwh">—</p>
          <p class="muted small">of ${app.user.solar.batteryKwh} kWh capacity</p>
        </div>
      </div>
    </div>`;
  }

  function healthCard(span, health) {
    return `<div class="glass stat-card tilt ${span}">
      <p class="muted label">Solar panel health</p>
      <div class="ring-wrap">
        <div class="ring" style="--p:${health}"><span>${health}%</span></div>
        <div><p class="big-sm">${health >= 90 ? 'Excellent' : health >= 80 ? 'Good' : 'Needs attention'}</p>
        <p class="muted small">${app.user.solar.capacityKw} kW array</p></div>
      </div>
    </div>`;
  }

  function weatherCard(span) {
    return `<div class="glass stat-card tilt ${span}">
      <p class="muted label">Weather · simulated</p>
      <div class="ring-wrap" style="gap:12px">
        <div class="weather-icon">⛅</div>
        <div><p class="big-sm">31°C · Partly cloudy</p>
        <p class="muted small">Mira Road · humidity 68%<br>Demo data, not a live forecast</p></div>
      </div>
    </div>`;
  }

  function quickActions(span) {
    return `<div class="glass panel ${span}">
      <p class="muted label">Quick actions</p>
      <div class="quick-grid">
        <a class="btn btn-primary btn-sm btn-block" href="#community">Request energy</a>
        <a class="btn btn-ghost btn-sm btn-block" href="#maintenance">Report an issue</a>
        <a class="btn btn-ghost btn-sm btn-block" href="#monitoring">Open live monitoring</a>
      </div>
    </div>`;
  }

  function flowHTML() {
    return `<div class="flow">
      <div class="flow-node"><span class="flow-icon">☀</span><strong>Solar panels</strong><small data-bind="generationKw" data-fmt="kw"></small></div>
      <div class="flow-link" data-flow="gen"><span class="flow-dot"></span></div>
      <div class="flow-node"><span class="flow-icon">⌂</span><strong>Home</strong><small data-bind="consumptionKw" data-fmt="kw"></small></div>
      <div class="flow-link" data-flow="battery"><span class="flow-dot"></span></div>
      <div class="flow-node"><span class="flow-icon">▮</span><strong>Battery</strong><small data-bind="batteryKwh" data-fmt="kwh"></small></div>
      <div class="flow-link" data-flow="surplus"><span class="flow-dot"></span></div>
      <div class="flow-node"><span class="flow-icon">⇄</span><strong>Surplus</strong><small data-bind="surplusKwh" data-fmt="kwh"></small></div>
    </div>`;
  }

  /* ---------- Live updates (called on every simulation tick) ---------- */
  function updateLive() {
    const s = app.sim && app.sim.state;
    if (!s) return;
    document.querySelectorAll('[data-bind]').forEach((el) => {
      const value = s[el.dataset.bind];
      const f = fmt[el.dataset.fmt];
      if (f && typeof value === 'number') el.textContent = f(value);
    });
    document.querySelectorAll('[data-text]').forEach((el) => { el.textContent = s[el.dataset.text] ?? ''; });
    document.querySelectorAll('[data-ring]').forEach((el) => el.style.setProperty('--p', s.batteryPct.toFixed(1)));
    document.querySelectorAll('[data-flow]').forEach((el) => el.classList.toggle('active', !!s.flows[el.dataset.flow]));
    const clock = document.getElementById('sim-clock');
    if (clock) clock.textContent = s.clock;

    if (app.charts.today) refreshDayChart(app.charts.today);
    if (app.charts.monitor && app.range === 'day') refreshDayChart(app.charts.monitor);
    if (app.charts.usage) { app.charts.usage.data.datasets[0].data = app.sim.usageSplit(); app.charts.usage.update('none'); }
  }

  function refreshDayChart(chart) {
    const series = app.sim.series('day');
    chart.data.labels = series.labels;
    chart.data.datasets[0].data = series.gen;
    chart.data.datasets[1].data = series.cons;
    chart.update('none');
  }

  /* ---------- Chart builders ---------- */
  function dayChart(canvasId, key) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    const series = app.sim.series('day');
    app.charts[key] = new Chart(canvas, {
      type: 'line',
      data: {
        labels: series.labels,
        datasets: [
          { label: 'Generation (kW)', data: series.gen, borderColor: '#42E8A5', backgroundColor: 'rgba(66,232,165,0.16)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2.5 },
          { label: 'Consumption (kW)', data: series.cons, borderColor: '#42C8FF', tension: 0.4, pointRadius: 0, borderWidth: 2 }
        ]
      },
      options: baseOpts()
    });
  }

  function seriesChart(canvasId, key, range, type = 'bar') {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    const s = app.sim.series(range);
    app.charts[key] = new Chart(canvas, {
      type,
      data: {
        labels: s.labels,
        datasets: [
          { label: `Generation (${s.unit})`, data: s.gen, backgroundColor: 'rgba(66,232,165,0.75)', borderColor: '#42E8A5', borderRadius: 6, tension: 0.4 },
          { label: `Consumption (${s.unit})`, data: s.cons, backgroundColor: 'rgba(66,200,255,0.55)', borderColor: '#42C8FF', borderRadius: 6, tension: 0.4 }
        ]
      },
      options: baseOpts()
    });
  }

  function usageChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    app.charts.usage = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: EnergySimulator.usageLabels,
        datasets: [{
          data: app.sim.usageSplit(),
          backgroundColor: ['#42E8A5', '#42C8FF', '#B6F36B', '#FFC857', '#7C8DFF'],
          borderColor: 'rgba(7,17,31,0.6)', borderWidth: 3, hoverOffset: 8
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '68%', animation: { duration: 900 }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } } } }
    });
  }

  /* ---------- Views ---------- */
  const VIEWS = {};

  VIEWS.dashboard = async () => {
    const [notes, shares] = await Promise.all([API.get('/notifications'), API.get('/sharing')]);
    const s = app.sim.state;
    const first = app.user.name.split(' ')[0];
    const recent = notes.items.slice(0, 4);
    main.innerHTML = `
      <section class="welcome glass">
        <div>
          <p class="eyebrow">${greeting()}</p>
          <h2>${esc(first)}, your rooftop is ${s.batteryPct > 50 ? 'well charged' : 'conserving energy'}.</h2>
          <p class="muted">${esc(app.user.building)} · Simulation clock <span id="sim-clock">${s.clock}</span></p>
        </div>
        <div class="demo-tag">DEMO · SIMULATED DATA</div>
      </section>
      <div class="grid">
        ${stat('Current generation', 'generationKw', 'kw', 'span-3', 'Live solar output')}
        ${stat('Total consumption', 'consumptionKw', 'kw', 'span-3', 'Household load now')}
        ${batteryCard('span-3')}
        ${stat('Available surplus', 'surplusKwh', 'kwh', 'span-3', 'Battery above 10% reserve')}
        ${stat('Remaining energy', 'remainingKwh', 'kwh', 'span-3', 'Total stored in battery')}
        ${healthCard('span-3', app.user.solar.healthPct)}
        ${weatherCard('span-3')}
        ${quickActions('span-3')}

        <div class="glass panel span-8">
          <div class="panel-head"><h3>Today's production vs consumption</h3><span class="muted small">kW · 15-minute intervals</span></div>
          <div class="chart-box"><canvas id="chart-today"></canvas></div>
        </div>
        <div class="glass panel span-4">
          <div class="panel-head"><h3>Energy usage breakdown</h3><span class="muted small">Estimated split</span></div>
          <div class="chart-box small"><canvas id="chart-usage"></canvas></div>
        </div>
        <div class="glass panel span-6">
          <div class="panel-head"><h3>Weekly statistics</h3><span class="muted small">kWh per day</span></div>
          <div class="chart-box"><canvas id="chart-week"></canvas></div>
        </div>
        <div class="glass panel span-6">
          <div class="panel-head"><h3>Monthly statistics</h3><span class="muted small">kWh per day, last 30 days</span></div>
          <div class="chart-box"><canvas id="chart-month"></canvas></div>
        </div>
        <div class="glass panel span-6">
          <div class="panel-head"><h3>Recent activity</h3></div>
          <div class="list">
            ${shares.history.slice(0, 3).map((r) => `
              <div class="list-item">
                <div><div class="item-title">${r.fromId === app.user.id ? 'Shared to ' + esc(r.to?.name) : 'Received from ' + esc(r.from?.name)}</div>
                <div class="item-meta">${r.kwh} kWh · ${fmtTime(r.respondedAt || r.createdAt)}</div></div>
                <span class="badge ${r.status === 'accepted' ? 'badge-ok' : ''}">${r.status}</span>
              </div>`).join('') || '<p class="empty">No sharing activity yet.</p>'}
          </div>
        </div>
        <div class="glass panel span-6">
          <div class="panel-head"><h3>System notifications</h3><a class="small" href="#notifications">View all →</a></div>
          <div class="list">
            ${recent.map((n) => `
              <div class="list-item ${n.read ? '' : 'unread'}">
                <div><div class="item-title">${esc(n.title)}</div><div class="item-meta">${esc(n.message)}</div></div>
              </div>`).join('') || '<p class="empty">You are all caught up.</p>'}
          </div>
        </div>
      </div>`;

    dayChart('chart-today', 'today');
    usageChart('chart-usage');
    seriesChart('chart-week', 'week', 'week');
    seriesChart('chart-month', 'month', 'month', 'line');
  };

  VIEWS.monitoring = async () => {
    const isDay = app.range === 'day';
    const titles = { day: 'Generation vs consumption today (kW)', week: 'Last 7 days (kWh)', month: 'Last 30 days (kWh)' };
    const records = app.sim.recentRecords(8);
    main.innerHTML = `
      <section class="page-head">
        <div><p class="eyebrow">Live telemetry · simulated</p><h2>Energy monitoring</h2></div>
        <div class="segmented" id="range-switch">
          ${['day', 'week', 'month'].map((r) => `<button data-range="${r}" class="${app.range === r ? 'active' : ''}">${{ day: 'Daily', week: 'Weekly', month: 'Monthly' }[r]}</button>`).join('')}
        </div>
      </section>
      <div class="grid">
        ${stat('Live generation', 'generationKw', 'kw', 'span-4', 'Solar output right now')}
        ${stat('Consumption', 'consumptionKw', 'kw', 'span-4', 'Household load right now')}
        <div class="glass stat-card tilt span-4">
          <p class="muted label">Battery charging status</p>
          <p class="big-sm" data-text="chargeStatus">—</p>
          <p class="muted small" data-bind="batteryKwh" data-fmt="kwh"></p>
        </div>
        ${stat('Remaining energy', 'remainingKwh', 'kwh', 'span-4', 'Total stored')}
        ${stat('Surplus energy', 'surplusKwh', 'kwh', 'span-4', 'Usable above reserve')}
        ${stat('Grid import', 'gridImportKw', 'kw', 'span-4', 'Only when battery is empty')}
        <div class="glass panel span-12">
          <div class="panel-head"><h3>Energy flow</h3><span class="muted small">Solar → Home → Battery → Surplus</span></div>
          ${flowHTML()}
        </div>
        <div class="glass panel span-7">
          <div class="panel-head"><h3>${titles[app.range]}</h3></div>
          <div class="chart-box"><canvas id="chart-monitor"></canvas></div>
        </div>
        <div class="glass panel span-5">
          <div class="panel-head"><h3>Historical records</h3><span class="muted small">Last 8 days · simulated</span></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Generated</th><th>Consumed</th><th>Self-sufficiency</th></tr></thead>
            <tbody>${records.map((r) => `
              <tr><td>${esc(r.date)}</td><td class="num">${r.gen.toFixed(1)} kWh</td><td class="num">${r.cons.toFixed(1)} kWh</td>
              <td><span class="badge ${r.self >= 100 ? 'badge-ok' : r.self >= 60 ? 'badge-low' : 'badge-medium'}">${Math.round(r.self)}%</span></td></tr>`).join('')}
            </tbody></table></div>
        </div>
      </div>`;

    if (isDay) {
      const canvas = document.getElementById('chart-monitor');
      if (canvas && window.Chart) {
        const series = app.sim.series('day');
        app.charts.monitor = new Chart(canvas, {
          type: 'line',
          data: {
            labels: series.labels,
            datasets: [
              { label: 'Generation (kW)', data: series.gen, borderColor: '#42E8A5', backgroundColor: 'rgba(66,232,165,0.16)', fill: true, tension: 0.4, pointRadius: 0 },
              { label: 'Consumption (kW)', data: series.cons, borderColor: '#42C8FF', tension: 0.4, pointRadius: 0 }
            ]
          },
          options: baseOpts()
        });
      }
    } else {
      seriesChart('chart-monitor', 'monitor', app.range, app.range === 'month' ? 'line' : 'bar');
    }
  };

  VIEWS.community = async () => {
    const [res, sh] = await Promise.all([API.get('/community/residents'), API.get('/sharing')]);
    app.residents = res.residents.filter((r) => r.id !== app.user.id);
    // Each neighbour's listed surplus is simulated, generated once per session
    app.residents.forEach((r) => {
      if (app.residentSurplus[r.id] === undefined) {
        app.residentSurplus[r.id] = +(r.capacityKw * (0.3 + Math.random() * 1.1)).toFixed(1);
      }
    });
    const offering = app.residents.filter((r) => app.residentSurplus[r.id] >= 0.5);
    const incomingRows = sh.incoming.map((r) => `
      <div class="list-item">
        <div><div class="item-title">${esc(r.from?.name)} · ${r.kwh} kWh</div>
        <div class="item-meta">${esc(r.message || 'No message')} · ${fmtTime(r.createdAt)}</div></div>
        <div class="actions">
          <button class="btn btn-primary btn-sm" data-action="respond" data-id="${r.id}" data-act="accept">Accept</button>
          <button class="btn btn-ghost btn-sm" data-action="respond" data-id="${r.id}" data-act="reject">Reject</button>
        </div>
      </div>`).join('') || '<p class="empty">No pending requests.</p>';
    const outgoingRows = sh.outgoing.map((r) => `
      <div class="list-item">
        <div><div class="item-title">To ${esc(r.to?.name)} · ${r.kwh} kWh</div><div class="item-meta">Awaiting response</div></div>
        <button class="btn btn-danger btn-sm" data-action="cancel" data-id="${r.id}">Cancel</button>
      </div>`).join('');

    main.innerHTML = `
      <section class="page-head">
        <div><p class="eyebrow">Residential community network</p><h2>Community energy sharing</h2></div>
      </section>
      <div class="notice glass">Simulated sharing: requests and accounting are recorded on the platform, but <strong>no electricity is physically transferred</strong>. This website does not perform grid transfers.</div>
      <div class="grid">
        ${stat('Your available surplus', 'surplusKwh', 'kwh', 'span-4', 'Simulated from your battery')}
        <div class="glass stat-card tilt span-4"><p class="muted label">Energy shared (accepted)</p><p class="big">${sh.totals.sharedKwh.toFixed(1)} kWh</p><p class="muted small">${sh.totals.accepted} completed exchanges</p></div>
        <div class="glass stat-card tilt span-4"><p class="muted label">Participating residences</p><p class="big">${res.residents.length + 1}</p><p class="muted small">Including your home</p></div>

        <div class="glass panel span-6">
          <div class="panel-head"><h3>Residents offering surplus</h3><span class="muted small">Simulated listings</span></div>
          <div class="list">
            ${offering.map((r) => `
              <div class="list-item">
                <div><div class="item-title">${esc(r.name)}</div>
                <div class="item-meta">${esc(r.building)} · Flat ${esc(r.flat)} · ${app.residentSurplus[r.id].toFixed(1)} kWh available</div></div>
                <button class="btn btn-ghost btn-sm" data-action="request-from" data-id="${r.id}">Request</button>
              </div>`).join('') || '<p class="empty">No neighbours are offering surplus right now.</p>'}
          </div>
        </div>

        <div class="glass panel span-6">
          <div class="panel-head"><h3>Send a sharing request</h3></div>
          <form data-form="request" id="request-form" novalidate>
            <div class="field"><label for="req-to">Neighbour</label>
              <select id="req-to" name="toId" required>
                <option value="">Select a resident</option>
                ${app.residents.map((r) => `<option value="${r.id}">${esc(r.name)} · ${esc(r.building)}</option>`).join('')}
              </select>
              <div class="field-error" data-error="toId"></div></div>
            <div class="field"><label for="req-kwh">Energy requested (kWh)</label>
              <input id="req-kwh" name="kwh" type="number" step="0.1" min="0.1" max="20" placeholder="e.g. 2.5">
              <div class="field-error" data-error="kwh"></div></div>
            <div class="field"><label for="req-msg">Message (optional)</label>
              <textarea id="req-msg" name="message" maxlength="200" placeholder="Why do you need it?"></textarea></div>
            <div class="form-error"></div>
            <button class="btn btn-primary" type="submit">Send request</button>
          </form>
        </div>

        <div class="glass panel span-6">
          <div class="panel-head"><h3>Incoming requests</h3><span class="badge">${sh.incoming.length} pending</span></div>
          <div class="list">${incomingRows}</div>
          ${outgoingRows ? `<div class="panel-head" style="margin-top:18px"><h3>Your requests</h3></div><div class="list">${outgoingRows}</div>` : ''}
        </div>

        <div class="glass panel span-6">
          <div class="panel-head"><h3>Sharing history</h3></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Direction</th><th>Resident</th><th>Energy</th><th>Status</th></tr></thead>
            <tbody>${sh.history.map((r) => {
              const outgoing = r.fromId === app.user.id;
              return `<tr>
                <td>${fmtDate(r.createdAt)}</td>
                <td>${outgoing ? 'Sent' : 'Received'}</td>
                <td>${esc(outgoing ? r.to?.name : r.from?.name)}</td>
                <td class="num">${r.kwh} kWh</td>
                <td><span class="badge ${r.status === 'accepted' ? 'badge-ok' : r.status === 'rejected' ? 'badge-high' : ''}">${r.status}</span></td>
              </tr>`;
            }).join('') || '<tr><td colspan="5" class="empty">No history yet.</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>`;
  };

  VIEWS.maintenance = async () => {
    const data = await API.get('/maintenance');
    const items = data.items;
    const lastDone = items.filter((i) => i.status === 'done').sort((a, b) => b.date.localeCompare(a.date))[0];
    const upcoming = items.filter((i) => i.status !== 'done');
    const health = app.user.solar.healthPct;
    const highOpen = upcoming.some((i) => i.priority === 'high');

    main.innerHTML = `
      <section class="page-head">
        <div><p class="eyebrow">Asset care</p><h2>Solar panel maintenance</h2></div>
      </section>
      ${highOpen ? `<div class="notice glass" style="border-left-color:var(--danger)">A high-priority maintenance item is open. Please schedule an inspection soon.</div>` : ''}
      <div class="grid">
        <div class="glass panel span-4">
          <p class="muted label">Panel health</p>
          <div class="ring-wrap" style="flex-direction:column;align-items:flex-start">
            <div class="ring ring-lg" style="--p:${health}"><span>${health}%</span></div>
            <div><p class="big-sm">${health >= 90 ? 'Healthy' : health >= 80 ? 'Monitor closely' : 'Attention needed'}</p>
            <p class="muted small">Installed ${fmtDate(app.user.solar.installDate || Date.now())}</p></div>
          </div>
          <div class="list" style="margin-top:18px">
            <div class="list-item"><span class="item-meta">Last inspection</span><strong>${lastDone ? fmtDate(lastDone.date) : 'Not recorded'}</strong></div>
            <div class="list-item"><span class="item-meta">Next scheduled</span><strong>${upcoming.find((i) => i.status === 'scheduled') ? fmtDate(upcoming.find((i) => i.status === 'scheduled').date) : 'None'}</strong></div>
          </div>
        </div>

        <div class="glass panel span-8">
          <div class="panel-head"><h3>Upcoming maintenance & reminders</h3></div>
          <div class="list">${upcoming.map((i) => `
            <div class="list-item">
              <div><div class="item-title">${esc(i.issue)}</div>
              <div class="item-meta">${esc(i.type)} · ${fmtDate(i.date)} · ${esc(i.technician)}</div></div>
              <div class="actions" style="align-items:center">
                <span class="badge badge-${i.priority}">${i.priority}</span>
                ${i.status === 'open' ? `<button class="btn btn-ghost btn-sm" data-action="maint-status" data-id="${i.id}" data-status="scheduled">Schedule</button>` : ''}
                <button class="btn btn-primary btn-sm" data-action="maint-status" data-id="${i.id}" data-status="done">Mark done</button>
              </div>
            </div>`).join('') || '<p class="empty">Nothing pending. Your system is up to date.</p>'}
          </div>
        </div>

        <div class="glass panel span-5">
          <div class="panel-head"><h3>Report an issue</h3></div>
          <form data-form="report" novalidate>
            <div class="field"><label for="m-issue">What is happening?</label>
              <textarea id="m-issue" name="issue" placeholder="e.g. Panel row 2 shows lower output after noon"></textarea>
              <div class="field-error" data-error="issue"></div></div>
            <div class="form-grid">
              <div class="field"><label for="m-type">Type</label>
                <select id="m-type" name="type"><option>Inspection</option><option>Cleaning</option><option>Repair</option></select></div>
              <div class="field"><label for="m-pri">Priority</label>
                <select id="m-pri" name="priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select></div>
            </div>
            <div class="form-error"></div>
            <button class="btn btn-primary" type="submit">Submit report</button>
          </form>
        </div>

        <div class="glass panel span-7">
          <div class="panel-head"><h3>Maintenance history</h3></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Issue</th><th>Type</th><th>Priority</th><th>Status</th></tr></thead>
            <tbody>${items.map((i) => `<tr>
              <td>${fmtDate(i.date)}</td><td style="white-space:normal">${esc(i.issue)}</td><td>${esc(i.type)}</td>
              <td><span class="badge badge-${i.priority}">${i.priority}</span></td>
              <td><span class="badge ${i.status === 'done' ? 'badge-ok' : ''}">${i.status}</span></td></tr>`).join('') ||
              '<tr><td colspan="5" class="empty">No records.</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>`;
  };

  VIEWS.notifications = async () => {
    const data = await API.get('/notifications');
    const items = app.notifFilter === 'unread' ? data.items.filter((n) => !n.read) : data.items;
    main.innerHTML = `
      <section class="page-head">
        <div><p class="eyebrow">${data.unread} unread</p><h2>Notification center</h2></div>
        <div class="actions">
          <div class="segmented">
            <button data-action="notif-filter" data-value="all" class="${app.notifFilter === 'all' ? 'active' : ''}">All</button>
            <button data-action="notif-filter" data-value="unread" class="${app.notifFilter === 'unread' ? 'active' : ''}">Unread</button>
          </div>
          <button class="btn btn-ghost btn-sm" data-action="read-all">Mark all read</button>
        </div>
      </section>
      <div class="glass panel">
        <div class="list">${items.map((n) => `
          <div class="list-item ${n.read ? '' : 'unread'}">
            <div>
              <div class="item-title">${esc(n.title)} ${n.read ? '' : '<span class="badge badge-ok">New</span>'}</div>
              <div class="item-meta">${esc(n.message)}</div>
              <div class="item-meta">${fmtTime(n.createdAt)} · ${esc(n.type)}</div>
            </div>
            ${n.read ? '' : `<button class="btn btn-ghost btn-sm" data-action="read" data-id="${n.id}">Mark read</button>`}
          </div>`).join('') || '<p class="empty">No notifications to show.</p>'}
        </div>
      </div>`;
  };

  VIEWS.profile = async () => {
    const u = app.user;
    main.innerHTML = `
      <section class="page-head">
        <div><p class="eyebrow">Account</p><h2>Profile & settings</h2></div>
        <button class="btn btn-danger btn-sm" data-action="logout">Log out</button>
      </section>
      <div class="grid">
        <div class="glass panel span-6">
          <div class="panel-head"><h3>Profile details</h3><span class="muted small">${esc(u.email)}</span></div>
          <form data-form="profile" novalidate>
            <div class="field"><label for="p-name">Full name</label><input id="p-name" name="name" value="${esc(u.name)}"><div class="field-error" data-error="name"></div></div>
            <div class="form-grid">
              <div class="field"><label for="p-phone">Phone</label><input id="p-phone" name="phone" value="${esc(u.phone)}" placeholder="+91 98xxxxxx"></div>
              <div class="field"><label for="p-flat">Flat / apartment</label><input id="p-flat" name="flat" value="${esc(u.flat)}"></div>
            </div>
            <div class="field"><label for="p-building">Residential building</label><input id="p-building" name="building" value="${esc(u.building)}"></div>
            <h3 style="margin:8px 0 12px">Solar system</h3>
            <div class="form-grid">
              <div class="field"><label for="p-cap">Panel capacity (kW)</label><input id="p-cap" name="capacityKw" type="number" step="0.1" min="0.5" value="${u.solar.capacityKw}"></div>
              <div class="field"><label for="p-bat">Battery capacity (kWh)</label><input id="p-bat" name="batteryKwh" type="number" step="0.5" min="0" value="${u.solar.batteryKwh}"></div>
            </div>
            <h3 style="margin:8px 0 12px">Preferences</h3>
            <div class="form-grid">
              <div class="field"><label for="p-theme">Theme</label>
                <select id="p-theme" name="theme"><option value="dark" ${u.prefs.theme === 'dark' ? 'selected' : ''}>Dark (default)</option><option value="light" ${u.prefs.theme === 'light' ? 'selected' : ''}>Light</option></select></div>
              <div class="field"><label for="p-notif">Notifications</label>
                <select id="p-notif" name="notifications"><option value="true" ${u.prefs.notifications ? 'selected' : ''}>Enabled</option><option value="false" ${!u.prefs.notifications ? 'selected' : ''}>Muted</option></select></div>
            </div>
            <div class="form-error"></div>
            <button class="btn btn-primary" type="submit">Save changes</button>
          </form>
        </div>
        <div class="glass panel span-6">
          <div class="panel-head"><h3>Account summary</h3></div>
          <div class="list">
            <div class="list-item"><span class="item-meta">Role</span><strong>${esc(u.role)}</strong></div>
            <div class="list-item"><span class="item-meta">Building</span><strong>${esc(u.building)}</strong></div>
            <div class="list-item"><span class="item-meta">Flat</span><strong>${esc(u.flat)}</strong></div>
            <div class="list-item"><span class="item-meta">Solar capacity</span><strong>${u.solar.capacityKw} kW</strong></div>
            <div class="list-item"><span class="item-meta">Battery capacity</span><strong>${u.solar.batteryKwh} kWh</strong></div>
          </div>
        </div>
      </div>`;
  };

  VIEWS.admin = async () => {
    const data = await API.get('/admin/overview');
    const s = data.stats;
    main.innerHTML = `
      <section class="page-head">
        <div><p class="eyebrow">Platform operations</p><h2>Admin dashboard</h2></div>
        <span class="demo-tag">DEMO · SAMPLE DATA</span>
      </section>
      <div class="grid">
        <div class="glass stat-card tilt span-3"><p class="muted label">Registered residents</p><p class="big">${s.residents}</p></div>
        <div class="glass stat-card tilt span-3"><p class="muted label">Connected buildings</p><p class="big">${s.buildings}</p></div>
        <div class="glass stat-card tilt span-3"><p class="muted label">Solar installations</p><p class="big">${s.installations}</p></div>
        <div class="glass stat-card tilt span-3"><p class="muted label">Energy shared (accepted)</p><p class="big">${s.sharedKwh} kWh</p></div>
        <div class="glass panel span-6">
          <div class="panel-head"><h3>Maintenance overview</h3></div>
          <div class="list">
            <div class="list-item"><span>Open</span><span class="badge badge-medium">${data.maintenance.open}</span></div>
            <div class="list-item"><span>Scheduled</span><span class="badge">${data.maintenance.scheduled}</span></div>
            <div class="list-item"><span>Completed</span><span class="badge badge-ok">${data.maintenance.done}</span></div>
            <div class="list-item"><span>High priority, unresolved</span><span class="badge badge-high">${data.maintenance.highPriorityOpen}</span></div>
          </div>
        </div>
        <div class="glass panel span-6">
          <div class="panel-head"><h3>Buildings</h3><span class="muted small">${s.pendingRequests} pending sharing requests</span></div>
          <div class="list">${data.buildings.map((b) => `
            <div class="list-item"><span class="item-title">${esc(b.name)}</span><span class="badge">${b.residents} residents</span></div>`).join('')}
          </div>
        </div>
        <div class="glass panel span-12">
          <div class="panel-head"><h3>User management</h3><span class="muted small">Read-only in this demo</span></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Name</th><th>Flat</th><th>Building</th><th>Panels</th><th>Battery</th><th>Health</th></tr></thead>
            <tbody>${data.users.map((u) => `<tr>
              <td>${esc(u.name)}</td><td>${esc(u.flat)}</td><td>${esc(u.building)}</td>
              <td class="num">${u.capacityKw} kW</td><td class="num">${u.batteryKwh} kWh</td>
              <td><span class="badge ${u.healthPct >= 90 ? 'badge-ok' : u.healthPct >= 80 ? 'badge-low' : 'badge-medium'}">${u.healthPct}%</span></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>`;
  };

  /* ---------- Event handling (delegated, bound once) ---------- */
  const ACTIONS = {
    logout: () => { Session.clear(); location.href = 'login.html'; },
    'request-from': (d) => {
      const sel = document.getElementById('req-to');
      if (sel) { sel.value = d.id; sel.scrollIntoView({ behavior: 'smooth', block: 'center' }); sel.focus(); }
    },
    respond: async (d) => {
      try {
        await API.post(`/sharing/${d.id}/respond`, { action: d.act });
        toast(d.act === 'accept' ? 'Request accepted (simulated transfer recorded).' : 'Request rejected.');
        render();
      } catch (err) { toast(err.message, 'error'); }
    },
    cancel: async (d) => {
      try { await API.patch(`/sharing/${d.id}/cancel`); toast('Request cancelled.'); render(); }
      catch (err) { toast(err.message, 'error'); }
    },
    'maint-status': async (d) => {
      try { await API.patch(`/maintenance/${d.id}`, { status: d.status }); toast(`Marked as ${d.status}.`); render(); }
      catch (err) { toast(err.message, 'error'); }
    },
    read: async (d) => {
      try { await API.patch(`/notifications/${d.id}/read`); render(); refreshBell(); }
      catch (err) { toast(err.message, 'error'); }
    },
    'read-all': async () => {
      try { await API.patch('/notifications/read-all'); toast('All notifications marked as read.'); render(); refreshBell(); }
      catch (err) { toast(err.message, 'error'); }
    },
    'notif-filter': (d) => { app.notifFilter = d.value; render(); }
  };

  const FORMS = {
    request: async (form) => {
      const f = form.elements;
      const errs = {
        toId: f.toId.value ? '' : 'Choose a neighbour.',
        kwh: Number(f.kwh.value) >= 0.1 && Number(f.kwh.value) <= 20 ? '' : 'Enter between 0.1 and 20 kWh.'
      };
      setErrors(form, errs);
      if (errs.toId || errs.kwh) return;
      const offered = app.residentSurplus[f.toId.value];
      if (offered !== undefined && Number(f.kwh.value) > offered) {
        toast(`Note: this neighbour lists ${offered.toFixed(1)} kWh. The request will still be sent for their review.`, 'error');
      }
      await API.post('/sharing', { toId: f.toId.value, kwh: Number(f.kwh.value), message: f.message.value.trim() });
      toast('Sharing request sent.');
      render();
    },
    report: async (form) => {
      const f = form.elements;
      const issue = f.issue.value.trim();
      setErrors(form, { issue: issue.length >= 5 ? '' : 'Describe the issue in at least 5 characters.' });
      if (issue.length < 5) return;
      await API.post('/maintenance', { issue, type: f.type.value, priority: f.priority.value });
      toast('Issue reported. A technician will review it.');
      render();
    },
    profile: async (form) => {
      const f = form.elements;
      const name = f.name.value.trim();
      setErrors(form, { name: name.length >= 2 ? '' : 'Name must be at least 2 characters.' });
      if (name.length < 2) return;
      const res = await API.put('/users/profile', {
        name, phone: f.phone.value, flat: f.flat.value, building: f.building.value,
        solar: { capacityKw: Number(f.capacityKw.value), batteryKwh: Number(f.batteryKwh.value) },
        prefs: { theme: f.theme.value, notifications: f.notifications.value === 'true' }
      });
      Session.save(Session.token(), res.user);
      app.user = res.user;
      app.sim = null; // rebuild the simulator with new solar parameters
      toast('Profile saved. Simulation updated.');
      location.reload();
    }
  };

  function setErrors(form, errs) {
    Object.entries(errs).forEach(([k, msg]) => {
      const el = form.querySelector(`[data-error="${k}"]`);
      if (el) el.textContent = msg;
      if (form.elements[k]) form.elements[k].classList.toggle('invalid', !!msg);
    });
  }

  function bindGlobal() {
    main.addEventListener('click', (e) => {
      const rangeBtn = e.target.closest('[data-range]');
      if (rangeBtn) {
        app.range = rangeBtn.dataset.range;
        destroyCharts();
        render();
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (btn && ACTIONS[btn.dataset.action]) ACTIONS[btn.dataset.action](btn.dataset);
    });

    main.addEventListener('submit', async (e) => {
      const form = e.target;
      if (!form.dataset.form || !FORMS[form.dataset.form]) return;
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      const errBox = form.querySelector('.form-error');
      if (btn) btn.disabled = true;
      if (errBox) errBox.textContent = '';
      try { await FORMS[form.dataset.form](form); }
      catch (err) { if (errBox) errBox.textContent = err.message; else toast(err.message, 'error'); }
      finally { if (btn) btn.disabled = false; }
    });

    // 3D tilt on stat cards (pointer-driven, disabled for reduced motion)
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      main.addEventListener('mousemove', (e) => {
        const card = e.target.closest('.tilt');
        if (!card) return;
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `perspective(900px) rotateX(${(-y * 6).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg) translateY(-3px)`;
      });
      main.addEventListener('mouseleave', (e) => {
        if (e.target.classList && e.target.classList.contains('tilt')) e.target.style.transform = '';
      }, true);
      main.addEventListener('mouseout', (e) => {
        const card = e.target.closest && e.target.closest('.tilt');
        if (card && !card.contains(e.relatedTarget)) card.style.transform = '';
      });
    }

    window.addEventListener('hashchange', render);
  }

  /* ---------- Notification bell & simulation alerts ---------- */
  async function refreshBell() {
    try {
      const data = await API.get('/notifications');
      const badge = document.getElementById('bell-count');
      badge.textContent = data.unread > 0 ? String(data.unread) : '';
      badge.dataset.zero = data.unread > 0 ? 'false' : 'true';
    } catch { /* ignore: bell is non-critical */ }
  }

  function handleAlert(alert) {
    if (app.user.prefs && app.user.prefs.notifications === false) return;
    API.post('/notifications', { type: alert.type, title: alert.title, message: alert.message })
      .then(refreshBell)
      .catch(() => {});
    toast(`${alert.title} (simulated)`);
  }

  /* ---------- Render ---------- */
  async function render() {
    if (!app.user || !app.sim) return;
    const route = currentRoute();
    destroyCharts();
    document.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
    document.getElementById('page-title').textContent = ROUTES[route];
    document.title = `${ROUTES[route]} · Smart Solar Platform`;
    main.innerHTML = '<div class="loading">Loading…</div>';
    try {
      chartDefaults();
      await VIEWS[route]();
    } catch (err) {
      main.innerHTML = `<div class="glass panel"><h3>Something went wrong</h3><p class="muted">${esc(err.message)}</p></div>`;
    }
    main.classList.remove('page-enter');
    void main.offsetWidth;
    main.classList.add('page-enter');
    updateLive();
  }

  /* ---------- Init ---------- */
  (async function init() {
    try {
      const me = await API.get('/auth/me');
      app.user = me.user;
      Session.save(Session.token(), me.user);
    } catch {
      Session.clear();
      location.replace('login.html');
      return;
    }

    buildNav();
    app.sim = new EnergySimulator(app.user.solar);
    app.sim.onTick = updateLive;
    app.sim.onAlert = handleAlert;
    app.sim.start(4000); // one simulated 15-minute interval every 4 seconds

    $('#logout-btn').addEventListener('click', ACTIONS.logout);
    bindGlobal();
    await refreshBell();
    render();
  })();
})();
