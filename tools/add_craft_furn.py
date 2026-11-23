"""Cut the 6 craft-only furniture sprites from tools/sheets/craft_furn.jpg (2 rows x 3, magenta) and append to the atlas.

    python3 tools/add_craft_furn.py && node tools/build_snow_atlas.js   (then bump the atlas ?v= in public/game.js)
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, os.path.dirname(__file__))
from add_furniture import IMG, JS, TILE

ROOT = os.path.join(os.path.dirname(__file__), '..')
SHEET = os.path.join(ROOT, 'tools', 'sheets', 'craft_furn.jpg')
# reading order -> sprite name, width in tiles (same footprint as the placeholder shop sprite each one replaces)
ITEMS = [('xc_rocker', 1.7), ('xc_quilt', 2.0), ('xc_shelf', 1.9), ('xc_bonsai', 1.4), ('xc_tank', 1.9), ('xc_arch', 1.6)]

def bg(a):   # magenta plus the pink haze where the bonsai's glow was painted over it
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (g < np.minimum(r, b) * 0.8) & (r > 150) & (b > 150)

def main():
    sheet = np.asarray(Image.open(SHEET).convert('RGB')).astype(int); H, W = sheet.shape[:2]
    atlas = Image.open(IMG).convert('RGBA'); data = json.load(open(JS))
    x, y, rowh, placed = 0, data['size'][1] + 2, 0, []
    for i, (name, wt) in enumerate(ITEMS):
        r, c = divmod(i, 3); a = sheet[r * H // 2:(r + 1) * H // 2, c * W // 3:(c + 1) * W // 3]
        fg = ~bg(a); lab, n = ndimage.label(ndimage.binary_closing(fg, iterations=2))
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        keep = np.isin(lab, [k + 1 for k, s in enumerate(sizes) if s > sizes.max() * .04]) & fg   # drop sparkles / specks
        im = Image.fromarray(np.dstack([a, np.where(keep, 255, 0)]).astype(np.uint8)); im = im.crop(im.getbbox())
        w = round(wt * TILE); h = round(im.height * w / im.width); im = im.resize((w, h), Image.LANCZOS)
        if x + w > atlas.width: x, y, rowh = 0, y + rowh + 2, 0
        placed.append((name, x, y, im)); x += w + 2; rowh = max(rowh, h)
    out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
    for name, px, py, im in placed: out.paste(im, (px, py)); data['sprites'][name] = [px, py, im.width, im.height]
    data['size'] = [atlas.width, y + rowh]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('added', [p[0] for p in placed], 'atlas', out.size)

if __name__ == '__main__':
    main()
