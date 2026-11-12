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
SHEETS = {'base': ('tools/sheets/pixel_char.jpg', ('shirt', 'pants', 'hair')), 'doctor': ('tools/sheets/pixel_doctor.jpg', ('hair',))}
TARGET_H = 96
# which sheet frame (reading order, 0-19) is used for each direction / walk step; right = mirrored left
FRAMES = {'down0': 0, 'down1': 16, 'down2': 18, 'up0': 14, 'up1': 19, 'left0': 5, 'left1': 7, 'left2': 17}

def load(src):
    global A, lab, boxes
    im = Image.open(src).convert('RGB'); A = np.array(im).astype(int)
    R, G, B = A[..., 0], A[..., 1], A[..., 2]
    bg = (R > 150) & (B > 150) & (G < 120)
    grid = (R > 80) & (B > 80) & (G < 70) & (abs(R - B) < 70)
    fg = ndi.binary_opening(~(bg | grid), iterations=1)
    lab, n = ndi.label(fg)
    boxes = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        h = sl[0].stop - sl[0].start; w = sl[1].stop - sl[1].start
        if h > 100 and w > 60: boxes.append((sl[1].start, sl[0].start, w, h, i + 1))
    boxes.sort(key=lambda b: (round(b[1] / 200), b[0]))
    assert len(boxes) == 20, len(boxes)

OUTLINE = np.array([46, 14, 8])
def split(k, tint):
    x, y, w, h, i = boxes[k]
    sub = A[y:y + h, x:x + w].copy(); m = ndi.binary_fill_holes(lab[y:y + h, x:x + w] == i)
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
    hair = brown & (yy < h * .55)
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
  for fname, k in FRAMES.items():
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
    frames[name] = (layers, xs.min(), xs.max(), ys.max())

# common canvas: bottom-centre aligned, then scaled so the character is TARGET_H tall
W = max(f[2] - f[1] for f in frames.values()) + 12; H = max(f[3] for f in frames.values()) + 6
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
