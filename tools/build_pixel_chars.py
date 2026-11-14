"""Build the player/NPC sprite atlas from the pixel-art sheet (tools/sheets/pixel_char.jpg, 4x5 frames on magenta).

    python3 tools/build_pixel_chars.py

Each frame is split into four layers so the game can recolour it per player:
  base  (outline, skin, eyes, shoes)   - drawn as is
  shirt / pants / hair                 - stored as grey shading, tinted at runtime
Output: public/assets/pchar.webp + pchar.json  {frame: [x, y], layers order, size, feet}
"""
import json
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

OUT = 'public/assets/pchar'
# outfit -> (sheet, which layers are recoloured). Outfits other than 'base' keep their clothes and only dye the hair.
SHEETS = {'base': ('tools/sheets/pixel_char.jpg', ('shirt', 'pants', 'hair')), 'doctor': ('tools/sheets/pixel_doctor.jpg', ('hair',)),
          'police': ('tools/sheets/pixel_police.jpg', ()),
          'farmer': ('tools/sheets/pixel_farmer.jpg', ()),
          'chef': ('tools/sheets/pixel_chef.jpg', ()),
          'merchant': ('tools/sheets/pixel_merchant.jpg', ('hair',)),
          'office': ('tools/sheets/pixel_office.jpg', ('hair',)),
          'fisher': ('tools/sheets/pixel_fisher.jpg', ()),
          'rider': ('tools/sheets/pixel_rider.jpg', ()),
          'beggar': ('tools/sheets/pixel_beggar.jpg', ()),
          'thief': ('tools/sheets/pixel_thief.jpg', ())}
# per-sheet frame overrides (some sheets put the poses in different cells)
FRAME_FIX = {'police': {'left2': 6}, 'fisher': {'down2': 13}, 'rider': {'down1': 10, 'down2': 15, 'left1': -7, 'left2': -17}, 'beggar': {'up0': 19, 'up1': 19},
             'thief': {'down1': 10, 'down2': 15, 'up0': 4, 'up1': 9, 'left1': 6, 'left2': -7}}   # negative = use that cell mirrored
TARGET_H = 96
# which sheet frame (reading order, 0-19) is used for each direction / walk step; right = mirrored left
FRAMES = {'down0': 0, 'down1': 16, 'down2': 18, 'up0': 14, 'up1': 19, 'left0': 5, 'left1': 7, 'left2': 17}

# frame cells: all sheets share the same 4x5 layout (centres measured on the first sheet)
CELLS = [(cx, cy) for cy in (128, 384, 640, 896) for cx in (128, 384, 591, 768, 921)]
def load(src):
    """returns A (pixels) and FR: per frame (x, y, w, h, mask). Each frame is cut from its own grid cell,
    so sprites whose hats touch a neighbour are still separated."""
    global A, FR
    im = Image.open(src).convert('RGB'); A = np.array(im).astype(int)
    R, G, B = A[..., 0], A[..., 1], A[..., 2]
    bg = (R > 150) & (B > 150) & (G < 120)
    grid = (R > 80) & (B > 80) & (G < 70) & (abs(R - B) < 70)
    fg = ndi.binary_opening(~(bg | grid), iterations=1)
    FR = []
    for cx, cy in CELLS:
        xs_row = sorted({c[0] for c in CELLS}); j = xs_row.index(cx)
        left = (xs_row[j - 1] + cx) // 2 if j else 0; right = (cx + xs_row[j + 1]) // 2 if j + 1 < len(xs_row) else A.shape[1]
        x0, x1, y0, y1 = max(left, cx - 95), min(right, cx + 95), max(0, cy - 128), min(A.shape[0], cy + 128)
        win = fg[y0:y1, x0:x1].copy()
        lab, n = ndi.label(win)
        sz = ndi.sum(win, lab, range(1, n + 1))
        # keep the blob at the centre of the cell (+ any big blob touching it), drop pieces of the neighbours
        mid = lab[(y1 - y0) // 2 - 10:(y1 - y0) // 2 + 10, (x1 - x0) // 2 - 10:(x1 - x0) // 2 + 10]
        keep = set(np.unique(mid)) - {0}
        if not keep: keep = {int(np.argmax(sz)) + 1}
        m = np.isin(lab, list(keep))
        ys, xs = np.where(m)
        FR.append((x0 + xs.min(), y0 + ys.min(), xs.max() - xs.min() + 1, ys.max() - ys.min() + 1, m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]))

