"""Draw the vegetable-field sprite for home yards (y_field: a 2x2-tile wooden bed of tilled soil) and append it to the atlas.

    python3 tools/add_field.py
"""
import json
from PIL import Image, ImageDraw
from add_furniture import IMG, JS

def field(T=48):
    W = T * 2; im = Image.new('RGBA', (W, W), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W - 1, W - 1], fill=(138, 90, 50, 255))                 # wooden frame
    d.rectangle([0, 0, W - 1, 3], fill=(168, 115, 63, 255))
    d.rectangle([0, W - 4, W - 1, W - 1], fill=(104, 66, 36, 255))
    for x in (0, W - 1): d.line([x, 0, x, W - 1], fill=(90, 56, 30, 255))
    d.rectangle([5, 5, W - 6, W - 6], fill=(92, 60, 36, 255))                    # soil
    for i in range(5):                                                          # furrows
        y = 5 + (W - 10) * (i + .5) / 5
        d.rectangle([8, y - 3, W - 9, y - 2], fill=(130, 92, 60, 255))
        d.rectangle([8, y, W - 9, y + 2], fill=(62, 40, 24, 255))
    for x in range(10, W - 10, 13):                                             # frame nails
        d.point([(x, 1), (x, W - 2)], fill=(60, 40, 22, 255))
    return im

def main():
    atlas = Image.open(IMG).convert('RGBA'); data = json.load(open(JS))
    if 'y_field' in data['sprites']: return print('already there')
    im = field(data['tile']); y = data['size'][1] + 2
    out = Image.new('RGBA', (atlas.width, y + im.height)); out.paste(atlas, (0, 0)); out.paste(im, (0, y))
    data['sprites']['y_field'] = [0, y, im.width, im.height]; data['size'] = [atlas.width, y + im.height]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':')); print('added y_field', out.size)

if __name__ == '__main__':
    main()
