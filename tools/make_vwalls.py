"""Draw the vertical (north-south) room partitions as pv_* sprites, in the colours of the horizontal pw_* walls, and append
them to the atlas (existing coordinates unchanged). Seen from above a vertical wall is its top cap running down the floor
(LEN tiles) with the wall's end face below it; the sprite's bottom is the wall's south end on the floor.

    python3 tools/make_vwalls.py
"""
import json, os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp')
JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
T, LEN, W, F = 48, 3, 18, 46            # px per tile, wall length in tiles, cap width px, end-face height px
SRC = {'pv_pink': 'pw_pink', 'pv_cream': 'pw_cream', 'pv_blue': 'pw_blue', 'pv_grey': 'pw_grey', 'pv_wood': 'pw_wood', 'pv_rail': 'pw_railing', 'pv_glass': 'pw_glass'}

def shade(c, k): return tuple(max(0, min(255, round(v * k))) for v in c[:3]) + (255,)

def main():
    data = json.load(open(JS)); S = data['sprites']; atlas = Image.open(IMG).convert('RGBA')
    if 'pv_pink' in S: return print('already there')
    px = lambda name, fx, fy: (lambda s: atlas.getpixel((s[0] + int(s[2] * fx), s[1] + int(s[3] * fy))))(S[name])
    pieces = []
    for name, src in SRC.items():
        cap, face, line = px(src, .5, .08), px(src, .5, .6), px(src, .02, .6)
        if name == 'pv_wood': cap = shade(face, 1.2)
        H = LEN * T + F; im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        out = shade(line, .55) if sum(line[:3]) > 200 else (40, 28, 28, 255)
        if name == 'pv_rail':                     # a wooden rail with turned posts, a short end post below
            wood = px(src, .5, .1); d.rectangle([5, 0, W - 6, LEN * T + 6], fill=wood, outline=out)
            for y in range(4, LEN * T, 16): d.rectangle([2, y, W - 3, y + 7], fill=shade(wood, 1.15), outline=out)
            d.rectangle([4, LEN * T, W - 5, H - 1], fill=shade(wood, .85), outline=out)
        elif name == 'pv_glass':                  # a glass pane in a thin frame: see-through blue with a shine line
            frame = px(src, .01, .5); d.rectangle([3, 0, W - 4, H - 1], fill=(170, 205, 240, 150), outline=frame)
            d.line([6, 6, 6, H - 8], fill=(255, 255, 255, 200), width=2)
            for y in (0, LEN * T): d.rectangle([2, y, W - 3, y + 4], fill=frame, outline=out)
        else:
            d.rectangle([0, 0, W - 1, LEN * T + 4], fill=cap, outline=out)                 # the top of the wall
            d.line([2, 2, 2, LEN * T], fill=shade(cap, 1.12), width=2)                     # light catching its edge
            d.rectangle([0, LEN * T, W - 1, H - 1], fill=face, outline=out)               # the end face
            d.line([1, H - 4, W - 2, H - 4], fill=shade(face, .78), width=2)               # skirting at the floor
            if name == 'pv_wood':
                for x in (6, 12): d.line([x, 3, x, LEN * T], fill=shade(cap, .8), width=1)
        pieces.append((name, im))
    x, y = 0, data['size'][1] + 2
    out = Image.new('RGBA', (atlas.width, y + max(im.height for _, im in pieces))); out.paste(atlas, (0, 0))
    for name, im in pieces: out.paste(im, (x, y)); S[name] = [x, y, im.width, im.height]; x += im.width + 2
    data['size'] = [atlas.width, out.height]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('added', [n for n, _ in pieces])

if __name__ == '__main__':
    main()
