---
name: fix
description: Fix a bug in เมืองชีวิตนี้เลือกได้ (กระตุก, ค้าง, กดแล้วไม่ทำงาน, ข้อมูลผู้เล่นผิด) by finding the root cause before editing. Use when the user reports something broken.
---

# Fix a bug (root cause first, minimum tokens)

1. `git pull -q`. Restate the symptom in one line (who/where/when).
2. Find the cause, don't guess:
   - `grep -n` the Thai UI text, function name or API route from the symptom (`public/game.js`, `server/*.js`), then `sed -n` ≤60 lines around it.
   - Follow the data: client sends → server handles → saved (`server/store.js`, Postgres/`/data`) → client shows. Check each hop only as far as needed.
   - If it only happens in the browser, reproduce with Playwright (see /check for how to start the server).
3. Fix the cause with the smallest edit. If 2 attempts fail, stop and tell the user what was ruled out; don't pile up patches.
4. Never "fix" by deleting player data, skipping a check, or hiding an error.
5. Then run the /update routine from step 4 on (NEWS line, syntax check, commit, push).
6. Reply in Thai: สาเหตุ 1 บรรทัด + แก้อะไร ≤3 bullets. If the fix touches player data/saves, say so explicitly.
