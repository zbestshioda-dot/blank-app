"""Cut the three pixel icon sheets (tools/sheets/icons_a..c.jpg, 8x8 each, magenta background) into
public/assets/icons.webp + icons.json: { cell, cols, map: { emoji: index } }. The game swaps these emoji in the UI for the icons."""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
C = 64
# emoji for each cell, row by row (None = not used). A later sheet does not override an emoji an earlier one already has.
NAMES = {
 'a': ['🪙 💰'.split()[0], '💎', '⚡', '❤️', '🍗', '😊', '⭐', '👑',
       '⏰', '⏳', '📅', '☀️', '🌙', '💤', '🔔', '🔊',
       '🎵', '⚙️', '🔒', '🔑', '✅', '❌', '➕', '➖',
       '⬆️', '⬇️', '⬅️', '➡️', '🔄', '🗑️', '♻️', '🔍',
       'ℹ️', '❔', '⚠️', '🚨', '📍', '🗺️', None, '🎒',
       '💼', '📱', '💬', '📞', '🚫', '📶', '👤', '👥',
       '🤝', '🪪', '🧾', '💳', '💵', '💰', '🏦', '🏆',
       '🏅', '🥇', '🥈', '🥉', '📜', '📝', '📋', '🎯'],
 'b': ['🏠', '🏡', '🏨', '🏬', '🥕', '🏪', '🏥', '🚑',
       '👮', '🚒', '🎓', '🏫', '🏢', '🛍️', '🏷️', '🪧',
       '🎣', '🐟', '🦈', '🌱', '🥬', '🌾', '🪣', '🟫',
       '💈', '👕', '👖', '🕶️', '🛋️', '🪑', '🛏️', '🪔',
       '🍳', '🍜', '🍛', '🍱', '🥡', '🥤', '💉', '🩺',
       '🩹', '💊', '🛵', '🚗', '🚁', '🚧', '🚪', None,
       '🌳', '🌊', '🏝️', '🐾', '🐶', '🐱', '🏋️', '👟',
       '🧰', '🛠️', '🧺', '📦', '🎁', '🎨', '📷', '🧳'],
 'c': ['🙂', '😁', '😂', '😭', '😡', '😓', '🤒', '🤢',
       '😴', '😱', '😍', '😎', '🤔', '🤤', '😞', '😐',
       '👋', '👍', '🙏', '👆', '👏', '💪', '👊', '✌️',
       '🔥', '✨', '🎉', '🌟', None, '💔', None, '💧',
       '❗', '❓', None, '💭', '💡', '🎶', '💫', '🌠',
       None, '☁️', '🌧️', '⛈️', '🌅', '🌃', '🌈', '❄️',
       '📈', '📉', '🕐', '🟢', '⚫', '🟡', '🔴', '⚪',
       '🏵️', '🫅', '🛡️', '🗡️', '💀', '🔐', None, '🤑'],
}
# extra emoji that should use an existing icon
ALIAS = {'✔️': '✅', '✖️': '❌', '❣️': '❤️', '♥️': '❤️', '🧡': '❤️', '💖': '❤️', '🕒': '🕐', '⌛': '⏳', '🗓️': '📅', '📆': '📅', '🌤️': '☀️', '🔕': '🔔', '🔉': '🔊', '🔈': '🔊',
  '🎼': '🎵', '🔓': '🔒', '🗝️': '🔑', '☑️': '✅', '⭕': '⚪', '↩️': '⬅️', '🔃': '🔄', '🔎': '🔍', '❕': '❗', '‼️': '❗', '📌': '📍', '🧭': '🗺️', '👜': '🎒', '📲': '📱', '🗨️': '💬',
  '☎️': '📞', '⛔': '🚫', '📊': '📈', '🧑': '👤', '👨': '👤', '🙋': '👤', '💸': '💵', '🏛️': '🏦', '🎖️': '🏅', '🗒️': '📝', '✍️': '📝', '🏘️': '🏡', '🏤': '🏬', '🚓': '🚗', '🚕': '🚗', '🚙': '🚗',
  '🏍️': '🛵', '🛴': '🛵', '🚲': '🛵', '🐕': '🐶', '🐈': '🐱', '🐠': '🐟', '🐡': '🐟', '🌴': '🏝️', '🌲': '🌳', '🥗': '🥬', '🍲': '🍜', '🍝': '🍜', '🥘': '🍛', '🍚': '🍛', '☕': '🥤', '🧋': '🥤',
  '🍹': '🥤', '🧃': '🥤', '😀': '😁', '😃': '😁', '😄': '😁', '😆': '😂', '🤣': '😂', '😢': '😭', '😤': '😡', '😠': '😡', '😥': '😓', '😰': '😓', '😮‍💨': '😓', '🥵': '😓', '🤧': '🤒', '😷': '🤒',
  '🤮': '🤢', '😪': '😴', '😨': '😱', '🥰': '😍', '😔': '😞', '☹️': '😞', '😕': '😞', '😑': '😐', '🫡': '🙂', '😌': '🙂', '😉': '🙂', '👌': '👍', '🙌': '👏', '✊': '👊', '🤞': '✌️', '💥': '🔥',
  '🎊': '🎉', '🥳': '🎉', '⚘': '🌱', '🪴': '🌱', '☔': '🌧️', '🌦️': '🌧️', '🌩️': '⛈️', '🌄': '🌅', '🌆': '🌃', '🔵': '⚪', '🛎️': '🔔', '🧹': '🗑️', '🥫': '🗑️'}
