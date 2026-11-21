"""Build the quest-giver portrait sheet from tools/sheets/portraits_a.jpg and portraits_b.jpg (4x3 painted portraits each).

    python3 tools/build_portraits.py

Output: public/assets/portraits.webp (one row of 128px squares) + portraits.json {id: index}. Magenta corners and grid
lines left by the sheets are painted over with the cell's own background colour (the game shows them as round faces).
"""
import json, os
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'public', 'assets', 'portraits')
SHEETS = [('portraits_a.jpg', ['office_f', 'farmer_f', 'fisher_m', 'shop_f', 'chef_m', 'doctor_f', 'rider_m', 'police_f', 'beggar_m', 'thief_m', 'sad_f', None]),
          ('portraits_b.jpg', ['elder_m', 'nurse_f', 'banker_f', 'barber_m', 'teacher_f', 'grocer_m', 'worker_m', 'market_f', 'grandma', 'student_m', 'girl', 'police_m']),
          ('portraits_c.jpg', ['mprang_happy', 'mprang_shy', 'mprang_wow', 'mprang_wave', 'folk_m1', 'folk_f1', 'folk_f2', 'folk_m2', 'folk_f3', 'folk_m3', 'folk_m4', 'folk_m5'])]
S = 128

def main():
    tiles, meta = [], {}
    for fn, names in SHEETS:
        im = Image.open(os.path.join(ROOT, 'tools', 'sheets', fn)).convert('RGB')
        W, H = im.size; cw, ch = W / 4, H / 3
        for i, name in enumerate(names):
            if not name: continue
            cx, cy = i % 4, i // 4
            cell = im.crop((int(cx * cw) + 10, int(cy * ch) + 10, int((cx + 1) * cw) - 10, int((cy + 1) * ch) - 10))
            a = np.asarray(cell).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
            mag = (g < np.minimum(r, b) * 0.6) & (np.minimum(r, b) > 120)
            if mag.any():
                bgc = np.median(a[:40][~mag[:40]], axis=0) if (~mag[:40]).any() else np.array([240, 225, 228])
                a[mag] = bgc
                cell = Image.fromarray(a.astype(np.uint8))
                blur = cell.filter(ImageFilter.GaussianBlur(6)); m = Image.fromarray((mag * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))
                cell = Image.composite(blur, cell, m)
            side = min(cell.size); cell = cell.crop(((cell.width - side) // 2, 0, (cell.width + side) // 2, side))
            meta[name] = len(tiles); tiles.append(cell.resize((S, S), Image.LANCZOS))
    out = Image.new('RGB', (S * len(tiles), S))
    for k, t in enumerate(tiles): out.paste(t, (k * S, 0))
    out.save(OUT + '.webp', 'WEBP', quality=86, method=6)
    json.dump({'size': S, 'faces': meta}, open(OUT + '.json', 'w'))
    print(len(tiles), out.size)

if __name__ == '__main__':
    main()
