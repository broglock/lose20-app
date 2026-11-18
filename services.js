/* External services: Claude (meal analysis, coach chat), Azure neural voice,
   GitHub private-repo sync, local photo store. */
(function (root) {
  'use strict';

  // ---------------- Claude ----------------
  const MEAL_PROMPT = `You are a nutrition analyst. Look at this meal photo{{NOTE}} and estimate what is on the plate and the portion sizes.
Return ONLY a JSON object, no other text, with these fields:
{"name": short meal name,
 "items": [{"food": string, "portion": string, "kcal": number, "color": "green" | "yellow" | "red"}],
 "kcal": total calories (number),
 "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number,
 "health_score": 1-10 for someone aged 60 losing weight while lifting weights (10 = lean protein, vegetables, whole foods, sensible portion),
 "verdict": one short sentence on how this meal fits a weight-loss day,
 "swap_tip": one specific, practical change that would make this meal better for losing weight,
 "light": "green" | "yellow" | "red" for the whole meal: green = low calorie density, lean protein, vegetables, sensible portion; yellow = okay in moderation; red = calorie dense, fried, sugary, or a portion over about 900 kcal,
 "confidence": "low" | "medium" | "high"}
If oils, sauces or dressings are likely, include them as items. Round calories to the nearest 10.`;

  const TEXT_PROMPT = `You are a nutrition analyst. Estimate the nutrition for this meal description: "{{TEXT}}".
Return ONLY a JSON object with the same fields as: {"name","items":[{"food","portion","kcal","color":"green|yellow|red by calorie density"}],"kcal","protein_g","carbs_g","fat_g","fiber_g","health_score" (1-10 for a 60-year-old losing weight while lifting),"verdict","swap_tip","light":"green|yellow|red for the whole meal","confidence"}.`;

  function extractJson(text) {
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b < 0) throw new Error('Claude did not return JSON');
    return JSON.parse(text.slice(a, b + 1));
  }

  // Usage reporting: every Claude call and every Azure voice clip is reported to listeners (the app logs them).
  const usageListeners = [];
  function onUsage(f) { usageListeners.push(f); }
  function report(u) { usageListeners.forEach(f => { try { f(u); } catch (e) { /* ignore */ } }); }
  function reportClaude(kind, model, j) {
    const u = j.usage || {};
    report({ service: 'claude', kind, model, input: u.input_tokens || 0, output: u.output_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 });
  }

  async function claudeRaw(settings, body, kind) {
    if (!settings.anthropicKey) throw new Error('Add your Claude API key in Settings.');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': settings.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(Object.assign({ model: settings.model || 'claude-sonnet-5-5', max_tokens: 4000 }, body))
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || ('Claude API error ' + r.status));
    reportClaude(kind || 'other', settings.model || 'claude-sonnet-5-5', j);
    return j;
  }

  async function claude(settings, messages, system, maxTokens, kind) {
    const j = await claudeRaw(settings, { max_tokens: maxTokens || 4000, system, messages }, kind);
    const text = j.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    if (!text) throw new Error('Claude returned no text (stop reason: ' + j.stop_reason + '). Try again.');
    return text;
  }

  async function analyzeMealPhoto(settings, base64Jpeg, note) {
    const prompt = MEAL_PROMPT.replace('{{NOTE}}', note ? ` (the user says: "${note}")` : '');
    const text = await claude(settings, [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Jpeg } },
      { type: 'text', text: prompt }
    ] }], undefined, undefined, 'meal photo');
    return extractJson(text);
  }

  async function analyzeMealText(settings, description) {
    const text = await claude(settings, [{ role: 'user', content: TEXT_PROMPT.replace('{{TEXT}}', description.replace(/"/g, "'")) }], undefined, undefined, 'meal text');
    return extractJson(text);
  }

  function coachSystem(profile, summary, desk) {
    return `You are ${profile.coachName}, a warm, upbeat, quick-witted personal fitness and nutrition coach. You are coaching ${profile.name}, who is trying to lose 20 lb.${profile.coachRole && profile.coachRole !== 'Fitness coach' ? `
Your day job is ${profile.coachRole.toLowerCase()}, and it colours how you talk: ${profile.coachStyle || ''} Keep the job flavour light, one touch per reply at most.` : ''}
He lifts weights and runs 5 km three times a week. Your style: encouraging but direct, a bit playful, never preachy, never shaming. Call out what is going wrong plainly and give one concrete fix.
Base advice on evidence: daily food logging, daily weigh-ins watching the trend, a consistent eating pattern on weekdays and weekends, breakfast, high protein (1.2-1.6 g/kg) to keep muscle at his age, vegetables and fiber for volume, limited liquid calories and alcohol, home cooking.
Do not recommend crash diets, skipping meals, or going below the calorie target by large amounts. If he mentions chest pain, dizziness or other medical symptoms, tell him to see a doctor.
Your replies are spoken aloud, so keep them to 2-4 short sentences, conversational, no lists, no markdown, no emoji.${desk ? ' You are on his Windows PC as a daily check-in, so nudge him to log meals and stay on track.' : ''}

His current data:
${summary}`;
  }

  async function coachReply(settings, profile, summary, history, desk) {
    const msgs = history.slice(-12);
    while (msgs.length && msgs[0].role !== 'user') msgs.shift();   // API needs a user turn first
    return claude(settings, msgs, coachSystem(profile, summary, desk), 2000, 'report card');
  }

  // Meal ideas with full recipes, sized to his targets. One request per recipe, run in parallel, each
  // at low effort with no up-front thinking, so the first recipes show up in seconds.
  const SHARE = { breakfast: 0.22, lunch: 0.30, dinner: 0.33, snack: 0.10 };
  const STYLES = ['Mediterranean', 'Mexican', 'East Asian', 'classic North American', 'Italian', 'Middle Eastern', 'Indian', 'Greek', 'Japanese', 'Thai', 'Cajun', 'French bistro'];
  const MAINS = { breakfast: ['eggs', 'Greek yogurt', 'cottage cheese', 'oats with protein powder', 'smoked turkey', 'egg whites'],
    lunch: ['chicken breast', 'turkey', 'lean beef', 'shrimp', 'lentils and beans', 'pork tenderloin', 'salmon'],
    dinner: ['chicken thighs', 'lean beef', 'pork tenderloin', 'shrimp', 'white fish', 'turkey', 'salmon', 'beans and lentils'],
    snack: ['Greek yogurt', 'cottage cheese', 'edamame', 'jerky', 'eggs', 'hummus'] };
  async function planOne(settings, o, slot, style, main) {
    const kcal = Math.round(o.kcal * SHARE[slot] / 10) * 10;
    const prompt = `Write one healthy ${slot} recipe, ${style} style, built around ${main}, for a ${o.age}-year-old ${o.sex} losing weight while lifting weights. Aim for about ${kcal} kcal and at least ${Math.round(o.protein * SHARE[slot])} g protein per serving, plenty of vegetables or fiber, simple home cooking, common supermarket ingredients, 30 minutes or less if possible.
${o.notes ? 'His preferences: ' + o.notes + '\n' : ''}${o.excludeIngredients && o.excludeIngredients.length ? 'Never use these ingredients (or anything made from them): ' + o.excludeIngredients.join(', ') + '\n' : ''}${o.excludeMeals && o.excludeMeals.length ? 'He dislikes these dishes, so suggest nothing like them: ' + o.excludeMeals.join('; ') + '\n' : ''}${o.avoid && o.avoid.length ? 'Do not repeat: ' + o.avoid.join('; ') + '\n' : ''}Return ONLY a JSON object: {"title":string,"slot":"${slot}","servings":number,"time_min":number,"kcal":number per serving,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number,"why":"one short sentence on why it helps him","ingredients":[{"item":string,"qty":string for all servings,"aisle":"Produce|Meat & fish|Dairy & eggs|Bakery|Pantry|Frozen|Other"}],"steps":[string, 3-7 short steps]}`;
    const j = await claudeRaw(settings, { max_tokens: 4000, messages: [{ role: 'user', content: prompt }], output_config: { effort: 'low' }, thinking: { type: 'between_tools' } }, 'recipes');
    const text = j.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    return extractJson(text);
  }
  async function planMeals(settings, o, onRecipe) {
    const jobs = [];
    const shuffle = a => a.slice().sort(() => Math.random() - 0.5);
    const styles = shuffle(STYLES), banned = (o.excludeIngredients || []).map(x => x.toLowerCase());
    const mains = {}; Object.keys(MAINS).forEach(k => { const ok = MAINS[k].filter(m => !banned.some(b => m.includes(b) || b.includes(m))); mains[k] = shuffle(ok.length ? ok : MAINS[k]); });
    const used = {};
    for (let i = 0; i < o.count; i++) {
      const slot = o.slots[i % o.slots.length], n = used[slot] = (used[slot] || 0) + 1;
      const args = [settings, o, slot, styles[i % styles.length], mains[slot][(n - 1) % mains[slot].length]];
      jobs.push(planOne(...args).catch(() => planOne(...args))     // one retry if a request fails
        .then(r => { if (onRecipe) onRecipe(r); return r; }, e => ({ error: e.message })));
    }
    const all = await Promise.all(jobs);
    const ok = all.filter(r => r && !r.error);
    if (!ok.length) throw new Error((all[0] && all[0].error) || 'No recipes came back. Try again.');
    return ok;
  }

  // Chat with tools: Maya can add, change and delete log entries when asked.
  // exec(name, input) runs a tool in the app and returns a result object.
  async function coachAct(settings, profile, summary, history, desk, tools, exec, context) {
    const msgs = history.slice(-12).map(m => ({ role: m.role, content: m.content }));
    while (msgs.length && msgs[0].role !== 'user') msgs.shift();
    const system = coachSystem(profile, summary, desk) + '\n\n' + context;
    const actions = [];
    for (let turn = 0; turn < 6; turn++) {
      const j = await claudeRaw(settings, { system, messages: msgs, tools, max_tokens: 3000, output_config: { effort: 'medium' } }, 'chat');
      const uses = j.content.filter(c => c.type === 'tool_use');
      if (j.stop_reason !== 'tool_use' || !uses.length) {
        const text = j.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
        if (!text && !actions.length) throw new Error('Claude returned no text (stop reason: ' + j.stop_reason + '). Try again.');
        return { text: text || 'Done.', actions };
      }
      msgs.push({ role: 'assistant', content: j.content.filter(c => !(c.type === 'text' && !c.text.trim())) });
      const results = [];
      for (const u of uses) {
        let out;
        try { out = await exec(u.name, u.input || {}); if (out && out.action) actions.push(out.action); }
        catch (e) { out = { error: e.message }; }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out && out.result !== undefined ? out.result : out) });
      }
      msgs.push({ role: 'user', content: results });
    }
    return { text: 'Done.', actions };
  }

  // ---------------- Voice (Azure neural) ----------------
  let audioEl = null, gen = 0, speaking = false, warnedNoVoice = false;
  const speakListeners = [];
  function setSpeaking(v) { if (speaking !== v) { speaking = v; speakListeners.forEach(f => f(v)); } }
  function esc(s) { return s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])); }

  async function speak(settings, text, onStart, onEnd, onAudio) {
    if (!settings.voiceOn) { onEnd && onEnd(); return; }
    stopSpeaking();
    const my = gen;
    const start = onStart, end = onEnd;
    onStart = () => { setSpeaking(true); start && start(); };
    onEnd = () => { if (my === gen) setSpeaking(false); end && end(); };
    if (settings.azureKey && settings.azureRegion) {
      try {
        const voice = settings.voice || 'en-US-AvaMultilingualNeural';
        const ssml = `<speak version="1.0" xml:lang="en-US"><voice name="${voice}"><prosody rate="${settings.voiceRate || '0%'}">${esc(text)}</prosody></voice></speak>`;
        const r = await fetch(`https://${settings.azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
          method: 'POST',
          headers: { 'Ocp-Apim-Subscription-Key': settings.azureKey, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3' },
          body: ssml
        });
        if (!r.ok) throw new Error('Azure speech error ' + r.status);
        report({ service: 'azure', kind: 'voice', model: voice, chars: text.length });
        const blob = await r.blob();
        if (my !== gen) { end && end(); return; }          // stopped or muted while the voice was downloading
        audioEl = new Audio(URL.createObjectURL(blob));
        if (onAudio) onAudio(audioEl);
        audioEl.onplay = () => onStart && onStart();
        audioEl.onended = audioEl.onerror = () => onEnd && onEnd();
        await audioEl.play();
        return;
      } catch (e) {
        if (my !== gen) { end && end(); return; } console.warn('Azure voice failed, using device voice', e); }
    }
    // The robotic device voice is off unless chosen in Settings: no Azure voice means Maya stays quiet.
    if (!settings.deviceVoice) {
      if (!settings.azureKey && !warnedNoVoice) { warnedNoVoice = true; root.dispatchEvent && root.dispatchEvent(new CustomEvent('maya-novoice')); }
      onEnd && onEnd(); return;
    }
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      const v = speechSynthesis.getVoices().find(v => /female|zira|aria|jenny|samantha|google us english/i.test(v.name));
      if (v) u.voice = v;
      u.onstart = () => onStart && onStart();
      u.onend = () => onEnd && onEnd();
      speechSynthesis.speak(u);
    } else onEnd && onEnd();
  }
  function stopSpeaking() {
    gen++;
    if (audioEl) { audioEl.pause(); audioEl = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    setSpeaking(false);
  }
  function onSpeaking(f) { speakListeners.push(f); }
  function isSpeaking() { return speaking; }

  // Speech-to-text for talking to the coach (Chrome on Android, Edge on Windows).
  function listen(onText, onDone) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Voice input is not supported in this browser.'); onDone && onDone(); return null; }
    const rec = new SR();
    rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = e => onText(e.results[0][0].transcript);
    rec.onend = () => onDone && onDone();
    rec.onerror = () => onDone && onDone();
    rec.start();
    return rec;
  }

  // ---------------- GitHub sync ----------------
  function b64encode(str) { const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b)); return btoa(bin); }
  function b64decode(b64) { const bin = atob(b64.replace(/\n/g, '')); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }

  function ghUrl(s) { return `https://api.github.com/repos/${s.ghRepo}/contents/${s.ghPath || 'data.json'}`; }
  function ghHeaders(s) { return { Authorization: 'Bearer ' + s.ghToken, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; }

  async function ghPull(s) {
    const r = await fetch(ghUrl(s) + '?t=' + Date.now(), { headers: ghHeaders(s), cache: 'no-store' });
    if (r.status === 404) return { data: null, sha: null };
    if (!r.ok) throw new Error('GitHub read failed: ' + r.status);
    const j = await r.json();
    return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
  }
  async function ghPush(s, data, sha) {
    const body = { message: 'lose20 sync ' + new Date().toISOString(), content: b64encode(JSON.stringify(data, null, 1)) };
    if (sha) body.sha = sha;
    const r = await fetch(ghUrl(s), { method: 'PUT', headers: ghHeaders(s), body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) return false;  // someone else wrote first
    if (!r.ok) throw new Error('GitHub write failed: ' + r.status);
    return true;
  }
  // Pull, merge, push; retries if the other device wrote in between.
  async function sync(s, local) {
    if (!s.ghToken || !s.ghRepo) throw new Error('Set the GitHub repo and token in Settings.');
    for (let i = 0; i < 3; i++) {
      const { data, sha } = await ghPull(s);
      const merged = Coach.mergeState(local, data);
      const same = data && JSON.stringify(data) === JSON.stringify(merged);
      if (same || await ghPush(s, merged, sha)) return merged;
    }
    throw new Error('Sync conflict, try again.');
  }

  // ---------------- Photo thumbnails (IndexedDB, phone only, not synced) ----------------
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('lose20', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('thumbs');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function putThumb(id, dataUrl) { const db = await idb(); return new Promise(r => { const t = db.transaction('thumbs', 'readwrite'); t.objectStore('thumbs').put(dataUrl, id); t.oncomplete = r; }); }
  async function getThumb(id) { const db = await idb(); return new Promise(r => { const q = db.transaction('thumbs').objectStore('thumbs').get(id); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); }

  // Resize a photo to a JPEG of at most maxPx on its long side.
  function resizeImage(file, maxPx, quality) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxPx / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', quality || 0.8));
        URL.revokeObjectURL(img.src);
      };
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }

  root.Services = { analyzeMealPhoto, analyzeMealText, coachReply, coachAct, planMeals, onUsage, speak, stopSpeaking, onSpeaking, isSpeaking, listen, sync, ghPull, putThumb, getThumb, resizeImage };
})(self);
