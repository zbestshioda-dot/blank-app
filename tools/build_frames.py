"""Cut the three profile-frame sheets (tools/sheets/frames_a..c.jpg, 4x3 each, magenta background) into
public/assets/frames.webp + frames.json: per frame the hole (centre and diameter, as fractions of the cell) so the
profile photo can sit inside it."""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
C = 192
cells, meta = [], []
for k in 'abc':
    im = Image.open(os.path.join(ROOT, 'tools/sheets', f'frames_{k}.jpg')).convert('RGB'); A = np.asarray(im).astype(int)
    H, W = A.shape[:2]; tw, th = W / 4, H / 3
    for r in range(3):
        for c in range(4):
            x0, y0, x1, y1 = int(c * tw), int(r * th), int((c + 1) * tw), int((r + 1) * th)
            a = A[y0:y1, x0:x1]; R, G, B = a[..., 0], a[..., 1], a[..., 2]
            bg = (R > 140) & (B > 140) & (G < 0.55 * np.minimum(R, B)) & (abs(R - B) < 90)
            # soft key: pink glow pixels close to magenta get partial alpha
            fg = ~bg
            fg = ndi.binary_opening(fg, np.ones((3, 3)))
            lab, n = ndi.label(fg); keep = np.zeros_like(fg)
            for i in range(1, n + 1):
                ys, xs = np.where(lab == i)
                edge = ys.min() < 6 or xs.min() < 6 or ys.max() > a.shape[0] - 7 or xs.max() > a.shape[1] - 7
                thin = (ys.max() - ys.min() < 14) or (xs.max() - xs.min() < 14)
                if len(ys) < 40 or (edge and (thin or len(ys) < 0.02 * fg.size)): continue
                keep |= lab == i
            keep &= ~ndi.binary_dilation(bg, iterations=1)
            keep[:14, :] = False; keep[-14:, :] = False; keep[:, :14] = False; keep[:, -14:] = False   # the sheet's grid lines
            # the hole: the background region around the cell centre
            cy, cx = a.shape[0] // 2, a.shape[1] // 2
            bl, _ = ndi.label(~keep); hole = bl == bl[cy, cx]
            hy, hx = np.where(hole)
            if hole.sum() > 0.4 * hole.size:   # leaked out: fall back to a ray scan
                rr = 0
                while rr < min(cx, cy) and not keep[cy, cx + rr]: rr += 1
                hcx, hcy, hd = cx, cy, rr * 2
            else:
                hcx, hcy = hx.mean(), hy.mean(); hd = (hx.max() - hx.min() + hy.max() - hy.min()) / 2
            side = max(a.shape[:2]); pad = Image.new('RGBA', (side, side))
            rgba = np.dstack([a.astype(np.uint8), (keep * 255).astype(np.uint8)])
            ox, oy = (side - a.shape[1]) // 2, (side - a.shape[0]) // 2
            pad.alpha_composite(Image.fromarray(rgba), (ox, oy))
            cells.append(pad.resize((C, C), Image.LANCZOS))
            meta.append([round(float(hcx + ox) / side, 3), round(float(hcy + oy) / side, 3), round(float(hd) / side, 3)])
cols = 6; rows = (len(cells) + cols - 1) // cols
sheet = Image.new('RGBA', (cols * C, rows * C))
for i, c in enumerate(cells): sheet.alpha_composite(c, ((i % cols) * C, (i // cols) * C))
sheet.save(os.path.join(ROOT, 'public/assets/frames.webp'), 'WEBP', quality=90, alpha_quality=100, method=6)
json.dump({'cell': C, 'cols': cols, 'rows': rows, 'holes': meta}, open(os.path.join(ROOT, 'public/assets/frames.json'), 'w'), separators=(',', ':'))
print(len(cells), sheet.size, os.path.getsize(os.path.join(ROOT, 'public/assets/frames.webp'))); print(meta)
bgc = Image.new('RGBA', sheet.size, (60, 60, 70, 255)); bgc.alpha_composite(sheet); bgc.save('/tmp/claude-0/-home-user-blank-app/05ecec07-c061-54e9-8d72-633cf2a62269/scratchpad/frames_contact.png')
