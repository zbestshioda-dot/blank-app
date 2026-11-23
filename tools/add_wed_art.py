"""Wedding art on plain beige sheets -> atlas: the 3 ring icons (tools/sheets/wed_rings.jpg, one per third)
and the wedding arch (tools/sheets/wed_arch.jpg; the white carpet in front is dropped).

    python3 tools/add_wed_art.py && node tools/build_snow_atlas.js   (then bump the atlas ?v= in public/game.js)
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, os.path.dirname(__file__))
from add_furniture import IMG, JS, TILE
S = os.path.join(os.path.dirname(__file__), 'sheets')

def cut(a, drop_carpet=False):
    """background = beige-coloured regions that touch the border, or big beige regions inside (ring hole, arch opening);
    small beige-ish patches inside an outline (silver shine, white stone) stay solid"""
    bgc = np.median(np.concatenate([a[:30, :30].reshape(-1, 3), a[-30:, -30:].reshape(-1, 3), a[:30, -30:].reshape(-1, 3), a[-30:, :30].reshape(-1, 3)]), 0)
    d = np.sqrt(((a - bgc) ** 2).sum(2)); near = d < 18
    lab, n = ndimage.label(near); H, W = near.shape; bgm = np.zeros_like(near)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    for k, sl in enumerate(ndimage.find_objects(lab), 1):
        m = lab[sl] == k; area = m.sum()
        if k in edge or (area > H * W * .004 and d[sl][m].mean() < 9): bgm[sl] |= m
    fg = ~bgm; lab, n = ndimage.label(fg); sz = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    keep = [k + 1 for k, v in enumerate(sz) if v > sz.max() * .03]
    m = np.isin(lab, keep)
    if drop_carpet:   # the plain white carpet between the pillars, and its thin outline
        ys, xs = np.where(m); y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        zone = np.zeros_like(m); zone[int(y0 + (y1 - y0) * .72):, int(x0 + (x1 - x0) * .36):int(x0 + (x1 - x0) * .64)] = True
        m &= ~ndimage.binary_dilation(zone & (a.min(2) > 200) & (a.max(2) - a.min(2) < 30), iterations=3)
        m[int(y0 + (y1 - y0) * .80):, int(x0 + (x1 - x0) * .28):int(x0 + (x1 - x0) * .72)] = False   # the carpet's side lines below the pillars
        lab2, _ = ndimage.label(m); sz2 = ndimage.sum(np.ones_like(lab2), lab2, range(1, lab2.max() + 1))
        m = np.isin(lab2, [k + 1 for k, v in enumerate(sz2) if v > sz2.max() * .01])
    im = Image.fromarray(np.dstack([a, np.where(m, 255, 0)]).astype(np.uint8)); return im.crop(im.getbbox())

def size(im, s):
    t = float(s[1:]) * TILE
    return im.resize((round(t), round(im.height * t / im.width)) if s[0] == 'w' else (round(im.width * t / im.height), round(t)), Image.LANCZOS)

rings = np.asarray(Image.open(os.path.join(S, 'wed_rings.jpg')).convert('RGB')).astype(int); W = rings.shape[1]
items = [(f'ring_{k}', size(cut(rings[:, i * W // 3:(i + 1) * W // 3]), 'w1.4')) for i, k in enumerate(['silver', 'gold', 'diamond'])]
arch = np.asarray(Image.open(os.path.join(S, 'wed_arch.jpg')).convert('RGB')).astype(int)
items.append(('o_wedarch', size(cut(arch, True), 'w3.4')))

atlas = Image.open(IMG).convert('RGBA'); data = json.load(open(JS))
x, y, rowh = 0, data['size'][1] + 2, 0
for name, im in items:
    if name in data['sprites']: print('replacing', name)
    data['sprites'][name] = [x, y, im.width, im.height]; x += im.width + 2; rowh = max(rowh, im.height)
out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
for name, im in items: px, py = data['sprites'][name][:2]; out.paste(im, (px, py))
data['size'] = [atlas.width, y + rowh]
out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
print('added', [n for n, _ in items], out.size)
