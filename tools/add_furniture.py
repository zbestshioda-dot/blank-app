"""Cut furniture / decor sprites from tools/sheets/pixel_furn_{a,b,c}.jpg (loose items on magenta) and append
them to the atlas as x_* sprites (existing coordinates unchanged).

    python3 tools/add_furniture.py

tools/furn_boxes.json holds each item's bounding box (found once by connected components, reading order);
NAMES maps sheet+index -> sprite name. PICK splits items that touch a neighbour: keep the part under a point.
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp')
JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
BOX = json.load(open(os.path.join(ROOT, 'tools', 'furn_boxes.json')))
TILE, PX_PER_TILE = 48, 100           # the sheets draw roughly 100 px per game tile
NAMES = {
 'a': 'arcade pool treadmill wbench dart piano bookshelf wardrobe crib rocker washer - aircon sink bench bonsai patio chest ebike yoga laundry iron vacuum fan fern shelf_s sideboard microwave espresso dishrack heater - mop bucket stool gchair desk dlamp flamp beanbag tv coatrack drawers umbrella cashdesk storage mirror mannequin cart easel tires drum hbed iv wheelchair alamp medcart medfridge bell waitseats moto pump toolbox dryer workbench jack tires2 tirerack airpump',
 'b': 'cafeset lsofa barstool counter coffeebar cakecase oven breadrack tray freezer menu napkin buffet prep hood souppot sdesk board locker tdesk globe blanket cubby hosereel helmets ext ladder - siren firstaid cot boots pbench tree gnome barrow arch lamppost ghose hang2 crate bucket2 flowers vases fabric mshelf seeds hanging mushroom sofa2 rtable magrack wclock aquarium bell2 pcdesk pendant vending drinkfridge ice basket cashbox drawer2 aboard pos',
 'c': '- - - - clothes mannequin2 mannequin3 shoes bags jewelcase hats hats2 curtain bench2 flowerfridge bouquets fcounter ribbons orchids ferns cards wshelf mshelf2 freezer2 fruit bread eggs water cart2 pos2 bankcounter safe atm rope vault moneycounter - chair pcdesk2 car keys tirerack2 tools meter barrier gaspump cardesk pdesk radio lockers policecar cuffs cones barricade phonebooth ladder2 bunk gearbench hosecart tank alarm - metaldoor aboard2 wheelchair2 hbed2 stretcher medcab xray monitor plant clock',
}
# items that touch another one in the sheet: (sheet, index) -> a point (sheet px) on the wanted part
PICK = {('b', 26): (880, 790)}
BOXFIX = {('b', 13): [250, 1255, 445, 1542], ('b', 0): [68, 4, 225, 291]}   # prep table without the umbrella below; café set without its sign   # [y0, x0, y1, x1] in sheet px
# wall-mounted / small table-top pieces drawn smaller than the sheet suggests
SCALE = {'wclock': .5, 'clock': .55, 'aircon': .75, 'pendant': .75, 'helmets': .8, 'keys': .75, 'alarm': .6, 'cuffs': .7, 'bell': .5, 'bell2': .55,
         'pos': .6, 'pos2': .6, 'moneycounter': .75, 'napkin': .6, 'cashbox': .65, 'dlamp': .75, 'globe': .8, 'microwave': .75, 'espresso': .75, 'board': .8, 'hanging': .8, 'ferns': .8}
MERGE = {('b', 47): ('b', 39)}        # one item found as two boxes
SKIP_IDX = {('b', 39), ('b', 27), ('c', 33)}

def bgmask(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (g < np.minimum(r, b) * 0.6) & (np.abs(r - b) < 90) & (np.minimum(r, b) > 110)

def cut(sheet, box, pick=None):
    y0, x0, y1, x1 = box; pad = 3
    y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
    a = np.asarray(sheet.crop((x0, y0, x1 + pad, y1 + pad)).convert('RGB')).astype(int)
    bg = bgmask(a); fg = ~bg
    lab, n = ndimage.label(ndimage.binary_closing(fg, iterations=2))
    if n > 1:
        if pick:
            px, py = pick[0] - x0, pick[1] - y0
            ys, xs = np.nonzero(lab); d = (xs - px) ** 2 + (ys - py) ** 2; want = lab[ys[d.argmin()], xs[d.argmin()]]
        else:
            sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1)); big = sizes.max()
            want = [i + 1 for i, s in enumerate(sizes) if s > big * .04]   # drop stray specks, keep real parts
        keep = np.isin(lab, want) & fg
    else: keep = fg
    rgba = np.dstack([a, np.where(keep, 255, 0)]).astype(np.uint8)
    im = Image.fromarray(rgba); return im.crop(im.getbbox())

def items():
    for k, names in NAMES.items():
        sheet = Image.open(os.path.join(ROOT, 'tools', 'sheets', f'pixel_furn_{k}.jpg')).convert('RGB')
        for i, nm in enumerate(names.split()):
            if nm == '-' or (k, i) in SKIP_IDX or i >= len(BOX[k]): continue
            box = BOXFIX.get((k, i), BOX[k][i])
            if (k, i) in MERGE: o = BOX[MERGE[(k, i)][0]][MERGE[(k, i)][1]]; box = [min(box[0], o[0]), min(box[1], o[1]), max(box[2], o[2]), max(box[3], o[3])]
            yield 'x_' + nm, cut(sheet, box, PICK.get((k, i)))

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
