"""Cut the town-project buildings (tools/sheets/proj_<id>.png|jpg, magenta background) into parts for the game.

    python3 tools/add_projects.py

Each sheet is split into its parts by area (see PARTS), the magenta is keyed out (with a de-spill so JPG edges do not
keep a pink rim), each part is trimmed and saved to public/assets/proj/<id>_<part>.webp. public/assets/proj/proj.json
holds every part's size plus a few anchors measured from the art (clock face centre, wheel hub) so the game can put the
pieces together.
"""
import glob, json, os
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'public', 'assets', 'proj')
# part name -> (x0, y0, x1, y1) as fractions of the sheet
PARTS = {
    'memorial': {'main': (0, 0, 1, 1)},
    'bridge13': {'deck': (0, 0, 1, .55), 'rail': (0, .62, 1, 1)},
    'clock': {'tower': (0, 0, .38, 1), 'hour': (.38, 0, .66, 1), 'min': (.66, 0, 1, 1)},
    'wheel': {'stand': (0, 0, .38, 1), 'ring': (.38, 0, .83, 1), 'cabin': (.83, 0, 1, 1)},
}
MAXW = 700   # px: parts are kept at most this wide (the game scales them down per tile size anyway)


def key(im):
    a = np.asarray(im.convert('RGB')).astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mag = np.minimum(r, b) - g                       # how magenta a pixel is
    alpha = np.clip(1 - (mag - 90) / 80, 0, 1)       # strong magenta -> clear, weak -> keep
    alpha[(r < 120) | (b < 120)] = 1
    # de-spill: pull the magenta cast out of edge pixels
    spill = np.clip(np.minimum(r, b) - g, 0, None) * (1 - alpha) * .9
    out = np.dstack([np.clip(r - spill, 0, 255), g, np.clip(b - spill, 0, 255), alpha * 255])
    out[..., 3] = np.where(out[..., 3] > 140, 255, 0)  # crisp pixel-art edges
    return out.astype(np.uint8)


def trim(a):
    ys, xs = np.where(a[..., 3] > 0)
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1], (int(xs.min()), int(ys.min()))


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    for pid, parts in PARTS.items():
        src = next(iter(sorted(glob.glob(os.path.join(ROOT, 'tools', 'sheets', f'proj_{pid}.*')))), None)
        if not src: print('missing', pid); continue
        im = Image.open(src); W, H = im.size; a = key(im)
        k = None; meta[pid] = {}
        for name, (x0, y0, x1, y1) in parts.items():
            sub, _ = trim(a[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)])
            k = k or min(1, MAXW / max(sub.shape[1], 1))   # one scale per sheet so the parts still fit together
            p = Image.fromarray(sub, 'RGBA'); p = p.resize((max(1, round(p.width * k)), max(1, round(p.height * k))), Image.NEAREST)
            p.save(os.path.join(OUT, f'{pid}_{name}.webp'), 'WEBP', lossless=True, quality=100)
            m = {'w': p.width, 'h': p.height}
            if pid == 'clock' and name == 'tower':          # the clock face: the biggest patch of near-white in the upper half
                q = np.asarray(p); wh = (q[..., 0] > 225) & (q[..., 1] > 225) & (q[..., 2] > 225) & (q[..., 3] > 0)
                wh[q.shape[0] // 2:] = False; ys, xs = np.where(wh)
                m['face'] = [round(float(xs.mean()) / p.width, 4), round(float(ys.mean()) / p.height, 4), round(float(xs.max() - xs.min()) / p.width / 2, 4)]
            if pid == 'wheel' and name == 'stand':          # the hub: the top of the frame, centred
                q = np.asarray(p)[..., 3] > 0; cols = np.where(q[:max(2, p.height // 12)].any(0))[0]
                m['hub'] = [round(float(cols.mean()) / p.width, 4), round(p.height * .055 / p.height, 4)]
            meta[pid][name] = m
            print(pid, name, m)
    json.dump(meta, open(os.path.join(OUT, 'proj.json'), 'w'))


if __name__ == '__main__':
    main()
