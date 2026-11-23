"""Treasure-cave art on magenta sheets -> atlas:
  cave.jpg       the entrance (one picture)
  cave_mons.jpg  12 monsters, 4 x 3 cells, a name label under each (cut off)
  cave_furn.jpg  6 coin-shop furniture pieces, 3 x 2 cells

    python3 tools/add_cave_art.py && node tools/build_snow_atlas.js   (then bump the atlas ?v= in public/game.js)
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, os.path.dirname(__file__))
from add_furniture import IMG, JS, TILE
from add_sheet_furn import bg
S = os.path.join(os.path.dirname(__file__), 'sheets')
MONS = ['slime', 'bat', 'rat', 'skel', 'spider', 'golem', 'ghost', 'naga', 'knight', 'kingslime', 'minotaur', 'dragon']
FURN = [('xd_trophy', 'h1.6'), ('xd_chest', 'w1.5'), ('xd_crystal', 'w1.4'), ('xd_sword', 'h1.6'), ('xd_map', 'w1.6'), ('xd_lantern', 'h1.5')]

def cut(a):
    fg = ~bg(a, True); lab, n = ndimage.label(ndimage.binary_closing(fg, iterations=2))
    sz = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    keep = np.isin(lab, [k + 1 for k, s in enumerate(sz) if s > sz.max() * .02]) & fg
    keep = ndimage.binary_erosion(keep, iterations=1) | (keep & ~ndimage.binary_dilation(~keep, iterations=1))   # trim the pink fringe
    im = Image.fromarray(np.dstack([a, np.where(keep, 255, 0)]).astype(np.uint8)); return im.crop(im.getbbox())

def size(im, s):
    t = float(s[1:]) * TILE
    return im.resize((round(t), round(im.height * t / im.width)) if s[0] == 'w' else (round(im.width * t / im.height), round(t)), Image.LANCZOS)

def cells(name, cols, rows, keep_h=1.0, pad=0.03):
    a = np.asarray(Image.open(os.path.join(S, name)).convert('RGB')).astype(int); H, W = a.shape[:2]
    for r in range(rows):
        for c in range(cols):
            y0, y1 = r * H // rows, (r + 1) * H // rows; x0, x1 = c * W // cols, (c + 1) * W // cols
            py, px = int((y1 - y0) * pad), int((x1 - x0) * pad)
            yield a[y0 + py:y0 + int((y1 - y0) * keep_h), x0 + px:x1 - px]

items = [('o_cave', size(cut(np.asarray(Image.open(os.path.join(S, 'cave.jpg')).convert('RGB')).astype(int)), 'w4.2'))]
fit = lambda im, n=110: im.resize((round(im.width * n / max(im.size)), round(im.height * n / max(im.size))), Image.LANCZOS)   # monsters: 110 px, shown in the cave panel
items += [(f'mon_{k}', fit(cut(c))) for k, c in zip(MONS, cells('cave_mons.jpg', 4, 3, keep_h=.80))]
items += [(n, size(cut(c), s)) for (n, s), c in zip(FURN, cells('cave_furn.jpg', 3, 2))]

atlas = Image.open(IMG).convert('RGBA'); data = json.load(open(JS))
x, y, rowh, placed = 0, data['size'][1] + 2, 0, []
for name, im in items:
    if x + im.width > atlas.width: x, y, rowh = 0, y + rowh + 2, 0
    placed.append((name, x, y, im)); x += im.width + 2; rowh = max(rowh, im.height)
out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
for name, px, py, im in placed: out.paste(im, (px, py)); data['sprites'][name] = [px, py, im.width, im.height]
data['size'] = [atlas.width, y + rowh]
out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
print('added', [p[0] for p in placed], 'atlas', out.size)
