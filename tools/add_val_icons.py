#!/usr/bin/env python3
"""Valentine art: tools/sheets/ev_valentine.jpg (banner) and tools/sheets/val_icons.jpg (heart + chocolate box on magenta;
the sheet also has leftover older icons, so each icon is cut from its own box and only the pieces that do not touch the box edge are kept).

Run: python3 tools/add_val_icons.py   → public/assets/nb/ev_valentine.webp, heart.webp, choco.webp
"""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SHEETS, OUT = ROOT / 'tools/sheets', ROOT / 'public/assets/nb'
# boxes as fractions of the sheet (x0, y0, x1, y1): the heart sits top-left, the chocolate box top-right
BOXES = {'heart': (0.08, 0.17, 0.48, 0.655), 'choco': (0.53, 0.24, 0.93, 0.67)}


def cut(sheet, name, box):
    W, H = sheet.size
    im = sheet.crop((int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H)))
    a = np.asarray(im).astype(int)
    d = np.maximum.reduce([np.abs(a[..., 0] - 255), a[..., 1], np.abs(a[..., 2] - 255)])   # 0 = pure magenta
    solid = d >= 60
    lab, n = ndimage.label(solid, structure=np.ones((3, 3)))
    h, w = solid.shape
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    sizes = ndimage.sum(solid, lab, range(1, n + 1))
    big = int(np.argmax(sizes)) + 1
    keep = np.zeros_like(solid)
    for i in range(1, n + 1):
        if i == big or (i not in edge and sizes[i - 1] > 30):        # the icon itself + its sparkles, not neighbours cut by the box
            keep |= lab == i
    keep = ndimage.binary_fill_holes(keep)                            # solid inside (the pink heart is close to the magenta key)
    alpha = keep * 255
    rgba = np.dstack([a[..., 0], a[..., 1], a[..., 2], alpha]).astype(np.uint8)
    icon = Image.fromarray(rgba, 'RGBA')
    icon = icon.crop(icon.getbbox())
    k = 128 / max(icon.size)
    icon = icon.resize((max(1, round(icon.width * k)), max(1, round(icon.height * k))), Image.LANCZOS)
    icon.save(OUT / f'{name}.webp', 'WEBP', quality=90)
    print('icon', name, icon.size)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    sheet = Image.open(SHEETS / 'val_icons.jpg').convert('RGB')
    for name, box in BOXES.items(): cut(sheet, name, box)
    ban = Image.open(SHEETS / 'ev_valentine.jpg').convert('RGB')
    ban = ban.resize((1280, round(ban.height * 1280 / ban.width)), Image.LANCZOS)
    ban.save(OUT / 'ev_valentine.webp', 'WEBP', quality=82)
    print('banner', ban.size)
