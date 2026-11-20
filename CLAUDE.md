# Notes for Claude

- Every time you ship an update to the game, add a short Thai summary entry at the top of `NEWS` in `public/game.js`
  (new `v` id + date + one line per change). Players see it once after the update, and under ⚙️ → 🆕 อัปเดต.
- Character sprites: the game loads `public/assets/pchar/<sheet>.webp` (one per outfit). After any change to `pchar.webp` (add_fashion.py, dye_masks.py, …) run `python3 tools/split_pchar.py` and bump `CH_V` in `public/game.js`.
- Room interiors are laid out in slots in declaration order; buildings added later use `late` (1, 2, …) so existing rooms keep their place.

## How to work with this user (save tokens, keep quality)
- Reply in short, plain Thai: the answer first, then at most 3–5 bullets. No jargon; if a command is needed, give it in one block with one line saying what it does.
- Don't ask before small, obvious fixes: just do them, test, commit, push, then report in a few lines.
- Read code narrowly: `grep -n` for the spot, then `sed -n` a small range. Never read all of `public/game.js` or `server/index.js` (thousands of lines).
- The user uploads files through the GitHub web page: `git pull` first every session.
- Before saying something is missing, check the code and `NEWS` — it may already be done.
- Live site is fly.io app `newlifetownth`; it only updates when someone runs `fly deploy`. Player data must stay on the volume (`/data`) or in Postgres.
- Model hint: at the start of a task, if it clearly fits a cheaper or stronger model, say so in one Thai line
  (Haiku = text/number tweaks; Sonnet = normal updates; Opus = big client+server features, lag, hard bugs, player data; Fable = only when Opus got stuck).
- Skills are chosen automatically: the user will just describe the job in Thai, never type `/...`. Pick the matching skill yourself
  (แก้/เพิ่ม/ปรับ → update; บั๊ก/กระตุก/ค้าง → fix; ชุดใหม่ → outfit; ตรวจ → check; รีวิว → review; ขึ้นเว็บ/deploy → deploy)
  and mention which one you used in a few words. After code changes, run check on your own before reporting done.
