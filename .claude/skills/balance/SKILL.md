---
name: balance
description: Check and tune the game balance of เมืองชีวิตนี้เลือกได้ — level/XP curves, job pay per career, prices vs income, money sinks, inflation, time-to-goal. Uses the real numbers in the code, finds what is too fast/slow/strong/weak, and proposes exact new values. Use when the user says "สมดุล", "บาลานซ์", "balance", "เลเวลขึ้นเร็ว/ช้าไป", "อาชีพนี้ได้เงินเยอะไป", "ของแพง/ถูกไป", "เงินเฟ้อ", "เงินล้นเมือง".
---

# Balance the game with real numbers

Goal: find the 2–4 numbers that most hurt the fun, and give a precise fix for each. Never guess a number that is in the code.

## 1. Snapshot (one command)
`node tools/balance.js` — prints the job XP curve (actions to reach Lv N, pay multiplier), daily tax bands, login bonus, home/vehicle/lux-title/furniture price ladders. It reads formulas straight from `server/index.js` and `server/data.js`, so it stays correct after edits. If the script breaks after a refactor, fix its regex, don't hardcode.

## 2. Dig only where the question points (grep -n, then sed -n a small range)
- Job XP/pay: `xpNeed`, `xpGain`, `jobPay`, `JOB_MAX`, `addXp(` in `server/index.js`; office uses its own ladder (`OFFICE_TITLES`, 3 shifts per promotion).
- Income per career: `grep -n "credit(a\|a.money +=" server/index.js` near each job; missions in `server/missions.js`, `server/quests.js`; stories pay in `server/stories*.js`.
- Sinks: `taxOf`/`TAX`, `fuel(`, rent/bills, `HOME_TIERS`, `VEHICLES`, `FURNITURE`, `LUX_TITLES`, auction (`server/auction.js`), craft (`server/craft.js`).
- Daily economy swing: `econ()` (fuel ×0.85–1.15, “slow” days halve tax).
- Real player data (if the user has admin stats or pastes them): D1/D7, active per day, money held by top players. Never read `/data` or Postgres from here.

## 3. Model a typical player (write the math, keep it short)
- Pick 2–3 player types: ใหม่ (วันแรก), ขาประจำ (~1 ชม./วัน), ตัวตึง (4+ ชม./วัน).
- For each: actions per hour per career → baht/hour, XP/hour → days to Lv5/10/20, days to buy บ้านเล็ก / รถคันแรก / บ้านใหญ่.
- Targets that usually feel good: first real purchase on day 1–2; first house within ~1 week for a regular; Lv10 in ~1–2 weeks; top items are long goals (months) but not impossible; careers within ±25% baht/hour of each other at the same level (riskier ones may pay more).
- Run quick calcs with a throwaway `node -e` in the scratchpad, not in the repo.

## 4. Answer (short Thai, no jargon)
- ตารางเล็ก: อาชีพ/ระบบ · ได้ต่อชั่วโมง · ถึงเป้าใช้กี่วัน · ปัญหา.
- 2–4 จุดที่ควรแก้, each: ค่าเดิม → ค่าใหม่ · ไฟล์:บรรทัด · ผลที่คาด (ตัวเลข) · ผลกับผู้เล่นเดิม (เงิน/เลเวลที่มีอยู่ไม่ควรหายหรือพุ่ง).
- Prefer small steps (±10–30%) over big swings; never take money or levels away from existing players.
- Ask which to apply. When the user picks, ship it with the **update** skill (NEWS line, check, commit, push).
