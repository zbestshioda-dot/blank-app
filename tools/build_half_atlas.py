"""Half-size copies of the world atlas for phones: assets/atlas_half.webp and atlas_snow_half.webp.
A 4096 x 6000+ atlas decodes to ~100 MB and iPhones reload (white screen); the half copy is ~25 MB.
The game halves the sprite rectangles and the tile size when it loads these, so nothing else changes.

    python3 tools/build_half_atlas.py      (run after every atlas change, after build_snow_atlas.js)
    python3 tools/build_half_atlas.py bld  (only the sharp buildings sheet)
"""
import json, os, sys
from PIL import Image
A = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets')
ONLY_BLD = sys.argv[1:] == ['bld']
for name in ([] if ONLY_BLD else ['atlas', 'atlas_snow']):
    im = Image.open(os.path.join(A, name + '.webp')).convert('RGBA')
    h = im.resize((im.width // 2, (im.height + 1) // 2), Image.LANCZOS)
    h.save(os.path.join(A, name + '_half.webp'), 'WEBP', quality=90, method=6)
    print(name + '_half.webp', h.size, os.path.getsize(os.path.join(A, name + '_half.webp')), 'bytes')

# the ground and floor textures stay sharp: a small full-size sheet of just those (tex() in game.js uses it on phones)
J = json.load(open(os.path.join(A, 'atlas.json')))

# buildings (b_*) stay sharp too: one full-size file each in assets/bld/ (<name>.webp, snow: <name>_s.webp);
# phones load only the ones near the player and drop the far ones (spr() in game.js), so memory stays small
os.makedirs(os.path.join(A, 'bld'), exist_ok=True)
for name, suf in [('atlas', ''), ('atlas_snow', '_s')]:
    im = Image.open(os.path.join(A, name + '.webp')).convert('RGBA'); tot = 0
    for k, (X, Y, w, h) in J['sprites'].items():
        if not k.startswith('b_'): continue
        f = os.path.join(A, 'bld', k + suf + '.webp'); im.crop((X, Y, X + w, Y + h)).save(f, 'WEBP', quality=92, method=6); tot += os.path.getsize(f)
    print(name, '-> bld/*' + suf + '.webp', tot, 'bytes')
if ONLY_BLD: sys.exit()
names = sorted(k for k in J['sprites'] if k.startswith(('g_', 'fl_')))
for name in ['atlas', 'atlas_snow']:
    im = Image.open(os.path.join(A, name + '.webp')).convert('RGBA'); out, x, y, rh, sp = [], 0, 0, 0, {}
    for k in names:
        X, Y, w, h = J['sprites'][k]
        if x + w > 1024: x, y, rh = 0, y + rh + 2, 0
        out.append((im.crop((X, Y, X + w, Y + h)), x, y)); sp[k] = [x, y, w, h]; x += w + 2; rh = max(rh, h)
    T = Image.new('RGBA', (1024, y + rh))
    for c, px, py in out: T.paste(c, (px, py))
    T.save(os.path.join(A, name + '_tex.webp'), 'WEBP', quality=92, method=6)
json.dump({'tile': J['tile'], 'sprites': sp}, open(os.path.join(A, 'atlas_tex.json'), 'w'), separators=(',', ':'))
print('atlas_tex', T.size, len(names), 'textures')
