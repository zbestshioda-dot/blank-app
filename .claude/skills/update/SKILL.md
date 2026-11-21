---
name: update
description: Ship one game update for เมืองชีวิตนี้เลือกได้ cheaply — pull, find the exact spot with grep, edit, add a NEWS line, syntax-check, commit, push, reply in a few Thai lines. Use for every "แก้/เพิ่ม/ปรับ ..." request on this game.
---

# Ship an update (token-saving routine)

Goal: finish with the fewest tokens read and written. Never read whole big files
(`public/game.js` ~900 KB, `server/index.js` ~440 KB, `server/data.js`, `public/style.css`).

## Steps
1. `git pull -q` (user uploads via GitHub web).
2. Locate: `grep -n "<keyword>" public/game.js server/*.js | cut -c1-160 | head -20`
   then `sed -n 'A,Bp' file | cut -c1-220` for a small range (≤60 lines). Widen only if needed.
   Before saying something is missing, grep the code and `NEWS` — it may already exist.
3. Edit with small, exact `Edit` calls (or `sed -i` for one-liners). No refactors, no rewrites.
4. NEWS: add at the top of `const NEWS = [` in `public/game.js` (grep `NEWS *=`).
   Copy the format of the first entry: next `v` id (same day → next letter; new day → `YYYY-MM-DDa`),
   `d: '<วัน> <เดือนย่อ>. (รอบ N+1)'`, one short Thai line per change with an emoji.
5. If `pchar.webp` changed: `python3 tools/split_pchar.py` and bump `CH_V` in `public/game.js`.
   New buildings' rooms: use `late: n` so existing rooms keep their slots.
6. Check: `node --check public/game.js && node --check server/index.js` (plus any other edited .js).
   For server changes also: `timeout 5 node server/index.js` and make sure it starts without errors.
7. Commit (short English message) and `git push -u origin HEAD`.
8. Reply in Thai: one sentence of what changed + ≤3 bullets. Remind that the live site
   only changes after `fly deploy` (app `newlifetownth`) when the change should go live.

## Don'ts
- Don't print big diffs or file contents back to the user.
- Don't ask before small obvious fixes; ask only when the request is genuinely ambiguous.
- Player data must stay on `/data` volume or Postgres — never reset or move it.
- Several requests at once: do them all, then one NEWS entry, one commit, one reply.
