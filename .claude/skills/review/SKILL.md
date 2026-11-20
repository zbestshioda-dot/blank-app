---
name: review
description: Quick safety review of the pending diff for this game (bugs, player-data risk, lag, cheating) before pushing or deploying. Use when the user says "รีวิว", "เช็คก่อน deploy", or after a big feature.
---

# Review the diff (lite)

1. `git diff origin/main --stat` then read the diff in chunks (`git diff origin/main -- <file> | head -200`). Don't open whole files.
2. Look only for things that hurt this game:
   - Player data: anything that resets/overwrites saves, changes the save format without migration, writes outside `/data`/Postgres.
   - Server trust: client sends coins/items/XP/position and the server believes it (cheating). Server must validate.
   - Lag: work inside per-frame / per-tick loops, large broadcasts, sync file writes, big new images (prefer small webp, load on demand).
   - Mobile (iPhone): memory-heavy canvases or huge sprite sheets.
   - Missing NEWS entry, forgotten `CH_V` bump after sprite changes.
3. Report in Thai: ปัญหา (ต้องแก้ก่อน deploy) / ข้อสังเกต (ไม่เร่ง), each one line with `file:line`. If clean, say "ไม่เจอปัญหา" and what you checked.
4. Don't fix unasked; offer to fix the must-fix items.
