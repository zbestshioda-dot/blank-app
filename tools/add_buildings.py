"""Cut building sprites from the 2x2 sheets in tools/sheets/ (magenta background) and append
any that are not in the atlas yet under the current atlas (existing coordinates unchanged).

    python3 tools/add_buildings.py
"""
import json, os
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp')
JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
TILE = 48
# name: (sheet, cell col, cell row, width in game tiles)
ITEMS = {'b_rider': ('a', 0, 0, 5.6), 'b_toolshop': ('a', 1, 0, 5), 'b_market': ('a', 0, 1, 5), 'b_fishing': ('a', 1, 1, 5.5),
         'b_cafe2': ('b', 0, 0, 5), 'b_school2': ('b', 1, 0, 6.4), 'b_inn2': ('b', 0, 1, 5.4), 'b_bank2': ('b', 1, 1, 5.6)}
SHEET = lambda k: os.path.join(ROOT, 'tools', 'sheets', f'pixel_buildings_{k}.jpg')

def cut(sheet, col, row):
    c = sheet.width // 2
    a = np.asarray(sheet.crop((col * c, row * c, (col + 1) * c, (row + 1) * c)).convert('RGB')).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg = (g < np.minimum(r, b) * 0.6) & (np.abs(r - b) < 90)          # magenta and its fringe
    rgba = np.dstack([a, np.where(bg, 0, 255)]).astype(np.uint8)
    im = Image.fromarray(rgba)
    return im.crop(im.getbbox())

def main():
    atlas = Image.open(IMG).convert('RGBA'); data = json.load(open(JS))
    x, y, rowh = 0, data['size'][1] + 2, 0
    placed = []
    for name, (sh, c, r, tiles) in ITEMS.items():
        if name in data['sprites']: continue
        im = cut(Image.open(SHEET(sh)).convert('RGB'), c, r); w = round(tiles * TILE); im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        if x + w > atlas.width: x, y, rowh = 0, y + rowh + 2, 0
        placed.append((name, x, y, im)); x += w + 2; rowh = max(rowh, im.height)
    out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
    for name, px, py, im in placed:
        out.paste(im, (px, py)); data['sprites'][name] = [px, py, im.width, im.height]
    data['size'] = [atlas.width, y + rowh]
    out.save(IMG, 'WEBP', quality=92, method=6)
    json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('added', [p[0] for p in placed], 'atlas', out.size)

if __name__ == '__main__':
    main()
