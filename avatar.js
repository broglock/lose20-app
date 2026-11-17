/* Maya, the coach avatar. Original illustration drawn as SVG so it scales,
   changes expression with mood, and lip-syncs while she talks. */
(function (root) {
  'use strict';

  const SKIN = '#e8b08a', SKIN_SH = '#d39570', HAIR = '#3b2418', HAIR_HI = '#5a3626';
  const TOP = '#14b8a6', TOP_SH = '#0f8f82', BAND = '#c6f432';

  const BROWS = {
    cheer:     'M68 78 Q80 70 92 76 M108 76 Q120 70 132 78',
    happy:     'M68 80 Q80 74 92 78 M108 78 Q120 74 132 80',
    neutral:   'M68 81 Q80 78 92 80 M108 80 Q120 78 132 81',
    concerned: 'M68 79 Q80 80 92 75 M108 75 Q120 80 132 79'
  };
  const MOUTHS = {
    cheer:     '<path d="M84 118 Q100 136 116 118 Q100 124 84 118Z" fill="#8f2f3a"/><path d="M88 119 Q100 123 112 119 L111 121 Q100 125 89 121Z" fill="#fff"/>',
    happy:     '<path d="M86 119 Q100 130 114 119" stroke="#8f2f3a" stroke-width="3.2" fill="none" stroke-linecap="round"/>',
    neutral:   '<path d="M89 121 Q100 125 111 121" stroke="#8f2f3a" stroke-width="3" fill="none" stroke-linecap="round"/>',
    concerned: '<path d="M89 124 Q100 119 111 124" stroke="#8f2f3a" stroke-width="3" fill="none" stroke-linecap="round"/>'
  };

  let seq = 0;
  function svg(mood) {
    const u = 'm' + (++seq);
    mood = BROWS[mood] ? mood : 'happy';
    const sparkle = mood === 'cheer'
      ? '<g fill="#fde68a"><path d="M160 40 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4z"/><path d="M36 58 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z"/></g>' : '';
    return `
<svg class="maya mood-${mood}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Maya, your coach, looking ${mood}">
  <defs>
    <radialGradient id="${u}bg" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#2dd4bf"/><stop offset="1" stop-color="#0b3b47"/></radialGradient>
    <clipPath id="${u}clip"><circle cx="100" cy="100" r="98"/></clipPath>
  </defs>
  <circle cx="100" cy="100" r="98" fill="url(#${u}bg)"/>
  <g clip-path="url(#${u}clip)">
    <!-- ponytail -->
    <path class="ponytail" d="M128 52 Q170 50 166 96 Q163 128 146 146 Q154 112 140 84 Q134 70 124 64Z" fill="${HAIR}"/>
    <path d="M150 70 Q160 92 152 120" stroke="${HAIR_HI}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <!-- shoulders and top -->
    <path d="M30 210 Q32 162 74 152 L126 152 Q168 162 170 210Z" fill="${TOP}"/>
    <path d="M74 152 Q100 172 126 152 L122 150 Q100 164 78 150Z" fill="${TOP_SH}"/>
    <path d="M100 166 L100 210" stroke="#e2e8f0" stroke-width="2.5"/>
    <rect x="96.5" y="168" width="7" height="10" rx="2" fill="#e2e8f0"/>
    <path d="M46 176 Q52 190 50 210 M154 176 Q148 190 150 210" stroke="${TOP_SH}" stroke-width="3" fill="none"/>
    <!-- neck -->
    <path d="M86 132 L86 156 Q100 164 114 156 L114 132Z" fill="${SKIN_SH}"/>
    <!-- ears -->
    <ellipse cx="60" cy="98" rx="7" ry="11" fill="${SKIN_SH}"/>
    <ellipse cx="140" cy="98" rx="7" ry="11" fill="${SKIN_SH}"/>
    <circle cx="60" cy="110" r="2.2" fill="#fcd34d"/><circle cx="140" cy="110" r="2.2" fill="#fcd34d"/>
    <!-- face -->
    <path d="M62 86 Q62 46 100 46 Q138 46 138 86 Q138 124 116 136 Q100 144 84 136 Q62 124 62 86Z" fill="${SKIN}"/>
    <!-- hair cap and bangs -->
    <path d="M58 92 Q54 40 100 36 Q148 38 142 92 Q138 66 124 58 Q104 70 76 64 Q64 72 58 92Z" fill="${HAIR}"/>
    <path d="M76 64 Q96 70 124 58" stroke="${HAIR_HI}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <!-- headband -->
    <path d="M60 70 Q100 44 140 70" stroke="${BAND}" stroke-width="7" fill="none" stroke-linecap="round"/>
    <!-- brows -->
    <path class="brows" d="${BROWS[mood]}" stroke="${HAIR}" stroke-width="3.6" fill="none" stroke-linecap="round"/>
    <!-- eyes -->
    <g class="eyes">
      <path d="M70 92 Q80 83 90 92 Q80 98 70 92Z" fill="#fff"/>
      <path d="M110 92 Q120 83 130 92 Q120 98 110 92Z" fill="#fff"/>
      <circle cx="80" cy="91.5" r="4.6" fill="#4b3a2a"/><circle cx="120" cy="91.5" r="4.6" fill="#4b3a2a"/>
      <circle cx="80" cy="91.5" r="2.2" fill="#111"/><circle cx="120" cy="91.5" r="2.2" fill="#111"/>
      <circle cx="81.8" cy="89.8" r="1.3" fill="#fff"/><circle cx="121.8" cy="89.8" r="1.3" fill="#fff"/>
      <path d="M69 91 Q80 82 91 91 M109 91 Q120 82 131 91" stroke="#2a1a12" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M69 91 L66 88 M131 91 L134 88" stroke="#2a1a12" stroke-width="1.6" stroke-linecap="round"/>
    </g>
    <!-- nose and cheeks -->
    <path d="M100 96 Q97 106 99 110 Q102 111 104 109" stroke="${SKIN_SH}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <ellipse cx="74" cy="110" rx="7" ry="4" fill="#f08a7e" opacity=".35"/>
    <ellipse cx="126" cy="110" rx="7" ry="4" fill="#f08a7e" opacity=".35"/>
    <!-- mouth: static by mood, swapped for the talking mouth while speaking -->
    <g class="mouth-still">${MOUTHS[mood]}</g>
    <g class="mouth-talk"><ellipse cx="100" cy="121" rx="8" ry="5" fill="#8f2f3a"/><path d="M93 118.5 Q100 117 107 118.5" stroke="#fff" stroke-width="2" fill="none"/></g>
  </g>
  ${sparkle}
</svg>`;
  }

  const CSS = `
.maya .mouth-talk{display:none}
.maya.talking .mouth-still{display:none}
.maya.talking .mouth-talk{display:inline}
.maya.talking .mouth-talk ellipse{animation:mayaTalk .18s ease-in-out infinite alternate;transform-origin:100px 121px}
@keyframes mayaTalk{from{transform:scaleY(.25)}to{transform:scaleY(1.1)}}
.maya .eyes{animation:mayaBlink 5s infinite;transform-origin:100px 92px}
@keyframes mayaBlink{0%,95%,100%{transform:scaleY(1)}97%{transform:scaleY(.1)}}
.maya .ponytail{animation:mayaSway 3.5s ease-in-out infinite alternate;transform-origin:130px 60px}
@keyframes mayaSway{from{transform:rotate(-2deg)}to{transform:rotate(3deg)}}
@media (prefers-reduced-motion: reduce){.maya *{animation:none!important}}`;

  function mount(el, mood) {
    if (!document.getElementById('maya-css')) {
      const s = document.createElement('style'); s.id = 'maya-css'; s.textContent = CSS; document.head.appendChild(s);
    }
    el.innerHTML = svg(mood);
    return el.querySelector('svg');
  }
  function setTalking(el, on) { const s = el.querySelector('svg'); if (s) s.classList.toggle('talking', !!on); }

  const api = { svg, mount, setTalking, CSS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Avatar = api;
})(typeof self !== 'undefined' ? self : this);
