/* Maya, the coach. Original half-body character drawn in SVG and rigged for animation:
   - idle: breathing, head tilt, glancing around, blinking, ponytail sway
   - poses: wave, cheer (jump, arms up), thumbs-up, flex, finger-wag warning, think, hands on hips
   - moods: happy, cheer, proud, neutral, concerned, alarmed, determined
   - outfits: teal tank (default) or coral gym kit with sweatband, towel and wristbands
   - lip-sync: mouth opens with the loudness of the actual voice audio */
(function (root) {
  'use strict';
  const INK = '#2b2622', SKIN = '#eab38f', SKIN_SH = '#d4926c', HAIR = '#3b2418', HAIR_HI = '#6a4030', LIP = '#b4424f';

  const limb = (a, b, w) => `<path d="M${a} L${b}" stroke="${INK}" stroke-width="${w + 5}" stroke-linecap="round"/><path d="M${a} L${b}" stroke="${SKIN}" stroke-width="${w}" stroke-linecap="round"/>`;
  const hand = (x, y) => `<circle cx="${x}" cy="${y}" r="11" fill="${SKIN}" stroke="${INK}" stroke-width="2.5"/>
    <g class="thumb"><rect x="${x - 4.5}" y="${y + 6}" width="9" height="16" rx="4.5" fill="${SKIN}" stroke="${INK}" stroke-width="2.5"/></g>
    <g class="finger"><rect x="${x - 3.5}" y="${y + 6}" width="7" height="22" rx="3.5" fill="${SKIN}" stroke="${INK}" stroke-width="2.5"/></g>`;

  function arm(side) {
    const L = side === 'L';
    const sh = L ? [82, 182] : [158, 182], el = L ? [72, 238] : [168, 238], wr = L ? [76, 290] : [164, 290];
    return `<g class="arm arm${side}"><g class="u">
      ${limb(sh.join(' '), el.join(' '), 19)}
      <g class="f"><g class="w">
        ${limb(el.join(' '), wr.join(' '), 17)}
        <path class="wrist" d="M${wr[0]} ${wr[1] - 15} L${wr[0]} ${wr[1] - 4}" stroke="#ffffff" stroke-width="20" opacity=".95"/>
        ${hand(wr[0], wr[1] + 9)}
      </g></g></g></g>`;
  }

  const MOOD = {
    happy:      { brows: 'M88 78 Q99 71 110 76 M130 76 Q141 71 152 78', mouth: `<path d="M106 119 Q120 131 134 119" stroke="${LIP}" stroke-width="3.6" fill="none" stroke-linecap="round"/>` },
    cheer:      { brows: 'M87 75 Q99 66 111 72 M129 72 Q141 66 153 75', mouth: `<path d="M103 116 Q120 140 137 116 Q120 123 103 116Z" fill="#7c1d2b" stroke="${INK}" stroke-width="2"/><path d="M107 117.5 Q120 122 133 117.5 L132 121 Q120 125 108 121Z" fill="#fff"/>` },
    proud:      { brows: 'M88 77 Q99 71 110 75 M130 75 Q141 71 152 77', mouth: `<path d="M105 117 Q120 132 135 117" stroke="${LIP}" stroke-width="3.8" fill="none" stroke-linecap="round"/>` },
    neutral:    { brows: 'M88 80 Q99 77 110 79 M130 79 Q141 77 152 80', mouth: `<path d="M109 121 Q120 125 131 121" stroke="${LIP}" stroke-width="3.4" fill="none" stroke-linecap="round"/>` },
    concerned:  { brows: 'M88 79 Q99 79 110 73 M130 73 Q141 79 152 79', mouth: `<path d="M109 124 Q120 118 131 124" stroke="${LIP}" stroke-width="3.4" fill="none" stroke-linecap="round"/>` },
    alarmed:    { brows: 'M87 72 Q99 63 111 69 M129 69 Q141 63 153 72', mouth: `<ellipse cx="120" cy="122" rx="7" ry="9" fill="#7c1d2b" stroke="${INK}" stroke-width="2"/>` },
    determined: { brows: 'M88 74 Q99 78 110 81 M130 81 Q141 78 152 74', mouth: `<path d="M108 121 Q122 126 133 117" stroke="${LIP}" stroke-width="3.6" fill="none" stroke-linecap="round"/>` }
  };

  let seq = 0;
  function svg(opts) {
    opts = opts || {};
    const u = 'my' + (++seq);
    const moods = Object.entries(MOOD).map(([k, v]) =>
      `<g class="m m-${k}"><path d="${v.brows}" stroke="${HAIR}" stroke-width="4" fill="none" stroke-linecap="round"/><g class="mouth-still">${v.mouth}</g></g>`).join('');
    return `
<svg class="maya mood-${opts.mood || 'happy'} outfit-${opts.outfit || 'tank'} pose-idle" viewBox="0 0 240 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Maya, your coach">
  <defs><clipPath id="${u}c"><circle cx="120" cy="170" r="112"/><rect x="0" y="170" width="240" height="150"/></clipPath></defs>
  ${opts.backdrop === false ? '' : `<circle cx="120" cy="170" r="112" fill="var(--maya-bg,#cdeee4)" stroke="${INK}" stroke-width="3"/>
  <path d="M30 120 q6 -10 12 0 M196 98 q6 -10 12 0 M206 250 q6 -10 12 0" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".45"/>`}
  <g clip-path="url(#${u}c)"><g class="jump"><g class="breathe">
    <g class="pony"><path d="M146 52 Q192 50 188 104 Q185 138 166 158 Q174 120 160 92 Q154 78 142 70Z" fill="${HAIR}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M170 76 Q181 100 172 130" stroke="${HAIR_HI}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle cx="150" cy="60" r="6" style="fill:var(--band)" stroke="${INK}" stroke-width="2"/></g>
    <path d="M108 136 L108 170 Q120 178 132 170 L132 136Z" fill="${SKIN_SH}" stroke="${INK}" stroke-width="2.5"/>
    <path d="M80 330 L80 196 Q80 172 98 166 L142 166 Q160 172 160 196 L160 330Z" fill="${SKIN}" stroke="${INK}" stroke-width="2.5"/>
    <path d="M82 330 L84 200 Q86 178 94 170 L100 168 Q104 196 120 198 Q136 196 140 168 L146 170 Q154 178 156 200 L158 330Z" style="fill:var(--top)" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M100 168 Q104 196 120 198 Q136 196 140 168" style="stroke:var(--trim)" stroke-width="4" fill="none"/>
    <path d="M120 222 l5 10 11 1.5 -8 7.5 2 11 -10 -5.5 -10 5.5 2 -11 -8 -7.5 11 -1.5z" style="fill:var(--trim)" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <g class="towel"><path d="M140 166 Q160 170 164 196 L152 232 Q146 206 134 190Z" fill="#ffffff" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M146 182 L154 222" stroke="#7dd3fc" stroke-width="3"/></g>
    <g class="head"><g class="headAnim">
      <ellipse cx="80" cy="100" rx="8" ry="12" fill="${SKIN_SH}" stroke="${INK}" stroke-width="2.5"/>
      <ellipse cx="160" cy="100" rx="8" ry="12" fill="${SKIN_SH}" stroke="${INK}" stroke-width="2.5"/>
      <circle cx="80" cy="114" r="3" fill="#fcd34d" stroke="${INK}" stroke-width="1.2"/><circle cx="160" cy="114" r="3" fill="#fcd34d" stroke="${INK}" stroke-width="1.2"/>
      <path d="M82 88 Q82 44 120 44 Q158 44 158 88 Q158 128 136 142 Q120 150 104 142 Q82 128 82 88Z" fill="${SKIN}" stroke="${INK}" stroke-width="2.8"/>
      <path d="M78 94 Q72 38 120 34 Q170 36 162 94 Q158 66 144 58 Q122 72 96 64 Q84 72 78 94Z" fill="${HAIR}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M96 64 Q118 72 144 58" stroke="${HAIR_HI}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M80 72 Q120 44 160 72" style="stroke:var(--band)" stroke-width="8" fill="none" stroke-linecap="round"/>
      <path d="M80 72 Q120 44 160 72" stroke="${INK}" stroke-width="1.2" fill="none" opacity=".5"/>
      <g class="eyesOpen">
        <path d="M89 93 Q99 83 110 93 Q99 100 89 93Z" fill="#fff" stroke="${INK}" stroke-width="1.6"/>
        <path d="M130 93 Q141 83 151 93 Q141 100 130 93Z" fill="#fff" stroke="${INK}" stroke-width="1.6"/>
        <g class="look"><circle cx="99.5" cy="92.5" r="5" fill="#5b3a22"/><circle cx="140.5" cy="92.5" r="5" fill="#5b3a22"/>
          <circle cx="99.5" cy="92.5" r="2.4" fill="#111"/><circle cx="140.5" cy="92.5" r="2.4" fill="#111"/>
          <circle cx="101.4" cy="90.6" r="1.5" fill="#fff"/><circle cx="142.4" cy="90.6" r="1.5" fill="#fff"/></g>
        <path d="M87 92 Q99 81 112 92 M128 92 Q141 81 153 92" stroke="${INK}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        <path d="M87 92 L82 88 M89 88 L85 83 M153 92 L158 88 M151 88 L155 83" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
        <g class="lids"><path d="M87 92 Q99 81 112 92 Q99 100 87 93Z M128 92 Q141 81 153 92 Q141 100 128 93Z" fill="${SKIN}" stroke="${INK}" stroke-width="2"/></g>
      </g>
      <g class="eyesClosed"><path d="M89 94 Q99 86 110 94 M130 94 Q141 86 151 94" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/></g>
      <path d="M120 98 Q117 108 119 112 Q122 113 124 111" stroke="${SKIN_SH}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <ellipse cx="94" cy="111" rx="7.5" ry="4.2" fill="#f08a7e" opacity=".4"/><ellipse cx="146" cy="111" rx="7.5" ry="4.2" fill="#f08a7e" opacity=".4"/>
      ${moods}
      <g class="mouth-talk"><ellipse class="talkO" cx="120" cy="122" rx="8" ry="6" fill="#7c1d2b" stroke="${INK}" stroke-width="2"/></g>
      <g class="sweat"><path d="M160 66 q5 8 0 12 q-5 -4 0 -12z" fill="#7dd3fc" stroke="${INK}" stroke-width="1.5"/></g>
    </g></g>
    ${arm('L')}${arm('R')}
  </g></g></g>
  <g class="sparkles" fill="#fde047" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round">
    <path class="sp1" d="M200 60 l5 12 12 5 -12 5 -5 12 -5 -12 -12 -5 12 -5z"/>
    <path class="sp2" d="M34 84 l4 9 9 4 -9 4 -4 9 -4 -9 -9 -4 9 -4z"/>
    <path class="sp3" d="M210 190 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z"/>
  </g>
</svg>`;
  }

  const CSS = `
.maya{--top:#14b8a6;--trim:#c6f432;--band:#c6f432;overflow:visible}
.maya.outfit-gym{--top:#fb7185;--trim:#ffffff;--band:#ffffff}
.maya g{transform-box:view-box}
.maya .towel,.maya .wrist{display:none}
.maya.outfit-gym .towel,.maya.outfit-gym .wrist{display:inline}
.maya .m,.maya .eyesClosed,.maya .mouth-talk,.maya .sparkles,.maya .thumb,.maya .finger,.maya .sweat{display:none}
.maya.mood-happy .m-happy,.maya.mood-cheer .m-cheer,.maya.mood-proud .m-proud,.maya.mood-neutral .m-neutral,
.maya.mood-concerned .m-concerned,.maya.mood-alarmed .m-alarmed,.maya.mood-determined .m-determined{display:inline}
.maya.mood-proud .eyesOpen{display:none}.maya.mood-proud .eyesClosed{display:inline}
.maya.mood-cheer .sparkles,.maya.mood-proud .sparkles{display:inline}
.maya.mood-alarmed .sweat,.maya.mood-concerned .sweat{display:inline}
.maya.mood-alarmed .eyesOpen{transform:scale(1.12);transform-origin:120px 92px}
.maya.talking .mouth-still{display:none}.maya.talking .mouth-talk{display:inline}
.maya.talking:not(.lipsync) .talkO{animation:myFlap .16s ease-in-out infinite alternate;transform-origin:120px 122px}
@keyframes myFlap{from{transform:scaleY(.3)}to{transform:scaleY(1.15)}}
.maya .breathe{transform-origin:120px 320px;animation:myBreathe 3.6s ease-in-out infinite alternate}
@keyframes myBreathe{from{transform:scale(1,1)}to{transform:scale(1.006,1.014)}}
.maya .head{transform-origin:120px 150px;transition:transform .4s ease}
.maya .headAnim{transform-origin:120px 150px;animation:myTilt 6s ease-in-out infinite}
@keyframes myTilt{0%,100%{transform:rotate(0)}30%{transform:rotate(-3deg)}65%{transform:rotate(2.5deg)}}
.maya .pony{transform-origin:146px 60px;animation:mySway 2.8s ease-in-out infinite alternate}
@keyframes mySway{from{transform:rotate(-3deg)}to{transform:rotate(4deg)}}
.maya .look{animation:myLook 9s steps(1) infinite}
@keyframes myLook{0%{transform:translate(0,0)}22%{transform:translate(2.5px,0)}40%{transform:translate(0,0)}63%{transform:translate(-2.5px,.8px)}80%{transform:translate(0,0)}}
.maya .lids{transform-origin:120px 86px;transform:scaleY(0);animation:myBlink 4.6s infinite}
@keyframes myBlink{0%,93%,100%{transform:scaleY(0)}95.5%{transform:scaleY(1)}}
.maya .sparkles path{transform-box:fill-box;transform-origin:center;animation:myTwinkle 1.1s ease-in-out infinite alternate}
.maya .sparkles .sp2{animation-delay:.35s}.maya .sparkles .sp3{animation-delay:.7s}
@keyframes myTwinkle{from{transform:scale(.6) rotate(0)}to{transform:scale(1.15) rotate(25deg)}}
.maya .u,.maya .f{transition:transform .5s cubic-bezier(.34,1.5,.55,1)}
.maya .armL .u{transform-origin:82px 182px}
.maya .armR .u{transform-origin:158px 182px}
.maya.pose-idle .armL .u{animation:myArmIdleL 3.6s ease-in-out infinite alternate}
.maya.pose-idle .armR .u{animation:myArmIdleR 3.6s ease-in-out infinite alternate}
@keyframes myArmIdleL{from{transform:rotate(0)}to{transform:rotate(3deg)}}
@keyframes myArmIdleR{from{transform:rotate(0)}to{transform:rotate(-3deg)}}
.maya .armL .f,.maya .armL .w{transform-origin:72px 238px}
.maya .armR .f,.maya .armR .w{transform-origin:168px 238px}
.maya.pose-wave .armR .u{transform:rotate(-158deg)}
.maya.pose-wave .armR .f{transform:rotate(-12deg)}
.maya.pose-wave .armR .w{animation:myWave .32s ease-in-out infinite alternate}
@keyframes myWave{from{transform:rotate(-22deg)}to{transform:rotate(22deg)}}
.maya.pose-wave .head{transform:rotate(-5deg)}
.maya.pose-cheer .armL .u{transform:rotate(150deg)}.maya.pose-cheer .armR .u{transform:rotate(-150deg)}
.maya.pose-cheer .armL .f{transform:rotate(14deg)}.maya.pose-cheer .armR .f{transform:rotate(-14deg)}
.maya.pose-cheer .jump{transform-origin:120px 320px;animation:myJump .55s ease-in-out infinite}
@keyframes myJump{0%,100%{transform:translateY(0) scaleY(1)}12%{transform:translateY(0) scaleY(.96)}50%{transform:translateY(-16px) scaleY(1.02)}}
.maya.pose-thumbs .armR .u{transform:rotate(-22deg)}.maya.pose-thumbs .armR .f{transform:rotate(-150deg)}
.maya.pose-thumbs .armR .thumb{display:inline}
.maya.pose-thumbs .head{transform:rotate(4deg)}
.maya.pose-thumbs .armR .w{animation:myPump .5s ease-in-out 4 alternate}
@keyframes myPump{from{transform:rotate(0)}to{transform:rotate(-10deg)}}
.maya.pose-flex .armL .u{transform:rotate(68deg)}.maya.pose-flex .armR .u{transform:rotate(-68deg)}
.maya.pose-flex .armL .f{transform:rotate(112deg)}.maya.pose-flex .armR .f{transform:rotate(-112deg)}
.maya.pose-flex .breathe{animation:myFlexPulse .6s ease-in-out infinite alternate}
@keyframes myFlexPulse{from{transform:scale(1)}to{transform:scale(1.02,1.01)}}
.maya.pose-warn .armR .u{transform:rotate(-26deg)}.maya.pose-warn .armR .f{transform:rotate(-148deg)}
.maya.pose-warn .armR .finger{display:inline}
.maya.pose-warn .armR .w{animation:myWag .28s ease-in-out infinite alternate}
@keyframes myWag{from{transform:rotate(-13deg)}to{transform:rotate(13deg)}}
.maya.pose-warn .headAnim{animation:myShake .7s ease-in-out infinite}
@keyframes myShake{0%,100%{transform:rotate(0)}25%{transform:rotate(-5deg)}75%{transform:rotate(5deg)}}
.maya.pose-think .armR .u{transform:rotate(-18deg)}.maya.pose-think .armR .f{transform:rotate(-150deg)}
.maya.pose-think .head{transform:rotate(7deg)}
.maya.pose-hips .armL .u{transform:rotate(32deg)}.maya.pose-hips .armR .u{transform:rotate(-32deg)}
.maya.pose-hips .armL .f{transform:rotate(-78deg)}.maya.pose-hips .armR .f{transform:rotate(78deg)}
@media (prefers-reduced-motion: reduce){.maya *{animation:none!important;transition:none!important}}`;

  function css() {
    if (typeof document === 'undefined' || document.getElementById('maya-css')) return;
    const s = document.createElement('style'); s.id = 'maya-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  const POSES = ['idle', 'wave', 'cheer', 'thumbs', 'flex', 'warn', 'think', 'hips'];
  const MOODS = Object.keys(MOOD);

  function create(el, opts) {
    css();
    opts = Object.assign({ mood: 'happy', outfit: 'tank' }, opts || {});
    el.innerHTML = svg(opts);
    const s = el.querySelector('svg');
    let poseTimer = null;
    const inst = {
      el, svg: s,
      setMood(m) { if (!MOODS.includes(m)) return; MOODS.forEach(x => s.classList.remove('mood-' + x)); s.classList.add('mood-' + m); },
      setOutfit(o) { s.classList.remove('outfit-tank', 'outfit-gym'); s.classList.add('outfit-' + o); },
      pose(p, ms) {
        if (!POSES.includes(p)) p = 'idle';
        POSES.forEach(x => s.classList.remove('pose-' + x)); s.classList.add('pose-' + p);
        clearTimeout(poseTimer);
        if (ms && p !== 'idle') poseTimer = setTimeout(() => inst.pose('idle'), ms);
      },
      talk(on) { s.classList.toggle('talking', !!on); if (!on) { s.classList.remove('lipsync'); s.querySelector('.talkO').setAttribute('ry', 6); } },
      mouth(level) { s.classList.add('lipsync'); s.querySelector('.talkO').setAttribute('ry', (2 + level * 10).toFixed(1)); }
    };
    el._maya = inst;
    return inst;
  }

  // Lip-sync: every mounted Maya's mouth follows the loudness of the voice audio.
  let ctx = null;
  function lipSync(audioEl, instances) {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const src = ctx.createMediaElementSource(audioEl);
      const an = ctx.createAnalyser(); an.fftSize = 512;
      src.connect(an); an.connect(ctx.destination);
      const buf = new Uint8Array(an.fftSize);
      let smooth = 0;
      const tick = () => {
        if (audioEl.paused || audioEl.ended) { instances.forEach(i => i.talk(false)); return; }
        an.getByteTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        smooth = smooth * 0.5 + Math.min(1, Math.sqrt(sum / buf.length) * 5) * 0.5;
        instances.forEach(i => i.mouth(smooth));
        requestAnimationFrame(tick);
      };
      instances.forEach(i => i.talk(true));
      requestAnimationFrame(tick);
      return true;
    } catch (e) { return false; }
  }

  const api = { create, svg, lipSync, CSS, POSES, MOODS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Avatar = api;
})(typeof self !== 'undefined' ? self : this);
