"""Mark which pixels of an outfit are cloth, so the dyed colour versions recolour only the clothes
(never skin, hair, eyes or the outline). The mask goes into a 5th atlas column ('dye').

    python3 tools/dye_masks.py [preview.png]

Run after tools/add_fashion.py. Outfits to mask = the bases in server/data.js DYE_SETS (and their 'f' sheets).
"""
import json, re, sys, colorsys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

OUT = 'public/assets/pchar'
src = open('server/data.js', encoding='utf-8').read()
sets = re.search(r'const DYE_SETS = \{(.*?)\};', src, re.S).group(1)
DY = {k: v.split(',') for k, v in re.findall(r"(\w+): \[([^\]]*)\]", sets)}
DY = {k: [x.strip(" '") for x in v] for k, v in DY.items()}
HUES = {k: int(v) for k, v in re.findall(r"(\w+): \['[^']+', (\d+)\]", re.search(r'const DYES = \{(.*?)\};', src, re.S).group(1))}
WT = set(re.search(r'const DYE_WHITE = \[(.*?)\]', src).group(1).replace("'", '').replace(' ', '').split(','))

meta = json.load(open(OUT + '.json')); atl = np.array(Image.open(OUT + '.webp').convert('RGBA'))
w, h, per = meta['w'], meta['h'], meta['per']; NL = len(meta['layers'])
rows = {}
for name, r in meta['rows'].items():
    bx, y = (r // per) * w * NL, (r % per) * h
    rows[name] = [atl[y:y + h, bx + c * w:bx + (c + 1) * w].copy() for c in range(NL)]
    if NL == 4: rows[name].append(np.zeros((h, w, 4), np.uint8))
meta['layers'] = ['base', 'shirt', 'pants', 'hair', 'dye']; NL = 5

def hsv(img):
    f = img[..., :3].astype(float) / 255; mx, mn = f.max(2), f.min(2)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]; d = np.maximum(mx - mn, 1e-6)
    hh = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return hh, s, mx

def skin_palette(img):
    """the face colours of this sheet: warm pixels in the middle of the head of the front frame"""
    a = img[..., 3] > 0; ys, xs = np.where(a); y0, y1 = ys.min(), ys.max(); x0, x1 = xs.min(), xs.max()
    hh, s, v = hsv(img); H = y1 - y0
    reg = np.zeros_like(a); reg[y0 + int(H * .16):y0 + int(H * .40), x0 + (x1 - x0) // 4:x1 - (x1 - x0) // 4] = True
    warm = reg & a & ((hh < 40) | (hh > 345)) & (s > .24) & (s < .72) & (v > .5)
    if warm.sum() < 25: return np.zeros((0, 3))
    cols = img[warm][:, :3].astype(int) // 6 * 6
    u, n = np.unique(cols, axis=0, return_counts=True)
    keep = u[n >= max(3, n.max() * .05)]
    return keep + 3

def mask(img, pal):
    a = img[..., 3] > 0; hh, s, v = hsv(img); px = img[..., :3].astype(int)
    m = a & (v > .26)
    if len(pal):
        d = np.min(np.sqrt(((px[:, :, None, :] - pal[None, None]) ** 2).sum(3)), 2)
        m &= d > 30
    m &= ~((hh >= 4) & (hh <= 40) & (s > .25) & (s < .68) & (v > .5))   # any skin tone (face, hands, side views)
    m &= ~((s > .28) & ((hh < 42) | (hh > 350)) & (v < .62))      # brown hair / leather / dark red-brown shading
    m &= (s > .22) | (v > .6)                                   # cloth: coloured, or white/grey cloth
    lab, n = ndi.label(m)
    if n: sz = ndi.sum(m, lab, range(1, n + 1)); m = np.isin(lab, [i + 1 for i, z in enumerate(sz) if z >= 6])
    return m

def dye(img, m, hue, wt):
    out = img.copy(); hh, s, v = hsv(img)
    sel = m & ((s > .2) | (wt & (v > .55)))
    s2 = np.where(s < .15, .3, s); H = hue / 60
    for (y, x) in zip(*np.where(sel)):
        r, g, b = colorsys.hsv_to_rgb(hue / 360, s2[y, x], v[y, x]); out[y, x, :3] = [r * 255, g * 255, b * 255]
    return out

sheets = [o for o in DY if f'{o}:down0' in rows] + ['f' + o for o in DY if f'f{o}:down0' in rows]
prev = []
for sh in sheets:
    pal = skin_palette(rows[f'{sh}:down0'][0])
    for f in ['down0', 'down1', 'down2', 'up0', 'up1', 'left0', 'left1', 'left2']:
        n = f'{sh}:{f}'
        if n not in rows: continue
        m = mask(rows[n][0], pal); c = np.zeros((h, w, 4), np.uint8); c[m] = 255; rows[n][4] = c
    base = sh[1:] if sh not in DY else sh
    img = rows[f'{sh}:down0'][0]; side = rows[f'{sh}:left0'][0]
    prev.append([img, side] + [dye(x, rows[f'{sh}:{fr}'][4][..., 3] > 0, HUES[d], base in WT) for d in DY[base] for x, fr in ((img, 'down0'), (side, 'left0'))])
    print(sh, 'skin colours', len(pal))

order = sorted(meta['rows'], key=meta['rows'].get); blocks = -(-len(order) // per)
out = np.zeros((h * min(per, len(order)), w * NL * blocks, 4), np.uint8)
for i, name in enumerate(order):
    bx, y = (i // per) * w * NL, (i % per) * h
    for c in range(NL): out[y:y + h, bx + c * w:bx + (c + 1) * w] = rows[name][c]
Image.fromarray(out, 'RGBA').save(OUT + '.webp', 'WEBP', lossless=True); json.dump(meta, open(OUT + '.json', 'w'))
print('atlas', out.shape)
if len(sys.argv) > 1:
    cols = max(len(r) for r in prev); S = Image.new('RGBA', (w * cols, h * len(prev)), (205, 225, 205, 255))
    for i, r in enumerate(prev):
        for j, x in enumerate(r): S.alpha_composite(Image.fromarray(x), (j * w, i * h))
    S.save(sys.argv[1])
