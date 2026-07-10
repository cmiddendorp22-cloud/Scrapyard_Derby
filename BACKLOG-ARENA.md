# Scrapyard Arena — Backlog (OPEN items only)

**Completed work is recorded in CLAUDE.md's changelog — finished items are
deleted from this file (user rule, 2026-07-10).**

**Core pillar / identity:** *Build your car from the parts you tear off your
enemies.* Your loadout is a set of SLOTS filled with parts scavenged from
wrecks/crates. Combat is about tearing off the specific parts you want (and
protecting your own).

## Locked design decisions (current state)

- **Multiplayer:** BOTS FIRST, netcode later. Client-only, deterministic RNG +
  fixed timestep keep the sim netcode-friendly.
- **Match format:** PERSISTENT WORLD; spawn/die/respawn, no match end.
- **Death:** respawn keeps 10% of total XP; build resets (fresh commons +
  stat-point refund for the reduced level). Softened later by the
  META-PROGRESSION HEAD-START (below).
- **Slots:** tires / engine / ONE weapon / armor (armor unlocks @L5). The dual
  primary/secondary weapon model was built then retired (2026-07-10, user:
  "easier; might change it back") — `weapon2` stays dormant in code.
- **Stats:** health / speed / reload / regen (durability was removed; ARMOR
  covers damage reduction). 1 point per level, cap 10 each.
- **Weapons:** cannon, shotgun, minelayer (mines + right-click HOOK), ram
  (hold-to-charge boost), and the LOOT-ONLY railgun (no charge — a piercing
  full-damage slug on FIRE with a long reload; found in crates/boss drops).

---

## Open items (roughly by priority)

### Gameplay / the signature pillar

1. **DISMEMBERMENT BEYOND WHEELS** — wheels shipped (4 per car, closest-wheel
   chips, mend out of combat). Still open: shooting WEAPONS/ENGINE/ARMOR off a
   car and re-looting them — the original "shoot their cannon off" chain-of-
   custody fantasy. Decide whether torn parts drop live or stay-broken like
   wheels. Extend only if wheels prove fun in playtests.
2. **MORE WEAPONS** — each needs: player behavior (both platforms), bot AI,
   `drawWeaponGear`, tier scaling, loot integration. Idea seeds:
   • FLAMETHROWER — short cone, continuous damage + brief burn DOT.
   • GATLING / MINIGUN — spin-up, high fire rate, low per-shot (weak clashes).
   • FLAK / MORTAR — lobbed arcing AoE shell; pairs with minelayer zoning.
   • SHIELD / DEFLECTOR — defensive slot (frontal block / brief bubble).
   • TESLA / CHAIN-ARC — short-range chain lightning, anti-swarm.
   Deferred: "tier adds clash strength" (higher-tier guns win bullet duels).
3. **ROAMING EVENTS** — periodic announced convergence spots: "scrap storm"
   (scrap + part drops rain at a marked spot) and/or a supply-drop mega-crate.
   Was next in the Q&A tour when paused (2026-07-10).
4. **MORE BOSSES** — Titan + Magnet alternate today (both just got extra
   attacks). Seeds: THE CRUSHER (swinging tethered wrecking ball), THE GUNSHIP
   (glass-cannon barrage), THE SWARM QUEEN (spawns drone adds), THE RECYCLER
   (environmental hazard you survive, not kill). Per boss: distinct mechanic,
   drop tier, minimap marker, whether bots swarm it.
5. **MINELAYER BOTS FEEL NEWER / MISS MORE (user)** — give minelayer bots a
   rookie persona band: wider `aimErr`, less `lead`, sloppier throttle/steer,
   slower reactions. Still dangerous via mines/hook, just visibly greener.
6. **Bots coordinate mines-first-then-hook** — lay a field, THEN drag you in.
7. **Part tiers carry the source car's quality (open idea)** — killing a
   high-level car drops better gear; pairs with the leader bounty.
7b. **POTENTIAL ITEM SET COMBINATIONS (user)** — bonus effects for wearing
   matching/combinable parts (e.g. all-same-tier loadout, or themed sets like
   "full uncommon = +5% speed", weapon+tires pairings with a perk). Decide:
   what counts as a set, bonus sizes, how the UI shows an active set.
