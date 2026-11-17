/* Photo Maya: a realistic portrait brought to life on a canvas.
   Frames (base, three jaw-open, blink) are made once from a single portrait by tools/make_maya_frames.py.
   At runtime: breathing and a slight sway, random blinks, jaw driven by the loudness of her voice,
   head motions for reactions (nod, shake, bounce, lean), a mood glow, and a reaction emoji.
   Same interface as the cartoon avatar, so the rest of the app doesn't care which is used. */
(function (root) {
  'use strict';
  const BASE = 'maya/';
  const NAMES = ['base', 'talk1', 'talk2', 'talk3', 'blink'];
  let frames = null, meta = null, loading = null;

  function load() {
    if (loading) return loading;
    loading = Promise.all([
      fetch(BASE + 'maya-frames.json').then(r => r.json()),
      ...NAMES.map(n => new Promise((res, rej) => { const i = new Image(); i.onload = () => res([n, i]); i.onerror = rej; i.src = BASE + 'maya-' + n + '.jpg'; }))
    ]).then(([m, ...imgs]) => { meta = m; frames = Object.fromEntries(imgs); });
    return loading;
  }

  const POSE = {  // head motion + reaction emoji
    idle: { motion: null }, wave: { motion: 'nod', emoji: '👋' }, cheer: { motion: 'bounce', emoji: '🎉' },
    thumbs: { motion: 'nod', emoji: '👍' }, flex: { motion: 'bounce', emoji: '💪' }, warn: { motion: 'shake', emoji: '⚠️' },
    think: { motion: 'lean', emoji: '🤔' }, hips: { motion: 'shake', emoji: '😤' }
  };

  const CSS = `
.pmaya{position:relative;overflow:hidden;border:2.5px solid #2b2622;border-radius:18px;background:#b8e3d3;box-shadow:3px 3px 0 #2b2622;transition:box-shadow .4s}
.pmaya canvas{width:100%;height:100%;display:block}
.pmaya .pm-emoji{position:absolute;right:6px;top:6px;font-size:34px;filter:drop-shadow(1px 2px 0 rgba(0,0,0,.25));transform:scale(0);pointer-events:none}
.pmaya .pm-emoji.pop{animation:pmPop 1.8s ease forwards}
@keyframes pmPop{0%{transform:scale(0) rotate(-20deg)}15%{transform:scale(1.25) rotate(8deg)}25%{transform:scale(1) rotate(0)}80%{transform:scale(1);opacity:1}100%{transform:scale(.6);opacity:0}}
.pmaya.mood-cheer,.pmaya.mood-proud{box-shadow:3px 3px 0 #2b2622,0 0 0 4px #0ca30c,0 0 22px 6px rgba(12,163,12,.45)}
.pmaya.mood-concerned,.pmaya.mood-alarmed{box-shadow:3px 3px 0 #2b2622,0 0 0 4px #d03b3b,0 0 22px 6px rgba(208,59,59,.45)}
.pmaya.mood-determined{box-shadow:3px 3px 0 #2b2622,0 0 0 4px #f6c445,0 0 18px 4px rgba(246,196,69,.5)}
.pmaya .pm-talk{position:absolute;left:8px;bottom:8px;display:none;gap:3px}
.pmaya.talking .pm-talk{display:flex}
.pmaya .pm-talk i{width:4px;height:12px;background:#fff;border:1px solid #2b2622;border-radius:2px;animation:pmBar .5s ease-in-out infinite alternate}
.pmaya .pm-talk i:nth-child(2){animation-delay:.15s}.pmaya .pm-talk i:nth-child(3){animation-delay:.3s}
@keyframes pmBar{from{transform:scaleY(.4)}to{transform:scaleY(1.2)}}`;

  function css() { if (!document.getElementById('pmaya-css')) { const s = document.createElement('style'); s.id = 'pmaya-css'; s.textContent = CSS; document.head.appendChild(s); } }

  function create(el) {
    css();
    el.innerHTML = '';
    el.classList.add('pmaya');
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
    const emoji = document.createElement('span'); emoji.className = 'pm-emoji';
    const bars = document.createElement('div'); bars.className = 'pm-talk'; bars.innerHTML = '<i></i><i></i><i></i>';
    el.append(cv, emoji, bars);

    let talking = false, level = 0, lipsync = false, motion = null, motionStart = 0, poseTimer = null;
    let nextBlink = performance.now() + 1500 + Math.random() * 3000, blinkUntil = 0, visible = true, raf = 0;

    function size() {
      const r = el.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      if (!r.width) return false;
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
      return true;
    }
    function frameFor() {
      if (!talking) return frames.base;
      const l = lipsync ? level : (0.5 + 0.5 * Math.sin(performance.now() / 70) * Math.sin(performance.now() / 173));
      return l < 0.12 ? frames.base : l < 0.38 ? frames.talk1 : l < 0.65 ? frames.talk2 : frames.talk3;
    }
    function draw(now) {
      raf = 0;
      if (!frames || !visible || document.hidden) return;
      if (!cv.width && !size()) { raf = requestAnimationFrame(draw); return; }
      const W = cv.width, H = cv.height, S = meta.size;
      // crop the square portrait to the box, centred on the face
      let sw = S * 0.6, sh = sw * H / W;
      if (sh > S) { sh = S; sw = S * W / H; }
      const cx = (meta.face[0] + meta.face[2]) / 2 + S * 0.02, cy = (meta.face[1] + meta.face[3]) / 2 + sh * 0.12;
      const sx = Math.max(0, Math.min(S - sw, cx - sw / 2));
      const sy = Math.max(0, Math.min(S - sh, cy - sh / 2));
      const t = now / 1000;
      let rot = Math.sin(t * 2 * Math.PI / 6.5) * 0.006, dy = 0, zoom = 1 + Math.sin(t * 2 * Math.PI / 4) * 0.006;
      if (motion) {
        const e = (now - motionStart) / 1000;
        if (motion === 'nod') dy += Math.sin(e * 9) * 6 * Math.exp(-e * 1.4);
        if (motion === 'shake') rot += Math.sin(e * 14) * 0.035 * Math.exp(-e * 1.2);
        if (motion === 'bounce') { dy -= Math.abs(Math.sin(e * 7)) * 12 * Math.exp(-e * 0.9); zoom += 0.02 * Math.exp(-e); }
        if (motion === 'lean') { rot += 0.03 * Math.min(1, e * 3); zoom += 0.03 * Math.min(1, e * 3); }
        if (e > 3.5 && motion !== 'lean') motion = null;
      }
      ctx.save();
      ctx.clearRect(0, 0, W, H);
      ctx.translate(W / 2, H * 0.92 + dy * W / 200);
      ctx.rotate(rot); ctx.scale(zoom, zoom);
      ctx.translate(-W / 2, -H * 0.92);
      ctx.drawImage(frameFor(), sx, sy, sw, sh, 0, 0, W, H);
      // blink: paste the closed-eye patch
      if (now > nextBlink) { blinkUntil = now + 120; nextBlink = now + 2200 + Math.random() * 4200; if (Math.random() < 0.15) nextBlink = now + 300; }
      if (now < blinkUntil) {
        const [ex, ey, ew, eh] = meta.eyes, k = W / sw;
        ctx.drawImage(frames.blink, ex, ey, ew, eh, (ex - sx) * k, (ey - sy) * k, ew * k, eh * k);
      }
      ctx.restore();
      raf = requestAnimationFrame(draw);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(draw); }
    load().then(() => { size(); kick(); });
    new ResizeObserver(() => { size(); kick(); }).observe(el);
    if ('IntersectionObserver' in root) new IntersectionObserver(es => { visible = es[0].isIntersecting; kick(); }).observe(el);
    document.addEventListener('visibilitychange', kick);

    const inst = {
      el, svg: cv,
      setMood(m) { el.className = el.className.replace(/\bmood-\S+/g, '').trim() + ' mood-' + m; },
      setOutfit() {},
      pose(p, ms) {
        const P = POSE[p] || POSE.idle;
        clearTimeout(poseTimer);
        if (P.motion) { motion = P.motion; motionStart = performance.now(); }
        else if (motion === 'lean') motion = null;
        if (P.emoji) { emoji.textContent = P.emoji; emoji.classList.remove('pop'); void emoji.offsetWidth; emoji.classList.add('pop'); }
        if (ms && p !== 'idle') poseTimer = setTimeout(() => { if (motion === 'lean') motion = null; }, ms);
        kick();
      },
      talk(on) { talking = !!on; el.classList.toggle('talking', talking); if (!on) { lipsync = false; level = 0; cv.classList.remove('lipsync'); } kick(); },
      mouth(l) { lipsync = true; cv.classList.add('lipsync'); level = l; talking = true; el.classList.add('talking'); kick(); }
    };
    el._maya = inst;
    return inst;
  }

  root.PhotoMaya = { create, load };
})(self);
