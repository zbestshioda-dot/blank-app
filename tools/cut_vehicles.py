"""Cut the vehicles from tools/sheets/vehicles.jpg (magenta background with thin grid lines drawn over it) into the atlas.

    python3 tools/cut_vehicles.py

Grid lines are found as columns/rows full of thin dark pixels with magenta on both sides, then painted over by blending
the pixels on either side (so a line crossing a vehicle disappears too). Side views face left; the game mirrors them.
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp'); JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
SHEET = os.path.join(ROOT, 'tools', 'sheets', 'vehicles.jpg')
# name: (centre x, centre y) on the 2000px sheet, length in game tiles (side views) or width in tiles (front/back views)
PICK = {
  'v_amb_side': (250, 140, 2.3), 'v_amb_back': (600, 140, .95),
  'v_fire_side': (250, 395, 2.5), 'v_fire_back': (600, 390, .95),
  'v_police_side': (250, 640, 1.9), 'v_police_front': (600, 640, .95),
  'v_taxi_side': (222, 875, 1.9), 'v_taxi_back': (600, 870, .9),
  'v_red_side': (202, 1118, 1.9), 'v_red_back': (600, 1128, .9),
  'v_blue_side': (160, 1355, 1.9), 'v_blue_back': (383, 1355, .9),
  'v_yellow_front': (145, 1550, .9), 'v_yellow_back': (383, 1548, .9), 'v_yellow_side': (865, 1545, 1.9),
  'v_bus_front': (140, 1795, 1.3), 'v_bus_back': (383, 1795, 1.2), 'v_bus_side': (1015, 1800, 3.8),
}

def groups(idx):
    out, cur = [], []
    for i in idx:
        if cur and i != cur[-1] + 1: out.append(cur); cur = []
        cur.append(i)
    if cur: out.append(cur)
    return out

def main():
    a = np.asarray(Image.open(SHEET).convert('RGB')).astype(float); H, W, _ = a.shape
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mag = (g < np.minimum(r, b) * .6) & (np.abs(r - b) < 90) & (np.minimum(r, b) > 110); dark = (r + g + b) < 260
    def bgline(axis):
        L = np.zeros_like(mag)
        for k in range(1, 6): L |= dark & np.roll(mag, k, axis) & np.roll(mag, -k, axis)
        return L
    vb, hb = bgline(1), bgline(0)
    for grp in groups([x for x in range(W) if vb[:, x].sum() > 150]):
        x0, x1 = max(0, grp[0] - 2), min(W - 1, grp[-1] + 2); n = x1 - x0
        for x in range(x0 + 1, x1): t = (x - x0) / n; a[:, x] = a[:, x0] * (1 - t) + a[:, x1] * t
    for grp in groups([y for y in range(H) if hb[y, :].sum() > 150]):
        y0, y1 = max(0, grp[0] - 2), min(H - 1, grp[-1] + 2); n = y1 - y0
        for y in range(y0 + 1, y1): t = (y - y0) / n; a[y] = a[y0] * (1 - t) + a[y1] * t
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg = (g < np.minimum(r, b) * .62) & (np.abs(r - b) < 100) & (np.minimum(r, b) > 100)
    rgba = np.dstack([a.clip(0, 255), np.where(bg, 0, 255)]).astype(np.uint8)
    lab, n = ndimage.label(~bg)
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1)); objs = ndimage.find_objects(lab)
    big = [i for i in range(n) if sizes[i] > 1500]
    data = json.load(open(JS)); atlas = Image.open(IMG).convert('RGBA'); S = data['sprites']
    s = W / 2000; pieces = []
    for name, (cx, cy, tiles) in PICK.items():
        cx, cy = cx * s, cy * s
        i = min(big, key=lambda i: (((objs[i][1].start + objs[i][1].stop) / 2 - cx) ** 2 + ((objs[i][0].start + objs[i][0].stop) / 2 - cy) ** 2))
        sl = objs[i]; piece = rgba[sl].copy(); piece[..., 3] = np.where(lab[sl] == i + 1, 255, 0)
        im = Image.fromarray(piece); w = round(tiles * 48); im = im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)
        pieces.append((name, im))
    x, y, rowh = 0, data['size'][1] + 2, 0; placed = []
    for name, im in pieces:
        if x + im.width > atlas.width: x, y, rowh = 0, y + rowh + 2, 0
        placed.append((name, x, y, im)); x += im.width + 2; rowh = max(rowh, im.height)
    out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
    for name, px, py, im in placed: out.paste(im, (px, py)); S[name] = [px, py, im.width, im.height]
    data['size'] = [atlas.width, out.height]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('added', len(placed))

if __name__ == '__main__':
    main()
