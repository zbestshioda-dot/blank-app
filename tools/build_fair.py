"""Cut the temple-fair stalls (tools/sheets/templefair.jpg) and props (templefair_props.jpg) into public/assets/fair.webp (+ .json).

    python3 tools/build_fair.py
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..'); A = os.path.join(ROOT, 'public', 'assets')
SHEETS = [('templefair.jpg', [('s_cotton', 3), ('s_grill', 3.4), ('s_coconut', 2.8), ('s_darts', 3.3), ('s_ring', 3.3), ('s_fish', 3.3), ('s_dessert', 3),
                              ('s_kanomkrok', 3), ('s_eggs', 3), ('s_glass', 3), ('s_sweets', 3)]),
          ('templefair_props.jpg', [('f_lights', 4), ('f_pole', 1), ('f_table', 2.2), ('f_teddy', 1.5), ('f_balloons', 1.2), ('f_speaker', 1.1), ('f_arch', 5), ('f_bin', 1)])]
PX = 64

def items(fn, names):
    a = np.asarray(Image.open(os.path.join(ROOT, 'tools', 'sheets', fn)).convert('RGB')).astype(int)
    fg = (a.min(axis=2) < 228) | (a.max(axis=2) - a.min(axis=2) > 20)
    lab, n = ndimage.label(ndimage.binary_dilation(fg, iterations=14))
    objs = [o for o in ndimage.find_objects(lab) if (o[0].stop - o[0].start) * (o[1].stop - o[1].start) > 4000]
    rows = []
    for o in sorted(objs, key=lambda o: (o[0].start + o[0].stop) / 2):
        cy = (o[0].start + o[0].stop) / 2
        if rows and abs(rows[-1][0] - cy) < 200: rows[-1][1].append(o)
        else: rows.append([cy, [o]])
    objs = [o for _, r in rows for o in sorted(r, key=lambda o: o[1].start)]
    assert len(objs) == len(names), f'{fn}: found {len(objs)} items'
    for (name, tw), o in zip(names, objs):
        m = fg[o]
        m = ndimage.binary_closing(m, iterations=1) if name in ('f_lights', 'f_balloons', 'f_pole', 'f_speaker') else ndimage.binary_fill_holes(ndimage.binary_closing(m, iterations=2))
        im = Image.fromarray(np.dstack([a[o], np.where(m, 255, 0)]).astype(np.uint8)); im = im.crop(im.getbbox())
        w = round(tw * PX); yield name, tw, im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)

def main():
    out, meta, x = [], {}, 0
    for fn, names in SHEETS:
        for name, tw, im in items(fn, names): out.append((x, im)); meta[name] = [x, 0, im.width, im.height, tw]; x += im.width + 2
    sheet = Image.new('RGBA', (x, max(im.height for _, im in out)))
    for px, im in out: sheet.paste(im, (px, 0))
    sheet.save(os.path.join(A, 'fair.webp'), 'WEBP', lossless=True)
    json.dump({'px': PX, 'sprites': meta}, open(os.path.join(A, 'fair.json'), 'w'), separators=(',', ':'))
    print('fair.webp', sheet.size, list(meta))

if __name__ == '__main__': main()
