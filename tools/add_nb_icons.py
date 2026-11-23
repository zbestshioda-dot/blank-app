#!/usr/bin/env python3
"""Newcomer + festival art (docs/newcomer_art_prompts.md).

tools/sheets/nb_icons.jpg  : 8 icons on magenta #FF00FF, 2 rows of 4  -> public/assets/nb/<name>.webp (transparent, max 128 px)
tools/sheets/ev_newyear.jpg, ev_cny.jpg : wide banners               -> public/assets/nb/ev_newyear.webp, ev_cny.webp (1280 wide)

Run: python3 tools/add_nb_icons.py   (then bump NB_ART_V in public/game.js)
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEETS, OUT = ROOT / 'tools/sheets', ROOT / 'public/assets/nb'
NAMES = [['egg', 'egg_crack', 'gift', 'coin'], ['moon', 'angpao', 'firework', 'rod']]


def key_out(im):
    """magenta -> transparent, with a soft edge (the AI art has a pink halo around glowing things)"""
    im = im.convert('RGBA'); px = im.load(); w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            d = max(abs(r - 255), g, abs(b - 255))          # 0 = pure magenta
            if d < 60: px[x, y] = (0, 0, 0, 0)
            elif d < 110:                                    # halo: fade out and pull the magenta tint off
                a = int(255 * (d - 60) / 50)
                px[x, y] = (min(255, r), g, min(255, max(0, b - (255 - g) // 3)), a)
    return im


def cut_icons():
    sheet = Image.open(SHEETS / 'nb_icons.jpg').convert('RGB')
    W, H = sheet.size; cw, ch = W // 4, H // 2
    for row, names in enumerate(NAMES):
        for col, name in enumerate(names):
            cell = key_out(sheet.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch)))
            box = cell.getbbox()
            if not box: raise SystemExit(f'empty cell {row},{col}')
            icon = cell.crop(box)
            k = 128 / max(icon.size)
            icon = icon.resize((max(1, round(icon.width * k)), max(1, round(icon.height * k))), Image.LANCZOS)
            icon.save(OUT / f'{name}.webp', 'WEBP', quality=90)
            print('icon', name, icon.size)


def banners():
    for name in ['ev_newyear', 'ev_cny']:
        im = Image.open(SHEETS / f'{name}.jpg').convert('RGB')
        im = im.resize((1280, round(im.height * 1280 / im.width)), Image.LANCZOS)
        im.save(OUT / f'{name}.webp', 'WEBP', quality=82)
        print('banner', name, im.size)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    cut_icons(); banners()
