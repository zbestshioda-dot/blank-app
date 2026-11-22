"""Cut the game-centre mini-game art (tools/sheets/mg_*.jpg, on magenta) into public/assets/mg.webp + mg.json,
plus the scrolling road (mg_road.jpg, a full picture) as public/assets/mg_road.webp. Sprites keep a size in canvas
pixels (the mini-game canvas is 340 x 400). Each sheet: rows top to bottom, left to right; scattered bits (sparks,
dizzy stars) are merged by a wide dilation.

    python3 tools/build_minigames.py
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
SH = lambda n: os.path.join(ROOT, 'tools', 'sheets', n)
OUT = os.path.join(ROOT, 'public', 'assets')
# sheet -> (dilation, rows of (name, width in canvas px))
SHEETS = {
  'mg_race.jpg': (34, [[('car_me', 50)], [('car_blue', 50), ('car_yellow', 50), ('car_green', 50), ('car_purple', 50), ('car_taxi', 50)],
                       [('cone', 28), ('oil', 56), ('barrier', 60), ('barrier_s', 40), ('crash', 70)]]),
  'mg_hoop.jpg': (10, [[('board', 150)], [('ball', 34), ('ball_blur', 56), ('net_swish', 64)], [('hoop_wall', 120), ('court', 300)]]),
  'mg_mole.jpg': (50, [[('hole', 80), ('mole_peek', 80), ('mole_up', 80), ('mole_hit', 80)], [('mole_gold', 60), ('mallet', 60)], [('grass', 340)]]),
  'mg_dance.jpg': (45, [[('ar_l', 56), ('ar_d', 56), ('ar_u', 56), ('ar_r', 56)], [('sl_l', 56), ('sl_d', 56), ('sl_u', 56), ('sl_r', 56)], [('burst', 80), ('stage', 340)]]),
  'mg_hockey.jpg': (10, [[('table', 330)], [('mallet_r', 52), ('mallet_b', 52), ('puck', 28)]]),
  'mg_claw.jpg': (10, [[('claw_open', 64), ('claw_shut', 44)], [('claw_wall', 300), ('claw_floor', 300)], [('chute', 60), ('coinbox', 60)]]),
}

def cut(path, dil, want):
    a = np.asarray(Image.open(path).convert('RGB')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    dist = np.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2)       # distance from pure magenta: pinks and purples in the art stay
    bg = dist < 75
    fg = ndimage.binary_opening(~bg, iterations=2)
    lab, n = ndimage.label(ndimage.binary_dilation(fg, iterations=dil))
    objs = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if (lab[sl] == i + 1).sum() < (20000 if dil >= 45 else 3000): continue
        objs.append(((sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2, i + 1, sl))
    objs.sort(); rows, cur = [], []
    for o in objs:
        if cur and o[0] - np.mean([c[0] for c in cur]) > 150: rows.append(cur); cur = []
        cur.append(o)
    if cur: rows.append(cur)
    got = [len(x) for x in rows]
    if got != [len(x) for x in want]: sys.exit(f'{path}: rows {got} != {[len(x) for x in want]}')
    alpha = np.clip((dist - 75) / 70, 0, 1)
    rgb = a.astype(float); tint = (1 - alpha)[..., None]
    rgb[..., 0] -= tint[..., 0] * 90; rgb[..., 2] -= tint[..., 0] * 90
    out = []
    for row, names in zip(rows, want):
        for (cy, cx, lid, sl), (name, w) in zip(sorted(row, key=lambda o: o[1]), names):
            keep = (lab[sl] == lid) & ~bg[sl]
            px = np.dstack([np.clip(rgb[sl], 0, 255), alpha[sl] * keep * 255]).astype(np.uint8)
            im = Image.fromarray(px, 'RGBA'); im = im.crop(im.getbbox())
            k = w * 2 / im.width                                   # stored at 2x for sharp phones
            out.append((name, im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)))
    return out

def main():
    pieces = [p for f, (d, want) in SHEETS.items() for p in cut(SH(f), d, want)]
    W, x, y, rowh, S = 1024, 0, 0, 0, {}
    pos = []
    for name, im in sorted(pieces, key=lambda p: -p[1].height):
        if x + im.width > W: x, y, rowh = 0, y + rowh + 2, 0
        pos.append((name, x, y, im)); x += im.width + 2; rowh = max(rowh, im.height)
    sheet = Image.new('RGBA', (W, y + rowh))
    for name, px, py, im in pos: sheet.paste(im, (px, py)); S[name] = [px, py, im.width, im.height]
    sheet.save(os.path.join(OUT, 'mg.webp'), 'WEBP', quality=90, method=6)
    json.dump({'scale': 2, 'sprites': S}, open(os.path.join(OUT, 'mg.json'), 'w'), separators=(',', ':'))
    road = Image.open(SH('mg_road.jpg')).convert('RGB')
    road = road.crop((0, round(road.height * .1), road.width, round(road.height * .9)))   # drop the guard rails across the top and bottom so it tiles
    road.resize((340 * 2, round(road.height * 680 / road.width)), Image.LANCZOS).save(os.path.join(OUT, 'mg_road.webp'), 'WEBP', quality=85, method=6)
    print('sprites', len(S), 'sheet', sheet.size)

if __name__ == '__main__':
    main()
