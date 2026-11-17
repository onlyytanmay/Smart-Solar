/* Energy simulation engine.
 * DEMO / SIMULATED DATA ONLY - no real inverter, smart meter or battery is connected.
 *
 * Energy balance per 15-minute interval (dt = 0.25 h):
 *   net = generation - consumption                (kW)
 *   net >= 0 : charge    = min(net*dt, capacity - stored)
 *              exported  = net*dt - charge          (energy that leaves the home)
 *   net <  0 : discharge = min(|net|*dt, stored)
 *              gridImport = |net|*dt - discharge    (shortfall after the battery)
 * The battery is the only place energy is held, so stored energy is counted once.
 * Available surplus = usable battery above the reserve. It is a subset of stored
 * energy and is never added on top of it.
 */
(function () {
  const DT = 0.25;
  const RESERVE_RATIO = 0.1;
  const USAGE_SPLIT = { Lighting: 0.12, Cooling: 0.38, Kitchen: 0.22, 'Water pump': 0.1, Other: 0.18 };
  const rand = (a, b) => a + Math.random() * (b - a);
  const pad = (n) => String(n).padStart(2, '0');

  class EnergySimulator {
    constructor(solar) {
      this.solar = {
        capacityKw: Number(solar.capacityKw) || 0,
        batteryKwh: Number(solar.batteryKwh) || 0,
        healthPct: Number(solar.healthPct) || 100
      };
      this.stored = this.solar.batteryKwh * 0.55;
      this.history = [];           // today's 15-minute samples
      this.daily = this.seedDaily(29); // past days (simulated history)
      this.onAlert = () => {};
      this.onTick = () => {};
      this.cooldown = {};
      this.timer = null;

      // Start the simulated clock at midnight and fast-forward silently to "now"
      this.simTime = new Date();
      this.simTime.setHours(0, 0, 0, 0);
      const target = Date.now();
      while (this.simTime.getTime() < target) this.advance(true);
      this.state = this.compute();
    }

    seedDaily(days) {
      const out = [];
      const cap = this.solar.capacityKw;
      const today = new Date();
      for (let i = days; i >= 1; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        out.push({
          date: `${d.getDate()}/${d.getMonth() + 1}`,
          gen: +(cap * rand(3.6, 4.6) * (this.solar.healthPct / 100)).toFixed(1),
          cons: +rand(9, 14).toFixed(1)
        });
      }
      return out;
    }

    solarFactor(h) {
      return h < 6 || h > 18 ? 0 : Math.sin((Math.PI * (h - 6)) / 12);
    }

    consumptionKw(h) {
      let base = h >= 23 || h < 6 ? 0.35 : 0.55;
      if (h >= 7 && h < 9) base += 0.9;      // morning peak
      if (h >= 12 && h < 15) base += 0.4;    // afternoon cooling
      if (h >= 18 && h < 23) base += 1.5;    // evening peak
      return Math.max(0.2, base + rand(-0.1, 0.1));
    }

    rollDay() {
      if (!this.history.length) return;
      this.daily.push({
        date: `${this.simTime.getDate()}/${this.simTime.getMonth() + 1}`,
        gen: +this.history.reduce((s, p) => s + p.genKwh, 0).toFixed(1),
        cons: +this.history.reduce((s, p) => s + p.consKwh, 0).toFixed(1)
      });
      if (this.daily.length > 60) this.daily.shift();
      this.history = [];
    }

    advance(quiet = false) {
      if (this.simTime.getHours() === 0 && this.simTime.getMinutes() === 0) this.rollDay();

      const h = this.simTime.getHours() + this.simTime.getMinutes() / 60;
      const cap = this.solar.batteryKwh;
      const cloud = rand(0.7, 1.0);
      const genKw = Math.max(0, this.solar.capacityKw * this.solarFactor(h) * cloud * (this.solar.healthPct / 100) + rand(-0.05, 0.05));
      const consKw = this.consumptionKw(h);
      const net = genKw - consKw;

      let exported = 0, gridImport = 0, charging = false, discharging = false;
      if (net >= 0) {
        const charged = cap > 0 ? Math.min(net * DT, cap - this.stored) : 0;
        this.stored += charged;
        exported = net * DT - charged;
        charging = charged > 0.001;
      } else {
        const need = -net * DT;
        const discharged = Math.min(need, this.stored);
        this.stored -= discharged;
        gridImport = need - discharged;
        discharging = discharged > 0.001;
      }
      this.stored = Math.min(Math.max(this.stored, 0), cap);

      this.history.push({
        label: `${pad(this.simTime.getHours())}:${pad(this.simTime.getMinutes())}`,
        genKw, consKw, genKwh: genKw * DT, consKwh: consKw * DT,
        exportKw: exported / DT, importKw: gridImport / DT, charging, discharging
      });

      this.simTime = new Date(this.simTime.getTime() + 15 * 60 * 1000);
      if (!quiet) this.checkAlerts();
    }

    compute() {
      const cap = this.solar.batteryKwh;
      const last = this.history[this.history.length - 1] ||
        { genKw: 0, consKw: 0, exportKw: 0, importKw: 0, charging: false, discharging: false };
      const reserve = cap * RESERVE_RATIO;
      const pct = cap > 0 ? (this.stored / cap) * 100 : 0;
      return {
        clock: `${pad(this.simTime.getHours())}:${pad(this.simTime.getMinutes())}`,
        generationKw: last.genKw,
        consumptionKw: last.consKw,
        exportKw: last.exportKw,
        gridImportKw: last.importKw,
        batteryKwh: this.stored,
        batteryPct: pct,
        reserveKwh: reserve,
        remainingKwh: this.stored,
        surplusKwh: Math.max(0, this.stored - reserve),
        chargeStatus: last.charging ? 'Charging from solar' : last.discharging ? 'Supplying home' : pct >= 99.5 ? 'Full' : 'Idle',
        flows: { gen: last.genKw > 0.05, battery: last.charging || last.discharging, surplus: last.exportKw > 0.01 }
      };
    }

    start(intervalMs = 4000) {
      this.stop();
      this.timer = setInterval(() => {
        this.advance();
        this.state = this.compute();
        this.onTick(this.state);
      }, intervalMs);
    }

    stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

    checkAlerts() {
      const s = this.compute();
      const now = Date.now();
      const rules = [
        { key: 'battery', when: this.solar.batteryKwh > 0 && s.batteryPct < 20, title: 'Low battery', message: `Battery is at ${Math.round(s.batteryPct)}% (simulated). Consider reducing non-essential loads.` },
        { key: 'consumption', when: s.consumptionKw > 2.5, title: 'High energy consumption', message: `Household load is ${s.consumptionKw.toFixed(2)} kW (simulated), above the 2.5 kW threshold.` },
        { key: 'surplus', when: s.surplusKwh > 5, title: 'Surplus energy available', message: `${s.surplusKwh.toFixed(1)} kWh above your reserve can be offered to neighbours (simulated).` }
      ];
      rules.forEach((r) => {
        if (r.when && (!this.cooldown[r.key] || now - this.cooldown[r.key] > 120000)) {
          this.cooldown[r.key] = now;
          this.onAlert({ type: r.key, title: r.title, message: r.message });
        }
      });
    }

    usageSplit() {
      const total = this.history.reduce((s, p) => s + p.consKwh, 0);
      return Object.values(USAGE_SPLIT).map((share) => +(total * share).toFixed(2));
    }

    static get usageLabels() { return Object.keys(USAGE_SPLIT); }

    todayTotals() {
      return {
        gen: this.history.reduce((s, p) => s + p.genKwh, 0),
        cons: this.history.reduce((s, p) => s + p.consKwh, 0)
      };
    }

    /* Chart series. day = kW over today; week/month = kWh per day. */
    series(range) {
      if (range === 'day') {
        return {
          labels: this.history.map((p) => p.label),
          gen: this.history.map((p) => +p.genKw.toFixed(2)),
          cons: this.history.map((p) => +p.consKw.toFixed(2)),
          unit: 'kW'
        };
      }
      const days = range === 'week' ? 7 : 30;
      const t = this.todayTotals();
      const rows = [...this.daily.slice(-(days - 1)), { date: 'Today', gen: t.gen, cons: t.cons }];
      return {
        labels: rows.map((r) => r.date),
        gen: rows.map((r) => +r.gen.toFixed(1)),
        cons: rows.map((r) => +r.cons.toFixed(1)),
        unit: 'kWh'
      };
    }

    /* Recent daily records for the history table, with self-sufficiency. */
    recentRecords(count = 8) {
      const t = this.todayTotals();
      const rows = [...this.daily.slice(-(count - 1)), { date: 'Today', gen: t.gen, cons: t.cons }];
      return rows.map((r) => ({ ...r, self: Math.min(100, (r.gen / Math.max(r.cons, 0.1)) * 100) }));
    }
  }

  window.EnergySimulator = EnergySimulator;
})();
