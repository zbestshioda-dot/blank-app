"""Rebuild the outdoor ground textures (grass, sand, dirt, asphalt, paving) as seamless 2x2 tiles.

    python3 tools/seamless_ground.py

Each texture is one cell of tools/sheets/ground_tiles.jpg (10x10 grid): its inner part is mirrored into a
2x2 quilt, so every edge meets its own mirror image and no grid lines show between tiles in the game.
"""
import json, os
from PIL import Image, ImageOps, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp')
JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
SHEET = os.path.join(ROOT, 'tools', 'sheets', 'ground_tiles.jpg')
# name: (row, col) of the source cell
CELLS = {'g_grass': (7, 1), 'g_grass_dots': (7, 4), 'g_grass3': (7, 6), 'g_sand': (9, 5), 'g_dirt': (8, 0),
         'g_asphalt': (0, 1), 'g_sidewalk': (4, 1), 'g_terracotta': (5, 1), 'g_cobble': (6, 1)}

def main():
    data = json.load(open(JS)); atlas = Image.open(IMG).convert('RGBA'); S = data['sprites']
    sheet = Image.open(SHEET).convert('RGBA'); cw = sheet.width / 10
    for name, (r, c) in CELLS.items():
        if name not in S: continue
        inset = cw * 0.16
        a = sheet.crop((round(c * cw + inset), round(r * cw + inset), round((c + 1) * cw - inset), round((r + 1) * cw - inset)))
        a = a.resize((48, 48), Image.LANCZOS)
        quilt = Image.new('RGBA', (96, 96))
        quilt.paste(a, (0, 0)); quilt.paste(ImageOps.mirror(a), (48, 0))
        quilt.paste(ImageOps.flip(a), (0, 48)); quilt.paste(ImageOps.flip(ImageOps.mirror(a)), (48, 48))
        x, y, w, h = S[name]
        atlas.paste(quilt.resize((w, h), Image.LANCZOS), (x, y))
    # grass is generated: wrap-around pixel noise in the sheet's own greens (no repeating marks, no seams)
    import random
    g = sheet.crop((round(1 * cw + cw * .2), round(7 * cw + cw * .2), round(2 * cw - cw * .2), round(8 * cw - cw * .2))).convert('RGB')
    px = sorted(g.get_flattened_data() if hasattr(g, 'get_flattened_data') else g.getdata(), key=lambda c: sum(c)); n = len(px)
    mid = px[n // 2]; dark = tuple(int(v * .84) for v in mid); light = tuple(min(255, int(v * 1.13)) for v in mid)
    for name, seed, flowers in (('g_grass', 1, 0), ('g_grass_dots', 2, 6), ('g_grass3', 3, 0)):
        if name not in S: continue
        rnd = random.Random(seed); N = 48; t = Image.new('RGB', (N, N), mid); P = t.load()
        for _ in range(170):                                          # soft blotches of lighter/darker grass
            cx, cy, col = rnd.randrange(N), rnd.randrange(N), rnd.choice((dark, light))
            for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1), (2, 0), (0, 2)):
                if rnd.random() < .8: P[(cx + dx) % N, (cy + dy) % N] = col
        for _ in range(26):                                           # small blades
            cx, cy = rnd.randrange(N), rnd.randrange(N)
            for k in range(3): P[cx % N, (cy - k) % N] = light if k else dark
        for _ in range(flowers):
            cx, cy = rnd.randrange(N), rnd.randrange(N); P[cx, cy] = rnd.choice(((250, 240, 200), (250, 180, 200), (255, 230, 120)))
        if name == 'g_grass3': t = Image.eval(t, lambda v: min(255, int(v * 1.06)))
        quilt = Image.new('RGBA', (96, 96))
        for i in range(2):
            for j in range(2): quilt.paste(t, (i * N, j * N))
        x, y, w, h = S[name]; atlas.paste(quilt.resize((w, h), Image.NEAREST), (x, y))
    atlas.save(IMG, 'WEBP', quality=92, method=6)
    print('rebuilt', [n for n in CELLS if n in S])

if __name__ == '__main__':
    main()
