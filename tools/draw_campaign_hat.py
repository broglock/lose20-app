import sys
from PIL import Image, ImageDraw, ImageFilter
import numpy as np
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB'); a = np.array(im).astype(int)
H, W, _ = a.shape
bg = np.array([252, 204, 50])
r, g, b = a[..., 0], a[..., 1], a[..., 2]
skin = (r > 180) & (g > 120) & (g < 215) & (b > 70) & (b < 190) & (r - b > 50)
yy, xx = np.mgrid[0:H, 0:W]
# erase the old bucket hat: everything above the brow line that is not skin, plus everything outside the head columns
skin &= b > 100
erase = (yy < 250) | ((yy < 300) & ~skin)
erase |= (yy < 430) & ((xx < 204) | (xx > 822))
a[erase] = bg
im = Image.fromarray(a.astype('uint8'))
S = 2
L = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0)); d = ImageDraw.Draw(L)
P = lambda pts: [(x * S, y * S) for x, y in pts]
K, OL, OLD, OLL, BR, GOLD = (20, 20, 20, 255), (122, 128, 66, 255), (88, 94, 46, 255), (146, 152, 84, 255), (98, 60, 30, 255), (226, 176, 52, 255)
lw = 7 * S
# brim: rigid, flat, seen nearly edge-on
cx, cy, rx, ry = 512, 282, 455, 40
d.ellipse([(cx - rx) * S, (cy - ry) * S, (cx + rx) * S, (cy + ry) * S], fill=OLD, outline=K, width=lw)
d.ellipse([(cx - rx + 18) * S, (cy - ry + 4) * S, (cx + rx - 18) * S, (cy + ry - 22) * S], fill=OL)
# crown with four-dent Montana peak
crown = [(318, 286), (330, 170), (372, 104), (512, 26), (652, 104), (694, 170), (706, 286)]
d.polygon(P(crown), fill=OL)
# side facets darker
d.polygon(P([(318, 286), (330, 170), (372, 104), (512, 26), (420, 268)]), fill=OLD)
d.polygon(P([(706, 286), (694, 170), (652, 104), (512, 26), (604, 268)]), fill=OLD)
d.polygon(P([(512, 26), (470, 120), (512, 268), (554, 120)]), fill=OLL)
d.line(P(crown), fill=K, width=lw, joint='curve')
for seg in ([(512, 30), (420, 268)], [(512, 30), (604, 268)], [(512, 34), (470, 120), (512, 200)], [(512, 34), (554, 120), (512, 200)]):
    d.line(P(seg), fill=K, width=4 * S, joint='curve')
# leather band
d.polygon(P([(320, 252), (704, 252), (706, 288), (318, 288)]), fill=BR)
d.line(P([(320, 252), (704, 252)]), fill=K, width=4 * S); d.line(P([(318, 288), (706, 288)]), fill=K, width=5 * S)
# brass badge
d.ellipse(P([(478, 170), (546, 238)]), fill=GOLD, outline=K, width=5 * S)
d.ellipse(P([(492, 184), (532, 224)]), outline=(150, 110, 30, 255), width=4 * S)
d.polygon(P([(512, 188), (520, 204), (536, 204), (523, 214), (528, 230), (512, 220), (496, 230), (501, 214), (488, 204), (504, 204)]), fill=(150, 110, 30, 255))
# brim front edge redrawn over the crown base
d.arc([(cx - rx) * S, (cy - ry) * S, (cx + rx) * S, (cy + ry) * S], 0, 180, fill=K, width=lw)
L = L.resize((W, H), Image.LANCZOS)
im = im.convert('RGBA'); im.alpha_composite(L); im.convert('RGB').save(out, quality=94)
