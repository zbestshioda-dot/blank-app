"""Cut the 4 pet sprite sheets (tools/sheets/pets_a..d.jpg) into public/assets/pets.webp + pets.json.
Each pet = 12 frames (down x4, up x4, side x4; side always facing RIGHT), 64x64 cells, feet anchored bottom-centre."""
import sys, json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(ROOT, 'tools', 'sheets')
C = 64
L, R = 'L', 'R'
# id, sheet, row, down, up, side, side facing (str or list), size scale for the game
PETS = [
 ('shiba','a',0,[0,1,2],[3,4,5,6],[7,8,9,10],L,1.0),
 ('golden','a',1,[0,1,2],[3,4,5,6],[7,8,9,10],L,1.0),
 ('corgi','a',2,[0,1,2],[3,4,5,6],[7,8,9,10],L,.95),
 ('pug','a',3,[0,1,2,3],[4,5,6],[7,8,9,10],L,.9),
 ('husky','a',4,[0,1,2,3],[4,5,6],[7,8,9,10],L,1.05),
 ('tabby','a',5,[0,1,2,3],[4,5,6],[7,8,9,10],L,.9),
 ('blackcat','a',6,[0,1,2,3],[4,5,6],None,L,.9),
 ('whitecat','a',7,[0,1,2,3],[4,5,6],None,L,.9),
 ('siamese','b',0,[0,1,2],[3,4,5,6],[7,8,9,10],R,.9),
 ('calico','b',1,[0,1,2],[3,4,5,6],[7,8,9,10],R,.9),
 ('britcat','b',2,[0,1,2,3],[4,5,6],[7,8,9,10],R,.9),
 ('oddeye','b',3,[0,1,2,3],[4,5,6],[7,8,9,10],R,.9),
 ('dalmatian','b',4,[0,1,2],[3,4,5,6],[7,8,9,10],R,1.0),
 ('poodle','b',5,[0,1,2,3],[4,5,6],[7,8,9,10],R,.95),
 ('pom','b',6,[0,1,2],[3,4,5,6],[7,8,9,10],R,.8),
 ('chihuahua','b',7,[0,1,2,3],[4,5,6],[7,8,9,10],R,.8),
 ('rabbit','c',0,[0,1,2],[3],[7,8,9,10],R,.85),
 ('lop','c',1,[0,1,2],[3,4,5,6],[7,8,9,10],L,.85),
 ('hamster','c',2,[0,1,2],[3,4,5,6],[7,8,9,10],L,.65),
 ('guinea','c',3,[0,1,2],[3,4,5,6],[7,8,9,10],L,.65),
 ('hedgehog','c',4,[0,1,2,3],None,None,L,.7),
 ('squirrel','c',4,None,[4,5,6],[7,8,9,10],L,.8),
 ('duck','c',5,[0,1,2,3],[4,5,6],[7,8,9,10],R,.75),
 ('chick','c',6,[0,1,2,3],[4,5,6],[7,8,9,10],R,.6),
 ('redpanda','d',0,[0,1],[3,4,5],[6,7,8],R,1.0),
 ('panda','d',1,[0,1,2],[3,4,5],[6,7,8],R,1.05),
 ('fox','d',2,[0,1,2],[3,4,5],[6,7,8],R,1.0),
 ('penguin','d',3,[0,1,2],[3,4,5],[6,7,8],R,.85),
 ('turtle','d',4,[0,1,2],[3,4,5],[6,7],L,.8),
 ('capybara','d',5,[0,1,2],[3,4,5],[6,7,8],L,1.05),
 ('dragon','d',6,[0,1,2],[3,4,5],[6,7],[L,R],1.0),
 ('unicorn','d',7,[0,1],[3,4,5],[6,7],R,1.1),
]
# 💎 aura pets: tools/sheets/pets_e.jpg / pets_f.jpg have the same layout as pets_d.jpg
for k, ids in (('e', ['starpanda', 'moonpanda', 'crystalfox', 'holopeng', 'runeturtle', 'goldcapy', 'skydragon', 'starunicorn']),
               ('f', ['nebulapanda', 'galaxypanda', 'featherfox', 'opalpeng', 'jadeturtle', 'gemcapy', 'icedragon', 'rainbowunicorn'])):
    for r, pid in enumerate(ids):
        b = PETS[24 + r]; PETS.append((pid, k) + b[2:])
