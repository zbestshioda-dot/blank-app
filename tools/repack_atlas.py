"""Repack public/assets/atlas.webp with only the sprites the game references (drops replaced/unused art).

    python3 tools/repack_atlas.py

A sprite counts as used when its name appears as a quoted string in server/*.js or public/*.js.
Sprites that share one rectangle (aliases) are packed once. Source sheets live in tools/sheets/.
"""
import glob, json, os, re
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp')
JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')
PAD = 2

def main():
    data = json.load(open(JS)); atlas = Image.open(IMG).convert('RGBA'); S = data['sprites']
    src = ''.join(open(f, encoding='utf-8').read() for f in glob.glob(os.path.join(ROOT, 'server', '*.js')) + glob.glob(os.path.join(ROOT, 'public', '*.js')))
    used = [k for k in S if re.search(r"['\"`]" + re.escape(k) + r"['\"`]", src)]
    rects = {}
    for k in used: rects.setdefault(tuple(S[k]), []).append(k)
    # shelf packing, tallest first
    W = atlas.width; x = y = rowh = 0; place = {}
    for r in sorted(rects, key=lambda r: (-r[3], -r[2])):
        w, h = r[2], r[3]
        if x + w > W: x, y, rowh = 0, y + rowh + PAD, 0
        place[r] = (x, y); x += w + PAD; rowh = max(rowh, h)
    out = Image.new('RGBA', (W, y + rowh))
    sprites = {}
    for r, (px, py) in place.items():
        out.paste(atlas.crop((r[0], r[1], r[0] + r[2], r[1] + r[3])), (px, py))
        for k in rects[r]: sprites[k] = [px, py, r[2], r[3]]
    data['sprites'] = dict(sorted(sprites.items())); data['size'] = [W, out.height]
    out.save(IMG, 'WEBP', quality=92, method=6)
    json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print(f'kept {len(sprites)} of {len(S)} sprites, atlas {out.size}, {os.path.getsize(IMG) // 1024} KB')

if __name__ == '__main__':
    main()
