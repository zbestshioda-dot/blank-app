"""Cut the 16 autotile soil pieces (tools/sheets/pixel_soil.jpg, 4x4) into 1-tile sprites y_soil0..y_soil15.

    python3 tools/add_soil.py

Order (grass shows on the sides where there is no neighbouring soil):
 0 middle  1 top  2 bottom  3 left | 4 right  5 top+left  6 top+right  7 bottom+left | 8 bottom+right
 9 inner NW  10 inner NE  11 inner SW | 12 inner SE  13 top+bottom  14 left+right  15 single (all sides)
"""
import json
import numpy as np
from PIL import Image
from scipy import ndimage
from add_furniture import bgmask, IMG, JS, ROOT
import os

def tiles():
    a = np.asarray(Image.open(os.path.join(ROOT, 'tools', 'sheets', 'pixel_soil.jpg')).convert('RGB')).astype(int)
    fg = ~bgmask(a); lab, n = ndimage.label(fg)
    bs = [[s[0].start, s[1].start, s[0].stop, s[1].stop] for s in ndimage.find_objects(lab) if (s[0].stop - s[0].start) * (s[1].stop - s[1].start) > 20000]
    bs.sort(key=lambda b: (round(b[0] / 300), b[1]))
    for i, (y0, x0, y1, x1) in enumerate(bs):
        crop = a[y0 + 7:y1 - 7, x0 + 7:x1 - 7]; m = ~bgmask(crop)   # trim the jpeg halo along the magenta edges
        im = Image.fromarray(np.dstack([crop, np.where(m, 255, 0)]).astype(np.uint8))
        yield f'y_soil{i}', im

def main():
    atlas = Image.open(IMG).convert('RGBA'); data = json.load(open(JS)); T = data['tile']
    new = [(n, im.resize((T, T), Image.NEAREST)) for n, im in tiles()]
    for n, _ in new: data['sprites'].pop(n, None)   # re-cut: the old copies stay in the atlas image but are no longer referenced
    y = data['size'][1] + 2
    out = Image.new('RGBA', (atlas.width, y + T)); out.paste(atlas, (0, 0))
    for i, (n, im) in enumerate(new): out.paste(im, (i * (T + 2), y)); data['sprites'][n] = [i * (T + 2), y, T, T]
    data['size'] = [atlas.width, y + T]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':')); print('added', len(new), out.size)

if __name__ == '__main__':
    main()
