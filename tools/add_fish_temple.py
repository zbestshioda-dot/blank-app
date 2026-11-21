"""Cut the temple fish sheet (lotus-pond fish, 3 per row) (tools/sheets/pixel_fish_temple.jpg, 6 uneven rows on magenta) into the atlas as fish_<id>.
The cells are not a regular grid, so every creature is found as its own blob, grouped into rows and read left to right.

    python3 tools/add_fish_temple.py
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp')
JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
SHEET = os.path.join(ROOT, 'tools', 'sheets', 'pixel_fish_temple.jpg')
ROWS = [  # item ids, row by row, left to right (server/data.js)
  ['tp_tapian', 'tp_lotus', 'tp_merit'],
  ['tp_turtle', 'tp_koi', 'tp_naga']]
ROW_Y = [510, 1380]     # row centres on the sheet (px)
OUT_W = 64

def main():
    data = json.load(open(JS)); atlas = Image.open(IMG).convert('RGBA'); S = data['sprites']
    a = np.asarray(Image.open(SHEET).convert('RGB')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg = (g < np.minimum(r, b) * 0.6) & (np.abs(r - b) < 90) & (np.minimum(r, b) > 110)
    fg = ndimage.binary_opening(~bg, iterations=2)
    lab, n = ndimage.label(ndimage.binary_dilation(fg, iterations=3))
    objs = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if (lab[sl] == i + 1).sum() < 1500: continue
        cy = (sl[0].start + sl[0].stop) / 2
        row = int(np.argmin([abs(cy - y) for y in ROW_Y]))
        objs.append((row, sl[1].start, i + 1, sl))
    rgba = np.dstack([a, np.where(bg, 0, 255)]).astype(np.uint8)
    pieces = []
    for row, names in enumerate(ROWS):
        got = sorted(o for o in objs if o[0] == row)
        assert len(got) == len(names), (row, len(got), len(names))
        for (_, _, lid, sl), nm in zip(got, names):
            name = 'fish_' + nm
            if name in S: continue
            keep = (lab[sl] == lid) & fg[sl]
            piece = rgba[sl].copy(); piece[..., 3] = np.where(keep, 255, 0)
            im = Image.fromarray(piece); im = im.crop(im.getbbox())
            k = OUT_W / max(im.width, im.height)
            pieces.append((name, im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)))
    x, y, rowh = 0, data['size'][1] + 2, 0
    placed = []
    for name, im in pieces:
        if x + im.width > atlas.width: x, y, rowh = 0, y + rowh + 2, 0
        placed.append((name, x, y, im)); x += im.width + 2; rowh = max(rowh, im.height)
    out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
    for name, px, py, im in placed:
        out.paste(im, (px, py)); S[name] = [px, py, im.width, im.height]
    data['size'] = [atlas.width, out.height]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('added', len(placed), 'atlas', out.size)

if __name__ == '__main__':
    main()
