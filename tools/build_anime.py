"""Anime dialogue portraits (4 moods) from tools/sheets/anime_1..3.jpg (4x4 grids, 2048px).

    python3 tools/build_anime.py

Output: public/assets/anime.webp (S x S cells, transparent background) + anime.json
{size, cols, who: {key: {n, h, s, a}}}  (n = normal/talking, h = happy, s = surprised, a = angry/pouting).
The AI sheets did not always keep a character the same across a row, so each mood is picked by hand below;
a mood without a good cell falls back to that character's normal face.
"""
import json, os
from collections import deque
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'public', 'assets', 'anime')
S = 256
# cell boxes per sheet (x0, x1) for the 4 columns and (y0, y1) for the 4 rows
EVEN = [(i * 512 + 8, (i + 1) * 512 - 8) for i in range(4)]
BOX3 = [(40, 500), (542, 1004), (1046, 1506), (1550, 2008)]
BOXES = {1: (EVEN, EVEN), 2: (EVEN, EVEN), 4: (EVEN, EVEN), 3: (BOX3, [(34, 498), (540, 1004), (1046, 1510), (1554, 2020)])}
# key: {mood: (sheet, row, col)}
PICK = {
    'office':       {'n': (1, 0, 0), 's': (1, 0, 2), 'a': (1, 0, 3)},
    'merchant':     {'n': (1, 1, 0), 'h': (1, 1, 1), 's': (1, 1, 2)},
    'doctor':       {'n': (1, 2, 0), 'h': (1, 0, 1)},
    'police':       {'n': (1, 3, 0), 'h': (1, 3, 1), 's': (1, 3, 2), 'a': (1, 3, 3)},
    'undertaker':   {'n': (2, 0, 0), 'h': (2, 0, 1), 's': (2, 0, 2)},
    'mechanic':     {'n': (2, 1, 0), 'h': (2, 1, 1), 's': (2, 1, 2), 'a': (2, 1, 3)},
    'thug':         {'n': (2, 2, 0), 'h': (2, 2, 1)},
    'photographer': {'n': (2, 3, 0), 'h': (2, 3, 1), 'a': (2, 3, 3)},
    'courier':      {'n': (3, 0, 0), 'h': (3, 0, 1), 's': (3, 0, 2), 'a': (3, 0, 3)},
    'rider':        {'n': (3, 1, 0), 'h': (3, 1, 1), 's': (3, 1, 2), 'a': (3, 1, 3)},
    'farmer':       {'n': (3, 2, 0), 'h': (3, 2, 1), 's': (3, 2, 2), 'a': (3, 2, 3)},
    'fishing':      {'n': (3, 3, 0), 'h': (3, 3, 1), 's': (3, 3, 2), 'a': (3, 3, 3)},
    'beggar':       {'n': (4, 0, 0), 'h': (4, 0, 1), 's': (4, 0, 2), 'a': (4, 0, 3)},
    'monk':         {'n': (4, 1, 0), 'h': (4, 1, 1), 's': (4, 1, 2), 'a': (4, 1, 3)},
    'cashier':      {'n': (4, 2, 0), 'h': (4, 2, 1), 's': (4, 2, 2), 'a': (4, 2, 3)},
    'templeboy':    {'n': (4, 3, 0), 'h': (4, 3, 1), 's': (4, 3, 2), 'a': (4, 3, 3)},
}

def cutout(cell, lo=238, sides=.45):
    """white background -> transparent: flood fill from the edges over near-white pixels, then soften the rim"""
    a = np.asarray(cell.convert('RGB')).astype(int); H, W = a.shape[:2]
    white = (a.min(axis=2) > lo) & (a.max(axis=2) - a.min(axis=2) < 14)
    bg = np.zeros((H, W), bool); q = deque()
    for x in range(W):            # seeds: top edge and the upper part of the sides only (white shirts reach the bottom edge)
        for y in (0,):
            if white[y, x] and not bg[y, x]: bg[y, x] = True; q.append((y, x))
    for y in range(int(H * sides)):
        for x in (0, W - 1):
            if white[y, x] and not bg[y, x]: bg[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W and white[ny, nx] and not bg[ny, nx]: bg[ny, nx] = True; q.append((ny, nx))
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    im = Image.fromarray(np.dstack([a.astype(np.uint8), alpha]), 'RGBA')
    return im

def main():
    sheets = {i: Image.open(os.path.join(ROOT, 'tools', 'sheets', f'anime_{i}.jpg')).convert('RGB') for i in (1, 2, 3, 4)}
    for i, im in sheets.items():
        if im.size != (2048, 2048): sheets[i] = im.resize((2048, 2048), Image.LANCZOS)
    tiles, cache, who = [], {}, {}
    for key, moods in PICK.items():
        who[key] = {}
        for m in 'nhsa':
            src = moods.get(m, moods['n'])
            if src not in cache:
                sh, r, c = src; xs, ys = BOXES[sh]
                cell = sheets[sh].crop((xs[0][c] if False else xs[c][0], ys[r][0], xs[c][1], ys[r][1]))
                cell = cutout(cell, 200, 1) if sh == 4 else cutout(cell)   # sheet 4: graph-paper grid, nobody's shirt touches the sides
                side = max(cell.size); sq = Image.new('RGBA', (side, side)); sq.paste(cell, ((side - cell.width) // 2, side - cell.height))
                cache[src] = len(tiles); tiles.append(sq.resize((S, S), Image.LANCZOS))
            who[key][m] = cache[src]
    cols = 8; rows = (len(tiles) + cols - 1) // cols
    out = Image.new('RGBA', (S * cols, S * rows))
    for k, t in enumerate(tiles): out.paste(t, ((k % cols) * S, (k // cols) * S))
    out.save(OUT + '.webp', 'WEBP', quality=88, method=6)
    import hashlib; v = hashlib.sha1(open(OUT + '.webp', 'rb').read()).hexdigest()[:8]   # cache buster for the image
    json.dump({'size': S, 'cols': cols, 'rows': rows, 'v': v, 'who': who}, open(OUT + '.json', 'w'), separators=(',', ':'))
    print(len(tiles), 'cells', out.size, os.path.getsize(OUT + '.webp') // 1024, 'KB')

if __name__ == '__main__':
    main()
