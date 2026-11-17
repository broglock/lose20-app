/* Small effects: confetti, floating points, haptics. */
(function (root) {
  'use strict';
  let cv = null, ctx = null, parts = [], running = false;
  const COLORS = ['#14b8a6', '#c6f432', '#fb7185', '#f6c445', '#2a78d6', '#a78bfa'];

  function canvas() {
    if (cv) return;
    cv = document.createElement('canvas'); cv.id = 'confetti'; document.body.appendChild(cv);
    ctx = cv.getContext('2d');
    const size = () => { cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); };
    size(); addEventListener('resize', size);
  }
  function confetti(n) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    canvas();
    for (let i = 0; i < (n || 140); i++) parts.push({
      x: innerWidth / 2 + (Math.random() - .5) * 80, y: innerHeight * .35,
      vx: (Math.random() - .5) * 14, vy: -Math.random() * 13 - 4, r: Math.random() * 6 + 4,
      rot: Math.random() * 6, vr: (Math.random() - .5) * .4, c: COLORS[i % COLORS.length], life: 0
    });
    if (!running) { running = true; requestAnimationFrame(step); }
  }
  function step() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts.forEach(p => {
      p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life++;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      ctx.strokeStyle = '#2b2622'; ctx.lineWidth = 1.2;
      ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.strokeRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
    });
    parts = parts.filter(p => p.y < innerHeight + 40 && p.life < 260);
    if (parts.length) requestAnimationFrame(step); else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
  }
  function points(n, x, y) {
    const d = document.createElement('div'); d.className = 'pts-pop'; d.textContent = '+' + n;
    d.style.left = (x || innerWidth / 2) + 'px'; d.style.top = (y || innerHeight * .45) + 'px';
    document.body.appendChild(d); setTimeout(() => d.remove(), 1500);
  }
  function buzz(pattern) { try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) {} }
  root.FX = { confetti, points, buzz };
})(self);