OUTLINE = np.array([46, 14, 8])
def split(k, tint):
    flip = k < 0; k = abs(k)
    x, y, w, h, m = FR[k]
    sub = A[y:y + h, x:x + w].copy(); m = ndi.binary_fill_holes(m)
    if flip: sub = sub[:, ::-1].copy(); m = m[:, ::-1].copy()
    r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]
    # magenta-tinted rim pixels are outline blended with the background: make them outline
    tinted = m & (b > g + 25) & (r > g + 20)
    sub[tinted] = OUTLINE
    r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]
    lum = (r * .3 + g * .59 + b * .11)
    yy = np.arange(h)[:, None].repeat(w, 1)
    neutral = m & (abs(r - g) < 28) & (abs(g - b) < 28) & (lum > 95)
    bright = neutral & (lum > 228)
    rows = np.where(bright.sum(1) >= 6)[0]
    shirt_bottom = rows.max() if len(rows) else int(h * .72)
    shirt = neutral & (yy <= shirt_bottom)
    pants = neutral & (yy > shirt_bottom)
    brown = m & (r > g) & (g > b) & (r < 150) & (r > 55) & (g < 105) & (b < 80) & (r - b > 25)
    hair = brown & (yy < h * .55) if 'hair' in tint else m & False
    # eyes and brows are the same dark brown: keep only the big connected hair mass
    hl, hn = ndi.label(hair)
    if hn:
        sz = ndi.sum(hair, hl, range(1, hn + 1)); hair = np.isin(hl, [j + 1 for j, v in enumerate(sz) if v >= max(sz) * .15])
    if 'shirt' not in tint: shirt = shirt & False
    if 'pants' not in tint: pants = pants & False
    base = m & ~shirt & ~pants & ~hair
    return sub, m, {'base': base, 'shirt': shirt, 'pants': pants, 'hair': hair}, lum

frames = {}
for outfit, (src, tint) in SHEETS.items():
  load(src)
  for fname, k in {**FRAMES, **FRAME_FIX.get(outfit, {})}.items():
    name = fname if outfit == 'base' else f'{outfit}:{fname}'
    sub, m, L, lum = split(k, tint)
    ys, xs = np.where(m)
    layers = {}
    for ln, msk in L.items():
        a = np.zeros(sub.shape[:2] + (4,), np.uint8)
        if ln == 'base':
            a[..., :3] = sub
        else:
            v = lum[msk]; top = np.percentile(v, 97) if len(v) else 255
            g = np.clip(lum / max(top, 1) * 255, 0, 255).astype(np.uint8)
            a[..., 0] = a[..., 1] = a[..., 2] = g
        a[..., 3] = (msk * 255).astype(np.uint8)
        layers[ln] = Image.fromarray(a, 'RGBA')
    # align on the head (top 40% of the sprite), not the whole body: swinging arms/legs change the
    # body's width per frame and would make the head jump sideways while walking
    top = ys.min() + (ys.max() - ys.min()) * 0.4
    hx = xs[ys <= top]
    frames[name] = (layers, hx.min(), hx.max(), ys.max())

