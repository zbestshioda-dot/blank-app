"""Cut room-partition pieces (wall runs, doors, screens, curtains) from tools/sheets/pixel_walls.jpg and append them to
the atlas as pw_* sprites (existing coordinates unchanged).

    python3 tools/add_walls.py

tools/wall_boxes.json holds each item's bounding box [y0, x0, y1, x1] in reading order (connected components).
"""
import json, os
from PIL import Image
from add_furniture import cut, IMG, JS, ROOT, TILE

PX_PER_TILE = 165
BOX = json.load(open(os.path.join(ROOT, 'tools', 'wall_boxes.json')))
NAMES = ('pink cream blue wood - - grey corner_r corner_l - pillar - - win_pink - pic shelf lamp '
         'door_wood door_glass doorway door_louver railing glass low_grey low_cream sliding curtain shoji shelfdiv hooks mirror halfwall').split()
SCALE = {'hooks': .6, 'mirror': .8, 'lamp': .9}

def items():
    sheet = Image.open(os.path.join(ROOT, 'tools', 'sheets', 'pixel_walls.jpg')).convert('RGB')
    for i, nm in enumerate(NAMES):
        if nm != '-': yield 'pw_' + nm, cut(sheet, BOX[i])

def main():
    atlas = Image.open(IMG).convert('RGBA'); data = json.load(open(JS))
    x, y, rowh = 0, data['size'][1] + 2, 0; placed = []
    for name, im in items():
        if name in data['sprites']: continue
        w = max(8, round(im.width / PX_PER_TILE * TILE * SCALE.get(name[3:], 1))); h = max(8, round(im.height * w / im.width))
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
