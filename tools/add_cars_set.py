"""Replace player cars with a new sprite set: tools/sheets/cars_set<N>.jpg, magenta background, one car per row,
columns = front / back / side (side faces LEFT). New sprites are appended to the atlas and the w_<key>_f/_b/_s entries
re-pointed at them.   python3 tools/add_cars_set.py 1     (then: node tools/build_snow_atlas.js, bump atlas ?v= in game.js)
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp'); JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
TILE = 48
# set: [(key, side length in tiles)] top row first
SETS = {
  '1': [('lambo', 2.9), ('mclaren', 2.9), ('phantom', 2.9), ('spider', 2.9), ('porsche', 2.8)],
}

def pieces(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg = (g < np.minimum(r, b) * .55) & (np.minimum(r, b) > 120)
    fg = ndimage.binary_opening(~bg, iterations=1)
    lab, n = ndimage.label(ndimage.binary_closing(fg, iterations=3))
    objs = [(s, i + 1) for i, s in enumerate(ndimage.find_objects(lab)) if (s[0].stop - s[0].start) * (s[1].stop - s[1].start) > 4000]
    out = []
    for (sy, sx), i in objs:
        m = ndimage.binary_fill_holes((lab[sy, sx] == i) & fg[sy, sx])   # keep windows / rims, drop the background around
        rgb = a[sy, sx].copy()
        hub = m & (rgb[..., 1] < np.minimum(rgb[..., 0], rgb[..., 2]) * .7) & (np.minimum(rgb[..., 0], rgb[..., 2]) > 110)
        rgb[hub] = [70, 74, 86]                      # magenta seen through windows / rims → dark glass
        out.append(((sy.start + sy.stop) / 2, (sx.start + sx.stop) / 2, Image.fromarray(np.dstack([rgb, np.where(m, 255, 0)]).astype(np.uint8))))
    return out

def main(n):
    cars = SETS[n]; ps = pieces(os.path.join(ROOT, 'tools', 'sheets', f'cars_set{n}.jpg'))
    assert len(ps) == len(cars) * 3, f'found {len(ps)} pieces, want {len(cars) * 3}'
    ps.sort(key=lambda p: p[0]); rows = [sorted(ps[i * 3:i * 3 + 3], key=lambda p: p[1]) for i in range(len(cars))]
    atlas = Image.open(IMG).convert('RGBA'); data = json.load(open(JS))
    x, y, rowh = 0, data['size'][1] + 2, 0; placed = []
    for (key, tiles), row in zip(cars, rows):
        f, b, s = (p[2] for p in row); k = tiles * TILE / s.width
        for suf, im in (('s', s), ('f', f), ('b', b)):
            im = im.resize((max(4, round(im.width * k)), max(4, round(im.height * k))), Image.LANCZOS)
            if x + im.width > atlas.width: x, y, rowh = 0, y + rowh + 2, 0
            placed.append((f'w_{key}_{suf}', x, y, im)); x += im.width + 2; rowh = max(rowh, im.height)
    out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
    for name, px, py, im in placed: out.paste(im, (px, py)); data['sprites'][name] = [px, py, im.width, im.height]
    data['size'] = [atlas.width, y + rowh]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('replaced', len(placed), 'sprites, atlas', out.size)

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '1')
