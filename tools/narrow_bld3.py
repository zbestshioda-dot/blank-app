"""bld3.jpg came back long and flat: cut repeating middle strips out of each building (a window bay, plain wall, side
stalls) so it is closer to the old footprint's shape, and fill the market's see-through gap with its stall back wall.
Used by tools/redo_buildings2.py (PICK entries with a 'narrow' key).
"""
import numpy as np
from PIL import Image
# blob index -> strips to remove, as tenths of the width
STRIPS = {0: [(2.0, 3.4), (7.0, 8.4)], 1: [(0.35, 1.3), (8.7, 9.65)], 2: [(1.9, 3.4), (6.0, 7.4)], 3: [(1.0, 2.6), (6.2, 8.0)]}
def fill_hole(im):
    a = np.asarray(im).copy(); h, w = a.shape[:2]
    x0, x1, y0 = int(w * .33), int(w * .60), int(h * .40)
    wall = np.array([92, 60, 46])   # the dark wooden back wall of the stalls
    hole = a[y0:, x0:x1, 3] < 200
    for y in range(y0, h):
        row = a[y, x0:x1]; m = hole[y - y0]
        if m.all(): continue          # below the stalls: keep transparent
        row[m, :3] = wall * (1.25 if (y - y0) % 40 < 5 else 1); row[m, 3] = 255   # with a plank line every few rows
    return Image.fromarray(a)
def narrow(im, i):
    if i == 0: im = fill_hole(im)
    a = np.asarray(im); w = a.shape[1]; keep = np.ones(w, bool)
    for s0, s1 in STRIPS[i]: keep[int(w * s0 / 10):int(w * s1 / 10)] = False
    return Image.fromarray(a[:, keep])
