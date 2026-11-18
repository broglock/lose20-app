/* Lose20 UI. State lives in localStorage and syncs to a private GitHub repo.
   Motivation design is in research.md: traffic-light feedback, points for the right behaviours,
   a weekly points bank, streak shields, if-then plans, slip detection, and Maya reacting to everything. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const today = () => Coach.ymd(new Date());
  const hourNow = () => new Date().getHours() + new Date().getMinutes() / 60;
  const nowTime = () => new Date().toTimeString().slice(0, 5);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const params = new URLSearchParams(location.search);
  const DESK = params.has('desk');

  // ---------- storage ----------
  const SKEY = 'lose20.state', KKEY = 'lose20.settings', CKEY = 'lose20.celebrated';
  let state = load(SKEY) || Coach.defaultState(today());
  ['weights', 'meals', 'workouts', 'plans', 'planChecks', 'reports'].forEach(k => { if (!Array.isArray(state[k])) state[k] = []; });
  let settings = Object.assign({ voiceOn: true, model: 'claude-sonnet-5-5', voice: 'en-US-AvaMultilingualNeural' }, load(KKEY) || {});
  let celebrated = load(CKEY) || {};
  let A = null, chatHistory = [], pendingMeal = null, rec = null, tipSeed = 0;

  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function saveState() { localStorage.setItem(SKEY, JSON.stringify(state)); scheduleSync(); }
  function saveSettings() { localStorage.setItem(KKEY, JSON.stringify(settings)); }
  function saveCelebrated() { localStorage.setItem(CKEY, JSON.stringify(celebrated)); }
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2800); }

  // ---------- Maya instances ----------
  // Photo Maya (realistic, animated on a canvas). The cartoon is only a fallback if PhotoMaya is missing.
  const MayaKind = self.PhotoMaya || Avatar;
  const maya = {
    hero: MayaKind.create($('mayaHero'), {}),
    coach: MayaKind.create($('mayaCoach'), {}),
    result: MayaKind.create($('mayaResult'), { backdrop: true })
  };
  const allMaya = () => Object.values(maya);
  function mayaMood(m) { allMaya().forEach(i => i.setMood(m)); }

  // Live photorealistic avatar (Azure). Cartoon Maya only shows if the live avatar is off or failing.
  let liveBroken = false;
  const LiveMaya = self.LiveMaya || { speak: async () => false, stop() {}, close() {}, attach() {}, decorate() {}, minutesToday: () => 0 };
  const liveMode = () => !!self.LiveMaya && settings.avatarOn === true && !!settings.azureKey && !liveBroken;
  const boxes = { today: $('mayaHero'), maya: $('mayaCoach'), log: $('mayaResult') };
  function activeBox() {
    const t = (document.querySelector('.tab.active') || {}).id || 'tab-today';
    return t === 'tab-maya' ? boxes.maya : t === 'tab-log' ? boxes.log : boxes.today;
  }
  function applyLiveMode() {
    document.body.classList.toggle('live-mode', liveMode());
    if (liveMode()) Object.values(boxes).forEach(b => LiveMaya.decorate(b));
  }
  addEventListener('lose20-poster', applyLiveMode);
  addEventListener('lose20-avatar-error', e => {
    if (!liveBroken) toast('Live Maya unavailable: ' + e.detail + '. Using voice only.');
    liveBroken = true; applyLiveMode();   // retried after Settings are saved or the app reopens
  });
  function mayaPose(p, ms) { [maya.hero, maya.coach].forEach(i => i.pose(p, ms)); }

  // Speak with lip-sync; pose while talking.
  function say(text, opts) {
    opts = opts || {};
    if (!text) return;
    if (opts.pose) (opts.who ? [opts.who] : [maya.hero, maya.coach]).forEach(i => i.pose(opts.pose, opts.poseMs || 3500));
    if (opts.mood) mayaMood(opts.mood);
    if (opts.bubble !== false) $('bubble').textContent = text;
    const inst = allMaya();
    if (opts.force) { speakAudio(text, inst, Object.assign({}, settings, { voiceOn: true })); return; }
    if (liveMode() && settings.voiceOn) {
      Services.stopSpeaking();
      LiveMaya.speak(settings, text, opts.box || activeBox()).then(ok => { if (!ok) speakAudio(text, inst); });
      return;
    }
    speakAudio(text, inst);
  }
  function speakAudio(text, inst, cfg) {
    Services.speak(cfg || settings, text,
      () => { if (!inst[0].svg.classList.contains('lipsync')) inst.forEach(i => i.talk(true)); },
      () => inst.forEach(i => i.talk(false)),
      audio => (MayaKind.lipSync || Avatar.lipSync)(audio, inst));
  }

  // ---------- sync ----------
  let syncTimer = null, syncing = false;
  function scheduleSync() { if (!settings.ghToken) return; clearTimeout(syncTimer); syncTimer = setTimeout(doSync, 2000); }
  async function doSync(manual) {
    if (!settings.ghToken || !settings.ghRepo) { if (manual) toast('Set up sync in Settings'); return; }
    if (syncing) return; syncing = true; $('syncDot').className = 'sync-dot';
    try {
      state = await Services.sync(settings, state);
      localStorage.setItem(SKEY, JSON.stringify(state));
      $('syncDot').className = 'sync-dot ok'; $('syncBtn').title = 'Synced ' + nowTime();
      refresh();
    } catch (e) { $('syncDot').className = 'sync-dot bad'; $('syncBtn').title = e.message; if (manual) toast(e.message); }
    syncing = false;
  }

  // ---------- navigation ----------
  function go(tab) {
    document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + tab));
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.go === tab));
    if (tab === 'progress') renderProgress();
    if (tab === 'diary') renderDiary();
    if (tab === 'settings') renderSettings();
    if (tab === 'maya' && !$('chat').children.length) addMsg('her', greeting());
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  $('gearBtn').onclick = () => go('settings');

  // ---------- what Maya says ----------
  function greeting() {
    const h = new Date().getHours(), n = state.profile.name, S = Gamify.slip(state, today());
    if (S.slipping) return Tips.pick(Tips.COMEBACK, today());
    if (S.isMonday && h < 12) return Tips.pick(Tips.MONDAY, today());
    const hi = h < 12 ? `Morning, ${n}!` : h < 17 ? `Hey ${n}!` : `Evening, ${n}.`;
    let line;
    if (!A.weighedToday && h < 12) line = 'Scale first, then show me breakfast.';
    else if (A.isGymDay && !A.gymDoneToday && h < 20) line = 'Gym day! Weights and your 5k. Let us go.';
    else if (A.todayTotals.meals === 0 && h >= 11) line = 'Nothing logged yet. Snap your next meal for me.';
    else if (A.remaining < 0) line = `You are ${-A.remaining} over today. Kitchen is closed, okay?`;
    else if (h >= 17) line = `${A.remaining} calories and ${A.proteinLeft} g of protein left. Make dinner count.`;
    else line = A.problems.length ? `Today's focus: ${A.problems[0].title.toLowerCase()}.` : Tips.pick(Tips.MOTIVATE, today() + h);
    return hi + ' ' + line;
  }
  function tipLine() {
    tipSeed++;
    return tipSeed % 2 ? Coach.pickTip(A, today() + tipSeed) : Tips.pick(Tips.MOTIVATE, today() + tipSeed);
  }
  function moodFor() {
    const S = Gamify.slip(state, today());
    if (S.slipping) return 'determined';
    if (A.remaining < -300) return 'concerned';
    return A.mood === 'cheer' ? 'cheer' : A.mood === 'concerned' ? 'concerned' : 'happy';
  }

  // ---------- render: today ----------
  function refresh() {
    A = Coach.analyze(state, today());
    const T = A.targets, t = A.todayTotals, d = today();
    allMaya().forEach(i => i.setOutfit(A.isGymDay ? 'gym' : 'tank'));
    mayaMood(moodFor());
    if (!$('bubble').dataset.set) { $('bubble').textContent = greeting(); $('bubble').dataset.set = 1; }

    // header
    const X = Gamify.xp(state, d), dp = Gamify.dayPoints(state, d, T);
    $('lvlChip').textContent = `Lv ${X.level} ${X.name}`;
    $('ptsChip').textContent = `⭐ ${dp.total}`;

    // comeback
    const S = Gamify.slip(state, d);
    $('comeback').hidden = !S.slipping;
    if (S.slipping) $('comebackText').textContent = Tips.pick(Tips.COMEBACK, d) + (S.mealGap ? ` (${S.mealGap} days without a log.)` : '');

    // missions
    const M = Gamify.missions(state, d, hourNow());
    $('missions').innerHTML = M.list.map(m => `<li class="${m.done ? 'done' : ''} ${m.failed ? 'failed' : ''}">
      <span class="ic">${m.done ? '✅' : m.icon}</span>
      <div><span class="t">${esc(m.text)}</span>${m.detail ? ` <small>(${esc(m.detail)})</small>` : ''}<div class="bar"><i style="width:${Math.round(m.progress * 100)}%"></i></div></div>
      <span class="pts">+${m.pts}</span></li>`).join('');
    $('missionFoot').textContent = M.allDone ? '🎉 All missions done. That is a perfect day.' : `${M.done} of ${M.total} done. Each one earns points.`;

    // bank
    const B = Gamify.weeklyBank(state, d);
    $('bankNum').textContent = B.bank;
    $('bankBar').style.width = (B.bank / B.start * 100) + '%';
    $('bankNote').textContent = B.atRisk ? `${B.atRisk} more at risk today. ${t.meals ? '' : 'Log a meal'}${!t.meals && !A.weighedToday ? ' and ' : ''}${A.weighedToday ? '' : 'weigh in'} to keep it.` : 'Nothing at risk today. Protect it.';

    // streaks
    const ST = Gamify.streaks(state, d);
    const sh = s => s.shieldsUsed ? `<span class="shield">🛡 ${s.shieldsUsed} shield used</span>` : '';
    $('streaks').innerHTML = `<div class="streak">🔥 <b>${ST.logging.days}</b> logging ${sh(ST.logging)}</div>
      <div class="streak">⚖️ <b>${ST.weighin.days}</b> weigh-in ${sh(ST.weighin)}</div>
      <div class="streak">🥚 <b>${ST.protein.days}</b> protein</div>`;

    // fuel
    Charts.ring($('ring'), t.kcal, T.kcal);
    $('mProt').style.width = Math.min(100, t.protein / T.protein * 100) + '%';
    $('tProt').textContent = `${Math.round(t.protein)} / ${T.protein} g`;
    $('mFib').style.width = Math.min(100, t.fiber / T.fiber * 100) + '%';
    $('tFib').textContent = `${Math.round(t.fiber)} / ${T.fiber} g`;
    const mix = Gamify.colorMix(state, d);
    $('mixbar').innerHTML = mix.total ? `<i class="g" style="width:${mix.pct.green * 100}%"></i><i class="y" style="width:${mix.pct.yellow * 100}%"></i><i class="r" style="width:${mix.pct.red * 100}%"></i>` : '';

    // weigh-in + gym
    const tw = Coach.live(state.weights).find(w => w.date === d);
    $('wInput').placeholder = tw ? tw.lb + ' lb today' : 'lb';
    $('wHint').textContent = tw ? '✓ Weighed in today.' : 'Morning, after the bathroom, before food.';
    $('gymLabel').textContent = A.isGymDay ? 'Gym day' : 'Workout';
    $('gymText').textContent = A.isGymDay ? 'Weights + 5k done' : 'Did a workout anyway';
    $('gymDone').checked = A.gymDoneToday;
    $('exList').innerHTML = A.exerciseToday.map(w => { const E = Coach.EXERCISE[w.type] || Coach.EXERCISE.other;
      return `<li data-id="${w.id}">${E.icon} ${E.name} ${w.minutes} min, ${w.intensity} <small>~${w.kcal} kcal</small><button class="del" title="Delete">✕</button></li>`; }).join('') +
      (A.exerciseBonus ? `<li class="bonus">+${A.exerciseBonus} kcal added to today</li>` : '');

    // idea
    const idea = Tips.ideaFor(hourNow(), A.remaining, A.proteinLeft, d + tipSeed);
    $('ideaTitle').textContent = 'Idea for ' + idea.slot;
    $('idea').textContent = `${idea.name}. About ${idea.kcal} kcal and ${idea.protein} g protein.`;

    renderPlans();
    renderMeals();
    if (DESK) renderDesk();
    checkCelebrations(M);
  }

  function renderMeals() {
    const d = today(), T = A.targets;
    const meals = Coach.live(state.meals).filter(m => m.date === d);
    const ul = $('mealList');
    ul.innerHTML = meals.length ? '' : '<li class="empty">Nothing yet. Snap your next meal.</li>';
    meals.forEach(m => {
      const light = Coach.mealLight(m, T.kcal);
      const li = document.createElement('li'); li.className = light;
      li.innerHTML = `<div class="noimg">🍽</div><div class="m"><b><span class="dot ${light}"></span> ${esc(m.name)}</b><small>${m.time} · ${Math.round(m.kcal)} kcal · ${Math.round(m.protein)} g protein</small></div><button class="del" title="Delete">✕</button>`;
      Services.getThumb(m.id).then(src => { if (src) li.querySelector('.noimg').outerHTML = `<img src="${src}" alt="">`; }).catch(() => {});
      li.querySelector('.del').onclick = () => { if (confirm('Delete ' + m.name + '?')) { m.deleted = true; m.updatedAt = Date.now(); saveState(); refresh(); } };
      ul.appendChild(li);
    });
  }

  // ---------- celebrations ----------
  function checkCelebrations(M) {
    const d = today();
    const doneKey = 'missions:' + d;
    if (M.allDone && !celebrated[doneKey]) {
      celebrated[doneKey] = 1; saveCelebrated();
      FX.confetti(180); FX.buzz([60, 40, 60]);
      say('Every mission done today! That is what a winning day looks like.', { pose: 'cheer', mood: 'cheer', poseMs: 4000 });
    }
    Gamify.badges(state, d).filter(b => b.earned && !celebrated['badge:' + b.id]).forEach((b, i) => {
      celebrated['badge:' + b.id] = 1; saveCelebrated();
      setTimeout(() => { FX.confetti(120); toast(`${b.icon} New badge: ${b.name}`); }, 800 + i * 1500);
    });
  }
  function awardPoints(before) {
    const after = Gamify.dayPoints(state, today()).total;
    if (after > before) FX.points(after - before);
  }

  // ---------- weigh-in and gym ----------
  $('wSave').onclick = () => {
    const lb = parseFloat($('wInput').value);
    if (!(lb > 80 && lb < 400)) return toast('Enter your weight in lb');
    const before = Gamify.dayPoints(state, today()).total;
    const prevTrend = A.series.length ? A.series[A.series.length - 1].trend : null;
    const d = today();
    const w = state.weights.find(x => x.date === d && !x.deleted);
    if (w) { w.lb = lb; w.updatedAt = Date.now(); } else state.weights.push({ id: uid(), date: d, lb, updatedAt: Date.now() });
    $('wInput').value = ''; saveState(); refresh(); awardPoints(before);
    const dir = prevTrend == null ? 'flat' : A.nowLb < prevTrend - 0.05 ? 'down' : A.nowLb > prevTrend + 0.05 ? 'up' : 'flat';
    say(Tips.pick(Tips.WEIGH_REACT[dir], d + lb), { pose: dir === 'down' ? 'cheer' : dir === 'up' ? 'hips' : 'thumbs', mood: dir === 'down' ? 'cheer' : dir === 'up' ? 'determined' : 'happy' });
  };
  $('gymDone').onchange = e => {
    const before = Gamify.dayPoints(state, today()).total, d = today();
    const w = state.workouts.find(x => x.date === d && !x.deleted);
    if (w) { w.done = e.target.checked; w.updatedAt = Date.now(); }
    else state.workouts.push({ id: uid(), date: d, type: state.profile.gymRoutine.join('+'), done: e.target.checked, updatedAt: Date.now() });
    saveState(); refresh(); awardPoints(before);
    if (e.target.checked) { FX.confetti(90); say('Workout done! That is what keeps the weight you lose from being muscle. Get 30 grams of protein in.', { pose: 'flex', mood: 'determined' }); }
  };

  // ---------- other exercise ----------
  let exType = 'walk', exInt = 'moderate';
  $('exTypes').innerHTML = Object.entries(Coach.EXERCISE).map(([k, e]) => `<button data-t="${k}">${e.icon} ${e.name}</button>`).join('');
  function exUpdate() {
    $('exTypes').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === exType));
    $('exInt').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === exInt));
    const kc = Coach.exerciseKcal(exType, +$('exMin').value || 0, exInt, A.nowLb);
    $('exEst').textContent = `About ${kc} kcal burned. Adds ${Math.round(kc * 0.5 / 10) * 10} kcal to that day's budget.`;
  }
  $('exBtn').onclick = () => { $('exDate').value = today(); exUpdate(); $('exModal').hidden = false; };
  $('exTypes').onclick = e => { const b = e.target.closest('button'); if (b) { exType = b.dataset.t; exUpdate(); } };
  $('exInt').onclick = e => { const b = e.target.closest('button'); if (b) { exInt = b.dataset.v; exUpdate(); } };
  $('exMin').oninput = exUpdate;
  $('exCancel').onclick = () => { $('exModal').hidden = true; };
  $('exSave').onclick = () => {
    const minutes = +$('exMin').value || 0; if (minutes < 1) return toast('Enter the minutes');
    const before = Gamify.dayPoints(state, today()).total, d = $('exDate').value || today();
    const kcal = Coach.exerciseKcal(exType, minutes, exInt, A.nowLb);
    state.workouts.push({ id: uid(), date: d, type: exType, extra: true, minutes, intensity: exInt, kcal, done: true, updatedAt: Date.now() });
    $('exModal').hidden = true; saveState(); refresh(); awardPoints(before);
    const E = Coach.EXERCISE[exType];
    say(`${E.name} logged, about ${kcal} calories. ${d === today() ? `I added ${Math.round(kcal * 0.5 / 10) * 10} to today's budget. Spend it on protein, not on a treat.` : 'Nice work.'}`, { pose: 'flex', mood: 'cheer' });
  };
  $('exList').onclick = e => {
    if (!e.target.classList.contains('del')) return;
    const w = state.workouts.find(x => x.id === e.target.closest('li').dataset.id);
    if (w) { w.deleted = true; w.updatedAt = Date.now(); saveState(); refresh(); }
  };

  // ---------- What should I do next? ----------
  function nextSteps() {
    const d = today(), h = hourNow(), T = A.targets;
    const meals = Coach.live(state.meals).filter(m => m.date === d);
    const plan = Tips.planRest({ hour: h, kcalLeft: A.remaining, proteinLeft: A.proteinLeft, meals });
    const acts = [];
    if (!A.weighedToday && h < 11) acts.push('Weigh in now, before you eat.');
    else if (!A.weighedToday) acts.push('Weigh in first thing tomorrow morning.');
    if (A.isGymDay && !A.gymDoneToday && h < 20) acts.push('It is a gym day: weights, then the 5k.');
    if (!meals.length && h >= 10) acts.push('Log what you have eaten so far today, even roughly.');
    if (A.remaining < 0) acts.push(`You are ${-A.remaining} kcal over. Kitchen closed; a ${Math.round(-A.remaining / Coach.exerciseKcal('walk', 60, 'moderate', A.nowLb) * 60 / 5) * 5}-minute brisk walk would cover it.`);
    if (plan.items.length) acts.push(`Next meal: ${plan.items[0].name} (${plan.items[0].kcal} kcal, ${plan.items[0].protein} g protein).`);
    else if (A.remaining >= 0) acts.push(h >= 20 ? 'You are done eating for today. Water or tea if you are peckish.' : 'You are close to your calories. Stick to water, tea or veg until tomorrow.');
    const endK = Math.round(A.todayTotals.kcal + plan.kcal), endP = Math.round(A.todayTotals.protein + plan.protein);
    // projection: ideal days vs the last 7 days actually logged
    const toGo = Math.max(0, A.nowLb - state.profile.goalWeight);
    const ideal = Tips.projectWeeks(toGo, T.tdee, T.kcal);
    const days = Coach.lastNDays(d, 8).filter(x => x !== d && x >= state.profile.startDate).map(x => Coach.dayTotals(state, x)).filter(t => t.meals >= 2);
    const avgK = days.length ? Math.round(days.reduce((a, t) => a + t.kcal, 0) / days.length) : null;
    const actual = avgK ? Tips.projectWeeks(toGo, T.tdee, avgK) : null;
    const when = w => w ? new Date(Date.now() + w * 7 * 864e5).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'not at this rate';
    return { plan, acts, endK, endP, ideal, actual, avgK, toGo, when };
  }
  function showNext() {
    go('maya');
    const S = nextSteps(), T = A.targets;
    const card = document.createElement('div'); card.className = 'msg her next-card';
    card.innerHTML = `<b>Do next</b><ol>${S.acts.map(a => `<li>${esc(a)}</li>`).join('')}</ol>` +
      (S.plan.items.length ? `<b>Ideal rest of today</b><ul class="sim">${S.plan.items.map(i => `<li><span>${i.slot}</span> ${esc(i.name)} <small>${i.kcal} kcal · ${i.protein} g</small></li>`).join('')}</ul>
        <p class="sim-total">Day ends at <b>${S.endK}</b> / ${T.kcal + A.exerciseBonus} kcal and <b>${S.endP}</b> / ${T.protein} g protein.</p>` : '') +
      (S.toGo > 0 ? `<b>Where this leads</b><p class="sim-total">Eat like this every day: ${S.ideal.perWeek} lb/week, goal ${state.profile.goalWeight} lb by <b>${S.when(S.ideal.weeks)}</b>.` +
        (S.actual ? `<br>Your last ${''}week (avg ${S.avgK} kcal): ${S.actual.perWeek > 0 ? S.actual.perWeek + ' lb/week, goal by <b>' + S.when(S.actual.weeks) + '</b>' : '<b>no loss</b>'}.` : '') + '</p>' : '');
    $('chat').appendChild(card); card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const sim = `Simulation for the rest of today (time ${nowTime()}): do next: ${S.acts.join(' ')} Ideal remaining meals: ${S.plan.items.map(i => `${i.slot}: ${i.name} (${i.kcal} kcal, ${i.protein} g protein)`).join('; ') || 'none'}. ` +
      `Day would end at ${S.endK} kcal and ${S.endP} g protein vs targets ${T.kcal + A.exerciseBonus} kcal and ${T.protein} g. ` +
      (S.toGo > 0 ? `Ideal days: ${S.ideal.perWeek} lb/week, goal by ${S.when(S.ideal.weeks)}.` + (S.actual ? ` Last week average ${S.avgK} kcal: ${S.actual.perWeek} lb/week, goal by ${S.when(S.actual.weeks)}.` : '') : '');
    if (settings.anthropicKey) ask(`What should I do next? ${sim} Give me my next one or two actions first, then one tip that makes the rest of today easier. Use the simulation numbers. Under 70 words, spoken style.`, true);
    else say(S.acts.slice(0, 2).join(' '), { pose: 'think', bubble: false });
  }
  $('nextBtn').onclick = showNext;
  $('nextBtn2').onclick = showNext;

  // ---------- if-then plans ----------
  function renderPlans() {
    const d = today(), plans = Coach.live(state.plans).filter(p => p.active !== false);
    const checks = Coach.live(state.planChecks);
    $('plans').innerHTML = plans.length ? plans.map(p => {
      const c = checks.find(x => x.planId === p.id && x.date === d);
      return `<li data-id="${p.id}"><span>${esc(p.text)}</span><span class="kept"><button class="small ${c && c.kept ? 'on' : ''}" data-k="1" title="Kept it">✓</button><button class="small no ${c && !c.kept ? 'on' : ''}" data-k="0" title="Missed it">✕</button></span></li>`;
    }).join('') : '<li class="empty" style="display:block">No plans yet. Maya can suggest some for your weak spots.</li>';
    $('plans').querySelectorAll('button[data-k]').forEach(b => b.onclick = () => {
      const id = b.closest('li').dataset.id, kept = b.dataset.k === '1', cid = id + ':' + d;
      const before = Gamify.dayPoints(state, d).total;
      const ex = state.planChecks.find(x => x.id === cid);
      if (ex) { ex.kept = kept; ex.updatedAt = Date.now(); } else state.planChecks.push({ id: cid, planId: id, date: d, kept, updatedAt: Date.now() });
      saveState(); refresh(); awardPoints(before);
      if (kept) say('You stuck to your plan. That is how habits get rewired.', { pose: 'thumbs', mood: 'proud', bubble: true });
      else say('Okay, honest answer, I like it. Tomorrow we try it again.', { pose: 'think', mood: 'neutral' });
    });
  }
  $('pickPlans').onclick = () => {
    const keys = A.problems.map(p => p.key).concat(['general']).filter((k, i, a) => a.indexOf(k) === i && Tips.PLANS[k]);
    const have = new Set(Coach.live(state.plans).filter(p => p.active !== false).map(p => p.text));
    $('planChoices').innerHTML = keys.flatMap(k => Tips.PLANS[k].map(text => ({ k, text }))).slice(0, 10).map((o, i) =>
      `<label class="choice"><input type="checkbox" value="${i}" data-k="${o.k}" ${have.has(o.text) ? 'checked' : ''}><span>${esc(o.text)}<small>${o.k === 'general' ? 'everyday' : 'for: ' + esc((A.problems.find(p => p.key === o.k) || {}).title || o.k)}</small></span></label>`).join('');
    $('planChoices')._opts = keys.flatMap(k => Tips.PLANS[k].map(text => ({ k, text }))).slice(0, 10);
    $('planModal').hidden = false;
  };
  $('closePlans').onclick = () => { $('planModal').hidden = true; };
  $('savePlans').onclick = () => {
    const opts = $('planChoices')._opts, picked = [...$('planChoices').querySelectorAll('input:checked')].map(i => opts[+i.value]);
    const now = Date.now();
    state.plans.forEach(p => { if (!picked.some(o => o.text === p.text)) { p.active = false; p.updatedAt = now; } });
    picked.forEach(o => { const ex = state.plans.find(p => p.text === o.text); if (ex) { ex.active = true; ex.deleted = false; ex.updatedAt = now; } else state.plans.push({ id: uid(), key: o.k, text: o.text, active: true, date: today(), updatedAt: now }); });
    $('planModal').hidden = true; saveState(); refresh();
    if (picked.length) say(`Locked in ${picked.length === 1 ? 'one plan' : picked.length + ' plans'}. Tick them off each day and I will cheer you on.`, { pose: 'thumbs', mood: 'proud' });
  };

  // ---------- meal logging ----------
  async function onPhoto(file) {
    if (!file) return;
    const big = await Services.resizeImage(file, 1024, 0.82);
    const thumb = await Services.resizeImage(file, 200, 0.72);
    pendingMeal = { thumb, photoB64: big.split(',')[1] };
    $('preview').src = big; $('shot').hidden = false; $('analyzeBtn').hidden = true;
    $('resultCard').hidden = true; $('analyzeStatus').textContent = '';
    analyzePhoto();
  }
  $('camInput').onchange = e => onPhoto(e.target.files[0]);
  $('galInput').onchange = e => onPhoto(e.target.files[0]);
  $('analyzeBtn').onclick = analyzePhoto;

  async function analyzePhoto() {
    if (!pendingMeal) return;
    $('shot').classList.add('scanning');
    try { showResult(await Services.analyzeMealPhoto(settings, pendingMeal.photoB64, $('mealNote').value.trim())); }
    catch (e) { $('analyzeStatus').textContent = e.message; $('analyzeBtn').hidden = false; }
    $('shot').classList.remove('scanning');
  }
  $('analyzeTextBtn').onclick = async () => {
    const txt = $('mealText').value.trim(); if (!txt) return;
    pendingMeal = { thumb: null }; $('analyzeStatus').textContent = 'Maya is thinking…';
    try { showResult(await Services.analyzeMealText(settings, txt)); $('analyzeStatus').textContent = ''; }
    catch (e) { $('analyzeStatus').textContent = e.message; }
  };

  const LIGHT = { green: { label: '✓ GREEN LIGHT', pose: 'thumbs', mood: 'proud', buzz: [40] },
                  yellow: { label: '! YELLOW', pose: 'think', mood: 'neutral', buzz: [80, 60, 80] },
                  red: { label: '✕ RED LIGHT', pose: 'warn', mood: 'alarmed', buzz: [250, 120, 250] } };

  function showResult(r) {
    pendingMeal.result = r;
    const meal = { kcal: r.kcal, score: r.health_score, light: r.light };
    const light = Coach.mealLight(meal, A.targets.kcal);
    const L = LIGHT[light];
    const card = $('resultCard');
    card.hidden = false; card.className = 'panel result light-' + light;
    $('lightBadge').textContent = L.label; $('lightBadge').className = 'light-badge ' + light;
    $('rName').value = r.name || 'Meal';
    $('rVerdict').textContent = r.verdict || '';
    $('rSwap').innerHTML = r.swap_tip ? `<b>Better:</b> ${esc(r.swap_tip)}` : '';
    editItems = (r.items || []).map(i => ({ food: i.food || '', portion: i.portion || '', kcal: Math.round(i.kcal || 0), color: i.color }));
    baseMacros = { kcal: r.kcal || 0, protein: r.protein_g || 0, carbs: r.carbs_g || 0, fat: r.fat_g || 0, fiber: r.fiber_g || 0 };
    renderItems(); $('recheckBtn').hidden = true;
    $('rKcal').value = Math.round(r.kcal || 0); $('rProt').value = Math.round(r.protein_g || 0);
    $('rCarb').value = Math.round(r.carbs_g || 0); $('rFat').value = Math.round(r.fat_g || 0);
    $('rFib').value = Math.round(r.fiber_g || 0); $('rScore').value = Math.round(r.health_score || 0);
    $('rDate').value = today(); $('rTime').value = nowTime();
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    FX.buzz(L.buzz);
    maya.result.setOutfit(A.isGymDay ? 'gym' : 'tank'); maya.result.setMood(L.mood); maya.result.pose(L.pose, 6000);
    if (light === 'green') FX.confetti(70);
    const left = A.remaining - (r.kcal || 0);
    const tail = left >= 0 ? ` That leaves about ${left} calories for today.` : ` That puts you about ${-left} over for today.`;
    say(Tips.pick(Tips.REACT[light], r.name || '') + tail, { bubble: false, box: boxes.log });
  }

  // Editable item list: food, amount, kcal. Totals follow the items; macros scale with the calories.
  let editItems = [], baseMacros = null;
  const num = s => { const m = String(s).match(/(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?/); return m ? (m[2] ? +m[1] / +m[2] : +m[1]) : null; };
  function renderItems() {
    $('rItems').innerHTML = editItems.map((i, k) => `<div class="item-row" data-k="${k}">
      <span class="dot ${['green', 'yellow', 'red'].includes(i.color) ? i.color : 'yellow'}"></span>
      <input class="i-food" value="${esc(i.food)}" placeholder="Food">
      <input class="i-qty" value="${esc(i.portion)}" placeholder="e.g. 1 cup">
      <input class="i-kcal" type="number" inputmode="numeric" value="${i.kcal}">
      <button class="i-del" title="Remove">✕</button></div>`).join('') || '<p class="hint">No items. Add one below.</p>';
  }
  function itemsChanged() {
    const total = editItems.reduce((a, i) => a + (+i.kcal || 0), 0);
    $('rKcal').value = Math.round(total);
    if (baseMacros && baseMacros.kcal > 0) {
      const f = total / baseMacros.kcal;
      $('rProt').value = Math.round(baseMacros.protein * f); $('rCarb').value = Math.round(baseMacros.carbs * f);
      $('rFat').value = Math.round(baseMacros.fat * f); $('rFib').value = Math.round(baseMacros.fiber * f);
    }
    $('recheckBtn').hidden = !settings.anthropicKey;
  }
  $('rItems').addEventListener('input', e => {
    const row = e.target.closest('.item-row'); if (!row) return;
    const it = editItems[+row.dataset.k];
    if (e.target.classList.contains('i-food')) it.food = e.target.value;
    if (e.target.classList.contains('i-kcal')) it.kcal = +e.target.value || 0;
    if (e.target.classList.contains('i-qty')) {
      const a = num(it.portion), b = num(e.target.value);   // "1 cup" -> "2 cups" doubles the calories
      if (a && b && a !== b) { it.kcal = Math.round(it.kcal * b / a); row.querySelector('.i-kcal').value = it.kcal; }
      it.portion = e.target.value;
    }
    itemsChanged();
  });
  $('rItems').addEventListener('click', e => {
    if (!e.target.classList.contains('i-del')) return;
    editItems.splice(+e.target.closest('.item-row').dataset.k, 1); renderItems(); itemsChanged();
  });
  $('addItem').onclick = () => {
    editItems.push({ food: '', portion: '', kcal: 0, color: 'yellow' }); renderItems(); itemsChanged();
    const rows = $('rItems').querySelectorAll('.i-food'); rows[rows.length - 1].focus();
  };
  $('recheckBtn').onclick = async () => {
    const list = editItems.filter(i => i.food.trim()).map(i => `${i.portion ? i.portion + ' ' : ''}${i.food}${i.kcal ? ` (about ${i.kcal} kcal)` : ''}`).join('; ');
    if (!list) return;
    $('recheckBtn').disabled = true; $('recheckBtn').textContent = 'Maya is checking…';
    try {
      const r = await Services.analyzeMealText(settings, `The person corrected the photo estimate. These foods and amounts are exactly what they ate: ${list}. Keep these items and amounts; where they give calories, use them.`);
      const keepDate = $('rDate').value, keepTime = $('rTime').value;
      showResult(r); $('rDate').value = keepDate; $('rTime').value = keepTime;
    } catch (e) { toast(e.message); }
    $('recheckBtn').disabled = false; $('recheckBtn').textContent = '↻ Re-check with my changes';
  };

  $('saveMeal').onclick = async () => {
    const r = pendingMeal && pendingMeal.result || {}, before = Gamify.dayPoints(state, today()).total;
    const m = {
      id: uid(), date: $('rDate').value || today(), time: $('rTime').value || nowTime(), name: $('rName').value || 'Meal',
      kcal: +$('rKcal').value || 0, protein: +$('rProt').value || 0, carbs: +$('rCarb').value || 0, fat: +$('rFat').value || 0,
      fiber: +$('rFib').value || 0, score: +$('rScore').value || null, light: r.light || null, verdict: r.verdict || '', tip: r.swap_tip || '',
      items: editItems.filter(i => i.food.trim()).map(i => ({ food: i.food.trim(), portion: i.portion.trim(), kcal: +i.kcal || 0, color: i.color })), source: pendingMeal && pendingMeal.thumb ? 'photo' : 'text', updatedAt: Date.now()
    };
    state.meals.push(m);
    if (pendingMeal && pendingMeal.thumb) await Services.putThumb(m.id, pendingMeal.thumb);
    pendingMeal = null; saveState();
    ['shot', 'analyzeBtn', 'resultCard'].forEach(id => $(id).hidden = true);
    $('mealNote').value = ''; $('mealText').value = ''; $('camInput').value = ''; $('galInput').value = '';
    go('today'); refresh(); awardPoints(before);
  };

  // ---------- diary ----------
  async function renderDiary() {
    const feed = $('diaryFeed'), T = Coach.targets(state.profile, Coach.currentWeight(state, today()));
    const byDay = {};
    Coach.live(state.meals).forEach(m => (byDay[m.date] = byDay[m.date] || []).push(m));
    const days = Object.keys(byDay).sort().reverse().slice(0, 21);
    if (!days.length) { feed.innerHTML = '<div class="panel"><p class="empty">Your food diary fills up as you snap meals.</p></div>'; }
    else feed.innerHTML = days.map(d => {
      const t = Coach.dayTotals(state, d);
      const label = new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      const ex = Coach.extraExercise(state, d), bonus = Coach.exerciseBonus(state, d);
      const gym = Coach.live(state.workouts).some(w => w.date === d && !w.extra && w.done !== false);
      const exLine = (gym ? '🏋️ Weights + 5k ' : '') + ex.map(w => `${(Coach.EXERCISE[w.type] || Coach.EXERCISE.other).icon} ${w.minutes} min `).join('');
      return `<div class="day-head">${label}<small>${Math.round(t.kcal)} kcal · ${Math.round(t.protein)} g protein ${t.kcal > T.kcal + bonus + 100 ? '· ✕ over' : '· ✓ on target'}${exLine ? '<br>' + exLine : ''}</small></div>` +
        byDay[d].sort((a, b) => a.time < b.time ? -1 : 1).map(m => {
          const light = Coach.mealLight(m, T.kcal);
          return `<div class="panel dcard ${light}" data-id="${m.id}"><div class="noimg">🍽</div><div>
            <b><span class="dot ${light}"></span> ${esc(m.name)}</b><p>${m.time} · ${Math.round(m.kcal)} kcal · ${Math.round(m.protein)} g protein</p>
            ${m.verdict ? `<p>💬 ${esc(m.verdict)}</p>` : ''}${m.tip ? `<p><b style="background:var(--lime);font-size:15px;padding:0 4px;border-radius:4px">Better:</b> ${esc(m.tip)}</p>` : ''}</div></div>`;
        }).join('');
    }).join('');
    feed.querySelectorAll('.dcard').forEach(c => Services.getThumb(c.dataset.id).then(src => { if (src) c.querySelector('.noimg').outerHTML = `<img src="${src}" alt="">`; }).catch(() => {}));
    const last = Coach.live(state.reports).sort((a, b) => a.id < b.id ? 1 : -1)[0];
    if (last) showReport(last);
  }
  function showReport(r) {
    $('reportBody').innerHTML = `<div class="grade">${esc(r.grade)}</div><p class="sub">Week ending ${esc(r.id)}</p><p>${esc(r.text)}</p>`;
  }
  $('reportBtn').onclick = async () => {
    const end = Coach.addDays(today(), -1), g = Gamify.weekGrade(state, end);
    $('reportBtn').disabled = true; $('reportBody').innerHTML = '<p class="hint">Maya is grading your week…</p>';
    let text;
    try {
      text = await Services.coachReply(settings, state.profile, Coach.summaryText(state, A),
        [{ role: 'user', content: `Write my weekly report card. My computed grade for the last 7 days is ${g.grade} (${g.points}/100, ${g.logged} of 7 days logged). In 4 to 6 sentences: say the grade, the best thing I did, the biggest problem, and one specific change for next week. Be warm but straight.` }], DESK);
    } catch (e) { text = `Grade ${g.grade}: ${g.logged} of 7 days logged. ` + (A.problems[0] ? 'Biggest problem: ' + A.problems[0].title.toLowerCase() + '.' : 'Keep going.'); }
    const rep = { id: end, grade: g.grade, points: g.points, text, updatedAt: Date.now() };
    state.reports = (state.reports || []).filter(x => x.id !== end).concat(rep);
    saveState(); showReport(rep); $('reportBtn').disabled = false;
    if (['A', 'B'].includes(g.grade)) FX.confetti(150);
    say(text, { pose: ['A', 'B'].includes(g.grade) ? 'cheer' : 'think', mood: ['A', 'B'].includes(g.grade) ? 'cheer' : 'neutral', bubble: false });
  };

  // ---------- progress ----------
  function renderProgress() {
    A = Coach.analyze(state, today());
    const d = today();
    $('leadFat7').textContent = Gamify.fatBurned(state, d, 7).lb;
    $('leadFatAll').textContent = Gamify.fatBurned(state, d, 400).lb;
    $('leadXp').textContent = Gamify.xp(state, d).total;
    Charts.weight($('chWeight'), A.series, state.profile);
    $('badges').innerHTML = Gamify.badges(state, d).map(b => `<div class="badge ${b.earned ? '' : 'locked'}" title="${esc(b.desc)}"><span class="bi">${b.icon}</span>${esc(b.name)}</div>`).join('');
    const days = Coach.lastNDays(d, 14).map(x => Coach.dayTotals(state, x));
    Charts.bars($('chKcal'), days, A.targets.kcal, { key: 'kcal', unit: 'kcal', status: 'over-bad' });
    Charts.bars($('chProt'), days, A.targets.protein, { key: 'protein', unit: 'g', status: 'under-bad' });
    Charts.consistency($('chCons'), state, d);
    const li = x => `<li class="s${x.sev}"><b>${esc(x.title)}</b><small>${esc(x.detail)}</small></li>`;
    $('winsList').innerHTML = A.wins.map(li).join('') || '<li><small>Log a few days to see what is working.</small></li>';
    $('probList').innerHTML = A.problems.map(li).join('') || '<li><small>Nothing flagged. Keep going.</small></li>';
  }

  // ---------- coach chat ----------
  function addMsg(who, text, cls) {
    const d = document.createElement('div'); d.className = 'msg ' + who + (cls ? ' ' + cls : ''); d.textContent = text;
    $('chat').appendChild(d); d.scrollIntoView({ behavior: 'smooth', block: 'end' }); return d;
  }
  function extraSummary() {
    const d = today(), ST = Gamify.streaks(state, d), B = Gamify.weeklyBank(state, d), X = Gamify.xp(state, d);
    const plans = Coach.live(state.plans).filter(p => p.active !== false).map(p => p.text);
    return `\nStreaks: logging ${ST.logging.days} days, weigh-in ${ST.weighin.days}. Weekly points bank ${B.bank}/200. Level ${X.level} ${X.name}.` +
      (plans.length ? `\nHis if-then plans: ${plans.join(' | ')}` : '') + (Gamify.slip(state, d).slipping ? '\nHe has been slipping (missed days). Be warm, no guilt, ask for one small action.' : '');
  }
  async function ask(userText, hidden) {
    if (!hidden) addMsg('me', userText);
    chatHistory.push({ role: 'user', content: userText });
    const typing = addMsg('her', '…', 'typing');
    maya.coach.pose('think');
    try {
      const reply = await Services.coachReply(settings, state.profile, Coach.summaryText(state, A) + extraSummary(), chatHistory, DESK);
      chatHistory.push({ role: 'assistant', content: reply });
      typing.classList.remove('typing'); typing.textContent = reply;
      say(reply, { pose: /great|proud|nice|awesome|love/i.test(reply) ? 'thumbs' : 'idle', bubble: false });
    } catch (e) {
      chatHistory.pop(); maya.coach.pose('idle');
      typing.classList.remove('typing'); typing.textContent = e.message.includes('API key') ? 'Add your Claude API key in Settings so I can talk with you.' : 'I could not reach Claude: ' + e.message;
    }
  }
  $('sendBtn').onclick = () => { const v = $('chatInput').value.trim(); if (v) { $('chatInput').value = ''; ask(v); } };
  $('chatInput').onkeydown = e => { if (e.key === 'Enter') $('sendBtn').click(); };
  $('pepBtn').onclick = () => ask('Give me a short pep talk based on how I am doing.');
  $('reviewBtn').onclick = () => ask('Review my day and this week. What am I doing right, and what is the one thing I need to fix first?');
  $('hungryBtn').onclick = () => ask(`I'm hungry right now (${nowTime()}). What should I eat given what I have left today?`);
  $('micBtn').onclick = () => {
    if (rec) { rec.stop(); return; }
    Services.stopSpeaking(); $('micBtn').classList.add('listening');
    rec = Services.listen(t => ask(t), () => { rec = null; $('micBtn').classList.remove('listening'); });
  };
  // Voice on/off (Today and Maya tabs) and stop
  function stopTalking() { Services.stopSpeaking(); LiveMaya.stop(); allMaya().forEach(i => i.talk(false)); }
  function voiceButtons() {
    ['hearBtn', 'muteBtn'].forEach(id => { const b = $(id); b.textContent = settings.voiceOn ? '🔊 Voice on' : '🔇 Muted'; b.classList.toggle('muted', !settings.voiceOn); b.title = settings.voiceOn ? 'Tap to mute Maya' : 'Tap to let Maya talk'; });
  }
  function toggleVoice() {
    settings.voiceOn = !settings.voiceOn; saveSettings(); voiceButtons();
    if (!settings.voiceOn) { stopTalking(); toast('Maya is muted'); }
    else say(document.querySelector('#tab-today.active') ? $('bubble').textContent : "I'm back. Talk to me.", { pose: 'wave', bubble: false });
  }
  $('muteBtn').onclick = toggleVoice;
  $('stopBtn').onclick = stopTalking;
  Services.onSpeaking(on => { $('stopBtn').hidden = !on; });

  // Maya on the Today screen
  const heroTap = () => { $('tapHint').hidden = true; if (Services.isSpeaking()) { stopTalking(); return; } say($('bubble').textContent, { pose: 'wave', bubble: false }); };
  $('mayaHero').onclick = heroTap;
  $('hearBtn').onclick = () => { $('tapHint').hidden = true; toggleVoice(); };
  $('mayaCoach').addEventListener('click', () => { if (Services.isSpeaking()) stopTalking(); });
  $('tipBtn').onclick = () => { const t = tipLine(); say(t, { pose: Math.random() < .5 ? 'thumbs' : 'think' }); };

  // First touch of the session: Maya waves and greets out loud (browsers block audio before a tap).
  let greeted = false;
  document.addEventListener('pointerdown', e => {
    if (greeted || e.target.closest('#mayaHero,#hearBtn,input,select,textarea,label')) { greeted = true; return; }
    greeted = true; $('tapHint').hidden = true;
    if (document.querySelector('#tab-today.active')) say($('bubble').textContent, { pose: 'wave', bubble: false });
  }, { capture: true });

  // ---------- settings ----------
  const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function renderSettings() {
    const p = state.profile;
    $('pName').value = p.name; $('pAge').value = p.age; $('pHeight').value = p.heightIn; $('pSex').value = p.sex;
    $('pStart').value = p.startWeight; $('pGoal').value = p.goalWeight; $('pStartDate').value = p.startDate; $('pPace').value = String(p.paceLbPerWeek);
    $('pDays').innerHTML = DAYN.map((d, i) => `<button data-d="${i}" class="${p.gymDays.includes(i) ? 'on' : ''}">${d}</button>`).join('');
    $('pDays').querySelectorAll('button').forEach(b => b.onclick = () => b.classList.toggle('on'));
    const T = Coach.targets(p, Coach.currentWeight(state, today()));
    $('pTargets').textContent = `Daily targets: ${T.kcal} kcal (maintenance about ${T.tdee}), ${T.protein} g protein, ${T.fiber} g fiber. Gym calories are already counted in.`;
    $('sAnthKey').value = settings.anthropicKey || ''; $('sModel').value = settings.model || '';
    $('sRepo').value = settings.ghRepo || ''; $('sGhToken').value = settings.ghToken || '';
    $('sAzKey').value = settings.azureKey || ''; $('sAzRegion').value = settings.azureRegion || ''; $('sVoice').value = settings.voice;

  }
  $('saveProfile').onclick = () => {
    Object.assign(state.profile, {
      name: $('pName').value || 'David', age: +$('pAge').value || 60, heightIn: +$('pHeight').value || 70, sex: $('pSex').value,
      startWeight: +$('pStart').value || 185, goalWeight: +$('pGoal').value || 165, startDate: $('pStartDate').value || today(),
      paceLbPerWeek: +$('pPace').value || 1, gymDays: [...$('pDays').querySelectorAll('button.on')].map(b => +b.dataset.d), updatedAt: Date.now()
    });
    saveState(); renderSettings(); refresh(); toast('Profile saved');
  };
  function readKeys() {
    Object.assign(settings, {
      anthropicKey: $('sAnthKey').value.trim(), model: $('sModel').value.trim() || 'claude-sonnet-5-5',
      ghRepo: $('sRepo').value.trim(), ghToken: $('sGhToken').value.trim(),
      azureKey: $('sAzKey').value.trim(), azureRegion: $('sAzRegion').value.trim(), voice: $('sVoice').value
    });
    saveSettings(); liveBroken = false; LiveMaya.close(); applyLiveMode();
  }
  $('saveKeys').onclick = () => { readKeys(); toast('Saved'); doSync(true); };
  $('testVoice').onclick = () => { readKeys(); go('maya'); const was = settings.voiceOn; say(`Hi ${state.profile.name}, I'm ${state.profile.coachName}. Let's lose those twenty pounds together!`, { pose: 'wave', bubble: false, force: true }); };
  $('exportBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' }));
    a.download = 'lose20-' + today() + '.json'; a.click();
  };
  $('importInput').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { state = Coach.mergeState(state, JSON.parse(await f.text())); saveState(); refresh(); toast('Imported'); }
    catch (err) { toast('Import failed: ' + err.message); }
  };
  $('syncBtn').onclick = () => doSync(true);

  // ---------- desk mode (Windows check-in window) ----------
  function renderDesk() {
    const li = x => `<li class="s${x.sev}"><b>${esc(x.title)}</b><small>${esc(x.detail)}</small></li>`;
    $('deskSummary').innerHTML = `<div class="panel"><h3>Going wrong</h3><ul class="verdicts bad">${A.problems.slice(0, 3).map(li).join('') || '<li><small>Nothing flagged.</small></li>'}</ul></div>
      <div class="panel"><h3>Going right</h3><ul class="verdicts good">${A.wins.slice(0, 3).map(li).join('') || '<li><small>Log a few days first.</small></li>'}</ul></div>`;
  }

  // ---------- one-time setup link ----------
  function applySetup() {
    if (!location.hash.startsWith('#setup')) return;
    const h = new URLSearchParams(location.hash.slice(1));
    const map = { key: 'anthropicKey', repo: 'ghRepo', gh: 'ghToken', az: 'azureKey', region: 'azureRegion', avatar: 'avatarCharacter', astyle: 'avatarStyle' };
    Object.entries(map).forEach(([k, s]) => { if (h.get(k)) settings[s] = h.get(k); });
    saveSettings();
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => toast('Keys saved on this device'), 500);
  }
  applySetup();
  window.addEventListener('hashchange', applySetup);

  window.addEventListener('maya-novoice', () => toast('Maya needs the Azure speech key in Settings to talk'));

  // ---------- boot ----------
  if (!localStorage.getItem(SKEY)) saveState();
  voiceButtons();
  applyLiveMode();
  if (DESK) document.body.classList.add('desk');
  refresh();
  if (DESK) {
    go('maya');
    const opener = params.get('msg');
    if (opener) { $('chat').innerHTML = ''; addMsg('her', opener); chatHistory.push({ role: 'user', content: 'Check in with me.' }, { role: 'assistant', content: opener }); }
    maya.coach.pose('wave', 3500);
  } else {
    setTimeout(() => maya.hero.pose('wave', 3000), 400);
  }
  doSync();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { doSync(); refresh(); } });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');

  // ---------- auto-update ----------
  // The running code knows its own version (version.js, written by release.py).
  // If the server's version.json differs, reload with fresh files.
  const CODE_VERSION = self.APP_VERSION || '0';
  let pendingUpdate = null;
  $('appVersion').textContent = 'Version ' + CODE_VERSION;
  function safeToReload() {
    return !pendingMeal && !rec && !$('chatInput').value && !$('wInput').value && $('planModal').hidden && $('exModal').hidden &&
      !document.querySelector('.msg.typing');
  }
  async function hardReload(v) {
    sessionStorage.setItem('lose20.updatedTo', v);
    sessionStorage.setItem('lose20.reloadAt', Date.now());
    try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) {}
    try { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } catch (e) {}
    location.replace(location.pathname + '?v=' + encodeURIComponent(v) + (DESK ? '&desk=1' : '') + location.hash);
  }
  async function applyUpdate(v, force) {
    // don't loop if the server is still handing out the old files: one retry per 2 minutes
    const last = +sessionStorage.getItem('lose20.reloadAt') || 0;
    if (!force && Date.now() - last < 120000) return;
    if (!force && !safeToReload()) { pendingUpdate = v; return; }
    hardReload(v);
  }
  async function checkUpdate(force) {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      const v = (await r.json()).version;
      if (v !== CODE_VERSION) applyUpdate(v, force); else pendingUpdate = null;
      return v;
    } catch (e) { return null; }
  }
  $('updateBtn').onclick = async () => {
    $('updateBtn').disabled = true;
    const v = await checkUpdate(true);
    if (v === CODE_VERSION) { toast('You have the latest version (' + v + ')'); $('updateBtn').disabled = false; }
    else if (!v) { toast('Could not reach the update server'); $('updateBtn').disabled = false; }
  };
  const updated = sessionStorage.getItem('lose20.updatedTo');
  if (updated) {
    sessionStorage.removeItem('lose20.updatedTo');
    setTimeout(() => toast(updated === CODE_VERSION ? 'Updated to version ' + updated : 'Update downloading, try again in a minute'), 800);
  }
  checkUpdate();
  setInterval(() => pendingUpdate ? applyUpdate(pendingUpdate) : checkUpdate(), 15 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pendingUpdate ? applyUpdate(pendingUpdate) : checkUpdate(); });
  document.addEventListener('click', () => { if (pendingUpdate) setTimeout(() => applyUpdate(pendingUpdate), 1500); });
})();
