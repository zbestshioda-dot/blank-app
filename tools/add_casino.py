"""Cut the casino art (tools/sheets/pixel_buildings_k.jpg, casino_props.jpg, casino_icons.jpg, all on magenta) into the
atlas: every piece is found as its own blob, rows are read top to bottom, left to right, and scaled to a size in game tiles.
Existing atlas coordinates are unchanged (new sprites go below). The night variant of the casino (dark cell) is skipped.

    python3 tools/add_casino.py
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp')
JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
SH = lambda n: os.path.join(ROOT, 'tools', 'sheets', n)
TILE = 48
GROW = {}   # sheet -> a bigger grow for sheets whose pieces come in parts
# sheet -> rows of (sprite name, width in game tiles); None = skip that blob
SHEETS = {
  'pixel_buildings_k.jpg': [[('b_casino', 7.4)], [('b_chipkiosk', 3.6), ('b_slotstall', 3.6)]],
  'casino_props.jpg': [
    [('cz_slot1', 1.3), ('cz_slot2', 1.3), ('cz_slot3', 1.4), ('cz_roulette', 3.2), ('cz_bj', 3.0)],
    [('cz_table', 3.0), ('cz_hilo', 3.0), ('cz_poker', 2.4), ('cz_cashier', 2.4), ('cz_chips', 1.1)],
    [('cz_rope', 1.9), ('cz_sign', 3.2), ('cz_sign2', 2.8)],
    [('cz_bar', 4.2), ('cz_palm', 1.1), ('cz_armchair', 1.3), ('cz_chandelier', 1.5), ('cz_carpet', 2.8)]],
  'casino_icons.jpg': [
    [('ci_cherry', 1), ('ci_lemon', 1), ('ci_bell', 1), ('ci_bar', 1.2), ('ci_seven', 1), ('ci_diamond', 1.1), ('ci_star', 1)],
    [('ci_dice', 1.3), ('ci_chips', .8), ('ci_card', .8), ('ci_coins', 1.1), ('ci_chest', 1.3)]],
}

def blobs(path, want, grow=4):   # grow: how far apart two parts of one piece may be (chairs round a table, a neon glow ring)
    a = np.asarray(Image.open(path).convert('RGB')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mag = np.minimum(r, b) - g
    bg = (mag > 70) & (np.abs(r - b) < 110)
    if 'buildings' in path:                                # the night cell (top right) has a dark background: drop it
        H, W = bg.shape; bg[:H // 2, W // 2:] = True
    fg = ndimage.binary_opening(~bg, iterations=2)
    lab, n = ndimage.label(ndimage.binary_dilation(fg, iterations=GROW.get(os.path.basename(path), grow)))
    objs = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        area = (lab[sl] == i + 1).sum()
        if area < 2500: continue
        objs.append(((sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2, i + 1, sl))
    # group into rows by vertical centre
    objs.sort(); rows, cur = [], []
    for o in objs:
        if cur and o[0] - np.mean([c[0] for c in cur]) > 120: rows.append(cur); cur = []
        cur.append(o)
    if cur: rows.append(cur)
    assert [len(x) for x in rows] == [len(x) for x in want], (path, [len(x) for x in rows], [len(x) for x in want])
    # soft edge: half-magenta pixels (glow, anti-aliasing) fade out and lose their pink tint
    alpha = np.clip((110 - mag) / 60, 0, 1); alpha[np.abs(r - b) >= 110] = 1
    rgb = a.copy().astype(float); tint = (1 - alpha)[..., None]
    rgb[..., 0] -= tint[..., 0] * 60; rgb[..., 2] -= tint[..., 0] * 60
    out = []
    for row, names in zip(rows, want):
        for (cy, cx, lid, sl), (name, wt) in zip(sorted(row, key=lambda o: o[1]), names):
            keep = (lab[sl] == lid) & ~bg[sl]
            px = np.dstack([np.clip(rgb[sl], 0, 255), (alpha[sl] * keep * 255)]).astype(np.uint8)
            im = Image.fromarray(px, 'RGBA'); im = im.crop(im.getbbox())
            k = wt * TILE / im.width
            out.append((name, im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)))
    return out

def main():
    data = json.load(open(JS)); atlas = Image.open(IMG).convert('RGBA'); S = data['sprites']
    pieces = [p for f, want in SHEETS.items() for p in blobs(SH(f), want) if p[0] not in S]
    x, y, rowh, placed = 0, data['size'][1] + 2, 0, []
    for name, im in pieces:
        if x + im.width > atlas.width: x, y, rowh = 0, y + rowh + 2, 0
        placed.append((name, x, y, im)); x += im.width + 2; rowh = max(rowh, im.height)
    if not placed: return print('nothing new')
    out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
    for name, px, py, im in placed: out.paste(im, (px, py)); S[name] = [px, py, im.width, im.height]
    data['size'] = [atlas.width, out.height]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('added', len(placed), 'atlas', out.size)

if __name__ == '__main__':
    main()
