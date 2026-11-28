# Art style guide (เมืองชีวิตนี้เลือกได้)

Look: cozy top-down pixel art, warm and soft, chibi people (big head ≈ 40% of height), 1-px dark outline
(dark brown for people/props, navy for ghosts/spirits), flat shading with 1 highlight + 1 shadow tone, no anti-aliasing,
no text baked into pictures, no drop shadow (the game draws its own).

## Sizes the code expects
| What | Format | Where it goes | Built by |
|---|---|---|---|
| Outfit (job clothes / fashion) | 3x3 sheet, plain beige bg (~2400x1792 jpg). Row 1 front walk ×3, row 2 back ×3, row 3 side (facing right) ×3. Same body size every frame. Women's version = `f` + id | `tools/sheets/fashion_<id>.jpg` | `/outfit` skill → `tools/add_fashion.py`, `split_pchar.py`, bump `CH_V` |
| Player character frames | 126x96 per frame in `public/assets/pchar*` (layers: base, shirt, pants, hair, dye) | generated | `tools/split_pchar.py` |
| Walking NPC sheet (e.g. black shaman) | 3 cols x 3 rows, 96x112 per frame, transparent png/webp (row 0 down, 1 side, 2 up) | `public/assets/<name>.webp` | cut like `tools/cut_shaman.py` |
| Small animated thing (ghost) | 1 row of 3 frames, 96x112 each, transparent png | `public/assets/<name>.png` | drawn ping-pong 0-1-2-1 |
| Props / furniture / buildings | any size on a plain bg sheet; packed into the atlas (tile = 48 px) | `tools/sheets/<set>.jpg` | the matching `tools/add_*.py` → `atlas.webp/json` |

## Cleaning AI pictures
- AI tools often paint a fake checkerboard instead of real transparency: remove it (neutral gray pixels below
  brightness ~200 = background), keep the biggest blobs, crop each frame, scale all frames with ONE factor so the
  bob/size changes stay, align to the bottom of the cell.
- Always look at the cut result on a solid colour before wiring it in.

## Prompt skeleton (copy, fill the [ ])
```
Pixel art chibi [character / prop] sprite sheet, [3x3 grid: row 1 front walk 3 frames, row 2 back walk, row 3 side facing right]
OR [1 row x 3 frames floating animation], [plain beige background | transparent background], cozy top-down life-sim RPG style,
1px dark outline, soft warm colours, same size and proportions in every frame, no text, no shadow. [description]
```
