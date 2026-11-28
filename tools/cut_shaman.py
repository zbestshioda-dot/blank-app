# cut a 3x3 NPC walk sheet (rows: down, up, right; cols: 3 walk frames) into a transparent strip
# usage: python3 tools/cut_shaman.py tools/sheets/shaman_black.jpg public/assets/shaman_black.webp
import sys; from PIL import Image
import numpy as np
im = Image.open(sys.argv[1]).convert('RGB'); a = np.asarray(im).astype(int)
bg = np.median(np.concatenate([a[:8].reshape(-1,3), a[:, :8].reshape(-1,3)]), axis=0)
d = np.abs(a - bg).sum(2); mask = d > 40
H, W = mask.shape; CW, CH = 96, 112; out = Image.new('RGBA', (CW * 3, CH * 3))
rgba = np.dstack([a, np.where(mask, 255, 0)]).astype(np.uint8)
cells = []
for r in range(3):
  for c in range(3):
    y0, y1, x0, x1 = r * H // 3, (r + 1) * H // 3, c * W // 3, (c + 1) * W // 3
    m = mask[y0:y1, x0:x1]; ys, xs = np.where(m)
    cells.append((r, c, Image.fromarray(rgba[y0:y1, x0:x1]).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))))
k = min(min((CW - 4) / x.width, (CH - 2) / x.height) for _, _, x in cells)   # one scale for every frame: no size jitter
for r, c, cell in cells:
    cell = cell.resize((round(cell.width * k), round(cell.height * k)), Image.NEAREST)
    out.paste(cell, (c * CW + (CW - cell.width) // 2, r * CH + CH - cell.height), cell)
out.save(sys.argv[2], 'WEBP', lossless=True); print(out.size)
