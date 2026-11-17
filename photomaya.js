/* Photo Maya: a realistic portrait animated with a WebGL warp.
   Every frame the shader moves the jaw by a continuous amount, narrows or widens the lips, paints the
   mouth interior, and fades a blink in and out. Speech drives it from the voice audio:
   loudness -> jaw (fast attack, slower release), spectral centroid -> lip shape (oo = narrow, ee = wide),
   onsets -> small head nods. Idle: breathing, sway, glances, blinks.
   Same interface as the cartoon avatar (setMood, pose, talk, mouth), so the app doesn't care which is used. */
(function (root) {
  'use strict';
  const BASE = 'maya/';
  let assets = null, loading = null;

  // Landmarks for the 640 px frames (portrait B), in source pixels.
  const LM = { jx0: 268.8, jx1: 440.6, cx: 356.5, halfW: 40, teeth: 262.0, lip: 263.0, chin: 307.5, neck: 350 };
  const MAX_JAW = 6.2, MAX_WIDE = 2.6;

  function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
  function load() {
    if (loading) return loading;
    loading = Promise.all([fetch(BASE + 'maya-frames.json').then(r => r.json()), loadImg(BASE + 'maya-base.jpg'), loadImg(BASE + 'maya-blink.jpg')])
      .then(([meta, base, blink]) => { assets = { meta, base, blink }; });
    return loading;
  }

  const VS = `attribute vec2 a;varying vec2 v;void main(){v=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}`;
  const FS = `precision mediump float;
uniform sampler2D uBase,uBlink;uniform vec2 uSize;uniform vec4 uCrop;uniform float uJaw,uWide,uBlinkAmt;
uniform vec4 uM1;uniform vec4 uM2;uniform vec4 uEye;varying vec2 v;
float ss(float a,float b,float x){return smoothstep(a,b,x);}
void main(){
  vec2 p=uCrop.xy+v*uCrop.zw;
  float t=clamp((p.x-uM1.x)/(uM1.y-uM1.x),0.,1.);
  float u=clamp((p.x-uM1.z)/uM1.w,-1.2,1.2);
  float tl=uM2.x-15.*u*u;
  float hx=pow(max(sin(3.14159*t),0.),1.5);
  float hy=ss(tl,tl+1.5,p.y)*(1.-ss(uM2.z,uM2.w,p.y));
  float dy=uJaw*hx*hy;
  vec2 mc=vec2(uM1.z,(uM2.x+uM2.y)*.5);
  vec2 q=(p-mc)/vec2(uM1.w*1.45,16.);
  float g=exp(-dot(q,q));
  float dx=uWide*((p.x-mc.x)/uM1.w)*g;
  vec2 src=vec2(p.x-dx,p.y-dy);
  vec3 col=texture2D(uBase,src/uSize).rgb;
  float hw=uM1.w*.95+uWide*.6;
  float e=1.-pow((p.x-mc.x)/hw,2.);
  float gap=ss(-.5,.7,p.y-tl)*(1.-ss(-.9,.5,src.y-tl))*ss(0.,.35,e);
  vec3 cav=mix(vec3(.55,.30,.30),vec3(.30,.12,.13),clamp((p.y-tl)/max(dy,1.),0.,1.));
  col=mix(col,cav,gap*ss(.4,1.4,uJaw));
  vec2 eq=(p-(uEye.xy+uEye.zw*.5))/(uEye.zw*.5);
  float em=(1.-ss(.7,1.,abs(eq.x)))*(1.-ss(.6,1.,abs(eq.y)));
  col=mix(col,texture2D(uBlink,p/uSize).rgb,em*uBlinkAmt);
  gl_FragColor=vec4(col,1.);
}`;

  const POSE = {
    idle: {}, wave: { motion: 'nod', emoji: '👋' }, cheer: { motion: 'bounce', emoji: '🎉' },
    thumbs: { motion: 'nod', emoji: '👍' }, flex: { motion: 'bounce', emoji: '💪' }, warn: { motion: 'shake', emoji: '⚠️' },
    think: { motion: 'lean', emoji: '🤔' }, hips: { motion: 'shake', emoji: '😤' }
  };

  const CSS = `
.pmaya{position:relative;overflow:hidden;border:2.5px solid #2b2622;border-radius:18px;background:#b8e3d3;box-shadow:3px 3px 0 #2b2622;transition:box-shadow .4s}
.pmaya canvas{width:100%;height:100%;display:block;transform-origin:50% 92%;will-change:transform}
.pmaya .pm-emoji{position:absolute;right:6px;top:6px;font-size:34px;filter:drop-shadow(1px 2px 0 rgba(0,0,0,.25));transform:scale(0);pointer-events:none}
.pmaya .pm-emoji.pop{animation:pmPop 1.8s ease forwards}
@keyframes pmPop{0%{transform:scale(0) rotate(-20deg)}15%{transform:scale(1.25) rotate(8deg)}25%{transform:scale(1) rotate(0)}80%{transform:scale(1);opacity:1}100%{transform:scale(.6);opacity:0}}
.pmaya.mood-cheer,.pmaya.mood-proud{box-shadow:3px 3px 0 #2b2622,0 0 0 4px #0ca30c,0 0 22px 6px rgba(12,163,12,.45)}
.pmaya.mood-concerned,.pmaya.mood-alarmed{box-shadow:3px 3px 0 #2b2622,0 0 0 4px #d03b3b,0 0 22px 6px rgba(208,59,59,.45)}
.pmaya.mood-determined{box-shadow:3px 3px 0 #2b2622,0 0 0 4px #f6c445,0 0 18px 4px rgba(246,196,69,.5)}`;
  function css() { if (!document.getElementById('pmaya-css')) { const s = document.createElement('style'); s.id = 'pmaya-css'; s.textContent = CSS; document.head.appendChild(s); } }

  function initGL(cv) {
    const gl = cv.getContext('webgl', { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = (img, unit) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img); return t; };
    tex(assets.base, 0); tex(assets.blink, 1);
    const U = n => gl.getUniformLocation(pr, n);
    const u = { base: U('uBase'), blink: U('uBlink'), size: U('uSize'), crop: U('uCrop'), jaw: U('uJaw'), wide: U('uWide'), bl: U('uBlinkAmt'), m1: U('uM1'), m2: U('uM2'), eye: U('uEye') };
    gl.uniform1i(u.base, 0); gl.uniform1i(u.blink, 1);
    const S = assets.meta.size;
    gl.uniform2f(u.size, S, S);
    gl.uniform4f(u.m1, LM.jx0, LM.jx1, LM.cx, LM.halfW);
    gl.uniform4f(u.m2, LM.teeth, LM.lip, LM.chin, LM.neck);
    const e = assets.meta.eyes; gl.uniform4f(u.eye, e[0], e[1], e[2], e[3]);
    return { gl, u };
  }

  function create(el) {
    css();
    el.innerHTML = ''; el.classList.add('pmaya');
    const cv = document.createElement('canvas');
    const emoji = document.createElement('span'); emoji.className = 'pm-emoji';
    el.append(cv, emoji);

    let G = null, raf = 0, visible = true;
    // speech state
    let talking = false, external = false, level = 0, centroid = 0.5, lastLevel = 0;
    let jaw = 0, wide = 0, nod = 0, nodV = 0;
    // idle state
    let blinkT = -1, nextBlink = performance.now() + 1200 + Math.random() * 2500, look = 0, lookTarget = 0, nextLook = 0;
    let motion = null, motionStart = 0;

    function size() {
      const r = el.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      if (!r.width) return false;
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
      if (G) G.gl.viewport(0, 0, cv.width, cv.height);
      return true;
    }
    function crop() {
      const S = assets.meta.size, W = cv.width, H = cv.height;
      let sw = S * 0.6, sh = sw * H / W; if (sh > S) { sh = S; sw = S * W / H; }
      const f = assets.meta.face, cx = (f[0] + f[2]) / 2 + S * 0.02, cy = (f[1] + f[3]) / 2 + sh * 0.12;
      return [Math.max(0, Math.min(S - sw, cx - sw / 2)), Math.max(0, Math.min(S - sh, cy - sh / 2)), sw, sh];
    }
    // Speech-like envelope when there's no audio to analyse (device voice fallback).
    function synthLevel(t) {
      const syl = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 4.2 + 2 * Math.sin(t * 2 * Math.PI * 0.9));
      const phrase = 0.65 + 0.35 * Math.sin(t * 2 * Math.PI * 0.55);
      const pause = (t * 0.42 % 1) > 0.86 ? 0 : 1;
      return Math.pow(syl, 1.6) * phrase * pause;
    }
    function frame(now) {
      raf = 0;
      if (!assets || !visible || document.hidden) return;
      if (!G) { try { G = initGL(cv); } catch (e) { console.warn(e); } if (!G) return; size(); }
      const t = now / 1000;
      // --- speech drivers
      const lv = talking ? (external ? level : synthLevel(t)) : 0;
      const jawTarget = MAX_JAW * Math.min(1, Math.pow(lv, 0.8) * 1.15);
      jaw += (jawTarget - jaw) * (jawTarget > jaw ? 0.5 : 0.22);
      const wideTarget = talking ? (external ? (centroid - 0.45) * 2.2 * MAX_WIDE : Math.sin(t * 2.3) * 1.2) : 0;
      wide += (Math.max(-MAX_WIDE, Math.min(MAX_WIDE, wideTarget)) - wide) * 0.15;
      if (talking && lv - lastLevel > 0.28 && nod < 0.4) nodV += 2.2;   // emphasis nod on onsets
      lastLevel = lv;
      nodV += -nod * 0.18 - nodV * 0.22; nod += nodV * 0.12;
      // --- blink: ease in and out over ~150 ms
      if (now > nextBlink) { blinkT = now; nextBlink = now + 2400 + Math.random() * 4200; if (Math.random() < 0.15) nextBlink = now + 380; }
      const bp = blinkT < 0 ? 1 : (now - blinkT) / 150;
      const blinkAmt = bp >= 1 ? 0 : Math.sin(Math.PI * bp);
      // --- glances
      if (now > nextLook) { lookTarget = (Math.random() - 0.5) * 2; nextLook = now + 2500 + Math.random() * 4000; }
      look += (lookTarget - look) * 0.03;
      // --- head transform (CSS, cheap)
      let rot = Math.sin(t * 2 * Math.PI / 6.5) * 0.35 + look * 0.4, ty = nod * 1.6, sc = 1 + Math.sin(t * 2 * Math.PI / 4) * 0.005;
      if (motion) {
        const e = (now - motionStart) / 1000;
        if (motion === 'nod') ty += Math.sin(e * 9) * 3 * Math.exp(-e * 1.5);
        if (motion === 'shake') rot += Math.sin(e * 13) * 2.2 * Math.exp(-e * 1.2);
        if (motion === 'bounce') { ty -= Math.abs(Math.sin(e * 7)) * 6 * Math.exp(-e * 0.9); sc += 0.02 * Math.exp(-e); }
        if (motion === 'lean') { rot += 2 * Math.min(1, e * 3); sc += 0.025 * Math.min(1, e * 3); }
        if (e > 3.5 && motion !== 'lean') motion = null;
      }
      cv.style.transform = `translateY(${ty.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${sc.toFixed(4)})`;
      // --- draw
      const { gl, u } = G, c = crop();
      gl.uniform4f(u.crop, c[0], c[1], c[2], c[3]);
      gl.uniform1f(u.jaw, jaw); gl.uniform1f(u.wide, wide); gl.uniform1f(u.bl, blinkAmt);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }
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
        if (P.motion) { motion = P.motion; motionStart = performance.now(); } else if (motion === 'lean') motion = null;
        if (P.emoji) { emoji.textContent = P.emoji; emoji.classList.remove('pop'); void emoji.offsetWidth; emoji.classList.add('pop'); }
        if (ms && p !== 'idle') setTimeout(() => { if (motion === 'lean') motion = null; }, ms);
        kick();
      },
      talk(on) { talking = !!on; if (!on) { external = false; level = 0; cv.classList.remove('lipsync'); } kick(); },
      mouth(l, c) { external = true; talking = true; cv.classList.add('lipsync'); level = l; if (c != null) centroid = c; kick(); }
    };
    el._maya = inst;
    return inst;
  }

  // Lip-sync from the voice audio: loudness and spectral centroid every frame.
  let actx = null;
  function lipSync(audioEl, instances) {
    try {
      actx = actx || new (root.AudioContext || root.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const src = actx.createMediaElementSource(audioEl), an = actx.createAnalyser();
      an.fftSize = 1024; an.smoothingTimeConstant = 0.35;
      src.connect(an); an.connect(actx.destination);
      const td = new Uint8Array(an.fftSize), fd = new Uint8Array(an.frequencyBinCount);
      const hz = actx.sampleRate / an.fftSize;
      let floor = 0.02;
      const tick = () => {
        if (audioEl.paused || audioEl.ended) { instances.forEach(i => i.talk(false)); return; }
        an.getByteTimeDomainData(td); an.getByteFrequencyData(fd);
        let sum = 0; for (let i = 0; i < td.length; i++) { const v = (td[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / td.length);
        floor = Math.min(floor * 1.002 + 0.0001, rms);       // adaptive noise floor
        const lv = Math.max(0, Math.min(1, (rms - floor) * 6));
        let num = 0, den = 0;
        for (let i = 3; i < fd.length; i++) { const f = i * hz; if (f > 4500) break; num += f * fd[i]; den += fd[i]; }
        const cen = den ? Math.max(0, Math.min(1, (num / den - 500) / 1800)) : 0.5;  // ~500 Hz (oo) .. ~2300 Hz (ee)
        instances.forEach(i => i.mouth(lv, cen));
        requestAnimationFrame(tick);
      };
      instances.forEach(i => i.talk(true));
      requestAnimationFrame(tick);
      return true;
    } catch (e) { return false; }
  }

  root.PhotoMaya = { create, load, lipSync };
})(self);
