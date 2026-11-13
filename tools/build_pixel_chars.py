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
          'chef': ('tools/sheets/pixel_chef.jpg', ())}
# per-sheet frame overrides (some sheets put the poses in different cells)
FRAME_FIX = {'police': {'left2': 6}}
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
    x, y, w, h, m = FR[k]
    sub = A[y:y + h, x:x + w].copy(); m = ndi.binary_fill_holes(m)
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

# common canvas: bottom-centre aligned, then scaled so the character is TARGET_H tall
W = max(max(L['base'].width for L in [f[0]]) for f in frames.values()) * 2; H = max(f[3] for f in frames.values()) + 6
sc = TARGET_H / H; cw, ch = round(W * sc), TARGET_H
ORDER = ['base', 'shirt', 'pants', 'hair']
atlas = Image.new('RGBA', (cw * len(ORDER), ch * len(frames)), (0, 0, 0, 0)); meta = {}
for row, (name, (layers, x0, x1, yb)) in enumerate(frames.items()):
    cx = (x0 + x1) / 2
    for col, ln in enumerate(ORDER):
        c = Image.new('RGBA', (W, H), (0, 0, 0, 0)); c.alpha_composite(layers[ln], (round(W / 2 - cx), round(H - 3 - yb)))
        atlas.alpha_composite(c.resize((cw, ch), Image.LANCZOS), (col * cw, row * ch))
    meta[name] = row
atlas.save(OUT + '.webp', 'WEBP', lossless=True)
json.dump({'w': cw, 'h': ch, 'feet': [cw / 2, ch - 3 * sc], 'layers': ORDER, 'rows': meta}, open(OUT + '.json', 'w'))
print('atlas', atlas.size, 'frame', cw, ch)
