"""Build the character atlas (public/assets/chars.webp + chars.json) from the paper-doll sheet.

    python3 tools/build_chars.py [tools/sheets/characters.jpg]

1. cut every part off the pink background (connected components on a background mask)
2. name the parts we use (by their order on the sheet)
3. place each layer on a common 150x260 canvas so they stack (body, pants, shirt, hair, hat)
4. scale down, crop to content and pack into one atlas; json stores [x, y, w, h, offsetX, offsetY]
"""
import json, sys, math
import numpy as np
from PIL import Image, ImageDraw, ImageOps
from scipy import ndimage as ndi

SRC = sys.argv[1] if len(sys.argv) > 1 else 'tools/sheets/characters.jpg'
OUT = 'public/assets/chars'
SCALE = 0.55                      # canvas 150x260 -> 83x143 in the atlas

# ---------------------------------------------------------------- 1. cut parts out
im = Image.open(SRC).convert('RGB'); A = np.array(im).astype(int)
R, G, B = A[..., 0], A[..., 1], A[..., 2]
panel = (R >= 238) & (abs(G - 207) <= 18) & (B >= G - 6) & (B <= G + 18)
outer = (R >= 225) & (G >= 130) & (G <= 180) & (B >= G - 12) & (B <= G + 15)
bg = panel | outer
lab, n = ndi.label(bg); sz = ndi.sum(bg, lab, range(1, n + 1))
fg = ndi.binary_opening(~np.isin(lab, [i + 1 for i, s in enumerate(sz) if s > 2000]), iterations=1)
lab, n = ndi.label(fg)
boxes = []
for i, sl in enumerate(ndi.find_objects(lab)):
    h = sl[0].stop - sl[0].start; w = sl[1].stop - sl[1].start
    if h * w < 150 or h > 300: continue
    boxes.append((sl[1].start, sl[0].start, w, h, i + 1))

# ---------------------------------------------------------------- 2. names (index in reading order of components)
NAMES = {12: 'body_f_smile', 13: 'body_s', 20: 'eye_lash_l', 21: 'eye_lash_r', 61: 'hair_bob', 62: 'hair_swept', 60: 'hair_pony',
         58: 'hair_braid', 56: 'hair_bun', 59: 'hair_m', 45: 'hat_beanie', 48: 'hat_straw', 47: 'hat_beret', 46: 'hat_green', 57: 'hat_hood',
         69: 'pants_f', 70: 'pants_f2', 71: 'pants_s', 78: 'pants_s2', 89: 'shirt_blue', 90: 'shirt_blue_s', 88: 'shirt_green',
         95: 'shirt_yellow', 97: 'shirt_yellow_s', 96: 'shirt_stripe', 91: 'bag_red', 99: 'basket', 98: 'satchel', 116: 'i_can',
         113: 'i_rod', 115: 'i_berries', 114: 'i_lantern', 121: 'i_trowel', 124: 'i_map', 118: 'm_heart', 117: 'm_bulb', 129: 'm_dizzy', 128: 'm_sparkle'}
P = {}
for k, (x, y, w, h, i) in enumerate(boxes):
    if k not in NAMES: continue
    sub = A[y:y + h, x:x + w]; m = ndi.binary_fill_holes(lab[y:y + h, x:x + w] == i)
    r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]
    edge = m & ~ndi.binary_erosion(m, iterations=2)
    m = m & ~(edge & (r >= 235) & (b >= g - 8) & (g >= 185))          # leftover pink at the rim
    alpha = np.where(m & ~ndi.binary_erosion(m), 180, m * 255).astype(np.uint8)
    P[NAMES[k]] = Image.fromarray(np.dstack([sub.astype(np.uint8), alpha]), 'RGBA')
assert len(P) == len(NAMES), f'found {len(P)} of {len(NAMES)} parts - did the sheet change?'

# female faces: lashed eyes painted over the plain dot eyes
SKIN = (250, 216, 191, 255)
def with_lashes(src, eyes):
    b = P[src].copy(); d = ImageDraw.Draw(b)
    for cx, cy, ln in eyes:
        d.ellipse([cx - 6, cy - 7, cx + 6, cy + 7], fill=SKIN)
        e = P[ln].resize((round(P[ln].width * .62), round(P[ln].height * .62)), Image.LANCZOS)
        b.alpha_composite(e, (round(cx - e.width / 2), round(cy - e.height / 2 - 1)))
    return b
P['body_f_fem'] = with_lashes('body_f_smile', [(43, 50, 'eye_lash_l'), (81, 49.5, 'eye_lash_r')])
P['body_s_fem'] = with_lashes('body_s', [(83, 49.4, 'eye_lash_r')])

# ---------------------------------------------------------------- 3. layers on a shared canvas
CW, CH, BY, X = 150, 260, 40, 75
def placed(n, cx, top, sc, flip=False, sx=None):
    p = P[n].resize((max(1, round(P[n].width * (sx or sc))), max(1, round(P[n].height * sc))), Image.LANCZOS)
    if flip: p = p.transpose(Image.FLIP_LEFT_RIGHT)
    c = Image.new('RGBA', (CW, CH), (0, 0, 0, 0)); c.alpha_composite(p, (round(cx - p.width / 2), round(top))); return c
def tint(img, rgb):
    a = img.split()[-1]; col = ImageOps.colorize(ImageOps.grayscale(img.convert('RGB')), (20, 20, 20), rgb, mid=tuple(int(c * .75) for c in rgb)); col.putalpha(a); return col
