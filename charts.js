/* Small hand-built SVG charts. Colors: series blue for magnitude, reserved status
   colors (good/critical) for on/over target, always paired with a text label. */
(function (root) {
  'use strict';
  const C = { blue: '#2a78d6', good: '#0ca30c', warn: '#fab219', crit: '#d03b3b', grid: '#e3d8c3', ink: '#3b3530', ink2: '#7a6f62', surface: '#fffaf0' };
  const W = 340, H = 180, P = { l: 34, r: 10, t: 12, b: 22 };

  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const short = d => { const [, m, dd] = d.split('-'); return +m + '/' + +dd; };
  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const dowOf = d => DOW[new Date(d + 'T12:00').getDay()];

  function niceTicks(min, max, n) {
    const span = max - min || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0);
    const out = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }

  function frame(yTicks, y, fmt) {
    return yTicks.map(t => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="${C.grid}" stroke-width="1"/>` +
      `<text x="${P.l - 5}" y="${y(t) + 3.5}" fill="${C.ink2}" font-size="9.5" text-anchor="end">${fmt(t)}</text>`).join('');
  }

  // Tooltip: any element with data-tip shows it on hover/touch.
  function wireTips(container) {
    let tip = container.querySelector('.chart-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; container.appendChild(tip); }
    const show = e => {
      const t = e.target.closest('[data-tip]'); if (!t) { tip.style.display = 'none'; return; }
      const box = container.getBoundingClientRect(), pt = e.touches ? e.touches[0] : e;
      tip.innerHTML = t.getAttribute('data-tip'); tip.style.display = 'block';
      const x = Math.min(box.width - tip.offsetWidth - 4, Math.max(4, pt.clientX - box.left - tip.offsetWidth / 2));
      tip.style.left = x + 'px'; tip.style.top = Math.max(0, pt.clientY - box.top - tip.offsetHeight - 12) + 'px';
    };
    container.addEventListener('pointermove', show);
    container.addEventListener('pointerdown', show);
    container.addEventListener('pointerleave', () => tip.style.display = 'none');
  }

  // Weight: raw weigh-ins (dots), smoothed trend (line), plan line, goal line.
  function weight(el, series, profile) {
    if (!series.length) { el.innerHTML = '<p class="empty">Log a weigh-in to start the weight chart.</p>'; return; }
    const pts = series.slice(-60);
    const planAt = d => Math.max(profile.goalWeight, profile.startWeight - profile.paceLbPerWeek * Coach.daysBetween(profile.startDate, d) / 7);
    const vals = pts.flatMap(p => [p.trend, p.lb].filter(v => v != null)).concat([profile.goalWeight, planAt(pts[0].date), planAt(pts[pts.length - 1].date)]);
    const lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
    const x = i => P.l + (W - P.l - P.r) * (pts.length === 1 ? 0.5 : i / (pts.length - 1));
    const y = v => P.t + (H - P.t - P.b) * (1 - (v - lo) / (hi - lo));
    const trendPath = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.trend).toFixed(1)).join('');
    const planPath = `M${x(0)} ${y(planAt(pts[0].date))} L${x(pts.length - 1)} ${y(planAt(pts[pts.length - 1].date))}`;
    const dots = pts.map((p, i) => p.lb == null ? '' : `<circle cx="${x(i)}" cy="${y(p.lb)}" r="2.6" fill="${C.ink2}" opacity=".8"/>`).join('');
    const colW = (W - P.l - P.r) / Math.max(1, pts.length - 1);
    const hits = pts.map((p, i) => `<rect x="${x(i) - colW / 2}" y="${P.t}" width="${colW}" height="${H - P.t - P.b}" fill="transparent" data-tip="<b>${short(p.date)}</b><br>${p.lb != null ? 'Scale ' + f1(p.lb) + ' lb<br>' : ''}Trend ${f1(p.trend)} lb<br>Plan ${f1(planAt(p.date))} lb"/>`).join('');
    const last = pts[pts.length - 1];
    const xl = [0, Math.floor((pts.length - 1) / 2), pts.length - 1].filter((v, i, a) => a.indexOf(v) === i)
      .map(i => `<text x="${x(i)}" y="${H - 6}" fill="${C.ink2}" font-size="9.5" text-anchor="middle">${short(pts[i].date)}</text>`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart">
      ${frame(niceTicks(lo, hi, 4), y, t => t)}
      <line x1="${P.l}" x2="${W - P.r}" y1="${y(profile.goalWeight)}" y2="${y(profile.goalWeight)}" stroke="${C.good}" stroke-width="1.5" stroke-dasharray="5 4"/>
      <text x="${W - P.r}" y="${y(profile.goalWeight) - 4}" fill="${C.ink}" font-size="9.5" text-anchor="end">Goal ${profile.goalWeight}</text>
      <path d="${planPath}" stroke="${C.ink2}" stroke-width="1.5" stroke-dasharray="2 3" fill="none"/>
      ${dots}
      <path d="${trendPath}" stroke="${C.blue}" stroke-width="2" fill="none" stroke-linejoin="round"/>
      <circle cx="${x(pts.length - 1)}" cy="${y(last.trend)}" r="4" fill="${C.blue}" stroke="${C.surface}" stroke-width="2"/>
      ${xl}${hits}</svg>
      <div class="legend"><span><i style="background:${C.blue}"></i>Trend</span><span><i class="dot"></i>Scale</span><span><i class="dash" style="border-color:${C.ink2}"></i>Plan</span><span><i class="dash" style="border-color:${C.good}"></i>Goal</span></div>`;
    wireTips(el);
  }

  // Bars against a target line. mode 'calories': over target = critical, else good.
  function bars(el, days, target, opts) {
    const unit = opts.unit, key = opts.key;
    const vals = days.map(d => Math.round(d[key]));
    const hi = Math.max(target * 1.25, ...vals) * 1.05;
    const n = days.length, gap = 2, bw = (W - P.l - P.r) / n - gap;
    const x = i => P.l + i * (bw + gap) + gap / 2;
    const y = v => P.t + (H - P.t - P.b) * (1 - v / hi);
    const base = y(0);
    const barsSvg = days.map((d, i) => {
      const v = vals[i];
      if (!d.meals) return `<rect x="${x(i)}" y="${base - 3}" width="${bw}" height="3" fill="${C.grid}" data-tip="<b>${short(d.date)}</b><br>Not logged"/>`;
      let color = C.blue, status = '';
      if (opts.status === 'over-bad') { const over = v > target + 100; color = over ? C.crit : C.good; status = over ? '✕ Over by ' + (v - target) : '✓ Under by ' + (target - v); }
      if (opts.status === 'under-bad') { const low = v < target * 0.9; status = low ? '✕ ' + (target - v) + ' ' + unit + ' short' : '✓ Target met'; }
      const h = Math.max(1, base - y(v)), r = Math.min(4, bw / 2, h);
      const path = `M${x(i)} ${base} V${y(v) + r} Q${x(i)} ${y(v)} ${x(i) + r} ${y(v)} H${x(i) + bw - r} Q${x(i) + bw} ${y(v)} ${x(i) + bw} ${y(v) + r} V${base}Z`;
      return `<path d="${path}" fill="${color}" data-tip="<b>${short(d.date)}</b><br>${v} ${unit}<br>${status}"/>`;
    }).join('');
    const labels = days.map((d, i) => `<text x="${x(i) + bw / 2}" y="${H - 7}" fill="${C.ink2}" font-size="9" text-anchor="middle">${dowOf(d.date)}</text>`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart">
      ${frame(niceTicks(0, hi, 4), y, t => t >= 1000 ? (t / 1000) + 'k' : t)}
      ${barsSvg}
      <line x1="${P.l}" x2="${W - P.r}" y1="${y(target)}" y2="${y(target)}" stroke="${C.ink}" stroke-width="1.5" stroke-dasharray="5 4"/>
      <text x="${W - P.r}" y="${y(target) - 4}" fill="${C.ink}" font-size="9.5" text-anchor="end">Target ${target}</text>
      ${labels}</svg>` + (opts.status === 'over-bad'
        ? `<div class="legend"><span><i style="background:${C.good}"></i>✓ At or under target</span><span><i style="background:${C.crit}"></i>✕ Over target</span></div>` : '');
    wireTips(el);
  }

  // 28-day consistency strip: food logged and weighed in per day.
  function consistency(el, state, today) {
    const days = Coach.lastNDays(today, 28);
    const wset = new Set(Coach.live(state.weights).map(w => w.date));
    const cells = days.map(d => {
      const t = Coach.dayTotals(state, d), w = wset.has(d);
      const lvl = (t.meals >= 3 ? 2 : t.meals ? 1 : 0) + (w ? 1 : 0);
      const tip = `<b>${short(d)}</b><br>${t.meals} meals logged<br>${w ? '✓ Weighed in' : '✕ No weigh-in'}`;
      return `<div class="cell l${lvl}${d === today ? ' today' : ''}" data-tip="${tip}"><span>${dowOf(d)}</span></div>`;
    }).join('');
    el.innerHTML = `<div class="strip">${cells}</div><div class="legend"><span><i class="cell l0"></i>Nothing</span><span><i class="cell l1"></i>Some</span><span><i class="cell l3"></i>All meals + weigh-in</span></div>`;
    wireTips(el);
  }

  // Calorie ring for the Today screen.
  function ring(el, eaten, target) {
    const r = 52, c = 2 * Math.PI * r, frac = Math.min(1, eaten / target), over = eaten > target;
    el.innerHTML = `<svg viewBox="0 0 130 130" class="ring">
      <circle cx="65" cy="65" r="${r}" stroke="#2b2622" stroke-width="15" fill="none"/><circle cx="65" cy="65" r="${r}" stroke="#ffffff" stroke-width="10" fill="none"/>
      <circle cx="65" cy="65" r="${r}" stroke="${over ? C.crit : C.blue}" stroke-width="10" fill="none" stroke-linecap="round"
        stroke-dasharray="${(frac * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 65 65)"/>
      <text x="65" y="64" text-anchor="middle" fill="#2b2622" font-size="30" font-family="Caveat,cursive" font-weight="700">${Math.abs(target - Math.round(eaten))}</text>
      <text x="65" y="84" text-anchor="middle" fill="${C.ink}" font-size="13">${over ? '✕ kcal over' : 'kcal left'}</text></svg>`;
  }

  root.Charts = { weight, bars, consistency, ring, COLORS: C };
})(self);
