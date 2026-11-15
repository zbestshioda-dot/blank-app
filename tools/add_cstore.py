"""Draw the 24-hour convenience store building (b_cstore) in pixel-art style and append it to the atlas.

    python3 tools/add_cstore.py
"""
import json
from PIL import Image, ImageDraw
from add_furniture import IMG, JS

def store():
    W, H = 120, 104                                  # drawn at half size, then doubled (chunky pixels like the other buildings)
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    ol = (52, 36, 30, 255)
    # roof slab + parapet
    d.rectangle([2, 8, W - 3, 20], fill=(214, 218, 224, 255), outline=ol)
    d.rectangle([2, 8, W - 3, 11], fill=(236, 239, 243, 255), outline=ol)
    for x in (16, 44, 80): d.rectangle([x, 2, x + 14, 8], fill=(150, 156, 166, 255), outline=ol)   # AC units on the roof
    # sign band
    d.rectangle([4, 21, W - 5, 37], fill=(32, 140, 170, 255), outline=ol)
    d.rectangle([4, 21, W - 5, 24], fill=(70, 185, 210, 255))
    d.rectangle([4, 34, W - 5, 37], fill=(250, 150, 40, 255))
    # "24" badge + "H"
    d.rectangle([10, 24, 34, 34], fill=(255, 255, 255, 255), outline=ol)
    for (x0, y0, x1, y1) in [(13,26,17,26),(17,26,17,29),(13,29,17,29),(13,29,13,32),(13,32,17,32),(20,26,20,29),(20,29,24,29),(24,26,24,32),(27,26,27,32),(31,26,31,32),(27,29,31,29)]:
        d.line([x0, y0, x1, y1], fill=(32, 120, 150, 255), width=1)
    for i in range(6): d.rectangle([42 + i * 12, 27, 49 + i * 12, 31], fill=(255, 255, 255, 230))   # store name strip (stylised)
    # wall
    d.rectangle([4, 38, W - 5, H - 6], fill=(246, 243, 236, 255), outline=ol)
    # windows with shelves inside
    for (x0, x1) in [(8, 44), (W - 45, W - 9)]:
        d.rectangle([x0, 44, x1, H - 14], fill=(150, 206, 228, 255), outline=ol)
        for y in (52, 62, 72):
            d.line([x0 + 2, y, x1 - 2, y], fill=(110, 120, 130, 255))
            for xx in range(x0 + 3, x1 - 3, 4): d.rectangle([xx, y - 5, xx + 2, y - 1], fill=[(230, 80, 70, 255), (250, 200, 60, 255), (80, 170, 90, 255), (90, 120, 210, 255)][(xx // 4) % 4])
        d.line([x0 + 3, 46, x0 + 12, 46], fill=(225, 245, 255, 255)); d.line([x0 + 3, 47, x0 + 7, 47], fill=(225, 245, 255, 255))
        d.rectangle([x0 + 4, H - 22, x0 + 16, H - 16], fill=(255, 220, 90, 255), outline=ol)        # promo poster
    # glass double door
    d.rectangle([48, 44, W - 49, H - 6], fill=(120, 190, 220, 255), outline=ol)
    d.line([W // 2, 44, W // 2, H - 6], fill=ol)
    d.line([52, 48, 56, 48], fill=(230, 248, 255, 255)); d.line([W // 2 + 4, 48, W // 2 + 8, 48], fill=(230, 248, 255, 255))
    d.rectangle([W // 2 - 4, 60, W // 2 - 2, 66], fill=(200, 200, 205, 255)); d.rectangle([W // 2 + 2, 60, W // 2 + 4, 66], fill=(200, 200, 205, 255))
    # base step
    d.rectangle([2, H - 6, W - 3, H - 2], fill=(170, 168, 160, 255), outline=ol)
    return im.resize((W * 2, H * 2), Image.NEAREST)

def main():
    atlas = Image.open(IMG).convert('RGBA'); data = json.load(open(JS))
    if 'b_cstore' in data['sprites']: return print('already there')
    im = store(); y = data['size'][1] + 2
    out = Image.new('RGBA', (atlas.width, y + im.height)); out.paste(atlas, (0, 0)); out.paste(im, (0, y))
    data['sprites']['b_cstore'] = [0, y, im.width, im.height]; data['size'] = [atlas.width, y + im.height]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':')); print('added b_cstore', out.size)

if __name__ == '__main__':
    main()
