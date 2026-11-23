# First Ten Minutes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Newcomers get a calm, learn-by-doing first session that ends with something waiting tomorrow, so day-1 return rises from 6% to 15%+.

**Architecture:** All newcomer rules (who is a v2 newcomer, event log, egg, day-2 gift, first-fish guarantee, funnel stats) live in a new pure module `server/newbie.js` with its own test file, wired into `server/index.js`. The client (`public/game.js`, `public/style.css`) only displays: a quiet-mode helper, progressive HUD, hints, cards. Ship and measure phase by phase: 0 → 4 → 1 → 2 → 3.

**Tech Stack:** Node ≥18 (plain JS, `node:assert/strict`, tests run as `node server/<x>.test.js` like `server/homes.test.js`), vanilla browser JS + canvas, Playwright (pre-installed) for screen checks.

**Spec:** `docs/superpowers/specs/2026-11-23-first-ten-minutes-design.md`

## Global Constraints

- Only accounts created after release are affected: `a.nb.v === 2`. Accounts with older `a.nb` (since 22/11) and all older players see no change.
- The server decides every reward and every "day"; the day is `dayKey()` (Thai calendar day, UTC+7), never the phone clock.
- Day-2 gift: ฿500 + `bento` ×2, no gems; given once on the first login on any Thai day after the signup day; path completion not required.
- Egg: given when steps 0, 1, 2 (rod, 3 fish, sell) are all done, in any order; stored as `a.nb.egg = { d: dayKey() }`, not an inventory item; hatches on the first Thai day after `d` (on login or within a minute while online); 💎10 at 6/6 stays.
- First-fish guarantee: first catch only of a v2 newcomer; common non-junk fish; cast still costs ฿8.
- Never lock walking; hidden buttons only ever come back (on their step, its completion, `nb.done`, or after the signup day).
- Copy: short, friendly Thai. Every release adds a Thai line at the top of `NEWS` in `public/game.js`, runs the `check` skill, then commit + push to `claude/career-choice-multiplayer-game-jk4pzj`. `git pull` before starting.
- Read narrowly (`grep -n` + `sed -n`); never read whole `public/game.js` / `server/index.js`.

## Review Focus

1. **Online across Thai midnight** → the egg hatches and the day-2 gift arrives within a minute, no relog needed. (Task 2: `tick` test.)
2. **Steps done out of order** (chat or emoji first) → egg still given once when 0–2 are all done; a button whose step is already done is visible even if an earlier step is current. (Task 2 `egg out of order`; Task 4 `hudVisible` test.)
3. **Pre-release newcomer (v1, mid-path)** → no egg, no gift, no hidden buttons, old end reward. (Task 2 `v1 untouched`; Task 4 `v1 sees all`.)
4. **Re-login the same day after 6/6** → client still gets `nb` (badge + egg slot), quest box shows daily quests, not the starter list. (Task 2 `nbView keeps day 1`; Task 3 screen check.)
5. **Wrong phone clock** → countdown uses server time (`Date.now() + clockOff`); hatch is server-only. (Task 3 step.)

---

### Task 1: Phase 0 — newcomer event log and funnel

**Files:**
- Create: `server/newbie.js`, `server/newbie.test.js`
- Modify: `server/index.js` (account creation ~5181; `nbEv` ~1606; movement handler; `giveCatch` ~4496; message switch for `nbev`; `adminStats` ~756–790), `public/game.js` (`asExtra`; `endTut` ~9056; `talkTo` ~5184)

**Interfaces:**
- Produces (`server/newbie.js`, CommonJS):
  - `NBV = 2`
  - `start(t: number) -> { p: [], t0: t, v: 2, ev: {} }`
  - `isV2(a) -> boolean` — `!!a?.nb && a.nb.v === 2`
  - `CLIENT_EV = ['tut', 'talk', 'card']`, `SERVER_EV = ['move', 'fish1', 'egg', 'day2', 's0'..'s5']`
  - `mark(a, key: string, t: number) -> boolean` — records first time only, v2 only, key must be in either list; returns true if recorded
  - `funnel(list: Account[], dayKeyOf: (t) => string) -> { n, rows: [label, count][], back: number }` — over v2 accounts; rows in order: สมัคร, ปิดบทสอน, เดินครั้งแรก, คุย NPC, step 1..6, ได้ไข่, กลับมาวันที่ 2 (`back` = accounts whose `seen` has a day after signup day)

