"""Bakery item icons: tools/sheets/bakery_icons.jpg (8 icons on magenta, 2 rows of 4) are added to the UI pixel icons
(public/assets/icons.webp + icons.json) in new cells after the last used one; existing cells keep their place.
Each icon is mapped to its item's emoji (data.js bk_*). Then bump ?v= of icons.json (game.js) and icons.webp (style.css).

    python3 tools/add_bakery_icons.py
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMOJI = [['🍞', '🥐', '🍩', '🧁'], ['🍰', '🍥', '🫐', '🎂']]

a = np.asarray(Image.open(os.path.join(ROOT, 'tools/sheets/bakery_icons.jpg')).convert('RGB')).astype(int)
r, g, b = a[..., 0], a[..., 1], a[..., 2]; mag = np.minimum(r, b) - g
bg = (mag > 70) & (np.abs(r - b) < 110)
lab, n = ndimage.label(ndimage.binary_dilation(ndimage.binary_opening(~bg, iterations=2), iterations=4))
objs = [((s[0].start + s[0].stop) / 2, (s[1].start + s[1].stop) / 2, i + 1, s) for i, s in enumerate(ndimage.find_objects(lab)) if (lab[s] == i + 1).sum() > 2500]
objs.sort(); rows = [sorted(objs[:4], key=lambda o: o[1]), sorted(objs[4:], key=lambda o: o[1])]
assert len(objs) == 8, len(objs)
alpha = np.clip((110 - mag) / 60, 0, 1); alpha[np.abs(r - b) >= 110] = 1
rgb = a.astype(float); t = (1 - alpha); rgb[..., 0] -= t * 60; rgb[..., 2] -= t * 60

J = os.path.join(ROOT, 'public/assets/icons.json'); W = os.path.join(ROOT, 'public/assets/icons.webp')
d = json.load(open(J)); C, cols = d['cell'], d['cols']; sheet = Image.open(W).convert('RGBA')
nxt = max(d['map'].values()) + 1
need_rows = (nxt + 8 + cols - 1) // cols
if need_rows > d['rows']:
    big = Image.new('RGBA', (cols * C, need_rows * C)); big.paste(sheet, (0, 0)); sheet = big; d['rows'] = need_rows
for row, ems in zip(rows, EMOJI):
    for (cy, cx, lid, sl), em in zip(row, ems):
        keep = (lab[sl] == lid) & ~bg[sl]
        im = Image.fromarray(np.dstack([np.clip(rgb[sl], 0, 255), alpha[sl] * keep * 255]).astype(np.uint8), 'RGBA')
        im = im.crop(im.getbbox()); k = (C - 4) / max(im.size)
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        cell = Image.new('RGBA', (C, C)); cell.alpha_composite(im, ((C - im.width) // 2, (C - im.height) // 2))
        sheet.paste(cell, ((nxt % cols) * C, (nxt // cols) * C)); d['map'][em] = nxt; nxt += 1
sheet.save(W, 'WEBP', quality=92, method=6); json.dump(d, open(J, 'w'), ensure_ascii=False, separators=(',', ':'))
print('icons', nxt, 'rows', d['rows'])