# 8-frame walk strips for the base (recolourable) character: tools/sheets/pixel_walk_front.png / _back.png
# (grey sprites on magenta, one row of 8). They replace the base front/back frames: down0-7 and up0-7.
# Layers: hair = the dark grey mass on the head, shirt = the white, pants = the shorts band right under
# the shirt (between the arms), everything else (skin, outline, eyes) is base with the skin tinted.
SKIN = np.array([246, 196, 150])
def walk_strip(src):
    A = np.array(Image.open(src).convert('RGB')).astype(int)
    R, G, B = A[..., 0], A[..., 1], A[..., 2]
    bg = (R > 150) & (B > 150) & (G < 120)
    fg = ndi.binary_opening(~bg, iterations=1)
    col = fg.sum(0); runs = []; start = None
    for x, v in enumerate(col):
        if v and start is None: start = x
        if not v and start is not None: runs.append((start, x)); start = None
    out = []
    for x0, x1 in runs:
        if x1 - x0 < 40: continue
        win = fg[:, x0:x1]; lab, n = ndi.label(win); sz = ndi.sum(win, lab, range(1, n + 1))
        m = lab == int(np.argmax(sz)) + 1; m = ndi.binary_fill_holes(m)
        ys, xs = np.where(m); y0, y1, xa, xb = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        m = m[y0:y1, xa:xb]; sub = A[y0:y1, x0 + xa:x0 + xb].copy()
        r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]
        tinted = m & (b > g + 25) & (r > g + 20); sub[tinted] = OUTLINE          # magenta-blended rim -> outline
        lum = sub[..., 0] * .3 + sub[..., 1] * .59 + sub[..., 2] * .11
        h, w = m.shape; yy = np.arange(h)[:, None].repeat(w, 1)
        # hair: the big dark-grey blob at the top
        hair = m & (lum >= 48) & (lum < 118) & (yy < h * .6)
        hl, hn = ndi.label(hair)
        if hn: sz2 = ndi.sum(hair, hl, range(1, hn + 1)); hair = np.isin(hl, [j + 1 for j, v in enumerate(sz2) if v >= max(sz2) * .15])
        hair = ndi.binary_closing(hair, iterations=2) & m & (lum >= 40) & (lum < 130)
        shirt = m & (lum >= 222) & (yy > h * .35)
        sl, sn = ndi.label(shirt)
        if sn: sz3 = ndi.sum(shirt, sl, range(1, sn + 1)); shirt = sl == int(np.argmax(sz3)) + 1
        shirt = ndi.binary_closing(shirt, iterations=2) & m & (lum >= 150)
        sr = np.where(shirt.any(1))[0]; sb = sr.max()
        xs_b = np.where(shirt[sb - 3:sb + 1].any(0))[0]; sx0, sx1 = xs_b.min(), xs_b.max()
        band = (yy > sb) & (yy <= sb + int(h * .11))
        xx = np.arange(w)[None, :].repeat(h, 0)
        pants = m & band & (xx >= sx0) & (xx <= sx1) & (lum >= 120)
        base = m & ~hair & ~shirt & ~pants
        skin = base & (lum >= 110)
        rgb = sub.copy()
        ref = np.percentile(lum[skin], 90) if skin.any() else 180
        f = np.clip(lum / ref, 0, 1.12)[..., None]
        rgb[skin] = np.clip(SKIN[None, :] * f[skin], 0, 255).astype(int)
        out.append((rgb, m, {'base': base, 'shirt': shirt, 'pants': pants, 'hair': hair}, lum))
    return out
def _h(name):
    al = np.array(frames[name][0]['base'])[..., 3] > 0
    for ln in ('shirt', 'pants', 'hair'): al |= np.array(frames[name][0][ln])[..., 3] > 0
    ys = np.where(al.any(1))[0]; return ys.max() - ys.min() + 1
