# Notes for Claude

- Every time you ship an update to the game, add a short Thai summary entry at the top of `NEWS` in `public/game.js`
  (new `v` id + date + one line per change). Players see it once after the update, and under ⚙️ → 🆕 อัปเดต.
- Room interiors are laid out in slots in declaration order; buildings added later use `late` (1, 2, …) so existing rooms keep their place.
