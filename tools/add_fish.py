"""Cut the fish from tools/sheets/pixel_fish.jpg (4 columns x 8 rows on magenta) into the atlas as fish_<id>.

    python3 tools/add_fish.py

Names already in the atlas are skipped. The sprites are only drawn in the UI (bag, shop lists, catch pop-up).
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp')
JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
SHEET = os.path.join(ROOT, 'tools', 'sheets', 'pixel_fish.jpg')
NAMES = [  # row by row, left to right (item ids in server/data.js)
  'sfish', 'carp', 'catfish', 'tilapia',
  'snakehead', 'goldfish', 'guppy', 'puffer',
  'sardine', 'mackerel', 'herring', 'seabass',
  'snapper', 'tuna', 'swordfish', 'grouper',
  'clownfish', 'angelfish', 'lionfish', 'seahorse',
  'octopus', 'squid', 'crab', 'shrimp',
  'eel', 'stingray', 'shark', 'hammerhead',
  'koi', 'trout', 'salmon', 'goldenfish']
OUT_W = 64       # widest side of a sprite in the atlas

def main():
    data = json.load(open(JS)); atlas = Image.open(IMG).convert('RGBA'); S = data['sprites']
    a = np.asarray(Image.open(SHEET).convert('RGB')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg = (g < np.minimum(r, b) * 0.6) & (np.abs(r - b) < 90) & (np.minimum(r, b) > 110)
    rgba = np.dstack([a, np.where(bg, 0, 255)]).astype(np.uint8)
    H, W = bg.shape; cw, ch = W / 4, H / 8
    pieces = []
    for i, nm in enumerate(NAMES):
        name = 'fish_' + nm
        if name in S: continue
        cx, cy = i % 4, i // 4
        x0, y0, x1, y1 = int(cx * cw) + 4, int(cy * ch) + 4, int((cx + 1) * cw) - 4, int((cy + 1) * ch) - 4
        cell = ~bg[y0:y1, x0:x1]
        cell = ndimage.binary_opening(cell, iterations=1)
        lab, n = ndimage.label(ndimage.binary_dilation(cell, iterations=4))
        if not n: continue
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1)); keep = lab == 1 + int(np.argmax(sizes))
        piece = rgba[y0:y1, x0:x1].copy(); piece[..., 3] = np.where(keep & cell, 255, 0)
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