- [ ] **Step 1: Write failing tests in `server/newbie.test.js`** (same `T(name, fn)` helper style as `server/homes.test.js`)
  - `start: v2 shape` → `deepEqual(start(5), { p: [], t0: 5, v: 2, ev: {} })`
  - `mark: first time only` → `mark(a,'move',10)===true`, `mark(a,'move',20)===false`, `a.nb.ev.move===10`
  - `mark: rejects unknown key and v1` → `mark(a,'xyz',1)===false`; `mark({nb:{p:[]}},'move',1)===false`
  - `funnel: counts in order` → 3 v2 accounts (ev tut on 2, move on 1) + 1 v1 → `n===3`, row ปิดบทสอน `2`, เดินครั้งแรก `1`
- [ ] **Step 2: Run `node server/newbie.test.js`** → FAIL (`Cannot find module './newbie'`)
- [ ] **Step 3: Implement `server/newbie.js`** with the interfaces above (pure, no requires)
- [ ] **Step 4: Run `node server/newbie.test.js`** → all `ok`
- [ ] **Step 5: Wire the server**
  - account creation: `a.nb = NBM.start(now())` (`const NBM = require('./newbie')` near `HM`)
  - `nbEv`: when step `i` completes → `NBM.mark(a, 's' + i, now())`
  - first accepted movement of a v2 newcomer → `mark(a,'move')`; `giveCatch` → `mark(a,'fish1')`
  - new message `case 'nbev'`: `if (NBM.CLIENT_EV.includes(m.k)) NBM.mark(a, m.k, now())`
  - `adminStats`: `S.ftue = NBM.funnel([...accounts.values()].filter(real players), t => dayKeyAt(t))`, where `dayKeyAt(t)` is `dayKey()` generalised to a timestamp
- [ ] **Step 6: Client sends `nbev`** — `endTut` → `send({t:'nbev',k:'tut'})`; `talkTo` (any staff) → `{k:'talk'}`; guard both with `me.nb?.v === 2`
- [ ] **Step 7: `asExtra` renders `S.ftue`** as a second bar block "🧭 มือใหม่รุ่นใหม่ (v2): ทีละขั้น" using the existing `bar()` helper, % of `S.ftue.n`, plus "กลับมาวันที่ 2: back/n"
- [ ] **Step 8: Verify** — `node server/newbie.test.js` all ok; `node --check` both files; `check` skill (server boots, page loads, no console errors); new account via the Playwright helper in `/tmp/claude-0/pt2/lib.js` gets `nb.v===2` (`window.__lt.me.nb` is null until Task 2 widens the payload — check server-side with a scratch-copy log instead)
- [ ] **Step 9: NEWS + commit** — NEWS: none (admin-only change). `git commit -m "Newcomer v2: event log and funnel stats"`

### Task 2: Phase 4 (server) — egg tomorrow, day-2 gift, wider `nb` payload

**Files:** Modify `server/newbie.js`, `server/newbie.test.js`, `server/index.js` (`hatchEgg` ~672, `NB_END`/`nbEv` ~1605, `dailyLogin` ~5330, `refTick` ~792, me payload ~5051)

**Interfaces:**
- Consumes: Task 1 `isV2`, `mark`
- Produces (`server/newbie.js`):
  - `eggDue(a) -> boolean` — v2, no `nb.egg`, `p[0]>=1 && p[1]>=3 && p[2]>=1`
  - `eggReady(a, day: string) -> boolean` — `nb.egg && !nb.egg.h && day > nb.egg.d`
  - `giftDue(a, day: string, signupDay: string) -> boolean` — v2, no `nb.g2`, `day > signupDay`
  - `GIFT2 = { money: 500, items: { bento: 2 } }`
  - `view(a, day: string, signupDay: string) -> null | { p, t0, v, done, egg, g2 }` — non-null while `!done || day === signupDay || (egg && !egg.h)`; v1 keeps today's shape `{ p }` while `!done`
