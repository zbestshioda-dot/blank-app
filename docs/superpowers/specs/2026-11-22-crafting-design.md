# Crafting v1 (โรงช่างคราฟ) — design

**Why:** players grind money for houses and show off (gem buys = rare visible aura pets/cars). Crafting gives craft-only
furniture the shop never sells, so homes are never "done" and free players have something rare to chase.

**Decided by user:** furniture/garden decor only · crafted at a town workshop (no house needed) · inputs = existing
fish/crops + new dropped materials · legend tier needs a gem shard (💎 or fishing-contest prize) · no player trading.
Gems buy speed/sparkle, never the only path.

**Non-goals:** outfits/auras/tools, new maps, trading, new art pipeline (placeholder sprites until AI art arrives).

**Design (my calls):**
- Materials (ITEMS kind `mat`, category 🧰): wood 🪵, cloth 🧵, shell 🐚, crystal 💠 (rare), gshard 💎 (no drop, `nosell`).
- Drops ride the existing `stat()` hook: `fish`, `harvest`, `shifts` keys roll `D.MAT_DROPS`.
- `D.CRAFTS`: 6 recipes → new furniture flagged `craft: 1` (hidden from shops, refused by shop buy). Legend piece has `glow`.
- Logic in new pure module `server/craft.js` (testable without ws/pg).
- Workshop: outdoor station `type: 'craft'` at town (66, 45.6) with the existing `x_wbench` sprite.
- Gem shard: 💎20 each at the workshop; fishing contest top 3 also mail 3/2/1 shards.
- Crafted piece → `a.furniture` if the player owns a home, else `a.keep` (placeable once they buy one).
