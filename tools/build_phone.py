# Builds the phone UI assets (frame, wallpaper, 4x4 app icons) from the source pictures: magenta becomes transparent.
import sys
from PIL import Image
frame_src, icons_src, wall_src, out = sys.argv[1:5]

def key(im):
    im = im.convert('RGBA'); px = im.load(); W, H = im.size
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            m = min(r, b) - g                      # how magenta the pixel is
            if m > 120: px[x, y] = (0, 0, 0, 0)
            elif m > 60: px[x, y] = (r, g, b, int(255 * (120 - m) / 60))
    return im

f = key(Image.open(frame_src).crop((160, 410, 1285, 2505)))
f = f.resize((562, 1046), Image.LANCZOS); f.save(out + '/frame.webp', lossless=True)
w = Image.open(wall_src).convert('RGB').resize((480, 970), Image.LANCZOS); w.save(out + '/wall.webp', quality=86)
ic = Image.open(icons_src); T = 112; atlas = Image.new('RGBA', (T * 4, T * 4))
cols = [(40, 494), (547, 999), (1049, 1502), (1554, 2008)]; rows = [(46, 496), (547, 1000), (1048, 1500), (1551, 2000)]
for j, (y0, y1) in enumerate(rows):
    for i, (x0, x1) in enumerate(cols):
        t = key(ic.crop((x0 - 4, y0 - 4, x1 + 4, y1 + 4))).resize((T, T), Image.LANCZOS)
        atlas.paste(t, (i * T, j * T))
atlas.save(out + '/apps.webp', quality=92)
print('ok')
