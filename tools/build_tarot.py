"""Cut the tarot card sheets (tools/sheets/tarot_a.jpg, tarot_b.jpg ... 3x3 cards on a plain beige background) into
public/assets/tarot.webp (one row of 150x190 cards) + tarot.json {id: index}. The painted name strip under each card
and the gold frame are cropped off (the game draws its own frame and writes the name in Thai).

    python3 tools/build_tarot.py
"""
import glob, json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(__file__), '..')
SHEETS = {'a': ['fool', 'magician', 'priestess', 'empress', 'emperor', 'hierophant', 'lovers', 'chariot', 'strength'],
          'b': ['hermit', 'wheel', 'justice', 'death', 'temperance', 'devil', 'tower', 'star', 'moon']}   # sheet b order is a guess: edit when it arrives
SKIP = {'lovers'}   # left out of the deck
CW, CH = 150, 190

def cards(path):
    im = Image.open(path).convert('RGB'); a = np.asarray(im).astype(int)
    d = ndi.binary_closing(np.abs(a - a[5, 5]).sum(2) > 60, iterations=3)
    lab, n = ndi.label(d); boxes = []
    for s in ndi.find_objects(lab):
        h, w = s[0].stop - s[0].start, s[1].stop - s[1].start
        if h > im.height * .2 and w > im.width * .06: boxes.append((s[0].start, s[1].start, w, h))
    boxes.sort(key=lambda b: (round(b[0] / (im.height / 3)), b[1]))
    sc = im.width / 2816
    for y, x, w, h in boxes:
        yield im.crop((x + int(20 * sc), y + int(20 * sc), x + w - int(20 * sc), y + h - int(88 * sc))).resize((CW, CH), Image.LANCZOS)

def main():
    out, idx = [], {}
    for k, ids in SHEETS.items():
        p = os.path.join(ROOT, 'tools', 'sheets', f'tarot_{k}.jpg')
        if not os.path.exists(p): continue
        for cid, c in zip(ids, cards(p)):
            if cid in SKIP: continue
            idx[cid] = len(out); out.append(c)
    sheet = Image.new('RGB', (CW * len(out), CH))
    for i, c in enumerate(out): sheet.paste(c, (i * CW, 0))
    sheet.save(os.path.join(ROOT, 'public', 'assets', 'tarot.webp'), 'WEBP', quality=88)
    json.dump({'w': CW, 'h': CH, 'map': idx}, open(os.path.join(ROOT, 'public', 'assets', 'tarot.json'), 'w'))
    print(len(out), 'cards', list(idx))

if __name__ == '__main__': main()
