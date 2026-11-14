"""Cut the player vehicles (front / back / side views) from tools/sheets/pixel_moto.jpg and pixel_cars.jpg and append
them to the atlas as w_<key>_f, w_<key>_b, w_<key>_s (side view faces LEFT, the game mirrors it for right).

    python3 tools/add_vehicles.py
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp')
JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
BOX = json.load(open(os.path.join(ROOT, 'tools', 'veh_boxes.json')))   # bounding boxes found once by connected components
TILE = 48
# key: (sheet, front, back, side, side faces right?, side length in tiles)
VEH = {
    'escoot':   ('moto', 41, 45, 40, False, 1.45), 'vespa': ('moto', 1, 2, 4, True, 1.9), 'cub': ('moto', 8, 9, 11, True, 1.95),
    'delivery': ('moto', 46, 47, 49, False, 2.0), 'dirt': ('moto', 29, 29, 28, False, 2.0), 'cafe': ('moto', 35, 36, 37, True, 2.0),
    'cruiser':  ('moto', 22, 23, 25, True, 2.2), 'sport': ('moto', 15, 17, 18, True, 2.1),
    'mini': ('cars', 2, 3, 4, True, 2.4), 'sedan': ('cars', 8, 9, 10, True, 2.6), 'pickup': ('cars', 13, 14, 16, False, 2.8),
    'van': ('cars', 28, 29, 30, True, 2.9), 'suv': ('cars', 18, 19, 20, True, 2.7), 'sports': ('cars', 23, 24, 25, True, 2.7),
    'taxi': ('cars', 34, 35, 36, True, 2.6), 'police': ('cars', 40, 41, 42, True, 2.6),
}

def cut(sheet, box):
    y0, x0, y1, x1 = box
    a = np.asarray(sheet.crop((x0 - 2, y0 - 2, x1 + 2, y1 + 2)).convert('RGB')).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg = (g < np.minimum(r, b) * 0.6) & (np.abs(r - b) < 90) & (np.minimum(r, b) > 110)
    grid = (r > 80) & (b > 80) & (g < 70) & (np.abs(r - b) < 70)
    fg = ~bg & ~grid
    lab, n = ndimage.label(ndimage.binary_closing(fg, iterations=2))
    if n > 1:
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        fg = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > sizes.max() * .05]) & fg
    # pink wheel hubs: the sheet's magenta shows through the rims, paint it grey
    hub = fg & (g < np.minimum(r, b) * 0.75) & (np.minimum(r, b) > 90)
    a[hub] = [150, 150, 160]
    im = Image.fromarray(np.dstack([a, np.where(fg, 255, 0)]).astype(np.uint8)); return im.crop(im.getbbox())

def main():
    atlas = Image.open(IMG).convert('RGBA'); data = json.load(open(JS))
    x, y, rowh = 0, data['size'][1] + 2, 0; placed = []
    sheets = {k: Image.open(os.path.join(ROOT, 'tools', 'sheets', f'pixel_{k}.jpg')).convert('RGB') for k in ('moto', 'cars')}
    for key, (sh, f, b, s, flip, tiles) in VEH.items():
        side = cut(sheets[sh], BOX[sh][s]); k = tiles * TILE / side.width
        if flip: side = side.transpose(Image.FLIP_LEFT_RIGHT)
        for suf, im in (('s', side), ('f', cut(sheets[sh], BOX[sh][f])), ('b', cut(sheets[sh], BOX[sh][b]))):
            name = f'w_{key}_{suf}'
            if name in data['sprites']: continue
            im = im.resize((max(4, round(im.width * k)), max(4, round(im.height * k))), Image.LANCZOS)
            if x + im.width > atlas.width: x, y, rowh = 0, y + rowh + 2, 0
            placed.append((name, x, y, im)); x += im.width + 2; rowh = max(rowh, im.height)
    out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
    for name, px, py, im in placed: out.paste(im, (px, py)); data['sprites'][name] = [px, py, im.width, im.height]
    data['size'] = [atlas.width, y + rowh]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('added', len(placed), 'atlas', out.size)

if __name__ == '__main__':
    main()