- Produces (`server/index.js`): `givePet(a) -> petId | null` (the roll + add from `hatchEgg`, which now calls it); `nbDaily(a)` — runs egg hatch + day-2 gift checks, called from login and from `refTick`

- [ ] **Step 1: Failing tests**
  - `egg: needs steps 0-2` → p `[1,3,0]` false; `[1,3,1]` true
  - `egg out of order` → p `[1,3,1,0,0,0]` with chat undone still true; after `a.nb.egg={d:'2026-11-23'}` → false
  - `eggReady: next Thai day only` → d `'2026-11-23'`: day `'2026-11-23'` false, `'2026-11-24'` true, after `egg.h` set false
  - `gift2: once, any later day` → signup `'2026-11-23'`: `'2026-11-23'` false, `'2026-11-27'` true, after `nb.g2` set false
  - `v1 untouched` → `{nb:{p:[1,3,1]}}`: `eggDue` false, `giftDue` false, `view` = `{ p }`
  - `nbView keeps day 1` → v2 with `done` set, day = signup day → non-null; next day, egg hatched → null
  - `tick` → simulate: egg given 23rd, call `eggReady(a,'2026-11-24')` true (the wiring test is Step 6's screen check)
- [ ] **Step 2: `node server/newbie.test.js`** → new tests FAIL
- [ ] **Step 3: Implement** the five functions
- [ ] **Step 4: `node server/newbie.test.js`** → all ok
- [ ] **Step 5: Wire**
  - `nbEv` after progress: `if (NBM.eggDue(a)) { a.nb.egg = { d: dayKey() }; NBM.mark(a,'egg',now()); send(a,{ t:'nbegg', tmr: <loginReward for streak+1 from dailyLogin's table> }); }`
  - v2 at 6/6: give 💎10 only (no `petegg` item); v1 keeps `NB_END` as is
  - `nbDaily(a)`: `eggReady` → `a.nb.egg.h = dayKey(); const id = givePet(a); send(a,{t:'hatch', id})` (reuses the client's existing hatch card); `giftDue` → `a.nb.g2 = dayKey(); NBM.mark(a,'day2'); sysMail(a, '🎁 ยินดีต้อนรับกลับมาวันที่ 2! ...', NBM.GIFT2)`
  - call `nbDaily` after `dailyLogin(a)` in login and per online player in `refTick`
  - me payload: `nb: NBM.view(a, dayKey(), dayKeyAt(a.nb.t0))` (null-safe for no `nb`)
- [ ] **Step 6: Verify** — tests ok; scratch copy of the server (`/tmp/claude-0/srv`) with a fake v2 account (steps 0–2 done, `egg.d` = yesterday) logs a hatch and a gift mail on login; online-past-midnight path: same account online, change `egg.d`, wait one `refTick` (60 s) → hatch
- [ ] **Step 7: Commit** (released together with Task 3)

### Task 3: Phase 4 (client) — tomorrow card, badge, egg slot

**Files:** Modify `public/game.js` (`case 'nbegg'` new; status chips ~1110; bag panel `homeNote` area; every `me.nb` use: 1063, 1072, 5416, 9047, 9059), `public/style.css`

**Interfaces:**
- Consumes: Task 2 `nb` payload `{ p, t0, v, done, egg, g2 }`, message `{ t:'nbegg', tmr }`
- Produces: `nbActive() -> boolean` (`!!me?.nb && !me.nb.done`) — replaces "starter list is running" checks; `nbDay1() -> boolean` (`me?.nb?.v === 2`) — "newcomer quiet period" used by Tasks 4–6; `nextThaiMidnight() -> ms` (server time via `clockOff`)

- [ ] **Step 1: Replace `me.nb` checks** at the five call sites with `nbActive()` (behaviour unchanged for v1 and for unfinished v2)
- [ ] **Step 2: Tomorrow card** on `nbegg` (once): 🌙 "พรุ่งนี้รอคุณอยู่" — 🥚 ไข่ฟัก · 🎁 ของขวัญวันที่ 2 · 💰 โบนัสเข้าเกม `money(m.tmr)`; button "โอเค!"; on close `send({t:'nbev',k:'card'})`
- [ ] **Step 3: Badge chip** while `nbDay1() && me.nb.egg && !me.nb.egg.h`: `🌙 พรุ่งนี้: 🥚 + 🎁` tap → reopens the card
- [ ] **Step 4: Egg slot in the bag** (top of the grid, same `homeNote` row style): "🥚 ไข่รอฟัก · ฟักพรุ่งนี้ (อีก H:MM)" counting to `nextThaiMidnight()`
- [ ] **Step 5: Screen check** (Playwright, iPhone 12, scratch server with a fake v2 account at steps 0–2): card appears once, badge shows, bag slot counts down; after 6/6 and relog the same day the quest box shows daily quests and the badge stays (Review Focus 4); set the page clock wrong (`page.clock` or override `Date.now`) → countdown unchanged (Review Focus 5)
- [ ] **Step 6: NEWS** "🥚 มือใหม่: ทำภารกิจ 3 ขั้นแรกได้ไข่ที่ฟักพรุ่งนี้ + ของขวัญวันที่ 2" → `check` skill → commit + push → tell user to `fly deploy`

### Task 4: Phase 1 — quiet mode and progressive HUD

**Files:** Modify `public/game.js` (`toast` ~964; `lkBanner` ~5818; `payBanner` ~5835; `checkNews` ~7082; ev7 auto-toast ~4685; tip at ~5174; `paintMe`/HUD refresh), `public/style.css`; `server/index.js` login tip toast ~5217 (skip for v2)

**Interfaces:**
- Consumes: Task 3 `nbDay1()`, `nbActive()`
- Produces: `nbQuiet() -> boolean` (`nbDay1() && nbActive()`); `NB_HUD` table; `hudVisible(id, p, done) -> boolean`

`NB_HUD` (button id → step index whose turn or completion reveals it; `'end'` = only after `nb.done` / signup day over):
`runBtn: 0` (after rod), `restBtn: 1`, `cbOpen: 3`, `emoBtn: 5`, `talkBtn: 0`, `ev7Btn: 'end'`, `lkBtn: 'end'`, `topupBtn: 'end'`, `eventBar: 'end'`. Always visible: joystick, `actBtn`, `bagBtn`, `phoneBtn`, quest box, minimap. A step index reveals when `index <= currentStep || p[index] done`.

- [ ] **Step 1: Pure check** — put `hudVisible` in a tiny block that Node can `eval` (same trick used to test `asExtra`): tests `hudVisible('emoBtn',[1,0,0,0,0,1],false)===true` (step 5 done while step 1 current — Review Focus 2), `hudVisible('emoBtn',[1],false)===false`, `hudVisible('ev7Btn',[1,3,1,1,1,1],true)===true`, and v1 (`nbDay1()` false) → every id visible (Review Focus 3)
- [ ] **Step 2: Apply** — on every me refresh, toggle class `nbHide` per `NB_HUD`; a button newly revealed gets class `nbNew` (one glow, 2 s) and one toast naming it
- [ ] **Step 3: Quiet popups** — `lkBanner`, `payBanner`, `checkNews`, ev7 auto-toast, the "ยังไม่มีเงิน?" tips: `if (nbQuiet()) return` (they re-check later on their own timers); server login tip skipped for v2
- [ ] **Step 4: One toast at a time** — while `nbQuiet()`, `toast()` queues: show one, next after it fades; identical text already queued is dropped
- [ ] **Step 5: Screen check** — new account (iPhone 12): only joystick, act, bag, phone, quest box, minimap; buy rod → วิ่ง appears with glow; old account unchanged (log in with a pre-existing test account)
- [ ] **Step 6: NEWS** "🧘 มือใหม่: จอเริ่มต้นสะอาดขึ้น ปุ่มค่อยๆ โผล่ตามภารกิจ" → `check` → commit + push

### Task 5: Phase 2 — learn by doing, one-tap rod, first fish guaranteed

**Files:** Modify `server/newbie.js` + test, `server/index.js` (`pier.cast` ~3361, `pier.reel` ~3370, `pier.land`/`pier.lose` ~3380–3388, cast tick ~6288), `public/game.js` (`TUT`/`showTut`/`endTut` ~9038–9062; settings replay; `talkTo` ~5184; `#stick`; `actBtn`; bite/hooked handlers), `public/style.css`

**Interfaces:**
- Consumes: Task 3 `nbDay1()`; Task 1 `mark`
- Produces (`server/newbie.js`): `firstFish(a) -> boolean` (v2 && `!a.nb.f1`); `pickFirst(table: [id|null, weight][], items) -> id` (highest-weight non-null with `rar` 1)

- [ ] **Step 1: Failing tests** — `firstFish` true for fresh v2, false after `nb.f1=1`, false for v1; `pickFirst([[null,50],['a',30],['b',40]], {a:{rar:1},b:{rar:2}})==='a'`
- [ ] **Step 2: Run** → FAIL; **Step 3: Implement**; **Step 4: Run** → ok
- [ ] **Step 5: Server guarantee** while `firstFish(a)`: `pier.cast` bite in 2–3 s and `win` ×3; `pier.reel` fish = `pickFirst(D.FISH[pool], D.ITEMS)`; tick: an expired bite re-arms (`expire = t + win`) with toast "ทุ่นจมอยู่! กดปุ่มใหญ่เลย" instead of losing; `pier.land` too early and `pier.lose` → `giveCatch`; on catch set `a.nb.f1 = 1`
- [ ] **Step 6: One-card tutorial** for `nbDay1()`: single 👋 card "ยินดีต้อนรับสู่เมือง!" + "🚀 เริ่มเลย"; the 4-slide `TUT` stays for v1 and for ⚙️ replay
- [ ] **Step 7: Hints** — `#stick` gets `nbHint` (pulse + "ลากตรงนี้เพื่อเดิน") until the first joystick move; `actBtn` gets `nbGlow` the first time a station is in reach, cleared on press; fishing (first fish only): toasts on cast "รอทุ่นจม…", on bite "ทุ่นจม! กดปุ่มใหญ่เลย", on hooked "กดค้างให้อยู่ในแถบเขียว"
- [ ] **Step 8: One-tap rod** — `talkTo` for the fishing staff when `nbDay1() && !me.rod`: choices `[{ label: '🎣 ซื้อเบ็ดแรก ฿150', fn: () => { dialogClose(); send({ t:'act', st, a:'rod', rod:'bamboo' }); }, cls:'primary' }, '💬 คุยต่อ', '👋 ลาก่อน']`; after the rod arrives the guide moves to the next step's `go`
- [ ] **Step 9: Screen check** — new account: walk hint shows then clears; one tap buys the rod; first cast always lands a fish even when pressing late or early (try both); second cast is normal
- [ ] **Step 10: NEWS** "🎣 มือใหม่: สอนตอนเล่นจริง ซื้อเบ็ดแตะเดียว ปลาตัวแรกได้แน่" → `check` → commit + push

### Task 6: Phase 3 — celebration moments

**Files:** Modify `public/game.js` (`case 'nbstep'` ~784; catch handler; `#meMoney` paint), `public/style.css`; `server/index.js` (`giveCatch`: send `{ t:'nbfish', id }` when the catch sets `nb.f1`)

**Interfaces:** Consumes Task 3 `nbDay1()`, Task 5 `nb.f1`

- [ ] **Step 1: Step card** on `nbstep` while `nbDay1()`: small card 1.5 s — step text, coins flying to `#meMoney`, bar `k/6`, sound `levelup` (existing)
- [ ] **Step 2: First fish** on `nbfish`: big fish icon centre screen "ตัวแรกในชีวิต!" once (reuse the hatch card style)
- [ ] **Step 3: First money** — when step index 2 completes, `#meMoney` counts up from old to new over 1 s
- [ ] **Step 4: Screen check** — run the starter path on a new account; each moment appears once and never covers the action button for more than 1.5 s
- [ ] **Step 5: NEWS** "🎉 มือใหม่: ฉลองทุกครั้งที่ทำภารกิจสำเร็จ" → `check` → commit + push

### After each release

Ask the user to `fly deploy`, then after 2–3 days compare 📊 "มือใหม่รุ่นใหม่ (v2)" rows and D1 for signups after the release with the 6% baseline before moving on.
