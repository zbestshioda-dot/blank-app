"""Cut furniture sprites from a 2-row x 3-column magenta sheet and append them to the atlas.

    python3 tools/add_sheet_furn.py auc && node tools/build_snow_atlas.js   (then bump the atlas ?v= in public/game.js)

Sets: craft (tools/sheets/craft_furn.jpg, cut 2026-11-22) and auc (tools/sheets/auc_furn.jpg).
Each item: (sprite name, size, halo) - size 'w1.6' = 1.6 tiles wide, 'h2.6' = 2.6 tiles tall; halo=True also clears a glow
painted into the magenta (only for items with no pink of their own).
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, os.path.dirname(__file__))
from add_furniture import IMG, JS, TILE

ROOT = os.path.join(os.path.dirname(__file__), '..')
SETS = {
    'thai': ('thai_furn.jpg', [('xt_cushion', 'w1.5', False), ('xt_daybed', 'w2.4', False), ('xt_jar', 'w1.2', False),
                               ('xt_cabinet', 'w1.6', False), ('xt_spirit', 'h2.8', False), ('xt_lamp', 'h1.4', False)]),
    'princess': ('princess_furn.jpg', [('xp_bed', 'w2.0', False), ('xp_vanity', 'w1.6', False), ('xp_bear', 'w1.5', False),
                                       ('xp_cloud', 'w1.5', False), ('xp_rug', 'w2.0', False), ('xp_star', 'w1.0', True)]),
    # gamer_furn.jpg: the figures on the shelf were painted out (one was a well-known game character)
    'gamer': ('gamer_furn.jpg', [('xg_desk', 'w2.2', False), ('xg_stream', 'w1.9', False), ('xg_bean', 'w1.5', False),
                                 ('xg_shelf', 'w1.8', True), ('xg_arcade', 'h2.0', False), ('xg_fridge', 'w1.1', False)]),
    'bath': ('bath_furn.jpg', [('xr_tub', 'w1.9', False), ('xr_toilet', 'h1.3', False), ('xr_sink', 'h1.9', False),
                               ('xr_shower', 'h2.2', False), ('xr_towel', 'w1.2', False), ('xr_mat', 'w1.7', False)]),
    'kitchen': ('kitchen_furn.jpg', [('xk_stove', 'w1.2', False), ('xk_fridge', 'h2.0', False), ('xk_counter', 'w1.7', False),
                                     ('xk_island', 'w1.8', False), ('xk_shelf', 'w1.4', False), ('xk_rice', 'w1.2', False)]),
    'beach': ('beach_furn.jpg', [('xb_hammock', 'w2.2', False), ('xb_wheel', 'w1.1', False), ('xb_lighthouse', 'h2.0', True),
                                 ('xb_chest', 'w1.2', False), ('xb_rug', 'w1.9', False), ('xb_fountain', 'w1.6', False)]),
    'japan': ('japan_furn.jpg', [('xj_kotatsu', 'w1.6', False), ('xj_shoji', 'w1.8', False), ('xj_lantern', 'h1.4', False),
                                 ('xj_pond', 'w1.9', False), ('xj_tea', 'w1.2', False), ('xj_torii', 'w2.2', False)]),
    'xmas': ('xmas_furn.jpg', [('xx_tree', 'w1.4', False), ('xx_snowman', 'w1.2', False), ('xx_wreath', 'w1.3', False),
                               ('xx_sleigh', 'w2.0', False), ('xx_candy', 'w1.3', False), ('xx_globe', 'w1.4', False)]),
    'auc': ('auc_furn.jpg', [('xa_arch', 'w1.7', True), ('xa_piano', 'w2.2', False), ('xa_bonsai', 'w1.4', False),
                             ('xa_tank', 'w1.8', False), ('xa_rocker', 'w1.6', False), ('xa_lamp', 'h2.6', True)]),
}

def bg(a, halo):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = (g < 70) & (r > 110) & (b > 110)                       # magenta, incl. the darker magenta drop shadows
    if halo: m |= (g < np.minimum(r, b) * 0.8) & (r > 150) & (b > 150)
    return m

AUTO = {'japan', 'bath', 'kitchen', 'thai'}   # sheets whose items do not sit in equal thirds: find the 6 biggest blobs instead

def blobs(sheet, halo):
    """bounding boxes [y0, x0, y1, x1] of the 6 biggest items, top row first, left to right"""
    lab, n = ndimage.label(ndimage.binary_dilation(~bg(sheet, halo), iterations=12))   # glue each item's loose parts (bubbles, mirror) together
    objs = ndimage.find_objects(lab); sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    big = sorted(range(n), key=lambda k: -sizes[k])[:6]
    H = sheet.shape[0]
    bx = [(objs[k][0].start, objs[k][1].start, objs[k][0].stop, objs[k][1].stop) for k in big]
    return sorted(bx, key=lambda b: ((b[0] + b[2]) / 2 > H / 2, b[1]))

def main(set_name):
    sheet_name, items = SETS[set_name]
    sheet = np.asarray(Image.open(os.path.join(ROOT, 'tools', 'sheets', sheet_name)).convert('RGB')).astype(int); H, W = sheet.shape[:2]
    atlas = Image.open(IMG).convert('RGBA'); data = json.load(open(JS))
    x, y, rowh, placed = 0, data['size'][1] + 2, 0, []
    boxes = blobs(sheet, any(h for *_, h in items)) if set_name in AUTO else None
    for i, (name, size, halo) in enumerate(items):
        r, c = divmod(i, 3)
        if boxes: y0, x0, y1, x1 = boxes[i]; a = sheet[y0:y1, x0:x1]
        else: a = sheet[r * H // 2:(r + 1) * H // 2, c * W // 3:(c + 1) * W // 3]
        fg = ~bg(a, halo); lab, n = ndimage.label(ndimage.binary_closing(fg, iterations=2))
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        keep = np.isin(lab, [k + 1 for k, s in enumerate(sizes) if s > sizes.max() * .04]) & fg   # drop sparkles / specks
        im = Image.fromarray(np.dstack([a, np.where(keep, 255, 0)]).astype(np.uint8)); im = im.crop(im.getbbox())
        t = float(size[1:]) * TILE
        w, h = (round(t), round(im.height * t / im.width)) if size[0] == 'w' else (round(im.width * t / im.height), round(t))
        im = im.resize((w, h), Image.LANCZOS)
        if x + w > atlas.width: x, y, rowh = 0, y + rowh + 2, 0
        placed.append((name, x, y, im)); x += w + 2; rowh = max(rowh, h)
    out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
    for name, px, py, im in placed: out.paste(im, (px, py)); data['sprites'][name] = [px, py, im.width, im.height]
    data['size'] = [atlas.width, y + rowh]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('added', [p[0] for p in placed], 'atlas', out.size)

if __name__ == '__main__':
    main(sys.argv[1])
