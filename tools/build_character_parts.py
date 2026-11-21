"""Cut character body parts out of the reference sheets and write them as PNGs + pivots.

    python3 tools/build_character_parts.py

Inputs (tools/sheets/character/):
  parts_sheet.jpg  3 cols x 2 rows: row1 head, torso, (unused arm); row2 (unused arm), leg L, leg R
  arms_sheet.jpg   2 cols x 1 row: left cell = left arm (the right arm is its horizontal mirror)
Outputs: public/assets/char/parts/*.png and public/assets/char/parts/parts.json
Each part gets a pivot (x, y) inside its own PNG: head = bottom centre (neck),
torso / arms / legs = top centre (shoulder or hip joint).
"""
import json, os
from PIL import Image, ImageOps

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'tools', 'sheets', 'character')
OUT = os.path.join(ROOT, 'public', 'assets', 'char', 'parts')

def key_magenta(im):
    im = im.convert('RGBA'); px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, _ = px[x, y]
            if (255 - r) ** 2 + g ** 2 + (255 - b) ** 2 < 110 ** 2:
                px[x, y] = (0, 0, 0, 0)
    return im

def cut_cell(sheet, col, row, cols, rows):
    w, h = sheet.width / cols, sheet.height / rows
    inset = 14  # keep the black divider lines between cells out of the crop
    cell = sheet.crop((round(col * w) + inset, round(row * h) + inset, round((col + 1) * w) - inset, round((row + 1) * h) - inset))
    im = key_magenta(cell)
    bb = im.getbbox()
    return im.crop(bb), bb

GAME_H = 96            # figure height in game px (same as build_pixel_chars.py TARGET_H)
BODY_H = 1963          # head top to foot in the parts sheet (px), measured from the sheet
ARM_H = 1164           # arm length in the arm sheet (px), measured; arm sheet is a different scale
ARM_GAME_LEN = 34      # target shoulder-to-hand length in game px (about 0.35 of the figure)
K_PARTS = GAME_H / BODY_H
K_ARM = ARM_GAME_LEN / ARM_H

def save(name, im, pivot, parts, k):
    os.makedirs(OUT, exist_ok=True)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    pivot = (round(pivot[0] * k), round(pivot[1] * k) if pivot[1] else 0)
    im.save(os.path.join(OUT, name + '.png'))
    parts[name] = {'file': name + '.png', 'size': list(im.size), 'pivot': list(pivot)}

def main():
    parts, meta = {}, {}
    ps = Image.open(os.path.join(SRC, 'parts_sheet.jpg')).convert('RGB')
    arms = Image.open(os.path.join(SRC, 'arms_sheet.jpg')).convert('RGB')

    head, _ = cut_cell(ps, 0, 0, 3, 2)
    save('head', head, (head.width // 2, head.height), parts, K_PARTS)
    torso, _ = cut_cell(ps, 1, 0, 3, 2)
    save('torso', torso, (torso.width // 2, 0), parts, K_PARTS)
    legl, _ = cut_cell(ps, 1, 1, 3, 2)
    save('leg_l', legl, (legl.width // 2, 0), parts, K_PARTS)
    legr, _ = cut_cell(ps, 2, 1, 3, 2)
    save('leg_r', legr, (legr.width // 2, 0), parts, K_PARTS)

    arm_l, _ = cut_cell(arms, 0, 0, 2, 1)
    save('arm_l', arm_l, (arm_l.width // 2, 0), parts, K_ARM)
    arm_r = ImageOps.mirror(arm_l)
    save('arm_r', arm_r, (arm_r.width // 2, 0), parts, K_ARM)

    for k, v in parts.items():
        meta[k] = v
        print(f"{k:6s} size={v['size']} pivot={v['pivot']}")
    os.makedirs(OUT, exist_ok=True)
    json.dump({'parts': meta, 'source': 'tools/build_character_parts.py'}, open(os.path.join(OUT, 'parts.json'), 'w'), indent=1)

if __name__ == '__main__':
    main()