def load(k):
    im = Image.open(os.path.join(ROOT, 'tools/sheets', f'icons_{k}.jpg')).convert('RGB'); a = np.asarray(im).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg = (r > 150) & (b > 150) & (g < 0.55 * np.minimum(r, b)) & (abs(r - b) < 90)
    return im, bg, ndi.binary_opening(~bg, np.ones((3, 3)))
def bands(p):
    out = []; s = None
    for i, v in enumerate(p):
        if v and s is None: s = i
        if not v and s is not None:
            if i - s > 15: out.append((s, i))
            s = None
    if s is not None: out.append((s, len(p)))
    return out
cells, emap = [], {}
for k in 'abc':
    im, bg, fg = load(k)
    rb, cb = bands(fg.sum(1) > 0), bands(fg.sum(0) > 0)
    for ri, (y0, y1) in enumerate(rb):
        for ci, (x0, x1) in enumerate(cb):
            name = NAMES[k][ri * 8 + ci]
            if not name or name in emap: continue
            m = fg[y0:y1, x0:x1] & ~ndi.binary_dilation(bg[y0:y1, x0:x1], iterations=1)
            lab, n = ndi.label(m)
            if n > 1:
                sz = ndi.sum(m, lab, range(1, n + 1)); m = np.isin(lab, [i + 1 for i, v in enumerate(sz) if v > 0.02 * sz.max()])
            ys, xs = np.where(m)
            rgba = np.dstack([np.asarray(im.crop((x0, y0, x1, y1))), (m * 255).astype(np.uint8)])
            t = Image.fromarray(rgba).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
            sc = (C - 4) / max(t.width, t.height); t = t.resize((max(1, round(t.width * sc)), max(1, round(t.height * sc))), Image.LANCZOS)
            cell = Image.new('RGBA', (C, C)); cell.alpha_composite(t, ((C - t.width) // 2, (C - t.height) // 2))
            emap[name] = len(cells); cells.append(cell)
for a, b in ALIAS.items():
    if b in emap and a not in emap: emap[a] = emap[b]
cols = 16; rows = (len(cells) + cols - 1) // cols
sheet = Image.new('RGBA', (cols * C, rows * C))
for i, c in enumerate(cells): sheet.alpha_composite(c, ((i % cols) * C, (i // cols) * C))
sheet.save(os.path.join(ROOT, 'public/assets/icons.webp'), 'WEBP', quality=90, alpha_quality=100, method=6)
json.dump({'cell': C, 'cols': cols, 'rows': rows, 'map': emap}, open(os.path.join(ROOT, 'public/assets/icons.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(cells), 'icons', len(emap), 'emoji', sheet.size, os.path.getsize(os.path.join(ROOT, 'public/assets/icons.webp')))
sheet_bg = Image.new('RGBA', sheet.size, (240, 230, 210, 255)); sheet_bg.alpha_composite(sheet); sheet_bg.save('/tmp/claude-0/-home-user-blank-app/05ecec07-c061-54e9-8d72-633cf2a62269/scratchpad/icons_contact.png')
