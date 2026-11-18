/* Photo Maya: a realistic portrait animated with a WebGL warp.
   Every frame the shader bends the photo: jaw opening and lip shape (driven by the voice),
   brows (raise, worry, furrow, one-brow), eyes (squint, widen, glance, blink, wink) and mouth corners
   (bigger smile or a frown). Expressions blend smoothly, so moods and reactions read like a real face.
   Landmarks come from maya/maya-frames.json, written by tools/make_maya_frames.py.
   Same interface as the cartoon avatar (setMood, pose, talk, mouth), so the app doesn't care which is used. */
(function (root) {
  'use strict';
  let BASE = 'maya/coaches/maya/';
  let assets = null, loading = null;
  const live = [];

  function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
  function load() {
    if (loading) return loading;
    const b = BASE;
    loading = Promise.all([fetch(b + 'frames.json').then(r => r.json()), loadImg(b + 'base.jpg'), loadImg(b + 'blink.jpg')])
      .then(([meta, base, blink]) => { if (b === BASE) assets = { meta, base, blink }; });
    return loading;
  }
  // Switch every on-screen instance to another coach's portrait.
  let current = 'maya';
  function setCoach(id) {
    if (!id || id === current) return Promise.resolve();
    current = id; BASE = 'maya/coaches/' + id + '/'; loading = null;
    return load().then(() => live.forEach(i => i._reset()));
  }

  const VS = `attribute vec2 a;varying vec2 v;void main(){v=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}`;
  const FS = `precision mediump float;
uniform sampler2D uBase,uBlink;uniform vec2 uSize;uniform vec4 uCrop;
uniform float uJaw,uWide,uBlinkL,uBlinkR;
uniform vec4 uM1,uM2,uE0,uE1,uB,uX1,uX2;
varying vec2 v;
float ss(float a,float b,float x){return smoothstep(a,b,x);}
float gs(vec2 p,vec2 c,vec2 r){vec2 q=(p-c)/r;return exp(-dot(q,q));}
vec2 brow(vec2 p,vec2 c,float dir,float raise){
  float g=gs(p,c,vec2(46.,22.));
  float inner=clamp(.5+(p.x-c.x)*dir/46.,0.,1.);
  return vec2(uX1.w*4.5*dir*g, (-raise*11.-uX1.z*10.*inner+uX1.w*6.)*g);
}
vec2 eye(vec2 p,vec4 e){
  vec2 c=e.xy;float rx=e.z,ry=e.w;
  float ge=gs(p,c,vec2(rx*1.3,ry*2.2));
  float d=uX2.y*3.4*clamp((p.y-c.y)/ry,-1.5,1.5)*ge;
  d-=uX2.x*4.5*gs(p,c+vec2(0.,ry*1.1),vec2(rx*1.1,ry*1.3));
  d-=uX2.x*3.*gs(p,c+vec2(0.,35.),vec2(40.,25.));
  float dx=uX2.w*5.*gs(p,c,vec2(ry*1.6,ry));
  return vec2(dx,d);
}
void main(){
  vec2 p=uCrop.xy+v*uCrop.zw;
  float cx=uM1.z,hw=uM1.w;
  float u=clamp((p.x-cx)/hw,-1.2,1.2);
  float tl=uM2.x-uM2.y*u*u;
  vec2 D=vec2(0.);
  float t=clamp((p.x-uM1.x)/(uM1.y-uM1.x),0.,1.);
  float hx=pow(max(sin(3.14159*t),0.),1.5);
  float hy=ss(tl,tl+1.5,p.y)*(1.-ss(uM2.z,uM2.w,p.y));
  float dy=uJaw*hx*hy;
  D.y+=dy;
  vec2 q=(p-vec2(cx,uM2.x))/vec2(hw*1.45,22.);
  D.x+=uWide*((p.x-cx)/hw)*exp(-dot(q,q));
  float corner=uX2.z;
  for(int k=0;k<2;k++){float s=k==0?-1.:1.;
    float g=gs(p,vec2(cx+s*hw*.97,uM2.x-uM2.y),vec2(26.,20.));
    D+=vec2(corner*3.5*s*g,-corner*10.*g);}
  D+=brow(p,uB.xy,1.,uX1.x);
  D+=brow(p,uB.zw,-1.,uX1.y);
  D+=eye(p,uE0);D+=eye(p,uE1);
  vec2 src=p-D;
  vec3 col=texture2D(uBase,src/uSize).rgb;
  float e=1.-pow((p.x-cx)/(hw*.95),2.);
  float gap=ss(-.5,.7,p.y-tl)*(1.-ss(-.9,.5,src.y-tl))*ss(0.,.35,e);
  vec3 cav=mix(vec3(.55,.30,.30),vec3(.30,.12,.13),clamp((p.y-tl)/max(dy,1.),0.,1.));
  col=mix(col,cav,gap*ss(.4,1.4,uJaw));
  vec3 lid=texture2D(uBlink,src/uSize).rgb;
  vec2 q0=(src-uE0.xy)/(uE0.zw*vec2(1.35,2.3)),q1=(src-uE1.xy)/(uE1.zw*vec2(1.35,2.3));
  float m0=(1.-ss(.75,1.,abs(q0.x)))*(1.-ss(.6,1.,abs(q0.y)));
  float m1=(1.-ss(.75,1.,abs(q1.x)))*(1.-ss(.6,1.,abs(q1.y)));
  col=mix(col,lid,clamp(m0*uBlinkL+m1*uBlinkR,0.,1.));
  gl_FragColor=vec4(col,1.);
}`;

  // Facial expressions. brow/browL/browR raise, worry = inner brows up, furrow = brows down and in,
  // squint = happy eyes, wide = eyes open, corner = smile (+) / frown (-), look = glance, jaw = mouth held open.
  const EXPR = {
    neutral: {},
    happy: { brow: .25, squint: .45, corner: .4 },
    proud: { brow: .35, squint: .65, corner: .75, tilt: 2 },
    cheer: { brow: .9, wide: .35, corner: .85, jaw: .35, tilt: -2 },
    concerned: { worry: 1, corner: -.65, tilt: 3 },
    alarmed: { brow: 1, worry: .4, wide: 1, corner: -.5, jaw: .45 },
    determined: { furrow: .9, squint: .35, corner: -.15 },
    think: { browR: 1, look: -1, corner: -.25, tilt: 4 },
    skeptical: { browL: 1, squint: .4, corner: -.35, tilt: -3 },
    wink: { browL: .35, squint: .3, corner: .85, wink: 1, tilt: -3 },
    surprised: { brow: 1, wide: 1, jaw: .55 },
    smug: { browR: .5, squint: .55, corner: .5, look: 1, tilt: 2 }
  };
  const KEYS = ['browL', 'browR', 'worry', 'furrow', 'squint', 'wide', 'corner', 'look', 'jaw', 'tilt'];
  function target(name) {
    const x = EXPR[name] || EXPR.neutral, o = {};
    o.browL = (x.brow || 0) + (x.browL || 0); o.browR = (x.brow || 0) + (x.browR || 0);
    ['worry', 'furrow', 'squint', 'wide', 'corner', 'look', 'jaw', 'tilt'].forEach(k => o[k] = x[k] || 0);
    o.wink = 0;
    return o;
  }

  const POSE = {
    idle: {}, wave: { motion: 'nod', emoji: '👋', expr: 'happy' }, cheer: { motion: 'bounce', emoji: '🎉', expr: 'cheer' },
    thumbs: { motion: 'nod', emoji: '👍', expr: 'wink' }, flex: { motion: 'bounce', emoji: '💪', expr: 'determined' },
    warn: { motion: 'shake', emoji: '⚠️', expr: 'alarmed' }, think: { motion: 'lean', emoji: '🤔', expr: 'think' },
    hips: { motion: 'shake', emoji: '😤', expr: 'skeptical' }
  };
  const TAP = ['wink', 'surprised', 'skeptical', 'smug', 'cheer', 'think', 'proud'];

  const CSS = `
.pmaya{position:relative;overflow:hidden;border:2.5px solid #2b2622;border-radius:18px;background:#b8e3d3;box-shadow:3px 3px 0 #2b2622;transition:box-shadow .4s;cursor:pointer;-webkit-tap-highlight-color:transparent}
.pmaya canvas{width:100%;height:100%;display:block;transform-origin:50% 92%;will-change:transform}
.pmaya .pm-emoji{position:absolute;right:6px;top:6px;font-size:34px;filter:drop-shadow(1px 2px 0 rgba(0,0,0,.25));transform:scale(0);pointer-events:none}
.pmaya .pm-emoji.pop{animation:pmPop 1.8s ease forwards}
@keyframes pmPop{0%{transform:scale(0) rotate(-20deg)}15%{transform:scale(1.25) rotate(8deg)}25%{transform:scale(1) rotate(0)}80%{transform:scale(1);opacity:1}100%{transform:scale(.6);opacity:0}}
.pmaya.mood-cheer,.pmaya.mood-proud{box-shadow:3px 3px 0 #2b2622,0 0 0 4px #0ca30c,0 0 22px 6px rgba(12,163,12,.45)}
.pmaya.mood-concerned,.pmaya.mood-alarmed{box-shadow:3px 3px 0 #2b2622,0 0 0 4px #d03b3b,0 0 22px 6px rgba(208,59,59,.45)}
.pmaya.mood-determined{box-shadow:3px 3px 0 #2b2622,0 0 0 4px #f6c445,0 0 18px 4px rgba(246,196,69,.5)}`;
  function css() { if (!document.getElementById('pmaya-css')) { const s = document.createElement('style'); s.id = 'pmaya-css'; s.textContent = CSS; document.head.appendChild(s); } }

  function initGL(cv) {
    const gl = cv.getContext('webgl', { premultipliedAlpha: false, antialias: false });
    if (!gl) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = (img, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(w => gl.texParameteri(gl.TEXTURE_2D, w, gl.CLAMP_TO_EDGE));
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(f => gl.texParameteri(gl.TEXTURE_2D, f, gl.LINEAR));
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img); };
    tex(assets.base, 0); tex(assets.blink, 1);
    const U = {}; ['uBase', 'uBlink', 'uSize', 'uCrop', 'uJaw', 'uWide', 'uBlinkL', 'uBlinkR', 'uM1', 'uM2', 'uE0', 'uE1', 'uB', 'uX1', 'uX2'].forEach(n => U[n] = gl.getUniformLocation(pr, n));
    gl.uniform1i(U.uBase, 0); gl.uniform1i(U.uBlink, 1);
    const M = assets.meta, m = M.mouthLM, e = M.eye, b = M.brows;
    gl.uniform2f(U.uSize, M.size, M.size);
    gl.uniform4f(U.uM1, m.jaw_x0, m.jaw_x1, m.cx, (m.x1 - m.x0) / 2);
    gl.uniform4f(U.uM2, m.teeth, m.curve, m.chin, m.neck);
    gl.uniform4f(U.uE0, e[0][0], e[0][1], e[0][2], e[0][3]); gl.uniform4f(U.uE1, e[1][0], e[1][1], e[1][2], e[1][3]);
    gl.uniform4f(U.uB, b[0][0], b[0][1], b[1][0], b[1][1]);
    return { gl, U, hw: (m.x1 - m.x0) / 2 };
  }

  function create(el) {
    css();
    el.innerHTML = ''; el.classList.add('pmaya');
    let cv = document.createElement('canvas');
    const emoji = document.createElement('span'); emoji.className = 'pm-emoji';
    el.append(cv, emoji);

    let G = null, ctx2d = null, raf = 0, visible = true;
    let talking = false, external = false, level = 0, centroid = 0.5, lastLevel = 0;
    let jaw = 0, wide = 0, nod = 0, nodV = 0, browFlash = 0;
    let blinkT = -1, nextBlink = performance.now() + 1200 + Math.random() * 2500, lookIdle = 0, lookTarget = 0, nextLook = 0;
    let motion = null, motionStart = 0;
    let mood = 'happy', transient = null, transientUntil = 0, winkUntil = 0;
    const cur = target('happy');

    function size() {
      const r = el.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      if (!r.width) return false;
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
      if (G) G.gl.viewport(0, 0, cv.width, cv.height);
      return true;
    }
    function crop() {
      const S = assets.meta.size, W = cv.width, H = cv.height, c = assets.meta.crop;
      let sw = S * 0.62, sh = sw * H / W; if (sh > S) { sh = S; sw = S * W / H; }
      return [Math.max(0, Math.min(S - sw, c[0] - sw / 2)), Math.max(0, Math.min(S - sh, c[1] - sh * 0.45)), sw, sh];
    }
    function synthLevel(t) {
      const syl = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 4.2 + 2 * Math.sin(t * 2 * Math.PI * 0.9));
      const phrase = 0.65 + 0.35 * Math.sin(t * 2 * Math.PI * 0.55);
      const pause = (t * 0.42 % 1) > 0.86 ? 0 : 1;
      return Math.pow(syl, 1.6) * phrase * pause;
    }
    function frame(now) {
      raf = 0;
      if (!assets || !visible || document.hidden) return;
      if (!G && !ctx2d) {
        try { G = initGL(cv); } catch (e) { console.warn(e); }
        if (!G) ctx2d = cv.getContext('2d');
        size();
      }
      const t = now / 1000;
      if (transient && now > transientUntil) transient = null;
      const tg = target(transient || mood);
      tg.wink = now < winkUntil ? 1 : 0;
      KEYS.concat('wink').forEach(k => { cur[k] += (tg[k] - cur[k]) * (k === 'wink' ? 0.35 : 0.1); });
      const hw = G ? G.hw : 60, MAX_JAW = hw * 0.16, MAX_WIDE = hw * 0.065;
      const lv = talking ? (external ? level : synthLevel(t)) : 0;
      const jawTarget = Math.max(MAX_JAW * Math.min(1, Math.pow(lv, 0.8) * 1.15), MAX_JAW * cur.jaw);
      jaw += (jawTarget - jaw) * (jawTarget > jaw ? 0.5 : 0.22);
      const wideTarget = talking ? (external ? (centroid - 0.45) * 2.2 * MAX_WIDE : Math.sin(t * 2.3) * MAX_WIDE * 0.45) : 0;
      wide += (Math.max(-MAX_WIDE, Math.min(MAX_WIDE, wideTarget)) - wide) * 0.15;
      if (talking && lv - lastLevel > 0.28) { if (nod < 0.4) nodV += 2.2; if (Math.random() < 0.35) browFlash = Math.min(0.7, browFlash + 0.5); }
      lastLevel = lv;
      nodV += -nod * 0.18 - nodV * 0.22; nod += nodV * 0.12;
      browFlash *= 0.93;
      if (now > nextBlink) { blinkT = now; nextBlink = now + 2400 + Math.random() * 4200; if (Math.random() < 0.15) nextBlink = now + 380; }
      const bp = blinkT < 0 ? 1 : (now - blinkT) / 150;
      const blink = bp >= 1 ? 0 : Math.sin(Math.PI * bp);
      if (now > nextLook) { lookTarget = Math.random() < 0.6 ? 0 : (Math.random() - 0.5) * 1.4; nextLook = now + 2000 + Math.random() * 3500; }
      lookIdle += (lookTarget - lookIdle) * 0.12;
      let rot = Math.sin(t * 2 * Math.PI / 6.5) * 0.35 + cur.tilt, ty = nod * 1.6, sc = 1 + Math.sin(t * 2 * Math.PI / 4) * 0.005;
      if (motion) {
        const e = (now - motionStart) / 1000;
        if (motion === 'nod') ty += Math.sin(e * 9) * 3 * Math.exp(-e * 1.5);
        if (motion === 'shake') rot += Math.sin(e * 13) * 2.2 * Math.exp(-e * 1.2);
        if (motion === 'bounce') { ty -= Math.abs(Math.sin(e * 7)) * 6 * Math.exp(-e * 0.9); sc += 0.02 * Math.exp(-e); }
        if (motion === 'lean') sc += 0.025 * Math.min(1, e * 3);
        if (e > 3.5) motion = null;
      }
      cv.style.transform = `translateY(${ty.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${sc.toFixed(4)})`;
      const c = crop();
      if (G) {
        const { gl, U } = G;
        gl.uniform4f(U.uCrop, c[0], c[1], c[2], c[3]);
        gl.uniform1f(U.uJaw, jaw); gl.uniform1f(U.uWide, wide);
        gl.uniform1f(U.uBlinkL, blink);
        gl.uniform1f(U.uBlinkR, Math.max(blink, cur.wink));
        gl.uniform4f(U.uX1, cur.browL + browFlash, cur.browR + browFlash, cur.worry, cur.furrow);
        gl.uniform4f(U.uX2, cur.squint * (1 - cur.wink * 0.5), cur.wide, cur.corner, Math.max(-1, Math.min(1, cur.look + lookIdle)));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else if (ctx2d) {
        ctx2d.drawImage(blink > 0.5 ? assets.blink : assets.base, c[0], c[1], c[2], c[3], 0, 0, cv.width, cv.height);
      }
      raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }
    function react(name, ms) {
      transient = name; transientUntil = performance.now() + (ms || 2600);
      if (EXPR[name] && EXPR[name].wink) winkUntil = performance.now() + 450;
      kick();
    }
    load().then(() => { size(); kick(); });
    new ResizeObserver(() => { size(); kick(); }).observe(el);
    if ('IntersectionObserver' in root) new IntersectionObserver(es => { visible = es[0].isIntersecting; kick(); }).observe(el);
    document.addEventListener('visibilitychange', kick);
    let lastTap = -1;
    el.addEventListener('click', () => {           // tap her for a random face
      let i; do { i = Math.floor(Math.random() * TAP.length); } while (i === lastTap);
      lastTap = i; react(TAP[i], 2200);
      if (TAP[i] === 'surprised' || TAP[i] === 'cheer') { motion = 'bounce'; motionStart = performance.now(); }
    });

    function reset() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      const nc = document.createElement('canvas'); nc.className = cv.className; nc.style.transform = cv.style.transform;
      el.replaceChild(nc, cv); cv = nc; inst.svg = cv; G = null; ctx2d = null;
      size(); kick();
    }
    const inst = {
      el, svg: cv, _reset: reset,
      setMood(m) { mood = EXPR[m] ? m : 'happy'; el.className = el.className.replace(/\bmood-\S+/g, '').trim() + ' mood-' + m; kick(); },
      setOutfit() {},
      expression: react,
      pose(p, ms) {
        const P = POSE[p] || POSE.idle;
        if (P.motion) { motion = P.motion; motionStart = performance.now(); }
        if (P.expr) react(P.expr, Math.max(ms || 0, 2600));
        if (P.emoji) { emoji.textContent = P.emoji; emoji.classList.remove('pop'); void emoji.offsetWidth; emoji.classList.add('pop'); }
        kick();
      },
      talk(on) { talking = !!on; if (!on) { external = false; level = 0; cv.classList.remove('lipsync'); } kick(); },
      mouth(l, c) { external = true; talking = true; cv.classList.add('lipsync'); level = l; if (c != null) centroid = c; kick(); }
    };
    el._maya = inst;
    live.push(inst);
    return inst;
  }

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
        floor = Math.min(floor * 1.002 + 0.0001, rms);
        const lv = Math.max(0, Math.min(1, (rms - floor) * 6));
        let num = 0, den = 0;
        for (let i = 3; i < fd.length; i++) { const f = i * hz; if (f > 4500) break; num += f * fd[i]; den += fd[i]; }
        const cen = den ? Math.max(0, Math.min(1, (num / den - 500) / 1800)) : 0.5;
        instances.forEach(i => i.mouth(lv, cen));
        requestAnimationFrame(tick);
      };
      instances.forEach(i => i.talk(true));
      requestAnimationFrame(tick);
      return true;
    } catch (e) { return false; }
  }

  root.PhotoMaya = { create, load, lipSync, EXPR, setCoach };
})(self);
