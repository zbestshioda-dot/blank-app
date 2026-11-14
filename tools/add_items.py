"""Cut the small decor items from tools/sheets/items_decor.jpg (8x8 grid on magenta) into the atlas.

    python3 tools/add_items.py      (then tools/repack_atlas.py drops whatever the game does not use)

Names that are already in the atlas are skipped.
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp')
JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
SHEET = os.path.join(ROOT, 'tools', 'sheets', 'items_decor.jpg')
NAMES = [  # row by row, left to right
  'i_poster', 'i_calendar', 'i_clock', 'i_plant', 'i_cactus', 'i_vase', 'i_painting', 'i_open',
  'i_shopsign', 'i_sign_blank', 'i_bin_blue', 'i_bin_yellow', 'i_water', 'i_extinguisher', 'i_firstaid', 'i_corkboard',
  'i_pizza', 'i_bread', 'i_crate_apple', 'i_crate_carrot', 'i_milk', 'i_fish_ice', 'i_cake', 'i_coffee',
  'i_teapot', 'i_plates', 'i_stove_pot', 'i_pan', 'i_bottles', 'i_wine_rack', 'i_jam', 'i_rice_sack',
  'i_laptop', 'i_phone', 'i_books', 'i_news', 'i_backpack', 'i_umbrella', 'i_shoe_rack', 'i_rack',
  'i_ball', 'i_toycar', 'i_teddy', 'i_console', 'i_guitar', 'i_football', 'i_bike', 'i_skate',
  'i_cashbox', 'i_basket', 'i_pricestand', 'i_register', 'i_bag', 'i_gift1', 'i_gift2', 'i_bell',
  'i_stop', 'i_cone', 'i_bench', 'i_pot', 'i_watering', 'i_lantern', 'i_hanging', 'i_window_flower']
SCALE = 0.48     # sheet px -> atlas px (a cell of the sheet is ~1 game tile)

def main():
    data = json.load(open(JS)); atlas = Image.open(IMG).convert('RGBA'); S = data['sprites']
    a = np.asarray(Image.open(SHEET).convert('RGB')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg = (g < np.minimum(r, b) * 0.6) & (np.abs(r - b) < 90) & (np.minimum(r, b) > 110)
    rgba = np.dstack([a, np.where(bg, 0, 255)]).astype(np.uint8)
    H, W = bg.shape; cw, ch = W / 8, H / 8
    pieces = []
    for i, name in enumerate(NAMES):
        if name in S: continue
        cx, cy = i % 8, i // 8
        x0, y0, x1, y1 = int(cx * cw), int(cy * ch), int((cx + 1) * cw), int((cy + 1) * ch)
        cell = ~bg[y0:y1, x0:x1]
        lab, n = ndimage.label(ndimage.binary_dilation(cell, iterations=3))
        if not n: continue
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1)); keep = lab == 1 + int(np.argmax(sizes))
        piece = rgba[y0:y1, x0:x1].copy(); piece[..., 3] = np.where(keep & cell, 255, 0)
        im = Image.fromarray(piece); im = im.crop(im.getbbox())
        pieces.append((name, im.resize((max(1, round(im.width * SCALE)), max(1, round(im.height * SCALE))), Image.LANCZOS)))
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
    print('added', len(placed))

if __name__ == '__main__':
    main()
