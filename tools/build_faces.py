"""Cut the facial-expression sheet (tools/sheets/face_expr.jpg: 3 rows x 4 faces on magenta) into small feature
sprites at the character sprite's own pixel size: public/assets/faces.webp + faces.json.
Only the features are kept (eyes, brows, mouth, blush, tears): each face's own skin colour is dropped, so the game can
paint them onto any character (it first paints its own skin over the old eyes and mouth, see faceFrame in game.js).
The neutral face (first) fixes the scale: its eye spacing becomes D pixels, the spacing on the 126x96 character frames.

    python3 tools/build_faces.py
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'tools', 'sheets', 'face_expr.jpg')
OUT = os.path.join(ROOT, 'public', 'assets')
NAMES = ['neutral', 'happy', 'laugh', 'love', 'sad', 'cry', 'angry', 'surprised', 'sleepy', 'sick', 'shy', 'wink']
D = 20          # eye spacing on the character frames (pixels)
LIFT = 3        # rows the mouth moves up

def main():
    a = np.asarray(Image.open(SRC).convert('RGB')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg = np.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2) < 90
    lab, n = ndimage.label(ndimage.binary_opening(~bg, iterations=3))
    boxes = [sl for i, sl in enumerate(ndimage.find_objects(lab)) if (lab[sl] == i + 1).sum() > 5000]
    assert len(boxes) == 12, len(boxes)
    boxes.sort(key=lambda sl: sl[0].start + sl[0].stop)                        # top to bottom, then each row of 4 left to right
    boxes = [b for i in range(0, 12, 4) for b in sorted(boxes[i:i + 4], key=lambda sl: sl[1].start)]
    # neutral face: find its two eyes (dark blobs) to fix the scale and the anchor (midpoint between the eyes)
    def feats(sl):
        p = a[sl]; m = ndimage.binary_erosion(~bg[sl], iterations=14)        # stay off the face patch's own rim
        cols = p[m].reshape(-1, 3); skin = np.median(cols, axis=0)          # the face's own skin colour
        d = np.sqrt(((p - skin) ** 2).sum(-1))
        return p, m & (d > 55), skin
    p, fm, skin = feats(boxes[0])
    dark = fm & (p.sum(-1) < 250)
    el, en = ndimage.label(dark); objs = sorted(ndimage.find_objects(el), key=lambda s: -((s[0].stop - s[0].start) * (s[1].stop - s[1].start)))[:2]
    ec = sorted(((s[1].start + s[1].stop) / 2, (s[0].start + s[0].stop) / 2) for s in objs)
    spacing = ec[1][0] - ec[0][0]; k = D / spacing
    ax0, ay0 = (ec[0][0] + ec[1][0]) / 2, (ec[0][1] + ec[1][1]) / 2           # anchor inside the neutral box
    H0, W0 = boxes[0][0].stop - boxes[0][0].start, boxes[0][1].stop - boxes[0][1].start
    FM = np.zeros(bg.shape, bool)                                              # feature pixels of every face, in sheet coordinates
    for sl in boxes: FM[sl] |= feats(sl)[1]
    tiles = []
    for name, sl in zip(NAMES, boxes):
        # every face box is laid out like the neutral one: a fixed-size window centred the same way
        cy, cx = (sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2
        y0, x0 = int(round(cy - H0 / 2)), int(round(cx - W0 / 2))
        win, wm = a[y0:y0 + H0, x0:x0 + W0], FM[y0:y0 + H0, x0:x0 + W0]
        w, h = max(1, round(W0 * k)), max(1, round(H0 * k))
        # pixel-art downscale: average colour of the feature pixels in each cell, keep the cell if enough of it is feature
        cov = np.asarray(Image.fromarray((wm * 255).astype(np.uint8)).resize((w, h), Image.BOX)).astype(float) / 255
        col = np.asarray(Image.fromarray((win * wm[..., None]).astype(np.uint8)).resize((w, h), Image.BOX)).astype(float)
        rgb = col / np.maximum(cov[..., None], 1e-6)
        out = np.dstack([np.clip(rgb, 0, 255), (cov > .38) * 255]).astype(np.uint8)
        # the character's mouth sits closer under its eyes than on these round faces: lift everything below the eyes
        cut = int(round(ay0 * k)) + 4
        low = out[cut:].copy(); out[cut:] = 0; out[cut - LIFT:cut - LIFT + low.shape[0]][low[..., 3] > 0] = low[low[..., 3] > 0]
        tiles.append((name, Image.fromarray(out, 'RGBA')))
    W, Hh = tiles[0][1].size
    sheet = Image.new('RGBA', (W * len(tiles), Hh))
    for i, (nm, t) in enumerate(tiles): sheet.paste(t, (i * W, 0))
    sheet.save(os.path.join(OUT, 'faces.webp'), 'WEBP', lossless=True)
    json.dump({'names': NAMES, 'w': W, 'h': Hh, 'ax': round(ax0 * k, 2), 'ay': round(ay0 * k, 2), 'd': D}, open(os.path.join(OUT, 'faces.json'), 'w'))
    print('faces', len(tiles), 'tile', W, Hh, 'anchor', round(ax0 * k, 1), round(ay0 * k, 1))

if __name__ == '__main__':
    main()
