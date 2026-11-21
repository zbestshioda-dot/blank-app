"""Cut the football park props from tools/sheets/football.jpg into public/assets/football.webp (+ .json), and shrink the
pitch picture (tools/sheets/football_pitch.jpg) to public/assets/pitch.webp.

    python3 tools/build_football.py
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
A = os.path.join(ROOT, 'public', 'assets')
# reading order on the sheet; tiles = drawn width in map tiles
ITEMS = [('goal3d', 4), ('goal', 4), ('stands', 6), ('score', 3.4), ('dugout', 4), ('flag', 1), ('ball', .55),
         ('cones', 1.6), ('cooler', 1), ('fence', 4), ('fencec', 2), ('light', 1.4), ('kiosk', 2.4), ('trophy', 1.2)]
PX = 64   # stored pixels per tile

def main():
    sh = Image.open(os.path.join(ROOT, 'tools', 'sheets', 'football.jpg')).convert('RGB'); a = np.asarray(sh).astype(int)
    fg = (a.min(axis=2) < 232) | (a.max(axis=2) - a.min(axis=2) > 18)
    lab, n = ndimage.label(ndimage.binary_dilation(fg, iterations=12))
    objs = [o for o in ndimage.find_objects(lab) if (o[0].stop - o[0].start) * (o[1].stop - o[1].start) > 2500]
    rows = []                                                   # group into rows by vertical centre, then left to right
    for o in sorted(objs, key=lambda o: (o[0].start + o[0].stop) / 2):
        cy = (o[0].start + o[0].stop) / 2
        if rows and abs(rows[-1][0] - cy) < 160: rows[-1][1].append(o)
        else: rows.append([cy, [o]])
    objs = [o for _, r in rows for o in sorted(r, key=lambda o: o[1].start)]
    assert len(objs) == len(ITEMS), f'found {len(objs)} items'
    out, meta, x = [], {}, 0
    for (name, tw), o in zip(ITEMS, objs):
        crop = a[o]; m = fg[o]
        m = ndimage.binary_fill_holes(ndimage.binary_closing(m, iterations=2)) if name not in ('goal3d', 'goal', 'fence', 'fencec') else ndimage.binary_closing(m, iterations=1)
        rgba = np.dstack([crop, np.where(m, 255, 0)]).astype(np.uint8)
        im = Image.fromarray(rgba); im = im.crop(im.getbbox())
        w = round(tw * PX); h = round(im.height * w / im.width); im = im.resize((w, h), Image.LANCZOS)
        out.append((name, x, im)); meta[name] = [x, 0, w, h, tw]; x += w + 2
    sheet = Image.new('RGBA', (x, max(im.height for _, _, im in out)))
    for _, px, im in out: sheet.paste(im, (px, 0))
    sheet.save(os.path.join(A, 'football.webp'), 'WEBP', lossless=True)
    json.dump({'px': PX, 'sprites': meta}, open(os.path.join(A, 'football.json'), 'w'), separators=(',', ':'))
    p = Image.open(os.path.join(ROOT, 'tools', 'sheets', 'football_pitch.jpg')).convert('RGB')
    p.resize((1376, 768), Image.NEAREST).save(os.path.join(A, 'pitch.webp'), 'WEBP', quality=90)
    print('football.webp', sheet.size, '·', list(meta))

if __name__ == '__main__': main()
