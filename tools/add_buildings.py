"""Append new building sprites from tools/sheets/pixel_buildings_a.jpg to public/assets/atlas.webp + atlas.json.

    python3 tools/add_buildings.py

Sheet = 2x2 cells (1000 px each) on a magenta background. Each building is cut out,
magenta is made transparent, cropped to its bounds and scaled so its width equals
(tiles * 48) atlas px. Sprites are appended in a new band under the existing atlas,
so existing sprite coordinates do not change.
"""
import json, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
SHEET = os.path.join(ROOT, 'tools', 'sheets', 'pixel_buildings_a.jpg')
ATLAS_IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp')
ATLAS_JSON = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
TILE = 48
CELL = 1000
# name: (cell col, cell row, width in game tiles)
ITEMS = {
    'b_rider':   (0, 0, 5),
    'b_toolshop': (1, 0, 5.5),
    'b_market':  (0, 1, 5),
    'b_fishing': (1, 1, 5.5),
}

def cut(sheet, col, row):
    im = sheet.crop((col * CELL, row * CELL, (col + 1) * CELL, (row + 1) * CELL)).convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, _ = px[x, y]
            # distance to pure magenta: knock out the background and its fringe
            if (255 - r) ** 2 + g ** 2 + (255 - b) ** 2 < 110 ** 2:
                px[x, y] = (0, 0, 0, 0)
    bb = im.getbbox()
    return im.crop(bb)

def main():
    atlas = Image.open(ATLAS_IMG).convert('RGBA')
    data = json.load(open(ATLAS_JSON, encoding='utf-8'))
    sheet = Image.open(SHEET).convert('RGB')
    band_y = data['size'][1]
    pieces = []
    for name, (c, r, tiles) in ITEMS.items():
        im = cut(sheet, c, r)
        w = round(tiles * TILE)
        h = round(im.height * w / im.width)
        pieces.append((name, im.resize((w, h), Image.LANCZOS)))
    # pack in one row band below the existing atlas
    x, rowh, pad = 0, 0, 4
    placed = []
    for name, im in pieces:
        if x + im.width > atlas.width:
            x, band_y, rowh = 0, band_y + rowh + pad, 0
        placed.append((name, x, band_y, im))
        x += im.width + pad
        rowh = max(rowh, im.height)
    new_h = band_y + rowh + pad
    out = Image.new('RGBA', (atlas.width, new_h), (0, 0, 0, 0))
    out.paste(atlas, (0, 0))
    for name, px_, py, im in placed:
        out.paste(im, (px_, py), im)
        data['sprites'][name] = [px_, py, im.width, im.height]
    data['size'] = [atlas.width, new_h]
    out.save(ATLAS_IMG, 'WEBP', lossless=True, method=6)
    json.dump(data, open(ATLAS_JSON, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('added', [p[0] for p in placed], 'atlas', out.size)

if __name__ == '__main__':
    main()
