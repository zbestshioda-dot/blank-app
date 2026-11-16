"""Copy named sprites from an older atlas in git history back into the current atlas.

    python3 tools/restore_sprites.py <commit> name [name ...]

Useful after tools/repack_atlas.py dropped sprites that the game now wants again.
"""
import io, json, os, subprocess, sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'public', 'assets', 'atlas.webp')
JS = os.path.join(ROOT, 'public', 'assets', 'atlas.json')

def git_bytes(rev, path):
    return subprocess.run(['git', '-C', ROOT, 'show', f'{rev}:{path}'], check=True, capture_output=True).stdout

def main():
    rev, names = sys.argv[1], sys.argv[2:]
    old_j = json.loads(git_bytes(rev, 'public/assets/atlas.json')); old = Image.open(io.BytesIO(git_bytes(rev, 'public/assets/atlas.webp'))).convert('RGBA')
    data = json.load(open(JS)); atlas = Image.open(IMG).convert('RGBA'); S = data['sprites']
    pieces = [(n, old.crop((r[0], r[1], r[0] + r[2], r[1] + r[3]))) for n in names if n not in S and (r := old_j['sprites'].get(n))]
    x, y, rowh = 0, data['size'][1] + 2, 0; placed = []
    for n, im in pieces:
        if x + im.width > atlas.width: x, y, rowh = 0, y + rowh + 2, 0
        placed.append((n, x, y, im)); x += im.width + 2; rowh = max(rowh, im.height)
    out = Image.new('RGBA', (atlas.width, y + rowh)); out.paste(atlas, (0, 0))
    for n, px, py, im in placed:
        out.paste(im, (px, py)); S[n] = [px, py, im.width, im.height]
    data['size'] = [atlas.width, out.height]
    out.save(IMG, 'WEBP', quality=92, method=6); json.dump(data, open(JS, 'w'), separators=(',', ':'))
    print('restored', [p[0] for p in placed])

if __name__ == '__main__':
    main()
