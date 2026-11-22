"""Swap the angled building sprites for the straight-front redraws (tools/sheets/bld_a..d.jpg, 2x2 per sheet on magenta).
Each new picture keeps the old sprite's width in the atlas (so the building's footprint on the map stays the same); the
old pixels stay in the atlas unused and the sprite's entry points at the new ones (added below everything else).
Run tools/fix_bld_signs.py first (generic shop signs on sheet C), then this, then tools/build_snow_atlas.js.
    python3 tools/redo_buildings.py
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp'); JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
SH = lambda n: os.path.join(ROOT, 'tools', 'sheets', n)
SHEETS = {
  'bld_a.jpg': ['b_toolshop', 'b_showroom', 'b_hospital2', 'b_tower'],
  'bld_b.jpg': ['b_factory', 'b_kitchen', 'b_stilthouse', 'b_fishstall'],
  'bld_c.jpg': ['b_cs2', 'b_cs3', 'b_cs4', 'b_gas'],
  'bld_d.jpg': ['b_pet1', 'b_gym1', 'b_market', 'b_salon'],
}

def cut(path, names):
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    bgc = np.median(np.concatenate([a[:20, :20].reshape(-1, 3), a[-20:, -20:].reshape(-1, 3), a[:20, -20:].reshape(-1, 3)]), axis=0)
    dist = np.sqrt(((a - bgc) ** 2).sum(-1))
    bg = dist < 70
    if 'bld_b' in path:                       # pink-tinted chimney smoke -> soft grey smoke
        smoke = ~bg & (a[..., 0] - a[..., 1] > 40) & (a[..., 2] - a[..., 1] > 40) & (a[..., 0] > 150)
        a[smoke] = (215, 212, 220)
    fg = ndimage.binary_opening(~bg, iterations=2)
    lab, n = ndimage.label(ndimage.binary_dilation(fg, iterations=30))
    objs = sorted(((sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2, i + 1, sl) for i, sl in enumerate(ndimage.find_objects(lab)) if (lab[sl] == i + 1).sum() > 20000)
    assert len(objs) == 4, (path, len(objs))
    objs = sorted(objs[:2], key=lambda o: o[1]) + sorted(objs[2:], key=lambda o: o[1])
    alpha = np.clip((dist - 70) / 50, 0, 1)
    out = []
    for (cy, cx, lid, sl), name in zip(objs, names):
        keep = (lab[sl] == lid) & ~bg[sl]
        px = np.dstack([a[sl], alpha[sl] * keep * 255]).astype(np.uint8)
        im = Image.fromarray(px, 'RGBA'); out.append((name, im.crop(im.getbbox())))
    return out

def main():
    data = json.load(open(JS)); atlas = Image.open(IMG).convert('RGBA'); S = data['sprites']
    pieces = []
    for f, names in SHEETS.items():
        for name, im in cut(SH(f), names):
            w = S[name][2]; h = round(im.height * w / im.width)
            pieces.append((name, im.resize((w, h), Image.LANCZOS)))
    x, y, rowh, placed = 0, data['size'][1] + 2, 0, []
    for name, im in pieces:
        if x + im.width > atlas.width: x, y, rowh = 0, y + rowh + 2, 0
        placed.append((name, x, y, im)); x += im.width + 2; rowh = max(rowh, im.height)
    out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
    for name, px, py, im in placed: out.paste(im, (px, py)); S[name + '_f'] = [px, py, im.width, im.height]   # '<old>_f': the map keeps the old footprint
    data['size'] = [atlas.width, out.height]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('replaced', len(placed), 'atlas', out.size)

if __name__ == '__main__':
    main()
