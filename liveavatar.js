/* Live Maya: Azure AI Speech photorealistic talking avatar over WebRTC.
   - Connects only when she has something to say, and closes after 45 s of silence (billing is per minute).
   - A daily minutes cap protects the bill; past it, the app falls back to voice only.
   - The video element moves to whichever screen is showing (Today, Maya, meal result).
   - A still frame from the first live session is saved on this device and shown when she is quiet. */
(function (root) {
  'use strict';
  const IDLE_CLOSE_MS = 45000;
  const USAGE_KEY = 'lose20.avatarUsage', POSTER_KEY = 'lose20.poster';
  let pc = null, synth = null, connecting = null, idleTimer = null, connectedAt = 0, speakingCount = 0;
  let host = null, settingsRef = null;
  const wrap = document.createElement('div'); wrap.className = 'live-wrap';
  const video = document.createElement('video'); video.autoplay = true; video.playsInline = true; video.muted = true; video.className = 'live-video';
  const audio = document.createElement('audio'); audio.autoplay = true;
  const badge = document.createElement('span'); badge.className = 'live-badge'; badge.textContent = '● LIVE';
  wrap.appendChild(video); wrap.appendChild(badge); document.body.appendChild(audio);

  // ---- usage cap ----
  function usage() { try { const u = JSON.parse(localStorage.getItem(USAGE_KEY)); return u && u.day === new Date().toDateString() ? u : { day: new Date().toDateString(), sec: 0 }; } catch (e) { return { day: new Date().toDateString(), sec: 0 }; } }
  function addUsage(sec) { const u = usage(); u.sec += sec; localStorage.setItem(USAGE_KEY, JSON.stringify(u)); }
  function minutesToday() { return Math.round(usage().sec / 6) / 10; }
  function available(s) {
    return !!(s && s.avatarOn !== false && s.azureKey && s.azureRegion && root.SpeechSDK && root.RTCPeerConnection &&
      usage().sec / 60 < (s.avatarCapMin || 10));
  }

  // ---- poster frame ----
  function poster() { return localStorage.getItem(POSTER_KEY); }
  function capturePoster() {
    if (poster() || !video.videoWidth) return;
    const c = document.createElement('canvas'); c.width = 360; c.height = Math.round(360 * video.videoHeight / video.videoWidth);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    try { localStorage.setItem(POSTER_KEY, c.toDataURL('image/jpeg', 0.82)); root.dispatchEvent(new Event('lose20-poster')); } catch (e) {}
  }

  // ---- connection ----
  async function relayToken(s) {
    const r = await fetch(`https://${s.azureRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`, { headers: { 'Ocp-Apim-Subscription-Key': s.azureKey } });
    if (!r.ok) throw new Error(r.status === 401 ? 'Azure key rejected' : r.status === 404 ? `Avatars are not available in region ${s.azureRegion}` : 'Avatar relay error ' + r.status);
    return r.json();
  }
  async function connect(s) {
    if (synth) return;
    if (connecting) return connecting;
    connecting = (async () => {
      const SDK = root.SpeechSDK;
      const tok = await relayToken(s);
      pc = new RTCPeerConnection({ iceServers: [{ urls: tok.Urls, username: tok.Username, credential: tok.Password }] });
      pc.ontrack = ev => {
        if (ev.track.kind === 'video') { video.srcObject = ev.streams[0]; video.play().catch(() => {}); video.onplaying = () => { wrap.classList.add('on'); setTimeout(capturePoster, 1500); }; }
        else { audio.srcObject = ev.streams[0]; audio.play().catch(() => {}); }
      };
      pc.addTransceiver('video', { direction: 'sendrecv' });
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      const sc = SDK.SpeechConfig.fromSubscription(s.azureKey, s.azureRegion);
      sc.speechSynthesisVoiceName = (s.voice || 'en-US-AvaMultilingualNeural').replace(/:DragonHD.*$/, 'MultilingualNeural');
      const fmt = new SDK.AvatarVideoFormat();
      fmt.setCropRange(new SDK.Coordinate(600, 0), new SDK.Coordinate(1320, 1080));   // portrait crop
      const ac = new SDK.AvatarConfig(s.avatarCharacter || 'meg', s.avatarStyle || 'casual', fmt);
      ac.backgroundColor = '#D6F2E6FF';
      synth = new SDK.AvatarSynthesizer(sc, ac);
      const res = await synth.startAvatarAsync(pc);
      if (res.reason !== SDK.ResultReason.SynthesizingAudioCompleted) {
        const why = res.errorDetails || 'reason ' + res.reason; close(); throw new Error('Avatar did not start: ' + why);
      }
      connectedAt = Date.now();
    })();
    try { await connecting; } finally { connecting = null; }
  }
  function close() {
    if (connectedAt) addUsage((Date.now() - connectedAt) / 1000);
    connectedAt = 0; clearTimeout(idleTimer);
    try { synth && synth.close(); } catch (e) {}
    try { pc && pc.close(); } catch (e) {}
    synth = null; pc = null; wrap.classList.remove('on', 'talking'); video.srcObject = null;
  }
  function scheduleClose() { clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!speakingCount) close(); }, IDLE_CLOSE_MS); }

  const esc = t => t.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

  // Speak a line with the live avatar. Resolves false if the avatar can't be used, so the caller can fall back.
  async function speak(s, text, el) {
    settingsRef = s;
    if (!available(s)) return false;
    if (el) attach(el);
    try {
      await connect(s);
      clearTimeout(idleTimer);
      speakingCount++; wrap.classList.add('talking');
      const voice = (s.voice || 'en-US-AvaMultilingualNeural').replace(/:DragonHD.*$/, 'MultilingualNeural');
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${voice}"><mstts:leadingsilence-exact value="0"/>${esc(text)}</voice></speak>`;
      const p = synth.speakSsmlAsync(ssml);
      p.then(() => {}).catch(() => {}).finally(() => { speakingCount = Math.max(0, speakingCount - 1); if (!speakingCount) wrap.classList.remove('talking'); scheduleClose(); });
      return true;
    } catch (e) {
      console.warn('Live avatar unavailable:', e.message);
      root.dispatchEvent(new CustomEvent('lose20-avatar-error', { detail: e.message }));
      close(); return false;
    }
  }
  async function stop() { try { synth && await synth.stopSpeakingAsync(); } catch (e) {} speakingCount = 0; wrap.classList.remove('talking'); scheduleClose(); }

  // Put the live video (or the still) into a screen's avatar box.
  function attach(el) { if (el && wrap.parentNode !== el) { el.appendChild(wrap); host = el; if (!video.paused || video.srcObject) video.play().catch(() => {}); } }

  // Prepare an avatar box: a still photo when one exists, otherwise a placeholder.
  function decorate(el) {
    el.classList.add('live-box');
    let img = el.querySelector('img.poster');
    if (!img) { img = document.createElement('img'); img.className = 'poster'; img.alt = 'Maya'; el.insertBefore(img, el.firstChild); }
    const p = poster();
    if (p) { img.src = p; el.classList.add('has-poster'); } else { img.removeAttribute('src'); el.classList.remove('has-poster'); }
  }

  addEventListener('pagehide', close);
  document.addEventListener('visibilitychange', () => { if (document.hidden) close(); });

  root.LiveMaya = { speak, stop, close, attach, decorate, available, minutesToday, poster, isLive: () => !!synth };
})(self);
