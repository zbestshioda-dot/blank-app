"""Add the fashion outfits (tools/sheets/fashion_<id>.jpg, 3x3 sheets on a plain beige background) to the
character atlas public/assets/pchar.webp/json without rebuilding the rest. Safe to run again: frames already
in the atlas with the same name are replaced.

    python3 tools/add_fashion.py

Sheet layout: row 1 = front (3 walk frames), row 2 = back, row 3 = side. Side frames are flipped so they all
face left (the game mirrors them for right). 'f' + id = the women's version.
"""
import glob, json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

OUT = 'public/assets/pchar'
SPR_H = 90          # sprite height in the 96px frame (same as the other outfits)
FRAMES = {'down0': (0, 1), 'down1': (0, 0), 'down2': (0, 2), 'up0': (1, 1), 'up1': (1, 2),
          'left0': (2, 1), 'left1': (2, 0), 'left2': (2, 2)}

meta = json.load(open(OUT + '.json')); atl = np.array(Image.open(OUT + '.webp').convert('RGBA'))
w, h, per = meta['w'], meta['h'], meta['per']; NL = len(meta['layers'])
rows = {}
for name, r in meta['rows'].items():
    bx, y = (r // per) * w * NL, (r % per) * h
    rows[name] = [atl[y:y + h, bx + c * w:bx + (c + 1) * w].copy() for c in range(NL)]
order = sorted(meta['rows'], key=meta['rows'].get)

def faces_right(rgb, m):
    """the face (skin) sits on the side the character looks at; no skin (helmets) = as drawn (right)"""
    hh = m.shape[0]; top = slice(0, int(hh * .5))
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    skin = m & (r > 180) & (g > 110) & (g < 205) & (b > 70) & (b < 170) & (r - b > 45)
    ys, xs = np.where(skin[top]); hx = np.where(m[top].any(0))[0]
    if len(xs) < 30: return True
    return xs.mean() > (hx.min() + hx.max()) / 2

# per-sheet fixes for generated sheets that are not consistent: 'frames' re-points a frame to another cell (r, c),
# 'pink' recolours a bright blue shirt to the pink of the front frames (so the shirt does not change colour as they walk)
SHEET_FIX = {'racer': {'frames': {'down2': (0, 0), 'left2': (2, 0)}, 'pink': 1},   # (the 3rd front / side cells carry another shirt with a beer logo)
             'fracer': {'frames': {'down2': (0, 0)}, 'pink': 1},
             'fwinter': {'green': 1},
             'rider': {'frames': {'down1': (0, 2)}}}   # (one front cell has the polo shirt instead of the jacket)   # (the hat / coat come out purple in some cells, green in others)

def greenify(im):
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    lum = r * .3 + g * .59 + b * .11
    m = (((b > g + 6) & (r > g + 6)) | ((r > g + 10) & (b >= g - 3))) & (lum < 150)
    for i, c in enumerate((.72, 1.12, .92)): im[..., i] = np.where(m, np.clip(lum * c, 0, 255), im[..., i])
    return im

def pinkify(im):
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    m = (b > 195) & (g > 115) & (r < 140)
    lum = (r * .3 + g * .59 + b * .11) / 175.0
    for i, c in enumerate((238, 78, 150)): im[..., i] = np.where(m, np.clip(c * lum, 0, 255), im[..., i])
    return im

POSE = {'sitfront': (0, 0), 'sitback': (0, 1), 'sitside': (0, 2)}   # tools/sheets/pose_<id>.jpg: one row, sitting front / back / side

def cut(src, grid=(3, 3), names=None, k=None):
    im = np.array(Image.open(src).convert('RGB')).astype(int); H, W = im.shape[:2]
    fix = SHEET_FIX.get(os.path.basename(src)[8:-4], {}) if names is None else {}
    if fix.get('pink'): im = pinkify(im)
    if fix.get('green'): im = greenify(im)
    bg = np.median(np.concatenate([im[:20, :20].reshape(-1, 3), im[-20:, -20:].reshape(-1, 3), im[:20, -20:].reshape(-1, 3)]), 0)
    fg = np.sqrt(((im - bg) ** 2).sum(2)) > 38
    fg = ndi.binary_opening(fg, iterations=2)
    out = {}
    for fname, (ry, cx) in (names or {**FRAMES, **fix.get('frames', {})}).items():
        y0, y1, x0, x1 = ry * H // grid[0], (ry + 1) * H // grid[0], cx * W // grid[1], (cx + 1) * W // grid[1]
        win = fg[y0:y1, x0:x1]; lab, n = ndi.label(win)
        sz = ndi.sum(win, lab, range(1, n + 1)); big = sz.max()
        m = np.isin(lab, [i + 1 for i, s in enumerate(sz) if s > big * .04])
        m = ndi.binary_fill_holes(ndi.binary_closing(m, iterations=3))
        ys, xs = np.where(m); sub = im[y0:y1, x0:x1][ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        mm = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        side = fname.startswith('left') or fname == 'sitside'
        if side and not faces_right(sub, mm): sub, mm = sub[:, ::-1], mm[:, ::-1]
        if side: sub, mm = sub[:, ::-1], mm[:, ::-1]       # store facing left
        a = np.dstack([sub, mm * 255]).astype(np.uint8)
        out[fname] = Image.fromarray(a, 'RGBA')
    # one scale per sheet (from the standing front frame) so every frame keeps the same size
    k = k or SPR_H / out['down0'].height
    frames = {}
    for fname, spr in out.items():
        s = spr.resize((max(1, round(spr.width * k)), max(1, round(spr.height * k))), Image.LANCZOS)
        a = np.array(s); a[..., 3] = np.where(a[..., 3] > 110, 255, 0)
        ys, xs = np.where(a[..., 3] > 0); top = ys.min() + (ys.max() - ys.min()) * .4
        hx = xs[ys <= top]; cxh = (hx.min() + hx.max()) / 2
        c = np.zeros((h, w, 4), np.uint8)
        ox, oy = int(round(w / 2 - cxh)), int(round(meta['feet'][1] + 1 - a.shape[0]))
        sx0, sy0 = max(0, -ox), max(0, -oy); dx0, dy0 = max(0, ox), max(0, oy)
        cw_, ch_ = min(a.shape[1] - sx0, w - dx0), min(a.shape[0] - sy0, h - dy0)
        c[dy0:dy0 + ch_, dx0:dx0 + cw_] = a[sy0:sy0 + ch_, sx0:sx0 + cw_]
        frames[fname] = c
    return frames, k

for src in sorted(glob.glob('tools/sheets/fashion_*.jpg')):
    oid = os.path.basename(src)[8:-4]
    frames, k = cut(src)
    pose = src.replace('fashion_', 'pose_')
    if os.path.exists(pose): frames.update(cut(pose, (1, 3), POSE, k)[0])
    for fname, c in frames.items():
        name = f'{oid}:{fname}'
        if name not in rows: order.append(name)
        rows[name] = [c] + [np.zeros_like(c) for _ in range(NL - 1)]
    print('added', oid)

blocks = -(-len(order) // per)
out = np.zeros((h * min(per, len(order)), w * NL * blocks, 4), np.uint8); newrows = {}
for i, name in enumerate(order):
    bx, y = (i // per) * w * NL, (i % per) * h
    for c in range(NL): out[y:y + h, bx + c * w:bx + (c + 1) * w] = rows[name][c]
    newrows[name] = i
Image.fromarray(out, 'RGBA').save(OUT + '.webp', 'WEBP', lossless=True)
meta['rows'] = newrows; json.dump(meta, open(OUT + '.json', 'w'))
print('atlas', out.shape, len(order), 'frames')
