---
name: check
description: Verify the game still works before saying done (syntax, server boot, page loads with no console errors, screenshot). Use after any non-trivial change, before commit.
---

# Check before claiming done

Run only what the change needs; report real results, never "should work".

1. Syntax: `node --check public/game.js && node --check server/index.js` (+ any other edited .js), and `node tools/news.test.js` (NEWS id must be new).
2. Server boots (scratch data dir, never `/data`):
   `PORT=3999 DATA_DIR=$(mktemp -d) timeout 40 node server/index.js > /tmp/s.log 2>&1 &` then `sleep 3; tail -5 /tmp/s.log`
3. Page loads with no errors (Playwright is pre-installed, `require('playwright')`):
   open `http://localhost:3999/`, collect `pageerror` and console errors for ~6 s, screenshot at deviceScaleFactor 1.
   Look at the screenshot only if the change is visual.
4. For gameplay changes: `node tools/play.js [--set key=val,...] [--phone] --out <scratch>/shot.png` (boots on a scratch dir, makes a test account, clears anti-bot + tutorial, screenshots, prints errors). Script game messages over `ws` for server-side checks.
5. Kill the server. Report: ผ่าน/ไม่ผ่าน + errors verbatim (if any). If something wasn't tested (e.g. real multiplayer), say so.
