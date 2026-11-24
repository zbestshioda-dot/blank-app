#!/usr/bin/env python3
"""HUD pixel icons + login art (prompts in the chat of 24 Nov; same rules as docs/newcomer_art_prompts.md).

tools/sheets/hud_icons.jpg    12 icons on magenta, 3 rows of 4  -> public/assets/hud/<name>.webp (transparent, 96 px)
tools/sheets/create_icon.jpg  1 icon on magenta                 -> public/assets/hud/welcome.webp
tools/sheets/login_banner.jpg tall town picture                 -> public/assets/ui/login_town.webp (900 wide)

Run: python3 tools/add_hud_icons.py   (then bump HUD_V in public/style.css urls if the art changes)
"""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SHEETS, OUT = ROOT / 'tools/sheets', ROOT / 'public/assets/hud'
NAMES = [['bag', 'run', 'rest', 'smile'], ['phone', 'chat', 'tap', 'energy'], ['rice', 'heart', 'laugh', 'mail']]


def cut(cell, size=96):
    a = np.asarray(cell).astype(int)
    d = np.maximum.reduce([np.abs(a[..., 0] - 255), a[..., 1], np.abs(a[..., 2] - 255)])   # 0 = pure magenta
    solid = d >= 90                                    # the AI art has a light-pink halo around each icon: leave it out
    lab, n = ndimage.label(solid, structure=np.ones((3, 3)))
    if not n: raise SystemExit('empty cell')
    sizes = ndimage.sum(solid, lab, range(1, n + 1))
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    big = int(np.argmax(sizes)) + 1
    keep = np.zeros_like(solid)
    for i in range(1, n + 1):
        if i == big or (i not in edge and sizes[i - 1] > 40): keep |= lab == i
    keep = ndimage.binary_fill_holes(keep)
    # peel the light-pink halo: pinkish pixels (red and blue well above green) connected to the outside
    pink = (np.minimum(a[..., 0], a[..., 2]) - a[..., 1]) > 45
    outside = ~keep | pink
    lab2, _ = ndimage.label(outside)
    ring = set(np.unique(np.concatenate([lab2[0], lab2[-1], lab2[:, 0], lab2[:, -1]]))) - {0}
    keep &= ~np.isin(lab2, list(ring))
    rgba = np.dstack([a[..., 0], a[..., 1], a[..., 2], keep * 255]).astype(np.uint8)
    icon = Image.fromarray(rgba, 'RGBA'); icon = icon.crop(icon.getbbox())
    k = size / max(icon.size)
    return icon.resize((max(1, round(icon.width * k)), max(1, round(icon.height * k))), Image.LANCZOS)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    sheet = Image.open(SHEETS / 'hud_icons.jpg').convert('RGB'); W, H = sheet.size; cw, ch = W // 4, H // 3
    for r, row in enumerate(NAMES):
        for c, name in enumerate(row):
            ic = cut(sheet.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))); ic.save(OUT / f'{name}.webp', 'WEBP', quality=92); print(name, ic.size)
    ic = cut(Image.open(SHEETS / 'create_icon.jpg').convert('RGB'), 128); ic.save(OUT / 'welcome.webp', 'WEBP', quality=92); print('welcome', ic.size)
    ban = Image.open(SHEETS / 'login_banner.jpg').convert('RGB'); ban = ban.resize((900, round(ban.height * 900 / ban.width)), Image.LANCZOS)
    ban.save(ROOT / 'public/assets/ui/login_town.webp', 'WEBP', quality=82); print('login', ban.size)
