"""Cut UI art (icons, parchment panel, portraits, map pin) out of tools/sheets/ui.jpg into public/assets/ui/*.png.

    python3 tools/build_ui.py
Background (tan paper, grid lines, dashed guides, grey checkerboard) is removed by flood-filling from each crop's border.
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SRC = 'tools/sheets/ui.jpg'; OUT = 'public/assets/ui'
os.makedirs(OUT, exist_ok=True)
im = Image.open(SRC).convert('RGB'); A = np.array(im).astype(int)

def cut(name, box, keep_bg=False, scale=2, inset=3, tan_only=False):
    x0, y0, x1, y1 = box; x0 += inset; y0 += inset; x1 -= inset; y1 -= inset
    sub = A[y0:y1, x0:x1]; R, G, B = sub[..., 0], sub[..., 1], sub[..., 2]
    tan = (R > 195) & (G > 160) & (B > 110) & (R - B > 38) & (R - G < 60)
    grey = (abs(R - G) < 14) & (abs(G - B) < 14) & (R > 178)
    green = (G > R + 8) & (G > B + 8) & (G > 90)
    bgl = tan if tan_only else tan | grey | green
    lab, n = ndi.label(bgl)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border)) if not keep_bg else np.zeros_like(bgl)
    fg = ~bg
    fg = ndi.binary_opening(fg, iterations=1) | (fg & ndi.binary_erosion(fg))
    # keep the biggest blobs only (drops stray dashes)
    lab2, n2 = ndi.label(fg)
    if n2:
        sz = ndi.sum(fg, lab2, range(1, n2 + 1)); big = max(sz)
        fg = np.isin(lab2, [i + 1 for i, s in enumerate(sz) if s > big * 0.06])
    alpha = (fg * 255).astype(np.uint8)
    rgba = Image.fromarray(np.dstack([sub.astype(np.uint8), alpha]), 'RGBA')
    bb = rgba.getbbox(); rgba = rgba.crop(bb)
    if scale != 1: rgba = rgba.resize((rgba.width * scale, rgba.height * scale), Image.LANCZOS)
    rgba.save(f'{OUT}/{name}.png')
    return rgba

def grid(y_off, items):
    for name, (x0, y0, x1, y1) in items.items(): cut(name, (x0 // 2, y0 // 2 + y_off, x1 // 2, y1 // 2 + y_off))

# buttons row (coordinates measured on a 2x zoom of the sheet)
grid(1020, {'b_close': (52, 42, 186, 168), 'b_job': (212, 42, 368, 168), 'b_bag': (396, 42, 536, 168), 'b_phone': (562, 42, 686, 168),
            'b_quest': (714, 42, 838, 168), 'b_rank': (868, 42, 994, 168), 'b_chat': (1030, 42, 1162, 168), 'b_sound': (1192, 42, 1326, 168)})
# status icons
grid(660, {'i_sleepy': (52, 34, 154, 130), 'i_meal': (172, 34, 272, 130), 'i_cold': (292, 34, 390, 130), 'i_belly': (528, 34, 626, 130),
           'i_calm': (52, 146, 154, 244), 'i_sad': (172, 146, 272, 244), 'i_heart': (292, 146, 390, 244), 'i_bulb': (410, 146, 508, 244),
           'i_medal': (52, 260, 154, 356), 'i_trophy': (172, 260, 272, 356), 'i_bowl': (292, 260, 390, 356),
           'i_scroll': (1220, 30, 1324, 130), 'i_fish': (1220, 266, 1324, 366), 'i_lantern': (1220, 384, 1324, 486), 'i_tool': (728, 148, 832, 248),
           'i_bolt': (64, 462, 130, 524), 'i_leg': (58, 528, 130, 594), 'i_hp': (58, 594, 132, 658)})
# portraits and the map pin
cut('pin', (26, 1307, 94, 1373), tan_only=True)
grid(1290, {'face_m': (212, 34, 346, 166), 'face_f': (370, 34, 504, 166)})
# parchment panel: wipe the baked title off, then it is used as a 9-slice frame
p = cut('parchment', (28, 56, 254, 354), keep_bg=False, scale=1, inset=1)
a = np.array(p); h, w = a.shape[:2]
patch = a[60:90, 40:150, :3].reshape(-1, 3); fill = np.median(patch, axis=0).astype(np.uint8)
noise = a[100:100 + 38, 40:40 + 150, :3].copy()
a[10:48, 12:186, :3] = np.concatenate([noise[:38, :150], noise[:38, :24]], axis=1)
Image.fromarray(a, 'RGBA').save(f'{OUT}/parchment.png')
print('ok', sorted(os.listdir(OUT)))
