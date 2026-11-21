"""Cut outdoor decor (fountains, planters, benches, lamps, street furniture) from tools/sheets/pixel_outdoor.jpg and
append them to the atlas as o_* sprites (existing coordinates unchanged).

    python3 tools/add_outdoor.py

tools/outdoor_boxes.json holds each item's bounding box [y0, x0, y1, x1] in reading order (connected components).
"""
import json, os
from PIL import Image
from add_furniture import cut, IMG, JS, ROOT, TILE

PX_PER_TILE = 120
BOX = json.load(open(os.path.join(ROOT, 'tools', 'outdoor_boxes.json')))
NAMES = ('fountain fountain2 fountain3 planter tulips roses potflower cactus '
         'hangbasket hedgering topiary hedgecube flowerbed grass lplanter '
         'bollard bollard2 bin bin_green bin_blue stonepot stonebench bench bowlpot '
         'rosearch gate mailbox noticeboard signpole newsbox aboard pergola '
         'lampball hydrant drinkfount bikerack shelter phonebooth shelter2 '
         'parasol parasol2 birdstatue catstatue lantern woodtable tap slide '
         'flowercart pottree potpalm').split()
# the pergola and the lamp post under it touch: cut each from its own box, keeping the part under a point
BOXFIX = {31: [884, 40, 1138, 362], 'lamp': [1128, 55, 1422, 140]}
PICK = {31: (200, 900), 'lamp': (100, 1300)}
SCALE = {'hangbasket': .8, 'hydrant': .8, 'tap': .85, 'drinkfount': .85, 'mailbox': .9, 'lampball': 1.0, 'lamp': 1.0,
         'shelter': 1.15, 'shelter2': 1.15, 'pergola': 1.1, 'rosearch': 1.0, 'potflower': .8, 'cactus': .8}

def items():
    sheet = Image.open(os.path.join(ROOT, 'tools', 'sheets', 'pixel_outdoor.jpg')).convert('RGB')
    for i, nm in enumerate(NAMES):
        yield 'o_' + nm, cut(sheet, BOXFIX.get(i, BOX[i]), PICK.get(i))
    yield 'o_lamp', cut(sheet, BOXFIX['lamp'], PICK['lamp'])

def main():
    atlas = Image.open(IMG).convert('RGBA'); data = json.load(open(JS))
    x, y, rowh = 0, data['size'][1] + 2, 0; placed = []
    for name, im in items():
        if name in data['sprites']: continue
        w = max(8, round(im.width / PX_PER_TILE * TILE * SCALE.get(name[2:], 1))); h = max(8, round(im.height * w / im.width))
        im = im.resize((w, h), Image.LANCZOS)
        if x + w > atlas.width: x, y, rowh = 0, y + rowh + 2, 0
        placed.append((name, x, y, im)); x += w + 2; rowh = max(rowh, h)
    out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
    for name, px, py, im in placed: out.paste(im, (px, py)); data['sprites'][name] = [px, py, im.width, im.height]
    data['size'] = [atlas.width, y + rowh]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('added', len(placed), 'atlas', out.size)

if __name__ == '__main__':
    main()
