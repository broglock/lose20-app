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
  ['weights', 'meals', 'workouts', 'plans', 'planChecks', 'reports', 'groceries', 'recipes', 'usage'].forEach(k => { if (!Array.isArray(state[k])) state[k] = []; });
  let settings = Object.assign({ voiceOn: true, model: 'claude-sonnet-5-5', voice: '' }, load(KKEY) || {});
  if (!settings.voiceV2) { settings.voice = ''; settings.voiceV2 = 1; }   // default: each coach's own voice
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

  // ---------- API usage ----------
  // One record per day, device and feature (id = date|device|kind), so devices never overwrite each other.
  if (!settings.deviceId) { settings.deviceId = (DESK ? 'pc-' : 'dev-') + uid().slice(0, 6); localStorage.setItem(KKEY, JSON.stringify(settings)); }
  const DEVICE = (DESK ? 'pc-' : '') + settings.deviceId;
  const PRICE = () => Object.assign({ in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5, azure: 15 }, settings.prices || {});
  Services.onUsage(u => {
    const d = today(), id = `${d}|${DEVICE}|${u.service === 'azure' ? 'voice' : u.kind}`;
    let r = state.usage.find(x => x.id === id);
    if (!r) { r = { id, date: d, device: DEVICE, kind: u.service === 'azure' ? 'voice' : u.kind, service: u.service, calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, chars: 0 }; state.usage.push(r); }
    r.calls++; r.input += u.input || 0; r.output += u.output || 0; r.cacheRead += u.cacheRead || 0; r.cacheWrite += u.cacheWrite || 0; r.chars += u.chars || 0;
    r.updatedAt = Date.now(); saveState();
  });
  function usageCost(r) { const P = PRICE(); return (r.input * P.in + r.output * P.out + r.cacheRead * P.cacheRead + r.cacheWrite * P.cacheWrite + r.chars * P.azure) / 1e6; }
  function renderUsage() {
    const rows = Coach.live(state.usage), d = today(), month = d.slice(0, 7), d30 = Coach.addDays(d, -29);
    const sum = list => list.reduce((a, r) => ({ calls: a.calls + r.calls, input: a.input + r.input, output: a.output + r.output, chars: a.chars + r.chars, cost: a.cost + usageCost(r) }), { calls: 0, input: 0, output: 0, chars: 0, cost: 0 });
    const T = sum(rows.filter(r => r.date === d)), M = sum(rows.filter(r => r.date.startsWith(month))), L = sum(rows.filter(r => r.date >= d30));
    const days = new Set(rows.filter(r => r.date >= d30).map(r => r.date)).size || 1;
    const by = {}; rows.filter(r => r.date >= d30).forEach(r => { by[r.kind] = by[r.kind] || []; by[r.kind].push(r); });
    const $$ = n => '$' + (n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)), k = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    $('usageBody').innerHTML = rows.length ? `<table class="usage">
      <tr><th></th><th>Requests</th><th>Tokens in / out</th><th>Voice chars</th><th>Cost</th></tr>
      <tr><td>Today</td><td>${T.calls}</td><td>${k(T.input)} / ${k(T.output)}</td><td>${k(T.chars)}</td><td>${$$(T.cost)}</td></tr>
      <tr><td>This month</td><td>${M.calls}</td><td>${k(M.input)} / ${k(M.output)}</td><td>${k(M.chars)}</td><td>${$$(M.cost)}</td></tr>
      <tr><td>Last 30 days</td><td>${L.calls}</td><td>${k(L.input)} / ${k(L.output)}</td><td>${k(L.chars)}</td><td>${$$(L.cost)}</td></tr></table>
      <p class="sub">About <b>${$$(L.cost / days)}</b> per day used, so roughly <b>${$$(L.cost / days * 30)}</b> a month at this pace.</p>
      <table class="usage"><tr><th>Last 30 days by feature</th><th>Requests</th><th>Cost</th><th>Per request</th></tr>${Object.entries(by).map(([kind, l]) => { const s2 = sum(l); return [kind, s2]; }).sort((a, b) => b[1].cost - a[1].cost)
        .map(([kind, s2]) => `<tr><td>${esc(kind)}</td><td>${s2.calls}</td><td>${$$(s2.cost)}</td><td>${$$(s2.cost / s2.calls)}</td></tr>`).join('')}</table>`
      : '<p class="hint">Nothing counted yet. Usage shows up here after the next photo, chat, recipe or voice clip.</p>';
    const P = PRICE(); $('prIn').value = P.in; $('prOut').value = P.out; $('prCr').value = P.cacheRead; $('prAz').value = P.azure;
  }
  $('prSave').onclick = () => { settings.prices = { in: +$('prIn').value || 2, out: +$('prOut').value || 10, cacheRead: +$('prCr').value || 0.2, cacheWrite: 2.5, azure: +$('prAz').value || 15 }; saveSettings(); renderUsage(); toast('Prices saved'); };

  // ---------- coaches ----------
  // The roster (maya/coaches.json) is built by tools/build_coaches.py. The chosen coach lives in the
  // synced profile, so phone and PC show the same one. Optionally a new coach takes over each week.
  let COACHES = [{ id: 'maya', name: 'Maya', role: 'Fitness coach', voice: 'en-US-AvaMultilingualNeural', style: '' }];
  const coach = () => COACHES.find(c => c.id === (state.profile.coachId || 'maya')) || COACHES[0];
  const CN = () => coach().name;
  const aOrAn = w => /^[aeiou]/i.test(w) ? 'an' : 'a';
  function applyCoach() {
    const c = coach(), p = state.profile;
    Object.assign(p, { coachId: c.id, coachName: c.name, coachRole: c.role, coachStyle: c.style, coachVoice: c.voice });
    if (self.PhotoMaya) PhotoMaya.setCoach(c.id);
    document.querySelectorAll('.cn').forEach(e => e.textContent = c.name);
    $('chatInput').placeholder = `Talk to ${c.name}, or say what you ate…`;
    $('mayaHero').title = 'Tap ' + c.name;
    $('mealNote').placeholder = `Note for ${c.name}: large portion, ranch dressing…`;
    renderCoachGrid();
  }
  function renderCoachGrid() {
    const g = $('coachGrid'); if (!g) return;
    const cur = coach().id;
    g.innerHTML = COACHES.map(c => `<button class="coach-card${c.id === cur ? ' on' : ''}" data-id="${c.id}"><img src="maya/coaches/${c.id}/thumb.jpg" alt=""><b>${esc(c.name)}</b><small>${esc(c.role)}</small></button>`).join('');
    $('coachRotate').checked = state.profile.coachRotate !== false;
  }
  function switchCoach(id, why) {
    const prev = CN();
    state.profile.coachId = id; state.profile.coachSince = today(); state.profile.updatedAt = Date.now();
    applyCoach(); saveState();
    const c = coach();
    const hello = why === 'rotate'
      ? `Hi ${state.profile.name}! I'm ${c.name}, ${aOrAn(c.role)} ${c.role.toLowerCase()}. ${prev} handed me your plan for this week. Let's keep it going.`
      : `Hi ${state.profile.name}, I'm ${c.name}. ${aOrAn(c.role)[0].toUpperCase() + aOrAn(c.role).slice(1)} ${c.role.toLowerCase()} by day, your coach the rest of the time. Let's do this.`;
    $('bubble').textContent = hello;
    setTimeout(() => say(hello, { pose: 'wave', mood: 'cheer', bubble: false }), 600);
  }
  function maybeRotate() {
    const p = state.profile;
    if (!p.coachSince) { p.coachSince = today(); return; }
    if (p.coachRotate === false || COACHES.length < 2 || Coach.daysBetween(p.coachSince, today()) < 7) return;
    const i = COACHES.findIndex(c => c.id === coach().id);
    switchCoach(COACHES[(i + 1) % COACHES.length].id, 'rotate');
  }
  async function loadCoaches() {
    try { const list = await fetch('maya/coaches.json').then(r => r.json()); if (Array.isArray(list) && list.length) COACHES = list; } catch (e) { /* offline: keep Maya */ }
    applyCoach(); maybeRotate();
  }
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
    cfg = Object.assign({}, cfg || settings); cfg.voice = cfg.voice || coach().voice;
    Services.speak(cfg, text,
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
    if (tab === 'food') renderFood();
    if (tab === 'settings') { renderSettings(); renderUsage(); }
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
    const planned = Coach.plannedIds(state, d), sessions = new Set(Coach.live(state.workouts).filter(w => w.done !== false && Coach.isRoutine(w) && w.date >= Coach.addDays(d, -((new Date(d + 'T12:00').getDay() + 6) % 7))).map(w => w.date)).size;
    $('woTitle').textContent = A.isGymDay ? 'Gym day: weights + 5k' : 'Workout';
    $('woSub').textContent = (A.gymDoneToday ? 'Done today. ' : A.isGymDay ? 'Planned for today. ' : '') + `${Math.min(sessions, 3)} of 3 planned sessions this week.` +
      (A.exerciseToday.length ? '' : ' Anything you do beyond the plan adds calories back.');
    $('woQuick').hidden = A.gymDoneToday;
    $('exList').innerHTML = A.exerciseToday.map(w => { const E = exName(w);
      return `<li data-id="${w.id}">${E.icon} ${E.name}${w.minutes ? ` ${w.minutes} min, ${w.intensity}` : ''} <small>${w.kcal ? '~' + w.kcal + ' kcal' : ''}${planned.has(w.id) || Coach.isLegacy(w) ? ' · planned' : ''}</small><button class="del" title="Delete">✕</button></li>`; }).join('') +
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
  // ---------- workouts ----------
  const exName = w => Coach.isLegacy(w) ? { icon: '🏋️', name: 'Weights + 5k' } : (Coach.EXERCISE[w.type] || Coach.EXERCISE.other);
  function logExercises(list, d) {
    const before = Gamify.dayPoints(state, today()).total, bonusBefore = Coach.exerciseBonus(state, d), now = Date.now();
    list.forEach((x, i) => state.workouts.push({ id: uid(), date: d, type: x.type, extra: true, minutes: x.minutes, intensity: x.intensity,
      kcal: Coach.exerciseKcal(x.type, x.minutes, x.intensity, A.nowLb), done: true, updatedAt: now + i }));
    saveState(); refresh(); awardPoints(before);
    const added = Coach.exerciseBonus(state, d) - bonusBefore;
    FX.confetti(90);
    say(`Workout logged. ${added > 0 && d === today() ? `I added ${added} calories to today's budget. Spend them on protein.` : 'That is what keeps the weight you lose from being muscle. Get 30 grams of protein in.'}`, { pose: 'flex', mood: 'determined' });
  }
  $('woQuick').onclick = () => logExercises([{ type: 'weights', minutes: 45, intensity: 'moderate' }, { type: 'run', minutes: 30, intensity: 'moderate' }], today());
  let exRows = [];
  function renderExRows() {
    $('exRows').innerHTML = exRows.map((r, k) => `<div class="ex-row" data-k="${k}">
      <select class="x-type">${Object.entries(Coach.EXERCISE).map(([t, e]) => `<option value="${t}"${t === r.type ? ' selected' : ''}>${e.icon} ${e.name}</option>`).join('')}</select>
      <input class="x-min" type="number" inputmode="numeric" value="${r.minutes}" title="Minutes"><span class="x-unit">min</span>
      <select class="x-int">${Coach.INTENSITY.map(i => `<option${i === r.intensity ? ' selected' : ''}>${i}</option>`).join('')}</select>
      <button class="x-del" title="Remove">✕</button></div>`).join('');
    const tot = exRows.reduce((a, r) => a + Coach.exerciseKcal(r.type, +r.minutes || 0, r.intensity, A.nowLb), 0);
    $('exEst').textContent = exRows.length ? `About ${tot} kcal burned in total.` : 'Add at least one exercise.';
  }
  $('exBtn').onclick = () => {
    exRows = A.isGymDay && !A.gymDoneToday ? [{ type: 'weights', minutes: 45, intensity: 'moderate' }, { type: 'run', minutes: 30, intensity: 'moderate' }] : [{ type: 'walk', minutes: 30, intensity: 'moderate' }];
    $('exDate').value = today(); renderExRows(); $('exModal').hidden = false;
  };
  $('exAddRow').onclick = () => { exRows.push({ type: 'walk', minutes: 20, intensity: 'moderate' }); renderExRows(); };
  $('exRows').addEventListener('change', e => {
    const row = e.target.closest('.ex-row'); if (!row) return; const r = exRows[+row.dataset.k];
    if (e.target.classList.contains('x-type')) r.type = e.target.value;
    if (e.target.classList.contains('x-min')) r.minutes = +e.target.value || 0;
    if (e.target.classList.contains('x-int')) r.intensity = e.target.value;
    renderExRows();
  });
  $('exRows').addEventListener('click', e => { if (e.target.classList.contains('x-del')) { exRows.splice(+e.target.closest('.ex-row').dataset.k, 1); renderExRows(); } });
  $('exCancel').onclick = () => { $('exModal').hidden = true; };
  $('exSave').onclick = () => {
    const list = exRows.filter(r => r.minutes > 0); if (!list.length) return toast('Add an exercise with minutes');
    const d = $('exDate').value && $('exDate').value <= today() ? $('exDate').value : today();
    $('exModal').hidden = true; logExercises(list, d);
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
    const plan = Tips.planRest({ hour: h, kcalLeft: A.remaining, proteinLeft: A.proteinLeft, meals, exclude: excl().ing.concat(excl().meals) });
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
    }).join('') : '<li class="empty" style="display:block">No plans yet. ' + CN() + ' can suggest some for your weak spots.</li>';
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
    pendingMeal = { thumb: null }; $('analyzeStatus').textContent = CN() + ' is thinking…';
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
    $('recheckBtn').disabled = true; $('recheckBtn').textContent = CN() + ' is checking…';
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
    const dates = new Set();
    [state.meals, state.weights, state.workouts].forEach(l => Coach.live(l).forEach(x => dates.add(x.date)));
    const days = [...dates].sort().reverse().slice(0, 30);
    if (!days.length) { feed.innerHTML = '<div class="panel"><p class="empty">Your diary fills up as you log meals, weigh-ins and workouts.</p></div>'; }
    else feed.innerHTML = days.map(d => {
      const t = Coach.dayTotals(state, d), bonus = Coach.exerciseBonus(state, d);
      const label = new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      const meals = Coach.live(state.meals).filter(m => m.date === d).sort((a, b) => a.time < b.time ? -1 : 1);
      const w = Coach.live(state.weights).find(x => x.date === d);
      const wos = Coach.live(state.workouts).filter(x => x.date === d && x.done !== false);
      const rows = (w ? `<div class="panel drow" data-kind="weight" data-id="${w.id}">⚖️ Weigh-in <b>${w.lb} lb</b><span class="edit-hint">✎</span></div>` : '') +
        wos.map(x => { const E = exName(x);
          return `<div class="panel drow" data-kind="${Coach.isLegacy(x) ? 'routine' : 'exercise'}" data-id="${x.id}">${E.icon} ${E.name}${!Coach.isLegacy(x) ? ` <b>${x.minutes} min</b> ${x.intensity} · ~${x.kcal} kcal` : ' <b>done</b>'}<span class="edit-hint">✎</span></div>`; }).join('');
      return `<div class="day-head">${label}<small>${Math.round(t.kcal)} kcal · ${Math.round(t.protein)} g protein ${meals.length ? (t.kcal > T.kcal + bonus + 100 ? '· ✕ over' : '· ✓ on target') : ''}</small></div>` + rows +
        meals.map(m => {
          const light = Coach.mealLight(m, T.kcal);
          return `<div class="panel dcard ${light}" data-kind="meal" data-id="${m.id}"><div class="noimg">🍽</div><div>
            <b><span class="dot ${light}"></span> ${esc(m.name)}</b><p>${m.time} · ${Math.round(m.kcal)} kcal · ${Math.round(m.protein)} g protein</p>
            ${m.verdict ? `<p>💬 ${esc(m.verdict)}</p>` : ''}${m.tip ? `<p><b style="background:var(--lime);font-size:15px;padding:0 4px;border-radius:4px">Better:</b> ${esc(m.tip)}</p>` : ''}</div><span class="edit-hint">✎</span></div>`;
        }).join('');
    }).join('');
    feed.querySelectorAll('.dcard').forEach(c => Services.getThumb(c.dataset.id).then(src => { if (src) c.querySelector('.noimg').outerHTML = `<img src="${src}" alt="">`; }).catch(() => {}));
    const last = Coach.live(state.reports).sort((a, b) => a.id < b.id ? 1 : -1)[0];
    if (last) showReport(last);
  }

  // ---------- recipes and shopping list ----------
  // Generated recipes stay on this device until saved (♥); saved recipes and the shopping list sync.
  let draftRecipes = load('lose20.recipeDraft') || [];
  const AISLES = ['Produce', 'Meat & fish', 'Dairy & eggs', 'Bakery', 'Pantry', 'Frozen', 'Other'];
  function recipeCard(r, saved) {
    return `<div class="panel recipe" data-rid="${r.id}">
      <div class="r-head"><span class="r-slot">${esc(r.slot || '')}</span><b>${esc(r.title)}</b></div>
      <p class="r-meta">${Math.round(r.kcal || 0)} kcal · ${Math.round(r.protein_g || 0)} g protein · ${Math.round(r.fiber_g || 0)} g fiber · ${r.time_min || '?'} min · serves ${r.servings || 1}</p>
      ${r.why ? `<p class="r-why">${esc(r.why)}</p>` : ''}
      <details><summary>Ingredients and steps</summary>
        <ul class="ing">${(r.ingredients || []).map(i => `<li>${esc(i.qty || '')} ${esc(i.item)} <button class="ban" data-ing="${esc(i.item)}" title="Never use this">🚫</button></li>`).join('')}</ul>
        <ol>${(r.steps || []).map(t => `<li>${esc(t)}</li>`).join('')}</ol></details>
      <div class="inline r-acts"><button class="small" data-act="shop">🛒 Add ingredients</button><button class="small" data-act="save">${saved ? '♥ Saved' : '♡ Save'}</button><button class="small" data-act="eat">🍽 I ate this</button><button class="small" data-act="nope" title="Not for me">👎</button></div>
    </div>`;
  }
  const excl = () => ({ ing: state.profile.excludeIngredients || [], meals: state.profile.excludeMeals || [] });
  function setExcl(kind, list) { state.profile[kind] = [...new Set(list.map(x => x.trim()).filter(Boolean))]; state.profile.updatedAt = Date.now(); saveState(); renderExcl(); }
  function renderExcl() {
    const E = excl();
    $('exclChips').innerHTML = E.ing.map(x => `<span class="chip-x" data-k="excludeIngredients" data-v="${esc(x)}">🚫 ${esc(x)} <b>✕</b></span>`).join('') +
      E.meals.map(x => `<span class="chip-x meal" data-k="excludeMeals" data-v="${esc(x)}">👎 ${esc(x)} <b>✕</b></span>`).join('') || '<span class="hint">Nothing excluded yet.</span>';
  }
  const addExcl = kind => { const v = $('exclInput').value.split(',').map(x => x.trim()).filter(Boolean); if (!v.length) return; setExcl(kind, (state.profile[kind] || []).concat(v)); $('exclInput').value = ''; };
  $('exclIngBtn').onclick = () => addExcl('excludeIngredients');
  $('exclMealBtn').onclick = () => addExcl('excludeMeals');
  $('exclChips').onclick = e => { const c = e.target.closest('.chip-x'); if (c) setExcl(c.dataset.k, (state.profile[c.dataset.k] || []).filter(x => x !== c.dataset.v)); };
  function renderFood() {
    renderExcl();
    const saved = Coach.live(state.recipes);
    const savedIds = new Set(saved.map(r => r.id));
    const drafts = draftRecipes.filter(r => !savedIds.has(r.id));
    $('recipeList').innerHTML = (drafts.length ? '<h4 class="sec">New ideas</h4>' + drafts.map(r => recipeCard(r, false)).join('') : '') +
      (saved.length ? '<h4 class="sec">♥ Saved recipes</h4>' + saved.map(r => recipeCard(r, true)).join('') : '');
    renderGroceries();
  }
  function renderGroceries() {
    const items = Coach.live(state.groceries);
    if (!items.length) { $('groList').innerHTML = '<p class="hint">Empty. Add items above or tap 🛒 on a recipe.</p>'; return; }
    const by = {}; items.forEach(g => (by[g.aisle || 'Other'] = by[g.aisle || 'Other'] || []).push(g));
    $('groList').innerHTML = AISLES.filter(a => by[a]).map(a => `<div class="aisle">${a}</div>` + by[a].sort((x, y) => (x.done - y.done) || x.item.localeCompare(y.item)).map(g =>
      `<div class="gro-row${g.done ? ' done' : ''}" data-gid="${g.id}"><input type="checkbox" class="g-done"${g.done ? ' checked' : ''}><input class="g-item" value="${esc(g.item)}"><input class="g-qty" value="${esc(g.qty || '')}" placeholder="qty"><button class="g-del" title="Remove">✕</button></div>`).join('')).join('');
  }
  function addGrocery(item, qty, aisle) {
    item = String(item || '').trim(); if (!item) return null;
    const ex = Coach.live(state.groceries).find(g => !g.done && g.item.toLowerCase() === item.toLowerCase());
    if (ex) { if (qty) ex.qty = ex.qty ? ex.qty + ' + ' + qty : qty; ex.updatedAt = Date.now(); return ex; }
    const g = { id: uid(), item, qty: String(qty || '').trim(), aisle: AISLES.includes(aisle) ? aisle : 'Other', done: false, updatedAt: Date.now() };
    state.groceries.push(g); return g;
  }
  $('mpSlots').onclick = e => { const b = e.target.closest('button'); if (b) b.classList.toggle('on'); };
  $('mpGo').onclick = async () => {
    const slots = [...$('mpSlots').querySelectorAll('.on')].map(b => b.dataset.s);
    if (!slots.length) return toast('Pick at least one meal');
    const T = A.targets, p = state.profile, E = excl(), n = +$('mpCount').value;
    $('mpGo').disabled = true; $('mpStatus').textContent = CN() + ' is writing recipes…';
    draftRecipes = []; let got = 0;
    try {
      await Services.planMeals(settings, { count: n, slots, notes: $('mpNotes').value.trim(), kcal: T.kcal, protein: T.protein, age: p.age, sex: p.sex,
        excludeIngredients: E.ing, excludeMeals: E.meals, avoid: Coach.live(state.recipes).map(r => r.title).slice(-20) },
        r => { got++; draftRecipes.push(Object.assign({ id: uid() }, r)); localStorage.setItem('lose20.recipeDraft', JSON.stringify(draftRecipes));
               $('mpStatus').textContent = `${got} of ${n} ready…`; renderFood(); });
      $('mpStatus').textContent = '';
      say(`Here are ${got} ideas. Save the ones you like and tap the cart to put the ingredients on your list.`, { pose: 'thumbs', bubble: false });
    } catch (e) { $('mpStatus').textContent = e.message; }
    $('mpGo').disabled = false;
  };
  $('recipeList').onclick = e => {
    const ban = e.target.closest('.ban');
    if (ban) { setExcl('excludeIngredients', excl().ing.concat(ban.dataset.ing)); toast(`Won't suggest ${ban.dataset.ing} again`); ban.closest('li').classList.add('banned'); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('.recipe').dataset.rid;
    const r = Coach.live(state.recipes).find(x => x.id === id) || draftRecipes.find(x => x.id === id); if (!r) return;
    if (b.dataset.act === 'shop') {
      (r.ingredients || []).forEach(i => addGrocery(i.item, i.qty, i.aisle));
      saveState(); renderGroceries(); toast(`${(r.ingredients || []).length} ingredients added to your list`);
      b.textContent = '✓ On your list';
    } else if (b.dataset.act === 'save') {
      const s = state.recipes.find(x => x.id === id);
      if (s && !s.deleted) { s.deleted = true; s.updatedAt = Date.now(); }
      else if (s) { s.deleted = false; s.updatedAt = Date.now(); }
      else state.recipes.push(Object.assign({}, r, { updatedAt: Date.now() }));
      saveState(); renderFood();
    } else if (b.dataset.act === 'nope') {
      setExcl('excludeMeals', excl().meals.concat(r.title));
      draftRecipes = draftRecipes.filter(x => x.id !== id); localStorage.setItem('lose20.recipeDraft', JSON.stringify(draftRecipes));
      const sv = state.recipes.find(x => x.id === id); if (sv) { sv.deleted = true; sv.updatedAt = Date.now(); saveState(); }
      renderFood(); toast('Got it. Nothing like that again.');
    } else if (b.dataset.act === 'eat') {
      const before = Gamify.dayPoints(state, today()).total;
      state.meals.push({ id: uid(), date: today(), time: nowTime(), name: r.title, kcal: Math.round(r.kcal || 0), protein: Math.round(r.protein_g || 0), carbs: Math.round(r.carbs_g || 0),
        fat: Math.round(r.fat_g || 0), fiber: Math.round(r.fiber_g || 0), score: 8, light: 'green', verdict: '', tip: '', items: [], source: 'recipe', updatedAt: Date.now() });
      saveState(); refresh(); awardPoints(before); toast('Logged ' + r.title + '. Edit it in the Diary if your portion was different.');
    }
  };
  $('groAddBtn').onclick = () => { if (addGrocery($('groItem').value, $('groQty').value, 'Other')) { $('groItem').value = ''; $('groQty').value = ''; saveState(); renderGroceries(); } $('groItem').focus(); };
  $('groItem').onkeydown = e => { if (e.key === 'Enter') $('groAddBtn').click(); };
  $('groList').addEventListener('change', e => {
    const row = e.target.closest('.gro-row'); if (!row) return;
    const g = state.groceries.find(x => x.id === row.dataset.gid); if (!g) return;
    if (e.target.classList.contains('g-done')) g.done = e.target.checked;
    if (e.target.classList.contains('g-item')) g.item = e.target.value.trim() || g.item;
    if (e.target.classList.contains('g-qty')) g.qty = e.target.value.trim();
    g.updatedAt = Date.now(); saveState(); if (e.target.classList.contains('g-done')) renderGroceries();
  });
  $('groList').addEventListener('click', e => {
    if (!e.target.classList.contains('g-del')) return;
    const g = state.groceries.find(x => x.id === e.target.closest('.gro-row').dataset.gid);
    if (g) { g.deleted = true; g.updatedAt = Date.now(); saveState(); renderGroceries(); }
  });
  $('groClear').onclick = () => { Coach.live(state.groceries).filter(g => g.done).forEach(g => { g.deleted = true; g.updatedAt = Date.now(); }); saveState(); renderGroceries(); };
  $('groShare').onclick = async () => {
    const items = Coach.live(state.groceries).filter(g => !g.done);
    const text = 'Shopping list\n' + AISLES.map(a => { const l = items.filter(g => (g.aisle || 'Other') === a); return l.length ? `\n${a}\n` + l.map(g => `- ${g.item}${g.qty ? ' (' + g.qty + ')' : ''}`).join('\n') : ''; }).join('');
    try { if (navigator.share) await navigator.share({ title: 'Shopping list', text }); else { await navigator.clipboard.writeText(text); toast('List copied'); } } catch (e) { /* cancelled */ }
  };

  // ---------- edit any entry ----------
  let editing = null;   // { kind, obj (null = new) }
  const fld = (label, id, val, type, extra) => `<label>${label}<input id="${id}" type="${type || 'text'}" value="${esc(val == null ? '' : val)}" ${extra || ''}></label>`;
  function openEdit(kind, obj) {
    editing = { kind, obj };
    const o = obj || {}, isNew = !obj;
    $('editDelete').hidden = isNew; $('editDelete').textContent = 'Delete'; $('editDelete').dataset.armed = '';
    let html = '';
    if (kind === 'meal') {
      $('editTitle').textContent = isNew ? 'Add a meal' : 'Edit meal';
      html = fld('Name', 'eName', o.name || '') + `<div class="grid2f">${fld('Date', 'eDate', o.date || today(), 'date')}${fld('Time', 'eTime', o.time || nowTime(), 'time')}</div>
        <div class="items-edit"><div class="items-head"><span>Item</span><span>Amount</span><span>kcal</span><span></span></div><div id="eItems"></div><button class="small" id="eAddItem">+ Add item</button></div>
        <div class="grid4">${fld('kcal', 'eKcal', Math.round(o.kcal || 0), 'number')}${fld('Protein', 'eProt', Math.round(o.protein || 0), 'number')}${fld('Carbs', 'eCarb', Math.round(o.carbs || 0), 'number')}${fld('Fat', 'eFat', Math.round(o.fat || 0), 'number')}${fld('Fiber', 'eFib', Math.round(o.fiber || 0), 'number')}</div>`;
      editing.items = (o.items || []).map(i => ({ food: i.food || '', portion: i.portion || '', kcal: Math.round(i.kcal || 0), color: i.color }));
    } else if (kind === 'weight') {
      $('editTitle').textContent = isNew ? 'Add a weigh-in' : 'Edit weigh-in';
      html = `<div class="grid2f">${fld('Weight (lb)', 'eLb', o.lb || '', 'number', 'step="0.1" inputmode="decimal"')}${fld('Date', 'eDate', o.date || today(), 'date')}</div>`;
    } else if (kind === 'exercise') {
      $('editTitle').textContent = isNew ? 'Add exercise' : 'Edit exercise';
      html = `<label>Activity<select id="eType">${Object.entries(Coach.EXERCISE).map(([k, e]) => `<option value="${k}"${k === (o.type || 'walk') ? ' selected' : ''}>${e.icon} ${e.name}</option>`).join('')}</select></label>
        <div class="grid2f">${fld('Minutes', 'eMin', o.minutes || 30, 'number')}${fld('Date', 'eDate', o.date || today(), 'date')}</div>
        <label>Intensity<select id="eInt">${Coach.INTENSITY.map(i => `<option${i === (o.intensity || 'moderate') ? ' selected' : ''}>${i}</option>`).join('')}</select></label><p class="ex-est" id="eEst"></p>`;
    } else {
      $('editTitle').textContent = 'Weights + 5k (old entry)';
      html = `${fld('Date', 'eDate', o.date || today(), 'date')}<p class="hint">Delete this if you didn't do the workout that day.</p>`;
    }
    $('editBody').innerHTML = html;
    if (kind === 'meal') renderEItems();
    if (kind === 'exercise') { const up = () => { const k = Coach.exerciseKcal($('eType').value, +$('eMin').value || 0, $('eInt').value, A.nowLb); $('eEst').textContent = `About ${k} kcal burned.`; }; ['eType', 'eMin', 'eInt'].forEach(id => $(id).oninput = $(id).onchange = up); up(); }
    $('editModal').hidden = false;
  }
  function renderEItems() {
    $('eItems').innerHTML = editing.items.map((i, k) => `<div class="item-row" data-k="${k}"><span class="dot ${i.color || 'yellow'}"></span><input class="i-food" value="${esc(i.food)}" placeholder="Food"><input class="i-qty" value="${esc(i.portion)}" placeholder="Amount"><input class="i-kcal" type="number" value="${i.kcal}"><button class="i-del">✕</button></div>`).join('');
    $('eAddItem').onclick = () => { editing.items.push({ food: '', portion: '', kcal: 0 }); renderEItems(); };
    $('eItems').oninput = e => {
      const row = e.target.closest('.item-row'); if (!row) return; const it = editing.items[+row.dataset.k];
      if (e.target.classList.contains('i-food')) it.food = e.target.value;
      if (e.target.classList.contains('i-qty')) { const a = num(it.portion), b = num(e.target.value); if (a && b && a !== b) { it.kcal = Math.round(it.kcal * b / a); row.querySelector('.i-kcal').value = it.kcal; } it.portion = e.target.value; }
      if (e.target.classList.contains('i-kcal')) it.kcal = +e.target.value || 0;
      $('eKcal').value = editing.items.reduce((a, i) => a + (+i.kcal || 0), 0);
    };
    $('eItems').onclick = e => { if (e.target.classList.contains('i-del')) { editing.items.splice(+e.target.closest('.item-row').dataset.k, 1); renderEItems(); $('eKcal').value = editing.items.reduce((a, i) => a + (+i.kcal || 0), 0); } };
  }
  $('editCancel').onclick = () => { $('editModal').hidden = true; editing = null; };
  $('editSave').onclick = () => {
    const { kind } = editing, now = Date.now(), d = $('eDate').value && $('eDate').value <= today() ? $('eDate').value : today();
    let o = editing.obj;
    const before = Gamify.dayPoints(state, today()).total;
    if (kind === 'meal') {
      if (!o) { o = { id: uid(), source: 'manual', verdict: '', tip: '', light: null, score: null }; state.meals.push(o); }
      Object.assign(o, { name: $('eName').value.trim() || 'Meal', date: d, time: $('eTime').value || nowTime(), kcal: +$('eKcal').value || 0, protein: +$('eProt').value || 0,
        carbs: +$('eCarb').value || 0, fat: +$('eFat').value || 0, fiber: +$('eFib').value || 0,
        items: editing.items.filter(i => i.food.trim()).map(i => ({ food: i.food.trim(), portion: i.portion.trim(), kcal: +i.kcal || 0, color: i.color || 'yellow' })), updatedAt: now });
    } else if (kind === 'weight') {
      const lb = parseFloat($('eLb').value); if (!(lb > 80 && lb < 400)) return toast('Enter your weight in lb');
      const clash = state.weights.find(x => x.date === d && !x.deleted && x !== o);
      if (clash) { clash.deleted = true; clash.updatedAt = now; }                     // one weigh-in per day
      if (!o) { o = { id: uid() }; state.weights.push(o); }
      Object.assign(o, { date: d, lb, updatedAt: now });
    } else if (kind === 'exercise') {
      const minutes = +$('eMin').value || 0; if (minutes < 1) return toast('Enter the minutes');
      if (!o) { o = { id: uid(), extra: true, done: true }; state.workouts.push(o); }
      Object.assign(o, { type: $('eType').value, minutes, intensity: $('eInt').value, date: d, kcal: Coach.exerciseKcal($('eType').value, minutes, $('eInt').value, A.nowLb), updatedAt: now });
    } else if (o) { Object.assign(o, { date: d, updatedAt: now }); }
    $('editModal').hidden = true; editing = null; saveState(); refresh(); renderDiary(); awardPoints(before); toast('Saved');
  };
  $('editDelete').onclick = () => {
    const b = $('editDelete');
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; return; }
    editing.obj.deleted = true; editing.obj.updatedAt = Date.now();
    $('editModal').hidden = true; editing = null; saveState(); refresh(); renderDiary(); toast('Deleted');
  };
  $('diaryFeed').addEventListener('click', e => {
    const c = e.target.closest('[data-kind]'); if (!c) return;
    const list = { meal: state.meals, weight: state.weights, exercise: state.workouts, routine: state.workouts }[c.dataset.kind];
    const o = list.find(x => x.id === c.dataset.id); if (o) openEdit(c.dataset.kind, o);
  });
  document.querySelector('.add-bar').onclick = e => { const b = e.target.closest('[data-add]'); if (b) openEdit(b.dataset.add, null); };

  function showReport(r) {
    $('reportBody').innerHTML = `<div class="grade">${esc(r.grade)}</div><p class="sub">Week ending ${esc(r.id)}</p><p>${esc(r.text)}</p>`;
  }
  $('reportBtn').onclick = async () => {
    const end = Coach.addDays(today(), -1), g = Gamify.weekGrade(state, end);
    $('reportBtn').disabled = true; $('reportBody').innerHTML = '<p class="hint">' + CN() + ' is grading your week…</p>';
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
  // ---------- Maya can log for you ----------
  const EX_TYPES = Object.keys(Coach.EXERCISE);
  const TOOLS = [
    { name: 'log_meal', description: 'Add a meal or snack he ate. Estimate calories and macros yourself when he describes food in words.',
      input_schema: { type: 'object', required: ['name', 'kcal', 'protein_g'], properties: {
        name: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD, default today' }, time: { type: 'string', description: 'HH:MM 24h, default now' },
        items: { type: 'array', items: { type: 'object', properties: { food: { type: 'string' }, portion: { type: 'string' }, kcal: { type: 'number' }, color: { type: 'string', enum: ['green', 'yellow', 'red'] } } } },
        kcal: { type: 'number' }, protein_g: { type: 'number' }, carbs_g: { type: 'number' }, fat_g: { type: 'number' }, fiber_g: { type: 'number' },
        health_score: { type: 'number', description: '1-10 for a 60-year-old losing weight while lifting' }, light: { type: 'string', enum: ['green', 'yellow', 'red'] } } } },
    { name: 'log_weight', description: 'Record a weigh-in in lb (replaces that day\'s weigh-in).',
      input_schema: { type: 'object', required: ['lb'], properties: { lb: { type: 'number' }, date: { type: 'string' } } } },
    { name: 'log_exercise', description: 'Record one exercise (call once per exercise: weights, run, walk, bike...). Calories are calculated by the app. The first weights and run on up to 3 days a week count as his planned routine (already in the calorie target); anything beyond adds half its burn to the budget.',
      input_schema: { type: 'object', required: ['type', 'minutes'], properties: { type: { type: 'string', enum: EX_TYPES }, minutes: { type: 'number' }, intensity: { type: 'string', enum: Coach.INTENSITY }, date: { type: 'string' } } } },
    { name: 'set_gym_done', description: 'Shortcut: log his usual weights (45 min) + 5k run (30 min) for a day, or remove that day\'s weights and run with done=false.',
      input_schema: { type: 'object', properties: { done: { type: 'boolean' }, date: { type: 'string' } } } },
    { name: 'list_entries', description: 'List meals, weigh-in and exercise for a day, with ids, so you can change or delete them.',
      input_schema: { type: 'object', required: ['date'], properties: { date: { type: 'string' } } } },
    { name: 'update_meal', description: 'Change a logged meal. Only pass the fields to change.',
      input_schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, name: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' },
        kcal: { type: 'number' }, protein_g: { type: 'number' }, carbs_g: { type: 'number' }, fat_g: { type: 'number' }, fiber_g: { type: 'number' },
        items: { type: 'array', items: { type: 'object', properties: { food: { type: 'string' }, portion: { type: 'string' }, kcal: { type: 'number' } } } } } } },
    { name: 'add_to_shopping_list', description: 'Add items to his shopping list.',
      input_schema: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { type: 'object', required: ['item'], properties: { item: { type: 'string' }, qty: { type: 'string' }, aisle: { type: 'string', enum: ['Produce', 'Meat & fish', 'Dairy & eggs', 'Bakery', 'Pantry', 'Frozen', 'Other'] } } } } } } },
    { name: 'delete_entry', description: 'Delete a meal, weigh-in or exercise entry by id.',
      input_schema: { type: 'object', required: ['kind', 'id'], properties: { kind: { type: 'string', enum: ['meal', 'weight', 'exercise'] }, id: { type: 'string' } } } }
  ];
  const okDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && d <= today() ? d : today();
  const okTime = t => /^\d{1,2}:\d{2}$/.test(t || '') ? t.padStart(5, '0') : nowTime();
  const r0 = n => Math.round(+n || 0);
  function dayEntries(d) {
    return {
      date: d,
      meals: Coach.live(state.meals).filter(m => m.date === d).map(m => ({ id: m.id, time: m.time, name: m.name, kcal: r0(m.kcal), protein_g: r0(m.protein) })),
      weigh_in: (Coach.live(state.weights).find(w => w.date === d) || {}).lb || null,
      weigh_in_id: (Coach.live(state.weights).find(w => w.date === d) || {}).id || null,
      exercise: Coach.exercisesOn(state, d).map(w => Coach.isLegacy(w) ? { id: w.id, type: 'weights + 5k (old entry)' } : { id: w.id, type: w.type, minutes: w.minutes, intensity: w.intensity, kcal: w.kcal })
    };
  }
  const restore = obj => () => { obj.deleted = false; obj.updatedAt = Date.now(); };
  const remove = obj => () => { obj.deleted = true; obj.updatedAt = Date.now(); };
  function runTool(name, x) {
    const now = Date.now();
    if (name === 'list_entries') return { result: dayEntries(okDate(x.date)) };
    if (name === 'log_meal') {
      const items = (x.items || []).map(i => ({ food: String(i.food || ''), portion: String(i.portion || ''), kcal: r0(i.kcal), color: i.color || 'yellow' }));
      const m = { id: uid(), date: okDate(x.date), time: okTime(x.time), name: String(x.name || 'Meal'), kcal: r0(x.kcal), protein: r0(x.protein_g), carbs: r0(x.carbs_g), fat: r0(x.fat_g),
        fiber: r0(x.fiber_g), score: x.health_score ? r0(x.health_score) : null, light: x.light || null, verdict: '', tip: '', items, source: 'chat', updatedAt: now };
      state.meals.push(m);
      return { result: { ok: true, id: m.id }, action: { text: `🍽 ${m.name}, ${m.kcal} kcal, ${m.protein} g protein${m.date !== today() ? ' (' + m.date + ')' : ''}`, undo: remove(m) } };
    }
    if (name === 'log_weight') {
      const lb = +x.lb; if (!(lb > 80 && lb < 400)) throw new Error('Weight must be in lb');
      const d = okDate(x.date), w = state.weights.find(v => v.date === d && !v.deleted);
      if (w) { const old = w.lb; w.lb = lb; w.updatedAt = now; return { result: { ok: true, replaced: old }, action: { text: `⚖️ ${lb} lb (was ${old})`, undo: () => { w.lb = old; w.updatedAt = Date.now(); } } }; }
      const nw = { id: uid(), date: d, lb, updatedAt: now }; state.weights.push(nw);
      return { result: { ok: true }, action: { text: `⚖️ Weigh-in ${lb} lb${d !== today() ? ' (' + d + ')' : ''}`, undo: remove(nw) } };
    }
    if (name === 'log_exercise') {
      const type = EX_TYPES.includes(x.type) ? x.type : 'other', minutes = r0(x.minutes), intensity = Coach.INTENSITY.includes(x.intensity) ? x.intensity : 'moderate';
      if (minutes < 1) throw new Error('Minutes missing');
      const kcal = Coach.exerciseKcal(type, minutes, intensity, A.nowLb);
      const w = { id: uid(), date: okDate(x.date), type, extra: true, minutes, intensity, kcal, done: true, updatedAt: now };
      state.workouts.push(w);
      return { result: { ok: true, id: w.id, kcal_burned: kcal, budget_bonus_today_now: Coach.exerciseBonus(state, w.date) }, action: { text: `${Coach.EXERCISE[type].icon} ${Coach.EXERCISE[type].name} ${minutes} min, ~${kcal} kcal`, undo: remove(w) } };
    }
    if (name === 'set_gym_done') {
      const d = okDate(x.date);
      if (x.done === false) {
        const gone = Coach.exercisesOn(state, d).filter(Coach.isRoutine); gone.forEach(w => { w.deleted = true; w.updatedAt = now; });
        return { result: { ok: true, removed: gone.length }, action: { text: '🏋️ Weights + 5k removed', undo: () => gone.forEach(w => { w.deleted = false; w.updatedAt = Date.now(); }) } };
      }
      const made = [['weights', 45], ['run', 30]].map(([type, minutes], i) => ({ id: uid(), date: d, type, extra: true, minutes, intensity: 'moderate', kcal: Coach.exerciseKcal(type, minutes, 'moderate', A.nowLb), done: true, updatedAt: now + i }));
      made.forEach(w => state.workouts.push(w));
      return { result: { ok: true }, action: { text: '🏋️ Weights 45 min + 🏃 run 30 min', undo: () => made.forEach(w => { w.deleted = true; w.updatedAt = Date.now(); }) } };
    }
    if (name === 'update_meal') {
      const m = state.meals.find(v => v.id === x.id && !v.deleted); if (!m) throw new Error('No meal with that id. Use list_entries first.');
      const before = JSON.parse(JSON.stringify(m));
      const map = { name: 'name', kcal: 'kcal', protein_g: 'protein', carbs_g: 'carbs', fat_g: 'fat', fiber_g: 'fiber' };
      Object.entries(map).forEach(([k, f]) => { if (x[k] !== undefined) m[f] = k === 'name' ? String(x[k]) : r0(x[k]); });
      if (x.date) m.date = okDate(x.date); if (x.time) m.time = okTime(x.time);
      if (Array.isArray(x.items)) m.items = x.items.map(i => ({ food: String(i.food || ''), portion: String(i.portion || ''), kcal: r0(i.kcal), color: i.color || 'yellow' }));
      m.updatedAt = now;
      return { result: { ok: true }, action: { text: `✏️ ${m.name} now ${m.kcal} kcal, ${m.protein} g protein`, undo: () => { Object.assign(m, before, { updatedAt: Date.now() }); } } };
    }
    if (name === 'add_to_shopping_list') {
      const added = (x.items || []).map(i => addGrocery(i.item, i.qty, i.aisle)).filter(Boolean);
      return { result: { ok: true, added: added.length }, action: { text: `🛒 Added ${added.map(g => g.item).join(', ')}`, undo: () => added.forEach(g => { g.deleted = true; g.updatedAt = Date.now(); }) } };
    }
    if (name === 'delete_entry') {
      const list = x.kind === 'meal' ? state.meals : x.kind === 'weight' ? state.weights : state.workouts;
      const o = list.find(v => v.id === x.id && !v.deleted); if (!o) throw new Error('Nothing with that id. Use list_entries first.');
      o.deleted = true; o.updatedAt = now;
      return { result: { ok: true }, action: { text: `🗑 Deleted ${x.kind === 'meal' ? o.name : x.kind === 'weight' ? o.lb + ' lb weigh-in' : 'exercise'}`, undo: restore(o) } };
    }
    throw new Error('Unknown tool ' + name);
  }
  function toolContext() {
    const d = today(), wd = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    return `It is ${wd} ${d}, ${nowTime()}. Today's entries: ${JSON.stringify(dayEntries(d))}
You can change his log with tools. When he tells you what he ate, what he weighed, or what exercise he did, or asks to fix or remove an entry, call the tools. Never claim you logged something without calling a tool.
For food described in words, estimate calories, protein, carbs, fat and fiber yourself (round calories to 10), split it into items, and pick a traffic light (green = lean and filling, red = calorie-dense or sugary).
"Yesterday" and similar mean the matching date. For entries on other days, call list_entries first to get ids.
"Gym done" or "did my usual workout" means set_gym_done; otherwise call log_exercise once per exercise he names.
After the tools, confirm in one short spoken sentence what you did with the calories, then one short coaching line. If something is unclear (for example the portion), make a sensible guess and say what you assumed.`;
  }

  async function ask(userText, hidden) {
    if (!hidden) addMsg('me', userText);
    chatHistory.push({ role: 'user', content: userText });
    const typing = addMsg('her', '…', 'typing');
    maya.coach.pose('think');
    const beforePts = Gamify.dayPoints(state, today()).total;
    try {
      const out = await Services.coachAct(settings, state.profile, Coach.summaryText(state, A) + extraSummary(), chatHistory, DESK, TOOLS, async (n, x) => runTool(n, x), toolContext());
      const reply = out.text;
      chatHistory.push({ role: 'assistant', content: reply });
      typing.classList.remove('typing'); typing.textContent = reply;
      if (out.actions.length) {
        saveState(); refresh(); awardPoints(beforePts);
        const box = document.createElement('div'); box.className = 'msg actions';
        out.actions.forEach(a => {
          const row = document.createElement('div'); row.className = 'act-row';
          row.innerHTML = `<span>✓ ${esc(a.text)}</span><button class="small">Undo</button>`;
          row.querySelector('button').onclick = e => { a.undo(); saveState(); refresh(); row.classList.add('undone'); e.target.remove(); row.querySelector('span').textContent = '↶ Undone: ' + a.text; };
          box.appendChild(row);
        });
        $('chat').appendChild(box); box.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
      say(reply, { pose: out.actions.length ? 'thumbs' : /great|proud|nice|awesome|love/i.test(reply) ? 'thumbs' : 'idle', bubble: false });
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
    if (!settings.voiceOn) { stopTalking(); toast(CN() + ' is muted'); }
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

  window.addEventListener('maya-novoice', () => toast(CN() + ' needs the Azure speech key in Settings to talk'));

  $('coachGrid').onclick = e => { const b = e.target.closest('.coach-card'); if (b && b.dataset.id !== coach().id) { switchCoach(b.dataset.id, 'pick'); go('today'); } };
  $('coachRotate').onchange = e => { state.profile.coachRotate = e.target.checked; state.profile.updatedAt = Date.now(); saveState(); };

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
  loadCoaches();
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
    return !pendingMeal && !rec && !$('chatInput').value && !$('wInput').value && $('planModal').hidden && $('exModal').hidden && $('editModal').hidden &&
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
