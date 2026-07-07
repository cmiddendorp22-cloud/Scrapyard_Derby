# Survival Gauntlet — Mode Backlog (+ shared game-wide infra)

The game has TWO modes, each with its OWN backlog file:
- **Survival Gauntlet** — round-based survival (the current game). THIS file.
  Also holds game-wide shared infra (io-ification, accounts, monetization)
  since it was built first.
- **Scrapyard Arena** — persistent diep.io-style FFA with modular loot-builds
  (no classes): `BACKLOG-ARENA.md`.

Goal: ship as an io-style browser game (single-player with shared-world
feel first; real multiplayer only if traction), then monetize via web game
portals (CrazyGames/Poki SDK) with rewarded ads, cosmetic IAP later.

## Roadmap (in order)

1. **Touch controls + mobile performance** — ✅ DONE
   - Virtual joystick (world direction + magnitude → car-like throttle/steer
     via Player.update; opposite-pull reverses), FIRE and DRIFT hold-buttons,
     on-screen pause. Shown only on touch devices (pointer:coarse or first
     touchstart → body.touch-mode). Landscape-locked with portrait
     auto-pause; full menu-readability + layout audit done. Device-feel and
     DPR/perf tuning fold into the ongoing polish pass, not a blocker.
2. **Seeded, deterministic runs** — ✅ CORE DONE
   - `js/rng.js` mulberry32 seeded RNG; sim randomness routed through
     `rand/randInt/pick` (settable `setSimRandom`), cosmetic through
     `fxRand/fxPick` (always Math.random, off the deterministic stream).
   - Fixed-timestep sim loop in main.js (STEP 1/60, accumulator) so physics
     no longer depends on display refresh rate.
   - `?seed=<hex|int>` locks a run (persists across restarts); seed shown on
     the game-over screen. Random seed per run otherwise.
   - Verified by determinism-test.js: same seed+inputs → byte-identical run;
     different seed/inputs diverge; cosmetic Math.random noise can't leak in.
   - Deferred (not needed yet, no design cost to add later): daily/date seed
     (user wants the daily challenge to be something else), input recording
     for ghost replays (foundation is in place).
3. **Identity + leaderboards** — name entry on start screen; local best
   score; then hosted global/daily boards (Cloudflare Workers or Supabase).
   Anti-cheat: validate submitted runs by replaying seeds server-side.
4. **"One more run" score screen** — death screen with rank, distance to
   next rank, shareable result card.
5. **Cosmetics system** — car skins (palette swaps via drawCar), tire-mark /
   drift-spark colors, death effects, horns. Unlock via play milestones
   first (groundwork for IAP). Persist in localStorage → accounts later.
6. **Session pacing pass** — target 3-8 min runs; visible score multiplier
   for risky play (no-repair streaks, near-misses).
7. **Bots-as-players (optional)** — named AI on killfeed/leaderboard for
   multiplayer feel before netcode.
8. **Portal SDK + monetization** — CrazyGames/Poki SDK; interstitials at
   intermission (round structure is the ad skeleton); rewarded video:
   revive-once-per-run, double-salvage round, free Repair Kit. Iron rule:
   never sell power.
9. **Cosmetic IAP** — accounts + Stripe, only after portal traffic proves
   demand.
10. **Real multiplayer (only if traction)** — authoritative Node/websockets
    server, server-side physics, client prediction, rooms. Biggest lift;
    requires rewriting the client-local game loop.
