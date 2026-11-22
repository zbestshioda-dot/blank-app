"""Cut the library / detective-office props from tools/sheets/library_props.jpg (12 items on magenta) and append them
to the atlas as l_* sprites (existing coordinates unchanged). Then run `node tools/build_snow_atlas.js` and bump the atlas ?v= in game.js.

    python3 tools/add_library_props.py
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp'); JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
TILE = 48
# reading order (rows top to bottom, left to right) -> (name, width in tiles); the three book piles are one item
ITEMS = [('l_board', 2.3), ('l_sign', 1.5), ('l_typedesk', 2.3), ('l_catalog', 1.7), ('l_lectern', 1.0), ('l_ladder', 2.2),
         ('l_books', 1.5), ('l_news', 1.8), ('l_case', 1.9), ('l_safe', 1.25), ('l_gramo', 1.05), ('l_rug', 3.0)]

def bgmask(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (g < np.minimum(r, b) * 0.6) & (np.abs(r - b) < 90) & (np.minimum(r, b) > 110)

def main():
    sheet = Image.open(os.path.join(ROOT, 'tools', 'sheets', 'library_props.jpg')).convert('RGB')
    a = np.asarray(sheet).astype(int); fg = ~bgmask(a)
    lab, n = ndimage.label(ndimage.binary_closing(fg, iterations=3))
    objs = [(s, i + 1) for i, s in enumerate(ndimage.find_objects(lab)) if (lab[s] == i + 1).sum() > 3000]
    objs.sort(key=lambda t: (round(t[0][0].start / 400), t[0][1].start))
    groups = [[o] for o in objs[:6]] + [objs[6:9]] + [[o] for o in objs[9:]]
    assert len(groups) == len(ITEMS), len(groups)
    atlas = Image.open(IMG).convert('RGBA'); data = json.load(open(JS))
    x, y, rowh, placed = 0, data['size'][1] + 2, 0, []
    for (name, wt), grp in zip(ITEMS, groups):
        if name in data['sprites']: continue
        keep = np.isin(lab, [i for _, i in grp]) & fg
        y0 = min(s[0].start for s, _ in grp); y1 = max(s[0].stop for s, _ in grp); x0 = min(s[1].start for s, _ in grp); x1 = max(s[1].stop for s, _ in grp)
        rgba = np.dstack([a[y0:y1, x0:x1], np.where(keep[y0:y1, x0:x1], 255, 0)]).astype(np.uint8)
        im = Image.fromarray(rgba); im = im.crop(im.getbbox())
        w = round(wt * TILE); h = round(im.height * w / im.width); im = im.resize((w, h), Image.LANCZOS)
        if x + w > atlas.width: x, y, rowh = 0, y + rowh + 2, 0
        placed.append((name, x, y, im)); x += w + 2; rowh = max(rowh, h)
    if not placed: return print('nothing new')
    out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
    for name, px, py, im in placed: out.paste(im, (px, py)); data['sprites'][name] = [px, py, im.width, im.height]
    data['size'] = [atlas.width, y + rowh]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('added', len(placed), 'atlas', out.size)

if __name__ == '__main__':
    main()
