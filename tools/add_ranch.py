"""Cut the ranch art (tools/sheets/ranch_barns.jpg, ranch_animals.jpg, ranch_props.jpg, all on WHITE) into the atlas.
The white around the pieces is flood-filled from the edges (white inside a piece, like a hen's body, stays), every piece is
found as its own blob, rows top to bottom, left to right. Animal frames in one row share one scale so they do not wobble.
Existing atlas coordinates are unchanged (new sprites go below).

    python3 tools/add_ranch.py && node tools/build_snow_atlas.js
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
# sheet -> rows of (name, width in tiles); 'row' = every piece in the row uses the first piece's scale
SHEETS = {
  'ranch_barns.jpg': ([[('rb_coop', 4.0), ('rb_sty', 4.3), ('rb_barn', 4.4)]], False, 16),
  'ranch_animals.jpg': ([[(f'an_chicken{i}', .75) for i in range(5)] + [('an_chicken_peck', 0)],
                         [(f'an_pig{i}', 1.35) for i in range(5)] + [('an_pig_sleep', 0)],
                         [(f'an_cow{i}', 2.1) for i in range(4)] + [('an_cow_eat', 0)]], True, 10),
  'ranch_props.jpg': ([[('rp_trough', 2.0), ('rp_water', 2.0), ('rp_mud', 2.4), ('rp_hay', 1.8)],
                       [('rp_milkcan', .8), ('rp_eggs', 1.0), ('rp_sign', 2.2), ('rp_bucket', .9)]], False, 30),
}
# the fence sheet has text labels and a duplicate: pick the pieces by blob id (scan order of this exact picture), one shared scale
FENCE = ('ranch_fence.jpg', [('rf_h', 3), ('rf_post', 2), ('rf_gate', 20), ('rf_open_l', 18), ('rf_open_r', 19)], 3.0, 8)

def cut(path, want, same, grow, ids=None):
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    white = a.min(axis=2) > 228
    lab0, _ = ndimage.label(white); edge = set(np.unique(np.r_[lab0[0], lab0[-1], lab0[:, 0], lab0[:, -1]])) - {0}
    bg = np.isin(lab0, list(edge))
    fg = ndimage.binary_opening(~bg, iterations=1)
    lab, n = ndimage.label(ndimage.binary_dilation(fg, iterations=grow))
    objs = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if (lab[sl] == i + 1).sum() < 1500: continue
        objs.append(((sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2, i + 1, sl))
    if ids:                                          # pick by blob id, all at the first piece's scale
        byid = {o[2]: o for o in objs}; rows = [[byid[i] for _, i in ids]]; want = [[(n, want if j == 0 else 0) for j, (n, _) in enumerate(ids)]]; same = True
    objs.sort(key=lambda o: o[3][0].start); rows0, cur, bot = [], [], 0
    for o in objs:                                   # a new row starts below the lowest piece of the current one
        if cur and o[3][0].start > bot: rows0.append(cur); cur = []
        cur.append(o); bot = max(bot, o[3][0].stop) if len(cur) > 1 else o[3][0].stop
    if cur: rows0.append(cur)
    if not ids: rows = rows0
    assert [len(x) for x in rows] == [len(x) for x in want], (path, [len(x) for x in rows], [len(x) for x in want])
    soft = np.clip((250 - a.min(axis=2)) / 22, 0, 1)            # anti-aliased white fringe fades out
    out = []
    for row, names in zip(rows, want):
        k = None
        for (cy, cx, lid, sl), (name, wt) in zip(row if ids else sorted(row, key=lambda o: o[1]), names):
            keep = (lab[sl] == lid) & ~bg[sl]
            al = np.where(bg[sl], 0, 1.0) * keep
            al = np.maximum(al * np.where(ndimage.binary_erosion(keep, iterations=1), 1, soft[sl]), 0)
            px = np.dstack([a[sl], al * 255]).astype(np.uint8)
            im = Image.fromarray(px, 'RGBA'); im = im.crop(im.getbbox())
            if not same or k is None: k = wt * TILE / im.width
            out.append((name, im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)))
    return out

def main():
    data = json.load(open(JS)); atlas = Image.open(IMG).convert('RGBA'); S = data['sprites']
    pieces = [p for f, (want, same, grow) in SHEETS.items() for p in cut(SH(f), want, same, grow)]
    pieces += cut(SH(FENCE[0]), FENCE[2], True, FENCE[3], FENCE[1])
    pieces = [p for p in pieces if p[0] not in S]
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