old_h = _h('down0')
for view, src in (('down', 'tools/sheets/pixel_walk_front.png'), ('up', 'tools/sheets/pixel_walk_back.png')):
    strip = walk_strip(src)
    for k in [k for k in list(frames) if ':' not in k and k.startswith(view)]: del frames[k]
    for i, (rgb, m, L, lum) in enumerate(strip):
        sc2 = old_h / m.shape[0]; nw, nh = max(1, round(m.shape[1] * sc2)), old_h
        layers = {}
        for ln, msk in L.items():
            a = np.zeros(m.shape + (4,), np.uint8)
            if ln == 'base': a[..., :3] = rgb
            else:
                v = lum[msk]; top = np.percentile(v, 97) if len(v) else 255
                gg = np.clip(lum / max(top, 1) * 255, 0, 255).astype(np.uint8); a[..., 0] = a[..., 1] = a[..., 2] = gg
            a[..., 3] = (msk * 255).astype(np.uint8)
            layers[ln] = Image.fromarray(a, 'RGBA').resize((nw, nh), Image.LANCZOS)
        al = np.zeros((nh, nw), bool)
        for im in layers.values(): al |= np.array(im)[..., 3] > 60
        ys, xs = np.where(al); top = ys.min() + (ys.max() - ys.min()) * 0.4; hx = xs[ys <= top]
        frames[f'{view}{i}'] = (layers, hx.min(), hx.max(), ys.max())
    print(view, 'walk frames', len(strip))

# common canvas: bottom-centre aligned, then scaled so the character is TARGET_H tall
W = max(max(L['base'].width for L in [f[0]]) for f in frames.values()) * 2; H = max(f[3] for f in frames.values()) + 6
sc = TARGET_H / H; cw, ch = round(W * sc), TARGET_H
ORDER = ['base', 'shirt', 'pants', 'hair']
# place every layer of every frame on the shared canvas
canv = {}
for name, (layers, x0, x1, yb) in frames.items():
    cx = (x0 + x1) / 2; canv[name] = {}
    for ln in ORDER:
        c = Image.new('RGBA', (W, H), (0, 0, 0, 0)); c.alpha_composite(layers[ln], (round(W / 2 - cx), round(H - 3 - yb))); canv[name][ln] = c
# lock the head while walking: the sheet's step frames draw the head at slightly different angles,
# so each step frame gets the head (everything above the neck) of its direction's standing frame
def neck_y(name):
    a = np.zeros((H, W), bool)
    for ln in ORDER: a |= np.array(canv[name][ln])[..., 3] > 60
    ys = np.where(a.any(1))[0]; top, bot = ys.min(), ys.max()
    return int(top + (bot - top) * 0.44)
for name in frames:
    pre, _, f = name.rpartition(':'); base = (pre + ':' if pre else '') + f[:-1] + '0'
    if f.endswith('0') or base not in canv: continue
    ny = neck_y(base)
    # line the walking body up under the standing head: match the shoulders (rows just below the neck)
    def torso_cx(nm):
        a = np.zeros((H, W), bool)
        for ln in ORDER: a |= np.array(canv[nm][ln])[..., 3] > 60
        band = a[ny + 1:ny + 1 + max(4, int(H * 0.12))]
        xs = np.where(band.any(0))[0]; return (xs.min() + xs.max()) / 2 if len(xs) else W / 2
    dx = int(round(torso_cx(base) - torso_cx(name)))
    for ln in ORDER:
        step = np.roll(np.array(canv[name][ln]), dx, axis=1); stand = np.array(canv[base][ln])
        step[:ny] = stand[:ny]
        # the stand's chin/neck may hang a row or two below the cut: keep it on top
        st = stand[ny:ny + 3]; keep = st[..., 3] > 60; step[ny:ny + 3][keep] = st[keep]
        canv[name][ln] = Image.fromarray(step, 'RGBA')
atlas = Image.new('RGBA', (cw * len(ORDER), ch * len(frames)), (0, 0, 0, 0)); meta = {}
for row, name in enumerate(frames):
    for col, ln in enumerate(ORDER): atlas.alpha_composite(canv[name][ln].resize((cw, ch), Image.LANCZOS), (col * cw, row * ch))
    meta[name] = row
atlas.save(OUT + '.webp', 'WEBP', lossless=True)
json.dump({'w': cw, 'h': ch, 'feet': [cw / 2, ch - 3 * sc], 'layers': ORDER, 'rows': meta}, open(OUT + '.json', 'w'))
print('atlas', atlas.size, 'frame', cw, ch)
