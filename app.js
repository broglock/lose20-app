/* Lose20 UI. State lives in localStorage and syncs to a private GitHub repo. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const today = () => Coach.ymd(new Date());
  const nowTime = () => new Date().toTimeString().slice(0, 5);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const params = new URLSearchParams(location.search);
  const DESK = params.has('desk');

  // ---------- storage ----------
  const SKEY = 'lose20.state', KKEY = 'lose20.settings';
  let state = load(SKEY) || Coach.defaultState(today());
  let settings = Object.assign({ voiceOn: true, model: 'claude-sonnet-5-5', voice: 'en-US-AvaMultilingualNeural' }, load(KKEY) || {});
  let A = null;           // current analysis
  let chatHistory = [];
  let pendingMeal = null; // {thumb, photoB64}

  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function saveState() { localStorage.setItem(SKEY, JSON.stringify(state)); scheduleSync(); }
  function saveSettings() { localStorage.setItem(KKEY, JSON.stringify(settings)); }
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); }

  // ---------- sync ----------
  let syncTimer = null, syncing = false;
  function scheduleSync() { if (!settings.ghToken) return; clearTimeout(syncTimer); syncTimer = setTimeout(doSync, 2000); }
  async function doSync(manual) {
    if (!settings.ghToken || !settings.ghRepo) { if (manual) toast('Set up sync in Settings'); return; }
    if (syncing) return; syncing = true; $('syncState').textContent = 'Syncing…';
    try {
      state = await Services.sync(settings, state);
      localStorage.setItem(SKEY, JSON.stringify(state));
      $('syncState').textContent = 'Synced ' + nowTime();
      render();
    } catch (e) { $('syncState').textContent = 'Sync failed'; if (manual) toast(e.message); console.warn(e); }
    syncing = false;
  }

  // ---------- navigation ----------
  function go(tab) {
    document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + tab));
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.go === tab));
    if (tab === 'progress') renderProgress();
    if (tab === 'settings') renderSettings();
    if (tab === 'coach' && !$('chat').children.length) addMsg('her', greeting());
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));

  // ---------- greetings ----------
  function greeting() {
    const h = new Date().getHours(), n = state.profile.name;
    const hi = h < 12 ? `Morning, ${n}.` : h < 17 ? `Hey ${n}.` : `Evening, ${n}.`;
    let line;
    if (!A.weighedToday && h < 12) line = 'Step on the scale before breakfast, then show me what you are eating.';
    else if (A.isGymDay && !A.gymDoneToday && h < 20) line = 'Gym day. Weights and your 5k are on the calendar.';
    else if (A.todayTotals.meals === 0 && h >= 11) line = 'Nothing logged yet today. Snap your next meal for me.';
    else if (A.remaining < 0) line = `You are ${-A.remaining} over today. Kitchen is closed, okay?`;
    else if (h >= 17) line = `${A.remaining} calories and ${A.proteinLeft} g of protein left for today.`;
    else line = A.problems.length ? `Today's focus: ${A.problems[0].title.toLowerCase()}.` : 'You are on track. Keep it boring and consistent.';
    return hi + ' ' + line + ' ' + Coach.pickTip(A, today() + h);
  }

  // ---------- render: today ----------
  function render() {
    A = Coach.analyze(state, today());
    const p = state.profile;
    Avatar.mount($('avatarToday'), A.mood);
    Avatar.mount($('avatarCoach'), A.mood);
    $('bubbleText').textContent = greeting();
    $('sWeight').textContent = A.nowLb.toFixed(1);
    $('sLost').textContent = Math.max(0, A.lost).toFixed(1);
    $('sGoalLb').textContent = (p.startWeight - p.goalWeight).toFixed(0);
    $('sBar').style.width = A.pct + '%';
    if (A.projection) {
      const d = new Date(A.projection.date + 'T12:00');
      $('sEta').textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      $('sEtaBasis').textContent = A.projection.basis === 'trend' ? 'at current trend' : 'at planned pace';
    } else { $('sEta').textContent = 'Done'; $('sEtaBasis').textContent = 'goal reached'; }

    const top = A.problems[0];
    $('fixCard').hidden = !top;
    if (top) { $('fixTitle').textContent = top.title; $('fixDetail').textContent = top.detail; $('fixCard').className = 'card fix sev' + top.sev; }

    const t = A.todayTotals, T = A.targets;
    Charts.ring($('ring'), t.kcal, T.kcal);
    $('mProt').style.width = Math.min(100, t.protein / T.protein * 100) + '%';
    $('tProt').textContent = `${Math.round(t.protein)} / ${T.protein} g`;
    $('mFib').style.width = Math.min(100, t.fiber / T.fiber * 100) + '%';
    $('tFib').textContent = `${Math.round(t.fiber)} / ${T.fiber} g`;
    $('mScore').style.width = (t.score ? t.score * 10 : 0) + '%';
    $('tScore').textContent = t.score ? t.score.toFixed(1) + ' / 10 average' : 'no meals yet';

    const todaysW = Coach.live(state.weights).find(w => w.date === today());
    $('wInput').placeholder = todaysW ? todaysW.lb + ' lb today' : 'lb';
    $('wHint').textContent = todaysW ? '✓ Weighed in today. Update if needed.' : 'Morning, after the bathroom, before food.';
    $('gymLabel').textContent = A.isGymDay ? 'Gym day' : 'Workout';
    $('gymText').textContent = A.isGymDay ? 'Weights + 5k done' : 'Did a workout anyway';
    $('gymDone').checked = A.gymDoneToday;

    const meals = Coach.live(state.meals).filter(m => m.date === today());
    const ul = $('mealList');
    ul.innerHTML = meals.length ? '' : '<li class="empty">No meals logged yet.</li>';
    meals.forEach(m => {
      const li = document.createElement('li');
      li.innerHTML = `<div class="noimg">🍽</div><div class="m"><b></b><small>${m.time} · ${Math.round(m.kcal)} kcal · ${Math.round(m.protein)} g protein · ${m.score || '–'}/10</small></div><button class="del" title="Delete">✕</button>`;
      li.querySelector('b').textContent = m.name;
      Services.getThumb(m.id).then(src => { if (src) li.querySelector('.noimg').outerHTML = `<img src="${src}" alt="">`; }).catch(() => {});
      li.querySelector('.del').onclick = () => { if (confirm('Delete ' + m.name + '?')) { m.deleted = true; m.updatedAt = Date.now(); saveState(); render(); } };
      ul.appendChild(li);
    });
    if (DESK) renderDesk();
  }

  // ---------- weigh-in and gym ----------
  $('wSave').onclick = () => {
    const lb = parseFloat($('wInput').value);
    if (!(lb > 80 && lb < 400)) return toast('Enter your weight in lb');
    const d = today();
    let w = state.weights.find(x => x.date === d && !x.deleted);
    if (w) { w.lb = lb; w.updatedAt = Date.now(); } else state.weights.push({ id: uid(), date: d, lb, updatedAt: Date.now() });
    $('wInput').value = ''; saveState(); render();
    const prev = A.series.length > 1 ? A.series[A.series.length - 2].trend : null;
    say(prev && A.nowLb < prev ? 'Trend is heading down. Nice.' : 'Logged. Remember, the trend matters, not one day.');
  };
  $('gymDone').onchange = e => {
    const d = today();
    let w = state.workouts.find(x => x.date === d && !x.deleted);
    if (w) { w.done = e.target.checked; w.updatedAt = Date.now(); }
    else state.workouts.push({ id: uid(), date: d, type: state.profile.gymRoutine.join('+'), done: e.target.checked, updatedAt: Date.now() });
    saveState(); render();
    if (e.target.checked) say('Workout logged. That is what keeps the weight you lose from being muscle. Get some protein in.');
  };

  // ---------- meal logging ----------
  async function onPhoto(file) {
    if (!file) return;
    $('analyzeStatus').textContent = 'Preparing photo…';
    const big = await Services.resizeImage(file, 1024, 0.82);
    const thumb = await Services.resizeImage(file, 160, 0.7);
    pendingMeal = { thumb, photoB64: big.split(',')[1] };
    $('preview').src = big; $('preview').hidden = false; $('analyzeBtn').hidden = false;
    $('resultCard').hidden = true;
    $('analyzeStatus').textContent = '';
    analyzePhoto();
  }
  $('camInput').onchange = e => onPhoto(e.target.files[0]);
  $('galInput').onchange = e => onPhoto(e.target.files[0]);
  $('analyzeBtn').onclick = analyzePhoto;

  async function analyzePhoto() {
    if (!pendingMeal) return;
    $('analyzeBtn').disabled = true; $('analyzeStatus').textContent = 'Maya is looking at your plate…';
    try { showResult(await Services.analyzeMealPhoto(settings, pendingMeal.photoB64, $('mealNote').value.trim())); $('analyzeStatus').textContent = ''; }
    catch (e) { $('analyzeStatus').textContent = e.message; }
    $('analyzeBtn').disabled = false;
  }
  $('analyzeTextBtn').onclick = async () => {
    const txt = $('mealText').value.trim(); if (!txt) return;
    pendingMeal = { thumb: null };
    $('analyzeStatus').textContent = 'Estimating…';
    try { showResult(await Services.analyzeMealText(settings, txt)); $('analyzeStatus').textContent = ''; }
    catch (e) { $('analyzeStatus').textContent = e.message; }
  };

  function showResult(r) {
    pendingMeal.result = r;
    $('resultCard').hidden = false;
    $('rName').value = r.name || 'Meal';
    const s = Math.round(r.health_score || 0);
    const b = $('rScoreBadge'); b.textContent = s + '/10'; b.className = 'badge ' + (s >= 7 ? 'good' : s >= 5 ? 'warn' : 'bad');
    $('rVerdict').textContent = r.verdict || '';
    $('rSwap').textContent = r.swap_tip ? 'Better: ' + r.swap_tip : '';
    $('rItems').innerHTML = (r.items || []).map(i => `<li>${escapeHtml(i.food)} (${escapeHtml(i.portion || '')}) ~${Math.round(i.kcal)} kcal</li>`).join('');
    $('rKcal').value = Math.round(r.kcal || 0); $('rProt').value = Math.round(r.protein_g || 0);
    $('rCarb').value = Math.round(r.carbs_g || 0); $('rFat').value = Math.round(r.fat_g || 0);
    $('rFib').value = Math.round(r.fiber_g || 0); $('rScore').value = s;
    $('rDate').value = today(); $('rTime').value = nowTime();
    $('resultCard').scrollIntoView({ behavior: 'smooth' });
    const left = A.remaining - (r.kcal || 0);
    say(`${r.verdict || ''} ${left >= 0 ? `That leaves about ${left} calories for today.` : `That puts you about ${-left} over for today.`}`, true);
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  $('saveMeal').onclick = async () => {
    const r = pendingMeal && pendingMeal.result || {};
    const m = {
      id: uid(), date: $('rDate').value || today(), time: $('rTime').value || nowTime(), name: $('rName').value || 'Meal',
      kcal: +$('rKcal').value || 0, protein: +$('rProt').value || 0, carbs: +$('rCarb').value || 0, fat: +$('rFat').value || 0,
      fiber: +$('rFib').value || 0, score: +$('rScore').value || null, verdict: r.verdict || '', tip: r.swap_tip || '',
      items: r.items || [], source: pendingMeal && pendingMeal.thumb ? 'photo' : 'text', updatedAt: Date.now()
    };
    state.meals.push(m);
    if (pendingMeal && pendingMeal.thumb) await Services.putThumb(m.id, pendingMeal.thumb);
    pendingMeal = null; saveState();
    ['preview', 'analyzeBtn', 'resultCard'].forEach(id => $(id).hidden = true);
    $('mealNote').value = ''; $('mealText').value = ''; $('camInput').value = ''; $('galInput').value = '';
    toast('Meal saved'); render(); go('today');
  };

  // ---------- progress ----------
  function renderProgress() {
    A = Coach.analyze(state, today());
    Charts.weight($('chWeight'), A.series, state.profile);
    const days = Coach.lastNDays(today(), 14).map(d => Coach.dayTotals(state, d));
    Charts.bars($('chKcal'), days, A.targets.kcal, { key: 'kcal', unit: 'kcal', status: 'over-bad' });
    Charts.bars($('chProt'), days, A.targets.protein, { key: 'protein', unit: 'g', status: 'under-bad' });
    Charts.consistency($('chCons'), state, today());
    const li = x => `<li class="s${x.sev}"><b>${escapeHtml(x.title)}</b><small>${escapeHtml(x.detail)}</small></li>`;
    $('winsList').innerHTML = A.wins.map(li).join('') || '<li><small>Log a few days to see what is working.</small></li>';
    $('probList').innerHTML = A.problems.map(li).join('') || '<li><small>Nothing flagged. Keep going.</small></li>';
  }

  // ---------- coach chat and voice ----------
  function addMsg(who, text, cls) {
    const d = document.createElement('div'); d.className = 'msg ' + who + (cls ? ' ' + cls : ''); d.textContent = text;
    $('chat').appendChild(d); d.scrollIntoView({ behavior: 'smooth', block: 'end' }); return d;
  }
  function say(text, quiet) {
    if (!text) return;
    const els = [$('avatarToday'), $('avatarCoach')];
    Services.speak(settings, text, () => els.forEach(e => Avatar.setTalking(e, true)), () => els.forEach(e => Avatar.setTalking(e, false)));
    if (!quiet) toast(text.length > 70 ? text.slice(0, 67) + '…' : text);
  }
  async function ask(userText, hidden) {
    if (!hidden) addMsg('me', userText);
    chatHistory.push({ role: 'user', content: userText });
    const typing = addMsg('her', '…', 'typing');
    try {
      const reply = await Services.coachReply(settings, state.profile, Coach.summaryText(state, A), chatHistory, DESK);
      chatHistory.push({ role: 'assistant', content: reply });
      typing.classList.remove('typing'); typing.textContent = reply;
      say(reply, true);
    } catch (e) {
      chatHistory.pop();
      typing.classList.remove('typing'); typing.textContent = e.message.includes('API key') ? 'Add your Claude API key in Settings so I can talk with you.' : 'I could not reach Claude: ' + e.message;
    }
  }
  $('sendBtn').onclick = () => { const v = $('chatInput').value.trim(); if (v) { $('chatInput').value = ''; ask(v); } };
  $('chatInput').onkeydown = e => { if (e.key === 'Enter') $('sendBtn').click(); };
  $('pepBtn').onclick = () => ask('Give me a short pep talk based on how I am doing.', false);
  $('reviewBtn').onclick = () => ask('Review my day and this week. What am I doing right, and what is the one thing I need to fix first?', false);
  let rec = null;
  $('micBtn').onclick = () => {
    if (rec) { rec.stop(); return; }
    Services.stopSpeaking();
    $('micBtn').classList.add('listening');
    rec = Services.listen(t => ask(t), () => { rec = null; $('micBtn').classList.remove('listening'); });
  };
  $('voiceOn').onchange = e => { settings.voiceOn = e.target.checked; saveSettings(); if (!settings.voiceOn) Services.stopSpeaking(); };
  $('hearTip').onclick = () => say($('bubbleText').textContent, true);
  $('avatarToday').onclick = () => say($('bubbleText').textContent, true);

  // ---------- settings ----------
  const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function renderSettings() {
    const p = state.profile;
    $('pName').value = p.name; $('pAge').value = p.age; $('pHeight').value = p.heightIn; $('pSex').value = p.sex;
    $('pStart').value = p.startWeight; $('pGoal').value = p.goalWeight; $('pStartDate').value = p.startDate; $('pPace').value = String(p.paceLbPerWeek);
    $('pDays').innerHTML = DAYN.map((d, i) => `<button data-d="${i}" class="${p.gymDays.includes(i) ? 'on' : ''}">${d}</button>`).join('');
    $('pDays').querySelectorAll('button').forEach(b => b.onclick = () => b.classList.toggle('on'));
    const T = Coach.targets(p, Coach.currentWeight(state, today()));
    $('pTargets').textContent = `Daily targets: ${T.kcal} kcal (maintenance about ${T.tdee}), ${T.protein} g protein, ${T.fiber} g fiber. Gym calories are already counted in, so do not eat them back.`;
    $('sAnthKey').value = settings.anthropicKey || ''; $('sModel').value = settings.model || '';
    $('sRepo').value = settings.ghRepo || ''; $('sGhToken').value = settings.ghToken || '';
    $('sAzKey').value = settings.azureKey || ''; $('sAzRegion').value = settings.azureRegion || ''; $('sVoice').value = settings.voice;
  }
  $('saveProfile').onclick = () => {
    const p = state.profile;
    Object.assign(p, {
      name: $('pName').value || 'David', age: +$('pAge').value || 60, heightIn: +$('pHeight').value || 70, sex: $('pSex').value,
      startWeight: +$('pStart').value || 185, goalWeight: +$('pGoal').value || 165, startDate: $('pStartDate').value || today(),
      paceLbPerWeek: +$('pPace').value || 1,
      gymDays: [...$('pDays').querySelectorAll('button.on')].map(b => +b.dataset.d), updatedAt: Date.now()
    });
    saveState(); renderSettings(); render(); toast('Profile saved');
  };
  function readKeys() {
    Object.assign(settings, {
      anthropicKey: $('sAnthKey').value.trim(), model: $('sModel').value.trim() || 'claude-sonnet-5-5',
      ghRepo: $('sRepo').value.trim(), ghToken: $('sGhToken').value.trim(),
      azureKey: $('sAzKey').value.trim(), azureRegion: $('sAzRegion').value.trim(), voice: $('sVoice').value
    });
    saveSettings();
  }
  $('saveKeys').onclick = () => { readKeys(); toast('Saved'); doSync(true); };
  $('testVoice').onclick = () => { readKeys(); const was = settings.voiceOn; settings.voiceOn = true; say(`Hi ${state.profile.name}, I'm ${state.profile.coachName}. Let's lose those twenty pounds together.`, true); settings.voiceOn = was; };
  $('exportBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' }));
    a.download = 'lose20-' + today() + '.json'; a.click();
  };
  $('importInput').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { state = Coach.mergeState(state, JSON.parse(await f.text())); saveState(); render(); toast('Imported'); }
    catch (err) { toast('Import failed: ' + err.message); }
  };
  $('syncBtn').onclick = () => doSync(true);

  // ---------- desk mode (Windows check-in window) ----------
  function renderDesk() {
    let box = document.querySelector('.desk-summary');
    if (!box) {
      box = document.createElement('div'); box.className = 'desk-summary';
      const coach = $('tab-coach'), left = document.createElement('div'), right = document.createElement('div');
      left.appendChild(coach.querySelector('.coach-top')); left.appendChild(box);
      right.appendChild($('chat')); right.appendChild(coach.querySelector('.chat-input'));
      coach.appendChild(left); coach.appendChild(right);
    }
    const li = x => `<li class="s${x.sev}"><b>${escapeHtml(x.title)}</b><small>${escapeHtml(x.detail)}</small></li>`;
    box.innerHTML = `<div class="card stats"><div><span class="label">Trend</span><b>${A.nowLb.toFixed(1)}</b><small>lb</small></div>
      <div><span class="label">Lost</span><b>${Math.max(0, A.lost).toFixed(1)}</b><small>lb</small></div>
      <div><span class="label">Today</span><b>${Math.round(A.todayTotals.kcal)}</b><small>of ${A.targets.kcal} kcal</small></div>
      <div class="progress"><div style="width:${A.pct}%"></div></div></div>
      <div class="card"><h3>Going wrong</h3><ul class="verdicts bad">${A.problems.slice(0, 4).map(li).join('') || '<li><small>Nothing flagged.</small></li>'}</ul></div>
      <div class="card"><h3>Going right</h3><ul class="verdicts good">${A.wins.slice(0, 4).map(li).join('') || '<li><small>Log a few days first.</small></li>'}</ul></div>`;
  }

  // ---------- boot ----------
  // One-time setup link: index.html#setup&key=...&repo=...&gh=...&az=...&region=...
  // The part after # never leaves the phone (browsers don't send it to the server).
  // Keys are saved to this browser, then wiped from the address bar.
  function applySetup() {
    if (!location.hash.startsWith('#setup')) return;
    const h = new URLSearchParams(location.hash.slice(1));
    const map = { key: 'anthropicKey', repo: 'ghRepo', gh: 'ghToken', az: 'azureKey', region: 'azureRegion' };
    Object.entries(map).forEach(([k, s]) => { if (h.get(k)) settings[s] = h.get(k); });
    saveSettings();
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => toast('Keys saved on this device'), 500);
  }
  applySetup();
  window.addEventListener('hashchange', applySetup);
  if (!localStorage.getItem(SKEY)) saveState();
  $('voiceOn').checked = !!settings.voiceOn;
  if (DESK) document.body.classList.add('desk');
  render();
  if (DESK) {
    go('coach');
    const opener = params.get('msg');
    if (opener) { addMsg('her', opener); chatHistory.push({ role: 'user', content: 'Check in with me.' }, { role: 'assistant', content: opener }); }
    else addMsg('her', greeting());
  }
  doSync();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { doSync(); render(); } });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');

  // ---------- auto-update ----------
  // version.json is published with every release. The first fetch records the running
  // version; a later fetch that differs means a new release is live, so reload into it.
  let loadedVersion = null, pendingUpdate = null;
  function safeToReload() {
    return !pendingMeal && !rec && !$('chatInput').value && !$('wInput').value &&
      !document.querySelector('#tab-settings.active') && !document.querySelector('.msg.typing');
  }
  async function applyUpdate(v) {
    if (!safeToReload()) { pendingUpdate = v; return; }
    try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) {}
    sessionStorage.setItem('lose20.updatedTo', v);
    location.reload();
  }
  async function checkUpdate() {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const v = (await r.json()).version;
      if (!loadedVersion) { loadedVersion = v; $('appVersion').textContent = 'Version ' + v; return; }
      if (v !== loadedVersion) applyUpdate(v);
    } catch (e) { /* offline: try again later */ }
  }
  const updated = sessionStorage.getItem('lose20.updatedTo');
  if (updated) { sessionStorage.removeItem('lose20.updatedTo'); setTimeout(() => toast('Updated to version ' + updated), 800); }
  checkUpdate();
  setInterval(() => pendingUpdate ? applyUpdate(pendingUpdate) : checkUpdate(), 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pendingUpdate ? applyUpdate(pendingUpdate) : checkUpdate(); });
  document.addEventListener('click', () => { if (pendingUpdate) setTimeout(() => applyUpdate(pendingUpdate), 1500); });
})();
