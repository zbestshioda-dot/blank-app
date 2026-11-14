"""Cut the convenience-store buildings (tools/sheets/pixel_cstore_b.jpg, four variants in a 2x2 grid) and the store
fittings (tools/sheets/pixel_cstore_i.jpg) and append them to the atlas as b_cs1..b_cs4 and c_* sprites.

    python3 tools/add_cstores.py

tools/cstore_boxes.json holds each fitting's bounding box [y0, x0, y1, x1] in reading order (connected components).
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage
from add_furniture import cut, bgmask, IMG, JS, ROOT, TILE

BOX = json.load(open(os.path.join(ROOT, 'tools', 'cstore_boxes.json')))
NAMES = ('chips fridge icebox hotdog cashier baskets bread noodles coffee '
         'atm lottery shelfred safe cctv light '
         'rug1 giftcards tap umbrella bags fruit water cups '
         'cans toiletry freezer deli '
         'sign shelfempty soap cart boxes rug2 '
         'mop bin notice locker clock fan endshelf board '
         'icecream hotdog2 stool napkin').split()
SCALE = {'cctv': .55, 'clock': .5, 'giftcards': .7, 'tap': .6, 'soap': .5, 'napkin': .55, 'coffee': .8, 'cups': .75, 'fruit': .75, 'fan': .7, 'light': .8, 'notice': .9}
PX_ITEM, PX_BLD = 130, 150

def buildings():
    sheet = Image.open(os.path.join(ROOT, 'tools', 'sheets', 'pixel_cstore_b.jpg')).convert('RGB')
    W, H = sheet.size
    for k, (qx, qy) in enumerate([(0, 0), (1, 0), (0, 1), (1, 1)]):
        q = sheet.crop((qx * W // 2 + 8, qy * H // 2 + 8, (qx + 1) * W // 2 - 8, (qy + 1) * H // 2 - 8))
        a = np.asarray(q).astype(int); fg = ~bgmask(a)
        lab, n = ndimage.label(ndimage.binary_closing(fg, iterations=3))
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1)); keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > sizes.max() * .02]) & fg
        im = Image.fromarray(np.dstack([a, np.where(keep, 255, 0)]).astype(np.uint8)); im = im.crop(im.getbbox())
        yield f'b_cs{k + 1}', im, PX_BLD

def items():
    sheet = Image.open(os.path.join(ROOT, 'tools', 'sheets', 'pixel_cstore_i.jpg')).convert('RGB')
    for i, nm in enumerate(NAMES): yield 'c_' + nm, cut(sheet, BOX[i]), PX_ITEM

def main():
    atlas = Image.open(IMG).convert('RGBA'); data = json.load(open(JS))
    x, y, rowh = 0, data['size'][1] + 2, 0; placed = []
    for name, im, px in [*buildings(), *items()]:
        if name in data['sprites']: continue
        w = max(8, round(im.width / px * TILE * SCALE.get(name[2:], 1))); h = max(8, round(im.height * w / im.width))
        im = im.resize((w, h), Image.LANCZOS)
        if x + w > atlas.width: x, y, rowh = 0, y + rowh + 2, 0
        placed.append((name, x, y, im)); x += w + 2; rowh = max(rowh, h)
    out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
    for name, px, py, im in placed: out.paste(im, (px, py)); data['sprites'][name] = [px, py, im.width, im.height]
    data['size'] = [atlas.width, y + rowh]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('added', len(placed), 'atlas', out.size)

if __name__ == '__main__':
    main()
