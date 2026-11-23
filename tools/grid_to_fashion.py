"""Turn a 4x5 magenta grid character sheet (tools/sheets/grid/<id>.jpg) into the 3x3 beige layout add_fashion.py reads
(tools/sheets/fashion_<id>.jpg). PICK says which figure goes to each frame: (row, index in that row from the left).

    python3 tools/grid_to_fashion.py && python3 tools/add_fashion.py && python3 tools/split_pchar.py
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

BEIGE = (222, 200, 190)
BG = {'wedding': (60, 150, 160), 'fwedding': (60, 150, 160), 'panda': (60, 150, 160), 'fpanda': (60, 150, 160)}   # white/cream clothes vanish on beige, so these sheets get teal
CELL = {'down0': (0, 1), 'down1': (0, 0), 'down2': (0, 2), 'up0': (1, 1), 'up1': (1, 2), 'left0': (2, 1), 'left1': (2, 0), 'left2': (2, 2)}
PICK = {
    'bear':     {'down0': (0, 0), 'down1': (1, 0), 'down2': (1, 1), 'up0': (0, 3), 'up1': (0, 4), 'left0': (0, 2), 'left1': (1, 2), 'left2': (2, 2)},
    'panda':    {'down0': (0, 0), 'down1': (0, 1), 'down2': (0, 1), 'up0': (0, 2), 'up1': (2, 2), 'left0': (0, 3), 'left1': (3, 2), 'left2': (0, 3)},   # redrawn: hood-up frames only
    'fpanda':   {'down0': (0, 0), 'down1': (0, 1), 'down2': (0, 1), 'up0': (0, 2), 'up1': (2, 2), 'left0': (0, 3), 'left1': (3, 2), 'left2': (0, 3)},
    'tanktop':  {'down0': (0, 0), 'down1': (0, 1), 'down2': (2, 1), 'up0': (3, 4), 'up1': (3, 4), 'left0': (1, 0), 'left1': (1, 2), 'left2': (1, 0)},
    'wedding':  {'down0': (0, 0), 'down1': (0, 1), 'down2': (3, 0), 'up0': (0, 4), 'up1': (2, 4), 'left0': (1, 2), 'left1': (2, 2), 'left2': (1, 2)},
    'fwedding': {'down0': (0, 0), 'down1': (1, 0), 'down2': (1, 1), 'up0': (1, 3), 'up1': (1, 4), 'left0': (2, 2), 'left1': (1, 2), 'left2': (3, 2)},
    'fkitsune': {'down0': (0, 0), 'down1': (0, 1), 'down2': (1, 0), 'up0': (1, 4), 'up1': (2, 4), 'left0': (2, 2), 'left1': (2, 2), 'left2': (2, 2)},
}

def figures(im):
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    bg = (g < 90) & (r > 90) & (b > 90) & (r - g > 60) & (b - g > 60)          # magenta and its darker grid lines
    lab, n = ndi.label(ndi.binary_closing(~bg, iterations=4))
    sz = ndi.sum(np.ones_like(lab), lab, range(1, n + 1)); objs = ndi.find_objects(lab)
    keep = [k for k in range(n) if sz[k] > sz.max() * .25]
    boxes = [(objs[k], k + 1) for k in keep]
    H = im.shape[0]; rows = {}
    for (sy, sx), lid in boxes: rows.setdefault(int(((sy.start + sy.stop) / 2) / (H / 4)), []).append((sx.start, sy, sx, lid))
    return bg, lab, {r: sorted(v) for r, v in rows.items()}

for gid, pick in PICK.items():
    im = np.array(Image.open(f'tools/sheets/grid/{gid}.jpg').convert('RGB')).astype(int)
    bg, lab, rows = figures(im)
    S = 600; out = np.zeros((S * 3, S * 3, 3), np.uint8); out[:] = BG.get(gid, BEIGE)
    for f, (r, i) in pick.items():
        _, sy, sx, lid = rows[r][i]
        sub = im[sy, sx].copy(); m = (lab[sy, sx] == lid) & ~bg[sy, sx]
        if gid == 'fwedding':                     # the see-through veil picked up the magenta: make it white lace
            r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]; v = (r > 150) & (b > 130) & (g < np.minimum(r, b) - 30)
            lum = np.maximum(r, b)[..., None]; sub = np.where(v[..., None], np.clip(lum * np.array([.97, .95, .98]) + 15, 0, 255), sub).astype(int)
        sub[~m] = BG.get(gid, BEIGE)
        cy, cx = CELL[f]; hh, ww = sub.shape[:2]
        y0, x0 = cy * S + (S - hh) // 2, cx * S + (S - ww) // 2
        out[y0:y0 + hh, x0:x0 + ww] = sub
    Image.fromarray(out).save(f'tools/sheets/fashion_{gid}.jpg', quality=95)
    print('built', gid, {r: len(v) for r, v in rows.items()})
