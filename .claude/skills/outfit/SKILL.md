---
name: outfit
description: Add a new character outfit (ชุดใหม่) to the game from a sheet image the user uploaded. Use when the user adds tools/sheets/fashion_<id>.jpg or asks for a new outfit.
---

# Add an outfit

1. `git pull -q`. Check the sheet exists: `ls tools/sheets | grep fashion_` (3x3 sheet, beige background; row1 front, row2 back, row3 side). Women's version = id prefixed with `f`.
2. Build into the atlas: `python3 tools/add_fashion.py` (safe to re-run).
3. If the outfit is dyeable (listed in `DYE_SETS` in `server/data.js`): `python3 tools/dye_masks.py`.
4. Split for the game: `python3 tools/split_pchar.py`, then bump `CH_V` in `public/game.js` (`grep -n "CH_V *=" public/game.js`).
5. Register the item: `grep -n "<similar outfit id>" server/data.js public/game.js | cut -c1-160` and copy how an existing outfit is declared (name, price, shop slot). Edit narrowly.
6. Run the /update routine from the NEWS step on, then /check. Look at one screenshot of the new sprite only if something seems off.
7. Reply in Thai, ≤3 bullets: ชื่อชุด, ขายที่ไหน/ราคา, ต้อง `fly deploy`.
