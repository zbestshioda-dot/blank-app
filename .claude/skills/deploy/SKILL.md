---
name: deploy
description: Prepare a safe release of the game to fly.io (app newlifetownth) and give the user the exact command. Use when the user says "deploy", "อัปเดตเว็บจริง", "ขึ้นเว็บ".
---

# Deploy checklist

`fly` is not installed in the cloud session and only the user can deploy, so prepare and hand over the command.

1. `git pull -q`; make sure everything is committed and pushed on the working branch; say which branch the user must have checked out locally (`git pull` there first).
2. Run /check (syntax + boot + page load). Stop on any failure.
3. Confirm the latest `NEWS` entry matches what's shipping, and that no player data files or secrets are in the diff (`git diff origin/main --stat`).
4. Note anything risky for live data (save-format change, new DB column) and how it's migrated.
5. Reply in Thai with one block:
```
git pull
fly deploy
```
and one line: players get the update after it finishes (the build also minifies game.js). If server code changed, mention a brief restart.
