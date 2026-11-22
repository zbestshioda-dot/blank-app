"""Second batch of straight-front redraws (tools/sheets/bld2_1..7.jpg, several options per building, picked by hand):
each chosen picture becomes '<sprite>_f' in the atlas at the old sprite's width (the map keeps the old footprint).
Candidates are cut as blobs on the sheet's own background colour; pink-magenta haze (smoke, glows) counts as background.
    python3 tools/redo_buildings2.py && node tools/build_snow_atlas.js
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp'); JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
SH = lambda n: os.path.join(ROOT, 'tools', 'sheets', n)
DIL = {5: 7, 7: 3}
# sprite -> (sheet number, blob index in reading order)
PICK = {
  'b_school2': (1, 0), 'b_bank2': (1, 1), 'b_police2': (1, 2), 'b_fire2': (1, 3),
  'h_cottage1': (2, 0), 'h_gable_red': (2, 2),   # (the brick house has no door and the green-roof one reads as a shop: those two keep their old look)
  'h_gable_blue': (3, 0), 'h_cottage4': (3, 3), 'b_clawbooth': (3, 5), 'b_photobooth': (3, 7),
  'b_rider2': (4, 1), 'b_boutique': (4, 2), 'b_cs1': (4, 5), 'b_pet2': (4, 7),
  'b_casino': (5, 1), 'b_flower2': (6, 1), 'b_cafe2': (6, 4),
}

PICK3 = {'b_market2': 0, 'b_library': 1, 'h_cottage3': 2, 'h_cottage2': 3}

def cut(path, dil):
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    bgc = np.median(np.concatenate([a[:20, :20].reshape(-1, 3), a[-20:, -20:].reshape(-1, 3), a[:20, -20:].reshape(-1, 3)]), axis=0)
    dist = np.sqrt(((a - bgc) ** 2).sum(-1)); bg = dist < 70
    bg |= (a[..., 0] - a[..., 1] > 90) & (a[..., 2] - a[..., 1] > 60)
    fg = ndimage.binary_opening(~bg, iterations=2)
    lab, k = ndimage.label(ndimage.binary_dilation(fg, iterations=dil))
    objs = [(sl, i + 1) for i, sl in enumerate(ndimage.find_objects(lab)) if (lab[sl] == i + 1).sum() > 15000]
    objs.sort(key=lambda o: (round(o[0][0].start / (a.shape[0] / 3)), o[0][1].start))
    alpha = np.clip((dist - 70) / 50, 0, 1); alpha[ndimage.binary_erosion(~bg, iterations=2)] = 1; out = []   # soft only along the outline: colours close to the background (red, purple) stay solid
    for sl, lid in objs:
        keep = (lab[sl] == lid) & ~bg[sl]
        im = Image.fromarray(np.dstack([a[sl], alpha[sl] * keep * 255]).astype(np.uint8), 'RGBA'); out.append(im.crop(im.getbbox()))
    return out

def main():
    data = json.load(open(JS)); atlas = Image.open(IMG).convert('RGBA'); S = data['sprites']
    sheets = {n: cut(SH(f'bld2_{n}.jpg'), DIL.get(n, 12)) for n in sorted({v[0] for v in PICK.values()})}
    pieces = []
    for name, (n, i) in PICK.items():
        im = sheets[n][i]; w = S[name][2]; pieces.append((name, im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)))
    # third sheet (bld3.jpg): drawn long and flat, so a few middle strips are cut out first (tools/narrow_bld3.py)
    from narrow_bld3 import narrow
    b3 = cut(SH('bld3.jpg'), 12)
    for name, i in PICK3.items():
        im = narrow(b3[i], i); w = S[name][2]; pieces.append((name, im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)))
    x, y, rowh, placed = 0, data['size'][1] + 2, 0, []
    for name, im in pieces:
        if x + im.width > atlas.width: x, y, rowh = 0, y + rowh + 2, 0
        placed.append((name, x, y, im)); x += im.width + 2; rowh = max(rowh, im.height)
    out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
    for name, px, py, im in placed: out.paste(im, (px, py)); S[name + '_f'] = [px, py, im.width, im.height]
    data['size'] = [atlas.width, out.height]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('added', len(placed), 'atlas', out.size)

if __name__ == '__main__':
    main()
