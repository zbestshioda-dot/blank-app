"""Build public/assets/atlas.webp + atlas.json from the art sheets.

Usage: python3 tools/build_atlas.py <dir with cut_[a-e].png and boxes.json>
cut_*.png = the sprite sheets with the pink background removed (see tools/slice.py)
"""
import json, sys, os
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets')
T = 48                                     # atlas pixels per game tile
sheets = {k: Image.open(os.path.join(SRC, f'cut_{k}.png')).convert('RGBA') for k in 'abcde'}
boxes = json.load(open(os.path.join(SRC, 'boxes.json')))

def crop(ref):
    """ref = (sheet, index) or (sheet, [x, y, w, h])"""
    k, b = ref
    x, y, w, h = boxes[k][b] if isinstance(b, int) else b
    im = sheets[k].crop((x, y, x + w, y + h))
    bb = im.getbbox()
    return im.crop(bb) if bb else im

def inset(ref, d=5):
    k, (x, y, w, h) = ref
    return (k, [x + d, y + d, w - 2 * d, h - 2 * d])

# ------------------------------------------------------------------ sprites: name -> (ref, width in tiles)
S = {
  # finished buildings
  'b_mart': (('e', 0), 5), 'b_cafe': (('e', 1), 5), 'b_bakery': (('e', 2), 5), 'b_flower': (('e', 3), 5),
  'b_shop': (('e', 4), 5), 'b_hospital': (('e', 5), 7.5), 'b_police': (('e', [1236, 22, 210, 205]), 5.4),
  'b_fire': (('e', [1456, 14, 209, 226]), 5.4),
  'h_cottage1': (('a', 3), 3.6), 'h_cottage2': (('a', 4), 4), 'h_cottage3': (('b', 3), 3.6), 'h_cottage4': (('b', 4), 3.8),
  # street & park props
  'stall_red': (('e', 7), 3), 'stall_blue': (('e', 8), 3), 'stall_green': (('e', 9), 3), 'stall_orange': (('e', 10), 3),
  'foodtruck': (('e', 11), 3.8), 'icecream': (('e', 12), 3.6),
  'car_red': (('e', [1032, 275, 76, 73]), 2), 'car_blue': (('e', [1109, 275, 76, 73]), 2),
  'car_yellow': (('e', [1188, 271, 75, 77]), 2), 'car_green': (('e', [1263, 271, 75, 77]), 2),
  'bus': (('e', [1348, 246, 186, 124]), 4.6), 'taxi': (('e', 15), 2.2),
  'busstop': (('e', 16), 3.6), 'noticeboard': (('e', 17), 1.9), 'vending': (('e', 18), 1.1), 'phonebooth': (('e', 19), 1.1),
  'kiosk': (('e', 20), 2.2), 'sign_p': (('e', 22), 0.8), 'sign_stop': (('e', 23), 0.9), 'sign_walk': (('e', 24), 1),
  'trafficlight': (('e', 25), 0.7), 'cone': (('e', 27), 0.8), 'bin_blue': (('e', 30), 0.9), 'postbox': (('e', 31), 0.9),
  'bench': (('e', 33), 2.2), 'bench2': (('e', 34), 2.2), 'flowerbox': (('e', 35), 1.8), 'flowerbox2': (('e', 36), 1.8),
  'barrel': (('e', 37), 0.8), 'bin_green': (('e', 38), 0.8), 'bin_grey': (('e', 39), 0.8), 'hydrant': (('e', 41), 0.6),
  'lamp': (('e', 42), 0.8), 'lamp2': (('e', 44), 0.8), 'gazebo': (('e', 47), 4), 'well': (('e', 50), 2),
  'arch': (('e', 51), 3.2), 'fountain': (('e', 52), 3.6), 'pond': (('e', 53), 5), 'waterfall': (('e', 54), 4.2),
  'tree': (('e', 55), 2.8), 'tree_pink': (('e', 56), 2.8), 'tree_orange': (('e', 57), 2.8), 'pine': (('e', 58), 2.2),
  'palm': (('d', 71), 2.4), 'flowerbed': (('e', 59), 2.4), 'flowerbed2': (('e', 60), 2.4),
  'fence_white': (('e', 61), 3), 'fence_wood': (('e', 62), 3), 'hedge': (('e', 65), 2.2), 'hedge_flower': (('e', 64), 1.6),
  'parasol': (('e', 67), 2.6), 'parasol2': (('e', 68), 2.1), 'deckchair': (('e', 69), 1.1), 'picnic': (('e', 70), 2.6),
  'menuboard': (('e', 71), 1.1), 'easel': (('e', 72), 1.1), 'signpost': (('e', 73), 1.5), 'catstatue': (('e', 74), 1),
  'hay': (('e', 77), 1.1), 'hay2': (('e', 78), 1.4), 'crate': (('e', 79), 1.1), 'barrel2': (('e', 80), 0.9),
  'birdhouse': (('e', 83), 0.8), 'birdbath': (('e', 84), 1.1), 'doghouse': (('e', 85), 1.9), 'dog': (('e', 86), 0.9),
  'cat': (('e', 87), 1.2), 'planter_crops': (('e', 99), 3), 'planter_flowers': (('e', 100), 3), 'cart': (('e', 118), 2.8),
  'firewood': (('e', 119), 2.6), 'campfire': (('e', 120), 1.6), 'tent': (('e', 122), 2.4), 'sack': (('e', 117), 1),
  'bush': (('d', 73), 1.3), 'bush2': (('d', 74), 1.3), 'bushes': (('d', 75), 2.6), 'bush3': (('d', 76), 1.3),
  'bush_flower': (('d', 77), 1.5), 'bush_flower2': (('d', 78), 1.3), 'rock': (('d', 82), 0.9), 'stump': (('d', 83), 0.9),
  'potplant': (('d', 86), 0.8), 'potplant2': (('d', 90), 0.8), 'palm_small': (('d', 103), 1.8), 'cartstall': (('d', 117), 2),
  'lamp3': (('d', 11), 0.8),
  # interior furniture
  'f_bed_blue': (('c', 0), 1.7), 'f_bed_pink': (('c', 1), 1.7), 'f_bed_green': (('c', 2), 1.7), 'f_bed_beige': (('c', 3), 1.7),
  'f_bunk': (('c', 4), 1.6), 'f_armchair': (('c', 25), 1.3), 'f_sofa_blue': (('c', 6), 2.2), 'f_sofa_red': (('c', 7), 2.2),
  'f_sofa_green': (('c', 8), 2.2), 'f_table_chairs': (('c', 45), 2.6), 'f_round_table': (('c', 46), 2.2),
  'f_table_check': (('c', 49), 2.6), 'f_desk': (('c', 50), 1.8), 'f_bench': (('c', 33), 2.4), 'f_wardrobe': (('c', 55), 1.8),
  'f_drawer': (('c', 52), 1.2), 'f_cabinet': (('c', 48), 2.2), 'f_toilet': (('c', 66), 0.9), 'f_sink': (('c', 67), 1.1),
  'f_bath': (('c', 69), 2.4), 'f_fridge': (('c', 70), 1.1), 'f_counter_micro': (('c', 71), 2.4), 'f_counter_toast': (('c', 72), 1.2),
  'f_stove': (('c', 73), 1.1), 'f_shelf_jars': (('c', 85), 2.1), 'f_shelf_plants': (('c', 86), 2.1), 'f_aquarium': (('c', 87), 2.1),
  'f_shelf_pots': (('c', 88), 1.8), 'f_display': (('c', 89), 2.1), 'f_tv': (('c', 9), 2.6), 'f_tv2': (('c', 10), 2.2),
  'f_computer_desk': (('c', 30), 3), 'f_laptop_desk': (('c', 39), 1.7), 'f_bookshelf': (('c', 57), 1.5), 'f_bookshelf_wide': (('c', 58), 2.4),
  'f_bookshelf3': (('c', 59), 1.5), 'f_filing_blue': (('c', 60), 0.9), 'f_filing_wood': (('c', 61), 0.9), 'f_filing_grey': (('c', 62), 1),
  'f_window': (('c', 64), 1.6), 'f_floorlamp': (('c', 65), 0.9), 'f_fireplace': (('c', 96), 2.4), 'f_clock_tall': (('c', 97), 1),
  'f_guitar': (('c', 95), 0.8), 'f_speaker': (('c', 92), 0.6), 'f_stereo': (('c', 93), 1.8), 'f_plant': (('c', 118), 1),
  'f_plant2': (('c', 119), 1), 'f_plant3': (('c', 120), 1), 'f_plant4': (('c', 125), 1), 'f_rug_red': (('c', 147), 2.2),
  'f_rug_blue': (('c', 148), 2.6), 'f_rug_green': (('c', 149), 2.4), 'f_rug_round': (('c', 150), 2.4), 'f_welcome': (('c', 152), 2),
  'f_pictures': (('c', 31), 2), 'f_picture_cat': (('c', 40), 1.7), 'f_clock': (('c', 32), 0.8), 'f_teddy': (('c', 38), 1),
  'f_beanbag': (('c', 36), 1), 'f_coffee': (('c', 77), 0.9), 'f_oven': (('c', 75), 1.6), 'f_counter_oven': (('c', 76), 1.6),
  'f_trash': (('c', 146), 0.8), 'f_curtains': (('c', 106), 2), 'f_mirror': (('c', 112), 0.9), 'f_shower': (('c', 68), 1.2),
  'f_chair': (('c', 26), 0.8), 'f_counter': (('c', 74), 1.4),
}

