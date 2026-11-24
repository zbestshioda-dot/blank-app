---
name: idea
description: Come up with bold, fun, buildable ideas for เมืองชีวิตนี้เลือกได้ (new systems, events, money sinks, retention hooks, story twists), grounded in the game's real numbers and what already exists. Use when the user says "คิดไอเดีย", "มีไอเดียอะไร", "ควรเพิ่มอะไรดี", "ทำยังไงให้คนเล่นนาน", "เงินเฟ้อ", or asks for ideas.
---

# Think up ideas that are worth building

Goal: a few ideas that players would actually talk about, that fit this game, and that can be built in one or two updates.

## 1. Ground it (cheap, 2–4 greps)
- What exists already: `grep -n` the topic in `server/data.js`, `server/index.js`, and the `NEWS` list in `public/game.js`. Never propose something that is already in the game; build on it instead.
- Real numbers when money is involved: prices (`HOME_TIERS`, `VEHICLES`, `FURNITURE`, `LUX_TITLES`), income (job pay, missions, story pay, login bonus), sinks (`taxOf`, fuel, rent/bills). Estimate how much a daily player earns per day.
- Players: if the admin stats are known (D1/D7 retention, online by hour, what systems people use), use them.

## 2. Think like the players (Thai mobile players, casual, social)
Pull from these levers; the best ideas hit two or three at once:
- **Status you can show**: name tag colour, title, plate number, a building with your name on it, a top-10 board.
- **Scarcity**: only N exist in the whole town; weekly auctions; first come.
- **Together**: the whole town works toward one goal; gangs/friends compete; gifts.
- **Story**: tie into the townsfolk stories and the bus-99 mystery; reveal something.
- **Coming back tomorrow**: daily/weekly rhythm, something that grows while you are away.
- **Thai flavour**: lucky numbers, festivals, merit, markets, ทะเบียนสวย, ตลาดนัด.
Avoid: pure punishment (wealth tax that only takes), pay-to-win over other players, anything that needs new art the user cannot make quickly (say so if art is needed, and give the prompt).

## 3. Answer (short Thai, no jargon)
- 5–7 ideas, ranked. For each: **ชื่อ** · ทำอะไร (1 line) · ทำไมสนุก (1 line) · ผลกับเงิน/คนเล่น (a rough number) · งานที่ต้องทำ (เล็ก/กลาง/ใหญ่, ต้องมีรูปไหม).
- Mark 1–2 as **โหด** (bold, surprising) and keep at least one that is small and quick.
- End with one recommendation ("แนะนำทำ X ก่อน เพราะ...") and ask which to build. Do not build until the user picks.