8. **PARTS BREAK OVER TIME (idea, user queue)** — overlaps dismemberment;
   decide when that's designed.

### AI / social

9. **Bots hunt the BOUNTY** — bots don't read the leaderboard yet; let some
   personas divert to the leader's gold sector.
10. **Bots react to their own NEMESIS** — nemesis/revenge is player-only today.
11. **Spectate KILLER hand-off** — when the watched car is wrecked by a car
    (not the boss), auto-swap the camera to its killer (`lastHitBy`); fall back
    to next-living-bot if the killer is dead/boss/you.
12. **AI predictability leftovers (only if clumping returns)** — (b) periodic
    orbit-flip/juke timers, (d) target hysteresis.

### World / map

13. **TERRAIN THAT BLOCKS LINE OF SIGHT (user)** — walls/bushes for cover and
    hiding (bushes could conceal your car). Needs: rendering, collision or
    pass-through rules, bullet occlusion, bot awareness.
14. **Driving-game map features (deferred by design)** — ramps, pillars +
    destructible cover, oil slicks, speed strips, crushers. Revisit once the
    core loop is proven fun on the open field.
15. **World size + population tuning** — map dims vs bot count vs perf budget.
16. **Camera zoom** — fixed, or zoom OUT as you level/grow (diep.io style)?

### Meta / retention

17. **HEAD-START META-PROGRESSION + respawn screen** — persistent localStorage
    profile (day streak, lifetime games/score, ads watched);
    `startingXP = f(...)` HARD-CAPPED (~L5-8 of 30) so it softens the early
    grind, never buys dominance (P2W guardrail: never sell power). Respawn
    screen with run stats (level, kills, best parts, survival time).
18. **AUTOMATIC REVIVE (user)** — e.g. the death menu auto-respawns after a
    countdown (spectate/menu still selectable). Scope TBD with user.
19. **Monetization hooks** — rewarded ad → starting-XP head-start; optional ad
    to respawn once with your last build; cosmetic part skins. Never power.
20. **Global/cross-session leaderboard + killfeed** — waits on accounts;
    `ArenaGame.playerName` is the handle swap point.

### UI / UX

21. **DIFFERENT SCREEN SIZES AUDIT (user)** — fill-screen/fullscreen shipped;
    still open: extremes audit (tiny phones, big tablets, tall/narrow, hi-DPI,
    live resize) — no overlap/clipping, hit-target sizes hold up. Screenshot
    several sizes.
22. **UI SIZE + REPOSITION IN SETTINGS (user)** — UI scale slider + drag-to-
    move HUD elements (HP bar, minimap, leaderboard, stat panel, touch
    controls), persisted; needs a small anchoring system that survives resizes.
23. **BETTER MAIN-MENU SCREEN (user)** — polished title/mode buttons/layout,
    maybe background art or an animated arena preview. Strip em dashes from all
    UI copy (user preference: commas, colons, hyphens).
24. **Visible growth polish** — equipped looted parts rendering on the car
    is partial (weapon gear only); tires/engine/armor could show visually.
25. **Mobile live-loadout UX (open question)** — equipping loot in a world
    that never pauses without dying while menuing; leading idea: auto-equip
    into empty slots + non-blocking tap-chips.

### Big lifts (deferred)

26. **Real multiplayer / netcode** — authoritative server, humans + bot
    backfill. Biggest lift.
27. **BOT-ONLY GAMEMODE (user queue, skipped for now).**
28. **WEAK AUTOMATIC GUN (user queue, skipped for now).**
29. **RAM BOOST BREAKS PILES (user queue, skipped for now).**

## Known balance risks (revisit later)

- **Single-meta collapse:** every weapon needs a niche so the meta doesn't
  collapse onto the safest DPS pick. Minelayer has the hook (control), ram has
  frontal defense + charge, shotgun owns point-blank, railgun is the rare
  pierce sniper. Re-check whenever a weapon is added or retuned.

## Open design questions

- Slot-unlock schedule if more slots return (2nd weapon revival level?).
- XP economy numbers: XP per pile vs per kill; kills-per-level pacing.
- Head-start cap + exact streak/score/ads formula. (item 17)
- Persistence scope: localStorage only until accounts land? (items 17, 20)