# ------------------------------------------------------------------ composed buildings: roof + row of wall modules
def big_roof(i):   # the five large roofs on sheet b (first row)
    return ('b', [[15, 48, 132, 106], [150, 48, 102, 106], [255, 48, 98, 106], [357, 48, 115, 106], [480, 48, 68, 106]][i])
COMP = {
  'b_office':    (('b', 13), [('b', 9), ('b', 37), ('b', 9), ('b', 9)], 6.4),
  'b_school':    (('b', 12), [('b', 33), ('b', 33), ('b', 10), ('b', 33)], 6.4),
  'b_bank':      (('b', 14), [('b', 35), ('b', 36), ('b', 35)], 5.6),
  'b_cowork':    (('b', [483, 159, 129, 77]), [('b', 34), ('b', 10), ('b', 34)], 5.6),
  'b_studio':    (('b', 14), [('b', 8), ('b', 10), ('b', 8)], 5.2),
  'b_warehouse': (('b', [354, 159, 127, 77]), [('b', 32), ('b', 31), ('b', 32)], 5.6),
  'b_inn':       (('b', 26), [('b', 6), ('b', 10), ('b', 6)], 5.4),
  'b_dealer':    (big_roof(1), [('b', 37), ('b', 37), ('b', 37), ('b', 37)], 6.6),
  'b_barn':      (('b', 28), [('b', 32), ('b', 32)], 4),
  'h_gable_red': (('b', 23), [('b', 33), ('b', 10)], 3.8),
  'h_gable_blue':(('b', 24), [('b', 9), ('b', 10)], 3.8),
}
def compose(roof_ref, walls):
    mods = [crop(w) for w in walls]
    H = 100
    mods = [m.resize((round(m.width * H / m.height), H), Image.LANCZOS) for m in mods]
    W = sum(m.width for m in mods)
    roof = crop(roof_ref)
    rw = round(W * 1.08)
    rh = max(55, min(95, round(rw * roof.height / roof.width * 0.62)))
    roof = roof.resize((rw, rh), Image.LANCZOS)
    out = Image.new('RGBA', (rw, rh + H - 8), (0, 0, 0, 0))
    x = (rw - W) // 2
    for m in mods: out.alpha_composite(m, (x, rh - 8)); x += m.width
    out.alpha_composite(roof, (0, 0))
    return out

