"""Build base.jpg, blink.jpg, thumb.jpg and frames.json for each redrawn coach (640 px)."""
import json, sys, numpy as np, cv2
from PIL import Image, ImageDraw
# eyes: (cx, cy, rx, ry) x2; brows: (x,y) x2; mouth: x0, x1, lip line, cx, curve; chin, neck, jaw x0/x1; crop; view
L = {
 'sarge':   dict(eye=[(251,272,22,7.5),(392,272,22,7.5)], brows=[(235,245),(400,242)], m=(290,380,437,335,-3), chin=505, neck=560, jaw=(195,470), crop=(320,268), view=.92),
 'action':  dict(eye=[(267,249,20,6),(384,249,20,6)], brows=[(262,231),(387,231)], m=(285,372,382,328,2), chin=465, neck=500, jaw=(207,445), crop=(328,262), view=.82),
 'sage':    dict(eye=[(279,246,25,11),(381,246,25,11)], brows=[(270,190),(390,190)], m=(310,350,330,330,2), chin=385, neck=420, jaw=(235,425), crop=(330,250), view=.82),
 'wiseguy': dict(eye=[(245,267,26,21),(392,262,25,20)], brows=[(235,227),(400,222)], m=(267,392,392,330,8), chin=445, neck=470, jaw=(210,450), crop=(330,280), view=.88),
 'pirate':  dict(eye=[(262,269,30,11),(372,265,30,11)], brows=[(250,212),(377,210)], m=(290,355,392,322,2), chin=440, neck=480, jaw=(195,465), crop=(322,272), view=.88),
 'sheriff': dict(eye=[(267,262,22,7),(375,262,22,7)], brows=[(260,240),(380,240)], m=(295,355,394,325,-3), chin=445, neck=480, jaw=(230,425), crop=(325,270), view=.9),
 'aerobics':dict(eye=[(265,309,36,21),(377,309,36,21)], brows=[(262,265),(377,265)], m=(275,370,392,322,9), chin=452, neck=490, jaw=(225,425), crop=(322,290), view=.88),
 'butler':  dict(eye=[(267,236,28,13),(375,236,28,13)], brows=[(260,172),(382,170)], m=(257,390,342,325,8), chin=440, neck=470, jaw=(210,440), crop=(325,255), view=.85),
 'trainer': dict(eye=[(265,247,22,8),(375,247,22,8)], brows=[(252,215),(390,212)], m=(255,407,367,327,6), chin=450, neck=480, jaw=(220,440), crop=(327,262), view=.88),
 'hero':    dict(eye=[(265,266,22,7),(372,265,22,7)], brows=[(255,242),(382,242)], m=(270,370,355,320,5), chin=410, neck=440, jaw=(230,420), crop=(320,262), view=.9),
}
def blink(img, eyes):
    a = np.array(img); mask = np.zeros(a.shape[:2], np.uint8)
    for cx, cy, rx, ry in eyes: cv2.ellipse(mask, (int(cx), int(cy)), (int(rx * 1.15), int(ry * 1.45 + 2)), 0, 0, 360, 255, -1)
    out = cv2.inpaint(a, mask, 7, cv2.INPAINT_TELEA)
    im = Image.fromarray(out); d = ImageDraw.Draw(im)
    for cx, cy, rx, ry in eyes:
        ring = np.zeros_like(mask); cv2.ellipse(ring, (int(cx), int(cy)), (int(rx * 1.6), int(ry * 2.2 + 3)), 0, 0, 360, 255, -1)
        ring[mask > 0] = 0
        fill = out[int(cy), int(cx)].astype(float)
        line = (235, 235, 235) if fill.mean() < 70 else tuple(int(v) for v in fill * 0.22)
        w = max(2, int(ry * 0.28) + 1)
        y = cy + ry * 0.35
        d.arc([cx - rx * 1.05, y - ry * 0.9, cx + rx * 1.05, y + ry * 0.9], 15, 165, fill=line, width=w)
    return im
DY = -20   # landmarks were read off a grid whose y origin was 100, not 120
for p in L.values():
    p['eye'] = [(x, y + DY, rx, ry) for x, y, rx, ry in p['eye']]; p['brows'] = [(x, y + DY) for x, y in p['brows']]
    x0, x1, lip, cx, cu = p['m']; p['m'] = (x0, x1, lip + DY, cx, cu)
    p['chin'] += DY; p['neck'] += DY; p['crop'] = (p['crop'][0], p['crop'][1] + DY)
for c, p in L.items():
    base = Image.open(f'b640/{c}.jpg').convert('RGB')
    x0, x1, lip, cx, curve = p['m']
    meta = {'size': 640, 'eyes': [p['eye'][0][0] - 40, p['brows'][0][1] - 10, p['eye'][1][0] - p['eye'][0][0] + 80, p['eye'][0][1] - p['brows'][0][1] + 30],
            'eye': [list(e) for e in p['eye']], 'brows': [list(b) for b in p['brows']],
            'mouthLM': {'x0': x0, 'x1': x1, 'teeth': lip, 'curve': curve, 'lip': lip + 3, 'cx': cx, 'chin': p['chin'], 'neck': p['neck'], 'jaw_x0': p['jaw'][0], 'jaw_x1': p['jaw'][1]},
            'crop': list(p['crop']), 'view': p['view']}
    out = f'coaches/{c}'; import os; os.makedirs(out, exist_ok=True)
    base.save(f'{out}/base.jpg', quality=90); blink(base, p['eye']).save(f'{out}/blink.jpg', quality=90)
    s = 330; tx, ty = p['crop'][0] - s / 2, p['crop'][1] - s * 0.45
    tx, ty = max(0, min(640 - s, tx)), max(0, min(640 - s, ty))
    base.crop((int(tx), int(ty), int(tx + s), int(ty + s))).resize((160, 160), Image.LANCZOS).save(f'{out}/thumb.jpg', quality=88)
    json.dump(meta, open(f'{out}/frames.json', 'w'))
# contact sheet: base eye strip vs blink eye strip
rows = []
for c, p in L.items():
    y0 = int(min(e[1] for e in p['eye']) - 45); x0 = int(p['eye'][0][0] - 70); x1 = int(p['eye'][1][0] + 70)
    b = Image.open(f'coaches/{c}/base.jpg').crop((x0, y0, x1, y0 + 90)); k = Image.open(f'coaches/{c}/blink.jpg').crop((x0, y0, x1, y0 + 90))
    r = Image.new('RGB', (520, 90), 'white'); r.paste(b.resize((255, 90)), (0, 0)); r.paste(k.resize((255, 90)), (265, 0)); rows.append(r)
sheet = Image.new('RGB', (520, 90 * len(rows)), 'white')
for i, r in enumerate(rows): sheet.paste(r, (0, 90 * i))
sheet.save('blink_sheet.png')
