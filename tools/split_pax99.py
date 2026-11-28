# 🚌 tools/sheets/pax99.jpg (4x3 grid of the 12 bus-99 passengers) → public/assets/pax99.webp (one row of 256px squares)
from PIL import Image
im = Image.open('tools/sheets/pax99.jpg').convert('RGB'); W, H = im.size; cw, ch = W / 4, H / 3; S = 256
ROWS = [0, .352, .71, 1]   # the generated grid's rows aren't even
out = Image.new('RGB', (S * 12, S))
for i in range(12):
    c, r = i % 4, i // 4; top, bot = ROWS[r] * H, ROWS[r + 1] * H; side = min(cw, bot - top) - 8
    x0 = c * cw + (cw - side) / 2; y0 = top + 4
    out.paste(im.crop((round(x0), round(y0), round(x0 + side), round(y0 + side))).resize((S, S), Image.LANCZOS), (i * S, 0))
out.save('public/assets/pax99.webp', quality=82); print('ok', out.size)