# ------------------------------------------------------------------ ground textures (2x2 tiles each)
G = {
  'g_grass': ('a', [997, 829, 70, 85]), 'g_grass2': ('a', [1078, 829, 70, 85]), 'g_sand': ('a', [1163, 829, 68, 85]),
  'g_grass_flowers': ('a', [1244, 829, 70, 85]), 'g_cobble': ('a', [1328, 829, 63, 86]),
  'g_grass3': ('d', [636, 472, 112, 84]), 'g_meadow': ('d', [24, 578, 100, 104]), 'g_grass_dots': ('d', [144, 472, 102, 84]),
  'g_dirt': ('d', [268, 474, 94, 82]), 'g_pavers': ('d', [384, 580, 92, 102]), 'g_planks': ('d', [503, 580, 110, 102]),
  'g_sidewalk': ('d', [842, 17, 77, 75]), 'g_bricks': ('d', [935, 17, 60, 75]), 'g_terracotta': ('d', [1012, 17, 70, 75]),
  'fl_wood': ('b', [17, 733, 84, 54]), 'fl_checker': ('b', [112, 733, 54, 54]), 'fl_bluecheck': ('b', [176, 733, 52, 54]),
  'fl_white': ('b', [236, 733, 52, 54]), 'fl_brick': ('b', [297, 733, 52, 54]), 'fl_beige': ('b', [357, 733, 52, 54]),
  'fl_stone': ('b', [761, 733, 56, 54]),
}

# ------------------------------------------------------------------ build + pack
items = []
for name, (ref, tw) in S.items():
    im = crop(ref); items.append((name, im, tw))
for name, (roof, walls, tw) in COMP.items():
    items.append((name, compose(roof, walls), tw))
for name, ref in G.items():
    k, (x, y, w, h) = ref
    im = sheets[k].crop((x, y, x + w, y + h)).resize((2 * T, 2 * T), Image.LANCZOS)
    items.append((name, im, 2))
scaled = []
for name, im, tw in items:
    w = max(4, round(tw * T)); h = max(4, round(im.height * w / im.width))
    scaled.append((name, im.resize((w, h), Image.LANCZOS)))
scaled.sort(key=lambda s: -s[1].height)
MAXW, pad = 2048, 2
x = y = row_h = 0; pos = {}
for name, im in scaled:
    if x + im.width > MAXW: x = 0; y += row_h + pad; row_h = 0
    pos[name] = (x, y, im.width, im.height); x += im.width + pad; row_h = max(row_h, im.height)
H = y + row_h
atlas = Image.new('RGBA', (MAXW, H), (0, 0, 0, 0))
for name, im in scaled: atlas.alpha_composite(im, pos[name][:2])
os.makedirs(OUT, exist_ok=True)
atlas.save(os.path.join(OUT, 'atlas.webp'), 'WEBP', quality=88, method=6)
meta = {'tile': T, 'size': [MAXW, H], 'sprites': {n: list(p) for n, p in pos.items()}}
json.dump(meta, open(os.path.join(OUT, 'atlas.json'), 'w'), separators=(',', ':'))
print('sprites', len(pos), 'atlas', MAXW, 'x', H, 'webp KB', os.path.getsize(os.path.join(OUT, 'atlas.webp')) // 1024)