# side view: the same hair as the front, pushed a little towards the back of the head (the face looks right)
HAIR_F = {'bob': (X, BY - 2, 1.22), 'swept': (X, BY - 4, 1.12), 'pony': (X + 6, BY - 4, 1.2), 'braid': (X - 4, BY - 4, 1.3), 'bun': (X, BY - 18, 1.35), 'm': (X, BY - 2, 1.4)}
HAIR = {k: (f, (f[0] - 9, f[1] - 1, f[2] * 1.02)) for k, f in HAIR_F.items()}
HAT = {'beanie': ((X, BY - 22, 1.42), (X - 6, BY - 22, 1.36)), 'straw': ((X, BY - 20, 1.12), (X - 4, BY - 20, 1.1)), 'beret': ((X + 2, BY - 10, 1.3), (X - 6, BY - 10, 1.25)),
       'green': ((X, BY - 10, 1.32), (X - 6, BY - 10, 1.26)), 'hood': ((X, BY - 14, 1.3), (X - 2, BY - 14, 1.28))}
L = {}
L['body_front_m'] = placed('body_f_smile', X, BY, 1); L['body_front_f'] = placed('body_f_fem', X, BY, 1)
L['body_side_m'] = placed('body_s', X, BY, 1); L['body_side_f'] = placed('body_s_fem', X, BY, 1)
b = placed('body_f_smile', X, BY, 1); d = ImageDraw.Draw(b)
d.ellipse([X - 45, BY + 2, X + 45, BY + 92], fill=(124, 86, 56, 255), outline=(72, 46, 30, 255), width=3)
d.arc([X - 38, BY + 10, X + 38, BY + 80], 200, 340, fill=(150, 108, 72, 255), width=3); L['body_back'] = b
L['pants_front0'] = placed('pants_f', X, BY + 132, .95); L['pants_front1'] = placed('pants_f2', X, BY + 132, .95)
L['pants_side0'] = placed('pants_s', X + 6, BY + 132, .95); L['pants_side1'] = placed('pants_s2', X + 6, BY + 132, .95)
for k in ('blue', 'green', 'yellow', 'stripe'): L[f'shirt_{k}_front'] = placed('shirt_' + k, X, BY + 74, .86)
L['shirt_blue_side'] = placed('shirt_blue_s', X + 4, BY + 74, .92); L['shirt_yellow_side'] = placed('shirt_yellow_s', X + 4, BY + 74, .92)
L['shirt_green_side'] = tint(placed('shirt_blue_s', X + 4, BY + 74, .92), (150, 190, 95))
L['shirt_stripe_side'] = placed('shirt_stripe', X + 4, BY + 74, .86, sx=.55)
for k, (f, s) in HAIR.items():
    L[f'hair_{k}_front'] = placed('hair_' + k, *f); sd = placed('hair_' + k, *s)
    # side view: trim the fringe in front of the face so the eye shows
    cut = Image.new('L', (CW, CH), 255); ImageDraw.Draw(cut).rectangle([X + 12, BY + 36, CW, CH], fill=0)
    sd.putalpha(Image.composite(sd.getchannel('A'), Image.new('L', (CW, CH), 0), cut)); L[f'hair_{k}_side'] = sd
    if k in ('pony', 'braid', 'bun'): L[f'hair_{k}_back'] = placed('hair_' + k, *f, flip=True)
for k, (f, s) in HAT.items(): L[f'hat_{k}_front'] = placed('hat_' + k, *f); L[f'hat_{k}_side'] = placed('hat_' + k, *s)
# held items, bags and emote bubbles keep their own size (anchor = centre)
SMALL = {'i_rod': .5, 'i_can': .5, 'i_trowel': .5, 'i_lantern': .45, 'i_map': .45, 'i_berries': .45, 'basket': .42, 'bag_red': .45, 'satchel': .42,
         'm_heart': .5, 'm_bulb': .5, 'm_dizzy': .5, 'm_sparkle': .5}

# ---------------------------------------------------------------- 4. pack
tiles = []
for k, c in L.items():
    c = c.resize((round(CW * SCALE), round(CH * SCALE)), Image.LANCZOS); bb = c.getbbox(); tiles.append((k, c.crop(bb), bb[0], bb[1]))
for k, sc in SMALL.items():
    c = P[k].resize((round(P[k].width * sc * SCALE * 2), round(P[k].height * sc * SCALE * 2)), Image.LANCZOS); tiles.append((k, c, -c.width / 2, -c.height / 2))
tiles.sort(key=lambda t: -t[1].height)
W = 1024; x = y = rowh = 0; pos = {}
for k, c, ox, oy in tiles:
    if x + c.width > W: x = 0; y += rowh + 2; rowh = 0
    pos[k] = (x, y); x += c.width + 2; rowh = max(rowh, c.height)
atlas = Image.new('RGBA', (W, y + rowh), (0, 0, 0, 0)); meta = {}
for k, c, ox, oy in tiles:
    px, py = pos[k]; atlas.alpha_composite(c, (px, py)); meta[k] = [px, py, c.width, c.height, round(ox, 1), round(oy, 1)]
atlas.save(OUT + '.webp', 'WEBP', quality=92, method=6)
json.dump({'canvas': [round(CW * SCALE), round(CH * SCALE)], 'feet': [round(X * SCALE, 1), round(254 * SCALE, 1)], 'sprites': meta}, open(OUT + '.json', 'w'), separators=(',', ':'))
print('atlas', atlas.size, len(meta), 'sprites')
