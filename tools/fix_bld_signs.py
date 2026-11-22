"""Sheet C (convenience stores) came back with a chain-store look-alike logo ("8 eight"): paint each logo over with a plain
sign and a "24HR" taken from the third store's own lettering, so the stores stay generic.
    python3 tools/fix_bld_signs.py   (reads tools/sheets/bld_c_orig.jpg, writes tools/sheets/bld_c.jpg)
"""
import numpy as np
from PIL import Image
K = 2816 / 2000
sc = lambda b: tuple(round(v * K) for v in b)
im = Image.open('tools/sheets/bld_c_orig.jpg').convert('RGB'); a = np.asarray(im).copy()
# the "24HR" glyphs under the third store's logo -> a mask
gx0, gy0, gx1, gy1 = sc((478, 712, 570, 742))
g = a[gy0:gy1, gx0:gx1].astype(int); mask = (g.sum(-1) < 420)
from scipy import ndimage
lab, n = ndimage.label(mask); sz = ndimage.sum(mask, lab, range(1, n + 1)); mask = np.isin(lab, [i + 1 for i, v in enumerate(sz) if v > 12])
ys, xs = np.where(mask); mask = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
def paint(box, col, white):
    x0, y0, x1, y1 = sc(box)
    a[y0:y1, x0:x1] = white
    h = int((y1 - y0) * .78); w = int(mask.shape[1] * h / mask.shape[0])
    if w > (x1 - x0) * .92: w = int((x1 - x0) * .92); h = int(mask.shape[0] * w / mask.shape[1])
    m = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).resize((w, h), Image.NEAREST)) > 127
    ox, oy = x0 + ((x1 - x0) - w) // 2, y0 + ((y1 - y0) - h) // 2
    a[oy:oy + h, ox:ox + w][m] = col
white = a[sc((405, 0, 0, 0))[0], sc((0, 150, 0, 0))[1]].copy()
white = np.array([238, 236, 230])
paint((408, 138, 622, 198), (46, 120, 70), white)       # store 1 (green)
paint((1362, 138, 1578, 198), (120, 50, 140), white)    # store 2 (purple)
paint((418, 650, 632, 702), (120, 50, 140), white)      # store 3 (purple)
x0, y0, x1, y1 = sc((462, 706, 580, 748)); a[y0:y1, x0:x1] = white   # its old small "24HR" line
paint((1774, 232, 1846, 326), (120, 50, 140), np.array([246, 206, 80]))   # the pole sign: yellow panel, 24HR
# store 1's red stripes -> yellow (red + green bands read as a real chain's colours)
x0, y0, x1, y1 = sc((240, 135, 800, 200)); r = a[y0:y1, x0:x1].astype(int)
red = (r[..., 0] > 170) & (r[..., 1] < 110) & (r[..., 2] < 120); r[red] = (240, 196, 70); a[y0:y1, x0:x1] = r
Image.fromarray(a).save('tools/sheets/bld_c.jpg', quality=95)
print('ok')