def load(path):
    im = Image.open(path).convert('RGB'); a = np.asarray(im).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg = (r > 90) & (b > 90) & (g < 0.62 * np.minimum(r, b)) & (abs(r - b) < 70)
    fg = ndi.binary_opening(~bg, structure=np.ones((5, 5)))
    return im, bg, fg
def bands(fg):
    prof = fg.sum(1) > 0; out = []; s = None
    for y, v in enumerate(prof):
        if v and s is None: s = y
        if not v and s is not None:
            if y - s > 20: out.append((s, y))
            s = None
    if s is not None: out.append((s, len(prof)))
    return out
def colboxes(sub):
    col = ndi.binary_dilation(sub.sum(0) > 0, structure=np.ones(7))
    lab, n = ndi.label(col); out = []
    for i in range(1, n + 1):
        xs = np.where(lab == i)[0]
        if xs.max() - xs.min() >= 25: out.append((xs.min(), xs.max() + 1))
    return out
sheets = {}
for k in 'abcdef':
    im, bg, fg = load(os.path.join(SH, f'pets_{k}.jpg'))
    bs = bands(fg)
    sheets[k] = (im, bg, fg, bs)
def cut(k, row, ci):
    im, bg, fg, bs = sheets[k]
    y0, y1 = bs[row]; sub = fg[y0:y1]
    bx = colboxes(sub); x0, x1 = bx[ci]
    m = fg[y0:y1, x0:x1] & ~ndi.binary_dilation(bg[y0:y1, x0:x1], iterations=1)
    lab, n = ndi.label(m)
    if n > 1:  # keep big blobs only (drop grid-line crumbs)
        sz = ndi.sum(m, lab, range(1, n + 1)); keep = [i + 1 for i, s in enumerate(sz) if s > 0.04 * sz.max()]
        m = np.isin(lab, keep)
    rgb = np.asarray(im.crop((x0, y0, x1, y1)))
    rgba = np.dstack([rgb, (m * 255).astype(np.uint8)])
    ys, xs = np.where(m)
    return Image.fromarray(rgba).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
atlas = Image.new('RGBA', (12 * C, len(PETS) * C), (0, 0, 0, 0)); meta = {}
for pi, (pid, k, row, down, up, side, face, sz) in enumerate(PETS):
    d = [(cut(k, row, c), None) for c in down] if down else None
    u = [cut(k, row, c) for c in up] if up else None
    s = None
    if side:
        fl = face if isinstance(face, list) else [face] * len(side)
        s = []
        for c, f in zip(side, fl):
            t = cut(k, row, c)
            if f == L: t = t.transpose(Image.FLIP_LEFT_RIGHT)
            s.append(t)
    dd = [x[0] for x in d] if d else None
    # fallbacks: missing views reuse another one
    if dd is None: dd = s
    if u is None: u = dd
    if s is None: s = dd
    sets = [dd, u, s]
    allf = [f for g in sets for f in g]
    scale = min((C - 4) / max(f.height for f in allf), (C - 4) / max(f.width for f in allf))
    for gi, g in enumerate(sets):
        for fi in range(4):
            f = g[fi % len(g)]
            w, h = max(1, round(f.width * scale)), max(1, round(f.height * scale))
            f = f.resize((w, h), Image.LANCZOS)
            ox = (gi * 4 + fi) * C + (C - w) // 2; oy = pi * C + (C - 2 - h)
            atlas.alpha_composite(f, (ox, oy))
    meta[pid] = {'row': pi, 'sz': sz, 'n': [len(dd), len(u), len(s)]}
atlas.save(os.path.join(ROOT, 'public/assets/pets.webp'), 'WEBP', lossless=True, quality=100, method=6)
json.dump({'cell': C, 'pets': meta}, open(os.path.join(ROOT, 'public/assets/pets.json'), 'w'), separators=(',', ':'))
print(len(PETS), 'pets', atlas.size, os.path.getsize(os.path.join(ROOT, 'public/assets/pets.webp')))
# contact sheet for checking
cs = Image.new('RGBA', atlas.size, (90, 150, 90, 255)); cs.alpha_composite(atlas)
cs.save(os.environ.get('PETS_CONTACT', '/tmp/pets_contact.png'))
