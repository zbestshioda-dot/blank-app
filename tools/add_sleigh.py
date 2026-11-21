"""Cut the Santa sleigh (tools/sheets/veh_sleigh.jpg: front, side facing right, side facing left, back, on magenta) into the
atlas as w_sleigh_f / w_sleigh_s (faces left, like the other vehicles) / w_sleigh_b. Existing atlas coordinates unchanged.

    python3 tools/add_sleigh.py
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp')
JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
TILE, SIDE = 48, 2.6          # the side view is 2.6 game tiles long; front and back keep the same scale

def main():
    data = json.load(open(JS)); S = data['sprites']
    if 'w_sleigh_s' in S: return print('already there')
    a = np.asarray(Image.open(os.path.join(ROOT, 'tools', 'sheets', 'veh_sleigh.jpg')).convert('RGB')).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]; mag = np.minimum(r, b) - g
    bg = (mag > 70) & (np.abs(r - b) < 110)
    fg = ndimage.binary_opening(~bg, iterations=2)
    lab, n = ndimage.label(ndimage.binary_dilation(fg, iterations=4))
    objs = sorted([(sl[1].start, i + 1, sl) for i, sl in enumerate(ndimage.find_objects(lab)) if (lab[sl] == i + 1).sum() > 5000])
    assert len(objs) == 4, len(objs)
    alpha = np.clip((110 - mag) / 60, 0, 1); alpha[np.abs(r - b) >= 110] = 1
    def piece(o):
        _, lid, sl = o; keep = (lab[sl] == lid) & ~bg[sl]
        im = Image.fromarray(np.dstack([a[sl], alpha[sl] * keep * 255]).astype(np.uint8), 'RGBA'); return im.crop(im.getbbox())
    front, _, sideL, back = [piece(o) for o in objs]
    k = SIDE * TILE / sideL.width
    pieces = [(f'w_sleigh_{v}', im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)) for v, im in (('f', front), ('s', sideL), ('b', back))]
    atlas = Image.open(IMG).convert('RGBA'); y = data['size'][1] + 2; x = 0
    out = Image.new('RGBA', (atlas.width, y + max(im.height for _, im in pieces))); out.paste(atlas, (0, 0))
    for name, im in pieces: out.paste(im, (x, y)); S[name] = [x, y, im.width, im.height]; x += im.width + 2
    data['size'] = [atlas.width, out.height]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('added sleigh', [(n, S[n]) for n, _ in pieces])

if __name__ == '__main__':
    main()
