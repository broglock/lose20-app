/* Lose20 coaching engine. Pure functions, no DOM. Used by the phone app,
   the desk window and the Node tests. */
(function (root) {
  'use strict';

  const LB_PER_KG = 2.20462;
  const KCAL_PER_LB = 3500;

  function defaultState(today) {
    return {
      version: 1,
      profile: {
        name: 'David',
        coachName: 'Maya',
        sex: 'male',
        age: 60,
        heightIn: 70,
        startWeight: 185,
        goalWeight: 165,
        startDate: today,
        paceLbPerWeek: 1.0,
        gymDays: [1, 3, 5],            // Mon, Wed, Fri
        gymRoutine: ['weights', 'run5k'],
        activityFactor: 1.5,           // 3x/week weights + 5k
        updatedAt: 0
      },
      weights: [],
      meals: [],
      workouts: [],
      plans: [],        // if-then plans the user picked
      planChecks: [],   // daily kept/missed for each plan
      reports: []       // weekly report cards
    };
  }

  // ---------- dates ----------
  function ymd(d) {
    const z = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }
  function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
  function lastNDays(today, n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(addDays(today, -i)); return out; }
  function dow(s) { return parseYmd(s).getDay(); }
  function isWeekend(s) { const d = dow(s); return d === 0 || d === 6; }

  const live = arr => (arr || []).filter(x => !x.deleted);

  // ---------- targets ----------
  // Mifflin-St Jeor BMR, times an activity factor, minus the deficit for the chosen pace.
  // ---------- exercise ----------
  // METs from the Compendium of Physical Activities (Ainsworth 2011). Net calories above resting,
  // since resting burn is already in the targets.
  const EXERCISE = {
    weights: { name: 'Weights', icon: '🏋️', met: [3.5, 5, 6] },
    run: { name: 'Run', icon: '🏃', met: [8, 9.8, 11.5] },
    walk: { name: 'Walk', icon: '🚶', met: [3, 3.8, 5] },
    bike: { name: 'Bike', icon: '🚴', met: [5.8, 8, 10] },
    swim: { name: 'Swim', icon: '🏊', met: [6, 8, 10] },
    elliptical: { name: 'Elliptical / rower', icon: '🚣', met: [5, 6, 8] },
    hike: { name: 'Hike', icon: '🥾', met: [5.3, 6, 7.8] },
    yoga: { name: 'Yoga / stretch', icon: '🧘', met: [2.5, 3, 4] },
    sport: { name: 'Sport', icon: '🎾', met: [5, 7, 8] },
    other: { name: 'Other', icon: '⚡', met: [3.5, 5, 7] }
  };
  const INTENSITY = ['easy', 'moderate', 'hard'];
  function exerciseKcal(type, minutes, intensity, lb) {
    const e = EXERCISE[type] || EXERCISE.other, i = Math.max(0, INTENSITY.indexOf(intensity));
    return Math.round((e.met[i < 0 ? 1 : i] - 1) * (lb / LB_PER_KG) * (minutes / 60) / 5) * 5;
  }
  // Every workout is a list of exercises. The calorie target already assumes the planned routine
  // (weights + 5k, three times a week), so the weights and run of the first three workout days each
  // week (Mon-Sun) count as "planned" and add nothing. Everything else earns back half its burn.
  // Older data had one "weights+run" record without a type; it still counts as a planned session.
  const isLegacy = w => !w.extra && !EXERCISE[w.type];
  const isStrengthOrRun = w => isLegacy(w) || w.type === 'weights' || w.type === 'run';
  function exercisesOn(state, d) { return live(state.workouts).filter(w => w.date === d && w.done !== false); }
  function gymSession(state, d) { return exercisesOn(state, d).some(isStrengthOrRun); }
  function weekStart(d) { const t = new Date(d + 'T12:00'); return addDays(d, -((t.getDay() + 6) % 7)); }
  function plannedIds(state, d) {
    const ws = weekStart(d), we = addDays(ws, 6);
    const days = [...new Set(live(state.workouts).filter(w => w.date >= ws && w.date <= we && w.done !== false && isStrengthOrRun(w)).map(w => w.date))].sort().slice(0, 3);
    const ids = new Set();
    days.forEach(day => {
      const ex = exercisesOn(state, day).sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
      const w = ex.find(x => isLegacy(x) || x.type === 'weights'), r = ex.find(x => x.type === 'run');
      if (w) ids.add(w.id); if (r) ids.add(r.id);
    });
    return ids;
  }
  function extraExercise(state, d) { const p = plannedIds(state, d); return exercisesOn(state, d).filter(w => !p.has(w.id) && !isLegacy(w)); }
  function exerciseBonus(state, d) { return Math.round(extraExercise(state, d).reduce((a, w) => a + (w.kcal || 0), 0) * 0.5 / 10) * 10; }
  const isRoutine = w => isStrengthOrRun(w);

  function targets(profile, currentLb) {
    const kg = currentLb / LB_PER_KG;
    const cm = profile.heightIn * 2.54;
    const bmr = 10 * kg + 6.25 * cm - 5 * profile.age + (profile.sex === 'female' ? -161 : 5);
    const tdee = bmr * (profile.activityFactor || 1.5);
    const deficit = (profile.paceLbPerWeek || 1) * KCAL_PER_LB / 7;
    const floor = profile.sex === 'female' ? 1200 : 1500;
    const kcal = Math.max(floor, Math.round((tdee - deficit) / 10) * 10);
    return {
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      kcal,
      protein: Math.round(kg * 1.4),   // g/day; 1.2-1.6 g/kg range for older adults lifting
      fiber: 30,
      fatMaxPct: 30
    };
  }

  // ---------- weight trend ----------
  // Exponentially smoothed trend (alpha 0.1 per day), filled across missing days.
  function weightSeries(state, today) {
    const ws = live(state.weights).slice().sort((a, b) => a.date < b.date ? -1 : 1);
    if (!ws.length) return [];
    const byDate = {};
    ws.forEach(w => { byDate[w.date] = w.lb; });
    const out = [];
    let trend = ws[0].lb;
    for (let d = ws[0].date; d <= today; d = addDays(d, 1)) {
      if (byDate[d] != null) trend = trend + 0.1 * (byDate[d] - trend);
      out.push({ date: d, lb: byDate[d] != null ? byDate[d] : null, trend: Math.round(trend * 10) / 10 });
    }
    return out;
  }

  function currentWeight(state, today) {
    const s = weightSeries(state, today);
    return s.length ? s[s.length - 1].trend : state.profile.startWeight;
  }

  // Least-squares slope of the trend line over the last n days, in lb/week.
  function trendRate(series, n) {
    const pts = series.slice(-n);
    if (pts.length < 7) return null;
    const xs = pts.map((_, i) => i), ys = pts.map(p => p.trend);
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    return den ? (num / den) * 7 : null;
  }

  // ---------- daily totals ----------
  function dayTotals(state, date) {
    const ms = live(state.meals).filter(m => m.date === date);
    const t = { date, kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, meals: ms.length, scoreSum: 0, late: 0, breakfast: false };
    ms.forEach(m => {
      t.kcal += +m.kcal || 0; t.protein += +m.protein || 0; t.carbs += +m.carbs || 0;
      t.fat += +m.fat || 0; t.fiber += +m.fiber || 0; t.scoreSum += +m.score || 0;
      const time = m.time || '12:00';
      if (time >= '20:00') t.late += +m.kcal || 0;
      if (time <= '10:30') t.breakfast = true;
    });
    t.score = ms.length ? t.scoreSum / ms.length : null;
    return t;
  }

  function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

  // ---------- analysis ----------
  // Returns targets, today's numbers, and ranked lists of wins and problems.
  // Each rule is tied to a research finding (see research.md).
  function analyze(state, today) {
    const p = state.profile;
    const series = weightSeries(state, today);
    const nowLb = currentWeight(state, today);
    const T = targets(p, nowLb);
    const last7 = lastNDays(today, 7);
    const prev7 = last7.filter(d => d !== today && d >= p.startDate); // completed days since the start
    const days = prev7.map(d => dayTotals(state, d));
    const logged = days.filter(d => d.meals > 0);
    const todayT = dayTotals(state, today);
    const wins = [], problems = [];
    const add = (list, sev, key, title, detail) => list.push({ sev, key, title, detail });

    // 1. Logging consistency (6-7 logging days/week tied to the largest losses)
    const loggedDays = logged.length;
    const nDays = prev7.length;
    if (nDays >= 2) {
      if (loggedDays >= nDays) add(wins, 1, 'logging', 'Logging every day', `${loggedDays} of the last ${nDays} days logged.`);
      else add(problems, loggedDays <= nDays / 2 ? 3 : 2, 'logging', 'Gaps in the food log',
        `${loggedDays} of the last ${nDays} days logged. Daily loggers lose the most.`);
    }

    // 2. Calories vs target
    if (logged.length) {
      const over = logged.filter(d => d.kcal > T.kcal + 100).length;
      const avgK = Math.round(avg(logged.map(d => d.kcal)));
      if (over >= 3) add(problems, 3, 'calories', 'Over the calorie target too often',
        `${over} of ${logged.length} logged days over ${T.kcal} kcal. Average ${avgK}.`);
      else if (avgK <= T.kcal) add(wins, 2, 'calories', 'Calories on target', `Average ${avgK} kcal vs ${T.kcal} target.`);
      else add(problems, 2, 'calories', 'Calories creeping up', `Average ${avgK} kcal vs ${T.kcal} target.`);
      const under = logged.filter(d => d.kcal > 0 && d.kcal < T.kcal - 700).length;
      if (under >= 2) add(problems, 2, 'undereating', 'Some days are too low',
        `${under} days more than 700 kcal under target. That costs muscle and leads to rebound eating.`);
    }

    // 3. Protein (1.2-1.6 g/kg protects muscle in older adults during a deficit)
    if (logged.length) {
      const ap = Math.round(avg(logged.map(d => d.protein)));
      if (ap >= T.protein * 0.9) add(wins, 2, 'protein', 'Protein is strong', `Average ${ap} g vs ${T.protein} g target.`);
      else add(problems, ap < T.protein * 0.7 ? 3 : 2, 'protein', 'Protein is low',
        `Average ${ap} g vs ${T.protein} g target. Low protein in a deficit means losing muscle, not just fat.`);
      const af = Math.round(avg(logged.map(d => d.fiber)));
      if (af < 20) add(problems, 1, 'fiber', 'Not enough fiber', `Average ${af} g vs ${T.fiber} g. Vegetables, beans and fruit fill you up for fewer calories.`);
      else add(wins, 1, 'fiber', 'Good fiber intake', `Average ${af} g.`);
    }

    // 4. Weekend drift (NWCR: same eating pattern on weekdays and weekends)
    const wk = logged.filter(d => !isWeekend(d.date)), we = logged.filter(d => isWeekend(d.date));
    if (wk.length >= 2 && we.length >= 1) {
      const diff = Math.round(avg(we.map(d => d.kcal)) - avg(wk.map(d => d.kcal)));
      if (diff > 300) add(problems, 2, 'weekend', 'Weekends undo the week',
        `Weekend days average ${diff} kcal more than weekdays.`);
      else add(wins, 1, 'weekend', 'Weekends match weekdays', 'Consistent eating across the week.');
    }

    // 5. Late eating
    if (logged.length >= 3) {
      const latePct = avg(logged.map(d => d.kcal ? d.late / d.kcal : 0));
      if (latePct > 0.25) add(problems, 1, 'late', 'Too much eating after 8 pm',
        `${Math.round(latePct * 100)}% of calories come after 8 pm.`);
    }

    // 6. Breakfast (78% of NWCR members eat breakfast daily)
    if (logged.length >= 3) {
      const bf = logged.filter(d => d.breakfast).length;
      if (bf >= logged.length - 1) add(wins, 1, 'breakfast', 'Eating breakfast', `${bf} of ${logged.length} days.`);
      else add(problems, 1, 'breakfast', 'Skipping breakfast', `Breakfast on ${bf} of ${logged.length} logged days.`);
    }

    // 7. Meal quality
    const scored = logged.filter(d => d.score != null);
    if (scored.length >= 3) {
      const s = avg(scored.map(d => d.score));
      if (s < 6) add(problems, 2, 'quality', 'Meal quality is low', `Average health score ${s.toFixed(1)}/10.`);
      else if (s >= 7.5) add(wins, 1, 'quality', 'Meals are high quality', `Average health score ${s.toFixed(1)}/10.`);
    }

    // 8. Weigh-ins (daily weighing linked to greater loss)
    const lastW = live(state.weights).map(w => w.date).sort().pop();
    const sinceW = lastW ? daysBetween(lastW, today) : null;
    const weighIns7 = live(state.weights).filter(w => last7.includes(w.date)).length;
    if (sinceW == null || sinceW >= 3) add(problems, 2, 'weighin', 'Not weighing in',
      sinceW == null ? 'No weigh-ins yet.' : `Last weigh-in was ${sinceW} days ago.`);
    else if (weighIns7 >= 5) add(wins, 1, 'weighin', 'Weighing in daily', `${weighIns7} weigh-ins this week.`);

    // 9. Rate of loss vs plan
    const rate = trendRate(series, 21);   // negative = losing
    if (rate != null) {
      const loss = -rate;
      if (loss < p.paceLbPerWeek * 0.5) add(problems, 3, 'rate', 'Weight is not moving enough',
        `Trend ${loss >= 0 ? 'down' : 'up'} ${Math.abs(loss).toFixed(1)} lb/week vs ${p.paceLbPerWeek} planned.`);
      else if (loss > 2) add(problems, 2, 'tooFast', 'Losing too fast',
        `Trend down ${loss.toFixed(1)} lb/week. Over 2 lb/week at 60 risks muscle loss. Eat a bit more protein and carbs around workouts.`);
      else if (loss < p.paceLbPerWeek * 0.8) add(problems, 1, 'rate', 'A little behind pace',
        `Trend down ${loss.toFixed(1)} lb/week vs ${p.paceLbPerWeek} planned.`);
      else add(wins, 3, 'rate', 'On pace', `Trend down ${loss.toFixed(1)} lb/week.`);
    }

    // 10. Workouts this week vs plan
    const weekStart = addDays(today, -((dow(today) + 6) % 7)); // Monday
    const planned = lastNDays(today, daysBetween(weekStart, today) + 1).filter(d => p.gymDays.includes(dow(d)) && d < today && d >= p.startDate);
    const done = planned.filter(d => gymSession(state, d));
    if (planned.length) {
      if (done.length === planned.length) add(wins, 2, 'gym', 'Every gym session done', `${done.length} of ${planned.length} this week.`);
      else add(problems, 2, 'gym', 'Missed gym sessions', `${done.length} of ${planned.length} planned sessions done this week.`);
    }

    problems.sort((a, b) => b.sev - a.sev);
    wins.sort((a, b) => b.sev - a.sev);

    // projection
    let projection = null;
    const toGo = Math.max(0, nowLb - p.goalWeight);
    const effRate = rate != null && rate < -0.1 ? -rate : p.paceLbPerWeek;
    if (toGo > 0) projection = { lbToGo: Math.round(toGo * 10) / 10, weeks: Math.ceil(toGo / effRate), date: addDays(today, Math.ceil(toGo / effRate * 7)), basis: rate != null && rate < -0.1 ? 'trend' : 'plan' };
    const lost = Math.round((p.startWeight - nowLb) * 10) / 10;
    const pct = Math.max(0, Math.min(100, Math.round(lost / (p.startWeight - p.goalWeight) * 100)));

    const critical = problems.some(x => x.sev === 3);
    const settling = Coach_daysTracked(state) < 3;
    const mood = settling ? 'happy' : critical ? 'concerned' : wins.length > problems.length + 1 ? 'cheer' : wins.length >= problems.length ? 'happy' : 'neutral';

    return {
      today, targets: T, nowLb, lost, pct, rate, projection, series,
      todayTotals: todayT,
      remaining: T.kcal + exerciseBonus(state, today) - todayT.kcal,
      exerciseBonus: exerciseBonus(state, today),
      exerciseToday: exercisesOn(state, today),
      proteinLeft: Math.max(0, T.protein - Math.round(todayT.protein)),
      isGymDay: p.gymDays.includes(dow(today)),
      gymDoneToday: gymSession(state, today),
      weighedToday: lastW === today,
      loggedDays, wins, problems, mood
    };
  }

  function Coach_daysTracked(state) { return new Set(live(state.meals).map(m => m.date)).size; }

  // ---------- tips ----------
  const TIPS = {
    protein: [
      'Build every meal around a palm or two of protein first: chicken, fish, eggs, Greek yogurt, cottage cheese, lean beef, tofu.',
      'Breakfast is the easiest protein win. Three eggs plus a cup of Greek yogurt is about 50 g.',
      'After the gym, aim for 30 to 40 g of protein within a couple of hours. At 60, muscle needs a bigger dose to respond.',
      'Keep emergency protein around: canned tuna, jerky, protein shakes, string cheese.',
      'Cottage cheese with berries is a high-protein snack that keeps you full into the evening.'
    ],
    calories: [
      'Fill half the plate with vegetables before anything else goes on it. Same fullness, far fewer calories.',
      'Liquid calories are the sneakiest. Juice, specialty coffee and beer add up without filling you.',
      'Cooking oil is about 120 kcal per tablespoon. Measure it instead of pouring.',
      'Use a smaller plate at dinner. People eat what is in front of them.',
      'Eat slowly. It takes about 20 minutes for fullness signals to catch up.',
      'Restaurant portions are often two meals. Box half before you start.'
    ],
    fiber: [
      'Add a cup of beans or lentils to soups and salads for fiber and protein at once.',
      'Berries, pears and apples with the skin are high-fiber fruit choices.',
      'Swap white rice for a mix of rice and cauliflower rice, or for barley.'
    ],
    weekend: [
      'Plan weekend meals on Friday. Unplanned weekends are where most weekly deficits disappear.',
      'Successful long-term losers eat the same way on weekends as weekdays. Pick one treat meal, not a treat weekend.',
      'If you are going out Saturday, bank 200 kcal on Friday and Saturday lunch instead of skipping meals.'
    ],
    late: [
      'Set a kitchen-closed time, say 8 pm, and brush your teeth after dinner.',
      'Evening hunger is often habit. Try herbal tea or sparkling water first and wait 15 minutes.',
      'Move more of your calories to breakfast and lunch so dinner is not a rescue meal.'
    ],
    breakfast: [
      'About 4 in 5 people who keep weight off eat breakfast daily. Make it protein-heavy.',
      'Overnight oats with protein powder take two minutes the night before.'
    ],
    logging: [
      'Log meals as you eat, not at the end of the day. Memory undercounts.',
      'Consistency beats precision. A rough log every day works better than a perfect log twice a week.',
      'Snap a photo of everything, even a handful of nuts. Small bites add up.'
    ],
    weighin: [
      'Weigh in every morning after the bathroom, before eating. Watch the trend line, not the daily number.',
      'Daily weight jumps of 1 to 3 lb are water and salt. The trend line is what counts.'
    ],
    gym: [
      'Lifting while in a deficit is what keeps the weight you lose from being muscle. Do not skip weights days.',
      'If you miss a gym day, take a 30-minute brisk walk. Something beats nothing.',
      'Do not eat back your 5k. Fitness trackers and treadmills overestimate calories burned.'
    ],
    undereating: [
      'Very low days backfire. They cost muscle and set up a binge. Stay close to target instead.'
    ],
    quality: [
      'Ultra-processed food leads people to eat about 500 kcal more per day. Choose foods that look like they came from a farm.',
      'Swap chips for air-popped popcorn or raw veggies with hummus.'
    ],
    rate: [
      'Stalls happen. Check portions of oils, sauces and drinks, which are the usual hidden calories.',
      'If the trend has not moved in three weeks, drop the target by 150 kcal and log every bite for a week.'
    ],
    tooFast: [
      'Faster is not better past 2 lb a week. Add a protein-rich snack and protect your muscle.'
    ],
    general: [
      'Most of the people who keep weight off eat mostly home-cooked food. Cook more, order less.',
      'Prep two days of lunches on Sunday so the healthy choice is the easy one.',
      'Alcohol lowers willpower and adds empty calories. Keep it to a couple of drinks a week.',
      'Sleep under 7 hours makes you hungrier the next day. Protect bedtime.',
      'Drink a glass of water before each meal.',
      'Keep trigger foods out of the house. Willpower is easier at the store than in the pantry.'
    ]
  };

  function hash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }

  // Picks a tip aimed at the top problem, otherwise a general one. Seeded so it changes through the day.
  function pickTip(analysis, seed) {
    const top = analysis.problems[0];
    const pool = (top && TIPS[top.key]) || (analysis.isGymDay ? TIPS.gym : TIPS.general);
    return pool[hash(seed || analysis.today) % pool.length];
  }

  // ---------- sync merge ----------
  // Last-writer-wins per record id; deleted records kept as tombstones.
  function mergeArrays(a, b) {
    const map = {};
    (a || []).concat(b || []).forEach(r => {
      const cur = map[r.id];
      if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) map[r.id] = r;
    });
    return Object.values(map).sort((x, y) => (x.date + (x.time || '')) < (y.date + (y.time || '')) ? -1 : 1);
  }
  function mergeState(local, remote) {
    if (!remote) return local;
    if (!local) return remote;
    const out = { version: 1, profile: (remote.profile.updatedAt || 0) > (local.profile.updatedAt || 0) ? remote.profile : local.profile };
    // Every array field merges record by record, so new record types sync without code changes.
    // Object fields with an updatedAt (profile, prefs) keep whichever side changed last.
    const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
    new Set(Object.keys(local).concat(Object.keys(remote))).forEach(k => {
      const l = local[k], r = remote[k];
      if (Array.isArray(l) || Array.isArray(r)) out[k] = mergeArrays(l, r);
      else if (k !== 'profile' && (isObj(l) || isObj(r))) out[k] = !isObj(l) ? r : !isObj(r) ? l : (r.updatedAt || 0) >= (l.updatedAt || 0) ? r : l;   // tie goes to remote so devices settle
    });
    return out;
  }

  // Traffic light for a meal: Claude's call if present, otherwise from score and size.
  function mealLight(m, kcalTarget) {
    let light = m.light || ((m.score || 5) >= 7 ? 'green' : (m.score || 5) >= 5 ? 'yellow' : 'red');
    const share = kcalTarget ? (m.kcal || 0) / kcalTarget : 0;
    if (share > 0.7) light = 'red';
    else if (share > 0.5 && light === 'green') light = 'yellow';
    return light;
  }

  // Short plain-text summary for Claude prompts (coach chat, nag messages).
  function summaryText(state, a) {
    const p = state.profile;
    const lines = [
      `Name: ${p.name}, age ${p.age}, ${p.heightIn} in. Start ${p.startWeight} lb, goal ${p.goalWeight} lb, plan ${p.paceLbPerWeek} lb/week.`,
      `Current trend weight ${a.nowLb} lb (lost ${a.lost} lb, ${a.pct}% of goal).` + (a.rate != null ? ` 3-week trend ${(-a.rate).toFixed(1)} lb/week loss.` : ''),
      `Targets: ${a.targets.kcal} kcal, ${a.targets.protein} g protein, ${a.targets.fiber} g fiber.`,
      `Today so far: ${Math.round(a.todayTotals.kcal)} kcal, ${Math.round(a.todayTotals.protein)} g protein, ${a.todayTotals.meals} meals logged. ${a.remaining} kcal left.`,
      (a.exerciseToday && a.exerciseToday.length ? `Exercise today: ${a.exerciseToday.map(w => `${(EXERCISE[w.type] || EXERCISE.other).name} ${w.minutes} min ${w.intensity} (~${w.kcal} kcal)`).join(', ')}; ${a.exerciseBonus} kcal added to today's budget (planned weights + 5k are already in the target).\n` : '') +
      `Gym day: ${a.isGymDay ? 'yes' : 'no'}${a.isGymDay ? (a.gymDoneToday ? ' (done)' : ' (not done yet)') : ''}. Weighed in today: ${a.weighedToday ? 'yes' : 'no'}.`,
      'Going right: ' + (a.wins.map(w => w.title + ' (' + w.detail + ')').join('; ') || 'nothing yet'),
      'Going wrong: ' + (a.problems.map(w => w.title + ' (' + w.detail + ')').join('; ') || 'nothing')
    ];
    return lines.join('\n');
  }

  const api = { defaultState, targets, weightSeries, currentWeight, trendRate, dayTotals, analyze, pickTip, TIPS,
    mergeState, mergeArrays, mealLight, summaryText, EXERCISE, INTENSITY, exerciseKcal, exerciseBonus, extraExercise, exercisesOn, gymSession, plannedIds, isLegacy, isRoutine, ymd, addDays, lastNDays, daysBetween, isWeekend, live };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Coach = api;
})(typeof self !== 'undefined' ? self : this);
