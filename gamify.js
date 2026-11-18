/* Motivation engine, built on the research in research.md:
   - points only for self-monitoring and healthy behaviour (mLIFE trial), never for eating less
   - a weekly points bank that starts full and leaks on missed basics (loss aversion, Volpp 2008)
   - streak shields so one miss doesn't end a streak (avoids all-or-nothing quitting)
   - slip detection, since disengagement shows before weight regain (Frie 2020)
   - leading indicators (fat burned from logged deficit) to bridge the "no results yet" gap
   - traffic-light colour mix (Thorndike cafeteria labels, Noom) */
(function (root) {
  'use strict';
  const C = (typeof module !== 'undefined' && module.exports) ? require('./coach.js') : root.Coach;

  const PTS = { meal: 10, photo: 5, green: 10, weigh: 15, protein: 20, gym: 30, onTarget: 20, plan: 10, fiber: 10, move: 15 };
  const BANK_START = 200, BANK_COST = { noLog: 40, noWeigh: 20, overBig: 20 };
  const LEVELS = ['Rookie', 'Starter', 'Regular', 'Committed', 'Disciplined', 'Machine', 'Iron', 'Legend'];
  // Each level needs more points than the last (about 3 days, then 4, 5 ... of solid days).
  const LEVEL_AT = [0, 300, 700, 1200, 1900, 2800, 3900, 5200, 6800];

  function tgt(state, today) { return C.targets(state.profile, C.currentWeight(state, today)); }
  function weighSet(state) { return new Set(C.live(state.weights).map(w => w.date)); }
  function gymDone(state, d) { return C.gymSession(state, d); }

  // Points earned on one day, itemised.
  function dayPoints(state, d, T) {
    T = T || tgt(state, d);
    const meals = C.live(state.meals).filter(m => m.date === d);
    const t = C.dayTotals(state, d);
    const items = [];
    const add = (why, n) => items.push({ why, n });
    meals.slice(0, 5).forEach(m => {
      add('Logged ' + (m.name || 'a meal'), PTS.meal);
      if (m.source === 'photo') add('Photo log', PTS.photo);
      if (C.mealLight(m, T.kcal) === 'green') add('Green meal', PTS.green);
    });
    if (weighSet(state).has(d)) add('Weighed in', PTS.weigh);
    if (t.protein >= T.protein * 0.9) add('Protein target', PTS.protein);
    if (t.fiber >= 25) add('Fiber 25 g', PTS.fiber);
    if (gymDone(state, d)) add('Workout', PTS.gym);
    if (C.extraExercise(state, d).length) add('Extra exercise', PTS.move);
    // On target only counts with a full day logged and not under the safe floor.
    if (t.meals >= 3 && t.kcal <= T.kcal + C.exerciseBonus(state, d) + 100 && t.kcal >= T.kcal - 700) add('On calorie target', PTS.onTarget);
    C.live(state.planChecks || []).filter(c => c.date === d && c.kept).forEach(() => add('Kept an if-then plan', PTS.plan));
    return { total: items.reduce((s, i) => s + i.n, 0), items };
  }

  function xp(state, today) {
    const start = state.profile.startDate < today ? state.profile.startDate : today;
    const T = tgt(state, today);
    let total = 0;
    for (let d = start; d <= today; d = C.addDays(d, 1)) total += dayPoints(state, d, T).total;
    let lvl = 0; while (lvl + 1 < LEVEL_AT.length && total >= LEVEL_AT[lvl + 1]) lvl++;
    const next = LEVEL_AT[lvl + 1] || LEVEL_AT[lvl] + 2000;
    return { total, level: lvl + 1, name: LEVELS[Math.min(lvl, LEVELS.length - 1)], into: total - LEVEL_AT[lvl], need: next - LEVEL_AT[lvl] };
  }

  // Weekly bank: starts at 200 every Monday, completed days that miss the basics cost points.
  function weeklyBank(state, today) {
    const T = tgt(state, today), ws = weighSet(state);
    const monday = C.addDays(today, -((new Date(today + 'T12:00').getDay() + 6) % 7));
    let bank = BANK_START; const losses = [];
    for (let d = monday; d < today; d = C.addDays(d, 1)) {
      if (d < state.profile.startDate) continue;
      const t = C.dayTotals(state, d);
      if (!t.meals) { bank -= BANK_COST.noLog; losses.push({ date: d, why: 'No meals logged', n: BANK_COST.noLog }); }
      if (!ws.has(d)) { bank -= BANK_COST.noWeigh; losses.push({ date: d, why: 'No weigh-in', n: BANK_COST.noWeigh }); }
      if (t.kcal > T.kcal + 300) { bank -= BANK_COST.overBig; losses.push({ date: d, why: 'Over by 300+ kcal', n: BANK_COST.overBig }); }
    }
    const t = C.dayTotals(state, today);
    const atRisk = (t.meals ? 0 : BANK_COST.noLog) + (ws.has(today) ? 0 : BANK_COST.noWeigh);
    return { start: BANK_START, bank: Math.max(0, bank), losses, atRisk, daysLeft: 7 - C.daysBetween(monday, today) };
  }

  // Streak counting back from today (or yesterday if today isn't done yet).
  // One miss in any 7-day stretch is covered by a shield instead of breaking the streak.
  function streakWithShield(today, test, floorDate) {
    let n = 0, used = 0, lastMiss = null;
    let d = test(today) ? today : C.addDays(today, -1);
    for (let i = 0; i < 1000 && d >= floorDate; i++, d = C.addDays(d, -1)) {
      if (test(d)) { n++; continue; }
      const prev = C.addDays(d, -1);
      const shieldOk = n >= 3 && (!lastMiss || C.daysBetween(d, lastMiss) >= 7) && test(prev);
      if (!shieldOk) break;
      used++; lastMiss = d;
    }
    return { days: n, shieldsUsed: used };
  }

  function streaks(state, today) {
    const T = tgt(state, today), ws = weighSet(state), start = state.profile.startDate;
    const dt = d => C.dayTotals(state, d);
    return {
      logging: streakWithShield(today, d => dt(d).meals > 0, start),
      weighin: streakWithShield(today, d => ws.has(d), start),
      protein: streakWithShield(today, d => dt(d).protein >= T.protein * 0.9, start)
    };
  }

  // Slip detection: drop-off in logging or weighing after a period of use.
  function slip(state, today) {
    const lastMeal = C.live(state.meals).map(m => m.date).filter(d => d < today).sort().pop();
    const lastW = C.live(state.weights).map(w => w.date).sort().pop();
    const mealGap = lastMeal ? C.daysBetween(lastMeal, today) - 1 : null;  // full days missed
    const weighGap = lastW ? C.daysBetween(lastW, today) : null;
    const slipping = (mealGap != null && mealGap >= 2) || (weighGap != null && weighGap >= 4);
    return { slipping, mealGap, weighGap, isMonday: new Date(today + 'T12:00').getDay() === 1 };
  }

  // Leading indicator: fat burned from the logged deficit on fully logged days (3+ meals).
  function fatBurned(state, today, days) {
    const T = tgt(state, today);
    const list = C.lastNDays(today, days).filter(d => d >= state.profile.startDate && d < today);
    let kcal = 0, counted = 0;
    list.forEach(d => {
      const t = C.dayTotals(state, d);
      if (t.meals >= 3) { kcal += Math.max(0, T.tdee - t.kcal); counted++; }
    });
    return { lb: Math.round(kcal / 3500 * 10) / 10, days: counted };
  }

  // Share of the day's calories by traffic light.
  function colorMix(state, d) {
    const T = tgt(state, d), mix = { green: 0, yellow: 0, red: 0 };
    C.live(state.meals).filter(m => m.date === d).forEach(m => {
      if (m.items && m.items.length && m.items.some(i => i.color)) m.items.forEach(i => { mix[i.color in mix ? i.color : 'yellow'] += +i.kcal || 0; });
      else mix[C.mealLight(m, T.kcal)] += +m.kcal || 0;
    });
    const total = mix.green + mix.yellow + mix.red;
    return { total, pct: total ? { green: mix.green / total, yellow: mix.yellow / total, red: mix.red / total } : { green: 0, yellow: 0, red: 0 } };
  }

  // Badges reward behaviour and real progress, never restriction.
  const BADGES = [
    { id: 'first-photo', icon: '📸', name: 'First snap', desc: 'Logged a meal with a photo', test: c => c.photoMeals >= 1 },
    { id: 'first-weigh', icon: '⚖️', name: 'Stepped on', desc: 'First weigh-in', test: c => c.weighins >= 1 },
    { id: 'green-5', icon: '🟢', name: 'Green streak', desc: '5 green meals', test: c => c.greenMeals >= 5 },
    { id: 'log-7', icon: '🔥', name: 'Week of logging', desc: '7-day logging streak', test: c => c.best.logging >= 7 },
    { id: 'log-30', icon: '🏆', name: 'Logging machine', desc: '30-day logging streak', test: c => c.best.logging >= 30 },
    { id: 'weigh-7', icon: '📉', name: 'Scale regular', desc: '7 weigh-ins in a row', test: c => c.best.weighin >= 7 },
    { id: 'protein-7', icon: '🥚', name: 'Protein pro', desc: 'Protein target 7 days running', test: c => c.best.protein >= 7 },
    { id: 'plan-10', icon: '🧠', name: 'Plan keeper', desc: 'Kept if-then plans 10 times', test: c => c.plansKept >= 10 },
    { id: 'gym-10', icon: '🏋️', name: 'Gym rat', desc: '10 workouts', test: c => c.gym >= 10 },
    { id: 'gym-25', icon: '💪', name: 'Iron habit', desc: '25 workouts', test: c => c.gym >= 25 },
    { id: 'lost-5', icon: '⭐', name: '5 lb down', desc: 'Trend weight down 5 lb', test: c => c.lost >= 5 },
    { id: 'lost-10', icon: '🌟', name: '10 lb down', desc: 'Halfway there', test: c => c.lost >= 10 },
    { id: 'lost-15', icon: '🚀', name: '15 lb down', desc: 'Final stretch', test: c => c.lost >= 15 },
    { id: 'lost-20', icon: '👑', name: 'Goal reached', desc: '20 lb down', test: c => c.lost >= 20 }
  ];

  function bestRun(dates, test) {
    let best = 0, cur = 0, prev = null;
    dates.forEach(d => {
      if (test(d)) { cur = prev && C.addDays(prev, 1) === d ? cur + 1 : 1; prev = d; best = Math.max(best, cur); }
      else { cur = 0; prev = null; }
    });
    return best;
  }

  function badges(state, today) {
    const p = state.profile, T = tgt(state, today), ws = weighSet(state);
    const start = p.startDate < today ? p.startDate : today;
    const days = []; for (let d = start; d <= today; d = C.addDays(d, 1)) days.push(d);
    const tot = {}; days.forEach(d => tot[d] = C.dayTotals(state, d));
    const meals = C.live(state.meals);
    const c = {
      photoMeals: meals.filter(m => m.source === 'photo').length,
      greenMeals: meals.filter(m => C.mealLight(m, T.kcal) === 'green').length,
      weighins: ws.size,
      gym: new Set(C.live(state.workouts).filter(w => w.done !== false && C.isRoutine(w)).map(w => w.date)).size,
      plansKept: C.live(state.planChecks || []).filter(x => x.kept).length,
      lost: Math.max(0, p.startWeight - C.currentWeight(state, today)),
      best: {
        logging: bestRun(days, d => tot[d].meals > 0),
        weighin: bestRun(days, d => ws.has(d)),
        protein: bestRun(days, d => tot[d].protein >= T.protein * 0.9)
      }
    };
    return BADGES.map(b => ({ id: b.id, icon: b.icon, name: b.name, desc: b.desc, earned: !!b.test(c) }));
  }

  // Today's missions: one tap each, ordered by time of day.
  function missions(state, today, hour) {
    const a = C.analyze(state, today), t = a.todayTotals, T = a.targets;
    const list = [
      { id: 'weigh', icon: '⚖️', text: 'Weigh in', pts: PTS.weigh, progress: a.weighedToday ? 1 : 0 },
      { id: 'log3', icon: '📸', text: 'Log 3 meals', pts: PTS.meal * 3, progress: Math.min(1, t.meals / 3), detail: `${t.meals}/3` },
      { id: 'protein', icon: '🥚', text: `${T.protein} g protein`, pts: PTS.protein, progress: Math.min(1, t.protein / T.protein), detail: `${Math.round(t.protein)} g` },
      { id: 'fiber', icon: '🥦', text: '25 g fiber', pts: PTS.fiber, progress: Math.min(1, t.fiber / 25), detail: `${Math.round(t.fiber)} g` }
    ];
    if (a.isGymDay) list.splice(1, 0, { id: 'gym', icon: '🏋️', text: 'Weights + 5k', pts: PTS.gym, progress: a.gymDoneToday ? 1 : 0 });
    const over = t.kcal > T.kcal + 100;
    list.push({ id: 'cal', icon: '🎯', text: `Under ${T.kcal} kcal`, pts: PTS.onTarget, failed: over,
      progress: over ? 0 : (hour >= 20 && t.meals >= 3 ? 1 : Math.min(0.95, t.kcal / T.kcal)), detail: `${Math.round(t.kcal)}` });
    list.forEach(m => { m.done = m.progress >= 1; });
    return { list, done: list.filter(m => m.done).length, total: list.length, allDone: list.every(m => m.done) };
  }

  function weekGrade(state, endDate) {
    const days = C.lastNDays(endDate, 7).map(d => C.dayTotals(state, d));
    const T = tgt(state, endDate);
    const logged = days.filter(d => d.meals > 0);
    if (!logged.length) return { grade: '–', points: 0, logged: 0 };
    let pts = 0;
    pts += logged.length / 7 * 30;
    pts += logged.filter(d => d.kcal <= T.kcal + 100).length / logged.length * 30;
    pts += Math.min(1, logged.reduce((s, d) => s + d.protein, 0) / logged.length / T.protein) * 20;
    const sc = logged.filter(d => d.score != null);
    pts += sc.length ? (sc.reduce((s, d) => s + d.score, 0) / sc.length) / 10 * 20 : 10;
    const grade = pts >= 90 ? 'A' : pts >= 80 ? 'B' : pts >= 65 ? 'C' : pts >= 50 ? 'D' : 'F';
    return { grade, points: Math.round(pts), logged: logged.length };
  }

  const api = { PTS, dayPoints, xp, weeklyBank, streaks, slip, fatBurned, colorMix, badges, missions, weekGrade, BADGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Gamify = api;
})(typeof self !== 'undefined' ? self : this);
