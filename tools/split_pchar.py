"""Split the character atlas (public/assets/pchar.webp/json) into one small image per outfit sheet:
public/assets/pchar/<sheet>.webp + public/assets/pchar/index.json. The game loads only the sheets someone near you
is wearing (the one big atlas decoded to ~135 MB and made iPhones reload the page).
Run again after anything that changes pchar.webp (add_fashion.py, dye_masks.py, build_pixel_chars.py)."""
import json, os
from collections import defaultdict
from PIL import Image
SRC = 'public/assets/pchar'
OUT = 'public/assets/pchar'
j = json.load(open(SRC + '.json'))
im = Image.open(SRC + '.webp').convert('RGBA')
w, h, per, L = j['w'], j['h'], j['per'], len(j['layers'])
groups = defaultdict(list)
for k, r in j['rows'].items():
    groups[k.split(':')[0] if ':' in k else '_base'].append((r, k))
os.makedirs(OUT, exist_ok=True)
at = {}
for g, fr in groups.items():
    fr.sort()
    sheet = Image.new('RGBA', (w * L, h * len(fr)), (0, 0, 0, 0))
    for i, (r, k) in enumerate(fr):
        bx, row = (r // per) * w * L, r % per
        sheet.paste(im.crop((bx, row * h, bx + w * L, row * h + h)), (0, i * h))
        at[k] = [g, i]
    sheet.save(f'{OUT}/{g}.webp', 'WEBP', lossless=True, method=6)
json.dump({'w': w, 'h': h, 'feet': j['feet'], 'layers': j['layers'], 'at': at}, open(f'{OUT}/index.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(groups), 'sheets,', len(at), 'frames')
