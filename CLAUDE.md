# Scrapyard Derby: Survival Gauntlet — Project Context

**MAINTENANCE RULE: update this file whenever a feature is added, changed, or
removed from the game. Every change session should end with a new entry in the
Changelog below and, if systems changed, an update to the relevant section.**

Long-term roadmap (io-game + monetization plan) lives in `BACKLOG.md` —
update item statuses there as they're built. A planned SECOND game mode
("Scrapyard Arena", persistent diep.io-style FFA — bots-first, level-to-30,
class evolutions) is speced in `BACKLOG-ARENA.md`. The current game is the
round-based "Survival Gauntlet" mode.

**PLATFORM RULE: every change must work on BOTH desktop (keyboard/mouse) and
mobile (touch). Mobile is ALWAYS LANDSCAPE — portrait shows a rotate
overlay, so design/test against a short viewport (~390 CSS px tall; the
`max-height: 500px` media block compacts all menus). Checklist for anything
new:**
- New keybind → must also have a touch path (DOM button or existing control)
- New UI → DOM buttons (tappable), ~44px minimum hit targets on touch
- Canvas HUD → check overlap with virtual controls (joystick bottom-left,
  FIRE/DRIFT bottom-right, pause button top area)
- No hover-only affordances without a non-hover fallback
- Keycap/key hints are hidden in touch-mode (`body.touch-mode .keycap`);
  never make a key the only way to discover a feature. For prose that differs
  per platform, use `.kbd-only` / `.touch-only` spans (CSS-swapped); inline
  key hints like "(R)" go in a `.kbd-only` span.
- Full-screen `.overlay` menus auto-hide the virtual controls
  (`:has(.overlay:not(.hidden))`); the intermission is a docked panel (NOT an
  overlay) so controls stay live for driving to scrap between rounds.
- Watch per-frame allocations/draw calls — low-end phones are the perf floor
- End every summary by flagging anything that couldn't be made equivalent on
  one of the two platforms.

## What this is

Top-down 2D vehicular survival game. HTML5 Canvas + vanilla JS, classic script
tags (no modules, no build, no dependencies). Runs by double-clicking
`index.html` (works from `file://`). Fixed 1280x720 world, static camera.

## Architecture

**TWO GAME MODES.** The original round-based "Survival Gauntlet" (`Game` in
game.js, the bulk of this doc) and a new persistent open-world FFA "Scrapyard
Arena" (`ArenaGame` in js/arena/, speced in BACKLOG-ARENA.md, foundation only
so far). main.js picks an `active` controller from the start-screen mode
buttons; both expose update(dt)/renderer.draw()/togglePause()/
handleOrientation()/begin() and share one Input + AudioSys. `readDrive()` in
input.js is the shared keyboard/joystick→car-controls helper both use.

Load order matters (classic scripts, see index.html):
`utils → rng → input → audio → particles → projectile → scrap → car →
player → enemy → waves → render → ui → upgrades → game →
arena/arena-render → arena/arena → main`

- `js/utils.js` — math helpers, `WORLD`, `pathRoundRect`; SIM rng helpers
  `rand/randInt/pick` (routed via `setSimRandom`) + COSMETIC `fxRand/fxPick`
- `js/rng.js` — `RNG` seeded PRNG (mulberry32) for deterministic runs
- `js/input.js` — keyboard + mouse state → throttle/steer/fire/handbrake getters
- `js/audio.js` — Web Audio synth (no assets): engine drone, tire screech, one-shot SFX
- `js/particles.js` — `Particles` (sparks/smoke/explosions) + `GroundDebris` (detached parts that persist on the floor)
- `js/entities/car.js` — base `Car`: drift physics (forward/lateral friction split) + component damage model. Player and enemies share `integrate()`
- `js/entities/player.js` — `PLAYER_COMPONENTS` (6 parts), damage routing with spillover, cannon, upgrade hooks (plating, patch, turret)
- `js/entities/enemy.js` — `ENEMY_BASE` stat table + one AI state machine per archetype
- `js/waves.js` — `RoundManager`: countdown → active (staggered spawn queue) → intermission; per-round scaling knobs live in `spawnOne`
- `js/render.js` — all drawing: pre-rendered floor, aged skid-mark segments (`SKID_LIFE` 20s, last 5s fade), cars w/ visible upgrades & damage, mines, screen shake
- `js/ui.js` — HUD (round, kills, time, salvage, enemies-left), component panel (schematic + per-part HP bars), banners, float texts
- `js/upgrades.js` — `UPGRADES` catalog + `Shop` DOM class (tabs, purchasability states)
- `js/game.js` — orchestrator: collisions, damage, mines, repair/harvest economy, salvage, buy/apply upgrades, round transitions, game over
- `js/main.js` — boot, canvas letterbox scaling, rAF loop, global keybinds

## Core systems (current behavior)

- **Physics**: velocity split into forward/lateral; lateral damped by `grip`,
  forward by `drag`. Grip fades when cornering hard at speed; handbrake
  (Space) craters it for drifts. Steering authority scales with speed
  (→ enemies have reverse-out unstick logic for wall wedges).
- **Player components** (6): frontBumper, rearBumper, leftWheels, rightWheels,
  engine, weapon. Side hits route to the matching part; destroyed parts spill
  inward at 1.5x (1.1x with Crash Frame). Damage effects are GRADUAL
  (`Car.damageFactor`, see changelog): from 50% health a part's penalty eases
  in to its broken value — wheels veer toward the worse side + fishtail (full
  by 20% when both fail), engine sputters → stalls, weapon reload stretches →
  can't fire, bumpers bleed hits through to the inner part. Death = all 6 at 0.
  Damage now bites EARLIER than before (from 50% health, not 0%), so a hurt
  car feels meaningfully worse — intentional. If it's too punishing, the dials
  are: the 50% onset + `t²` curve in `Car.damageFactor`, the 50→20% fishtail
  range (`fishL/fishR` in car.js), and each effect's magnitude constants.
- **Repair economy**: scrap piles + purchasable Repair Kits are the ONLY
  repair sources. Piles: drive over (30 HP/s) or SHOOT to harvest remotely
  (bullet damage x0.6 as repair); repairs target the lowest-HP% part and can
  revive dead parts. NO free repair between rounds. ZERO piles in round 1;
  1-3 random piles spawn per round clear (cap 8). Enemy fire destroys piles
  (Armored Scrap prevents that). Repair Kit (shop, Utility, repeatable):
  three heal options — 25/50/100% of missing HP — priced proportionally off
  the full quote `roundIncomeEstimate() * missingHpFrac * 3.2` (min 10; one
  badly hurt part ≈ half a round's income for the full fix; critical ≈ 2-3
  rounds'). ALWAYS buyable while damaged and salvage > 0: an option you
  can't cover (amber button) spends everything and heals pro-rata
  (`buyRepairKit(frac)`). Refused only when pristine or broke.
- **Rounds**: countdown (3s) → active (spawn queue, 1.1s stagger) → cleared
  when all enemies die → intermission (shop + Next Round button / N).
  Player is INVULNERABLE to wall/self-collision damage outside active rounds.
  Headcount: `min(1+floor((r-1)/2), 5)`. Every 5th round leads with a named
  elite (2.4x HP, faster).
- **Enemy scaling per round r**: hp `1+(r-1)*0.06`, speed
  `min(1+(r-1)*0.02, 1.35)`, damage (bullets/mines) `min(1+(r-1)*0.04, 1.8)`.
- **Enemy archetypes** (internal key / display name, unlock round in parens):
  rammer/RAMMER (1), circler/GUNNER (2), thief/SCRAP THIEF (3, eats scrap
  piles), minelayer/MINELAYER (4, proximity mines — shootable),
  splitter/HAULER (5, splits into 2-3 bikes/SWARMERS on death),
  shielded/BULLDOZER (6, frontal bullet-proof plow). Every 5th round is a
  BOSS round: HALF the usual headcount, led by a boss (4x hull, 4x damage
  out via `bossDmgMul` — collisions, bullets, and mines; drawn from
  rammer/circler, +shielded from r6; pays 30+2r salvage). `ENEMY_INFO` in enemy.js maps type →
  {name, color, tip}: display names, threat-grammar colors (red/orange =
  contact, blue/purple = ranged, gold = economy), and dossier/banner tips.
- **Enemy legibility**: first-encounter banner per type per run
  (`Game.noteEnemySeen`); FIELD GUIDE menu opened by a button on the pause
  screen (`openGuide`/`buildGuide` — cards with live-rendered car portraits
  via `Renderer.renderEnemyPortrait`; ESC backs out of guide → pause →
  resume); per-type chassis GEOMETRY in `Renderer.carBodyPath` (rammer
  tapered muscle car, bulldozer box, gunner oval, thief dart, minelayer
  chamfered flatbed, hauler cab+trailer, swarmer arrow — bumper bars are
  player-only now); distinct silhouettes (bulldozer short+wide with flashing
  shield, hauler biggest with hazard-striped cargo box + pre-split shudder/
  red pulse below 25% hull, minelayer long flatbed with visible mines +
  amber hatch blink before dropping, gunner turret barrel tracks its shots,
  thief lean with prongs that glow while eating, swarmers tiny with a stripe
  and no windshield). Bulldozer deflects go CLANK (`playClank`).
- **Salvage economy** (lean — one upgrade per ~2-3 rounds): per-kill payout
  `ceil((typeValue + round) * 0.5)`; elites 20+round; x1.5 with Salvage Rig.
  Round-clear bonus 8+2r. Spent in the intermission shop.
- **Player toughness**: ALL incoming player damage is multiplied 1.5x at the
  top of `Player.applyDamage` (glass-cannon tuning).
- **Friendly fire**: enemies collide with full physics but NEVER damage each
  other; only collisions involving the player deal damage.
- **Fault-based collision damage** (player-enemy): each car is hurt by the
  OTHER car's pre-impulse closing contribution along the collision normal,
  plus a 15% baseline (`dmg = total * (0.15 + 0.85 * otherShare)`). A rammer
  hitting a motionless player takes ~15% of the crash; the victim takes ~100%.
  Bumper Spikes multiply the enemy's share x1.5 after attribution.
- **Shop**: 15 upgrades in 4 tabbed categories (Durability/Mobility/Weapons/
  Utility). Cards show green=buyable / grayed+NEED-X-MORE=unaffordable /
  gold MAXED. Tabs glow gold when active, dot when something's affordable.
  Side SHOP button (keycap B) toggles the panel during intermission.
- **Controls**: WASD/arrows drive, Space handbrake, left-click/F fire,
  N/Enter next round, B shop, Esc pause, R restart (game over).

## Testing

Headless harnesses in the session scratchpad (not committed): stub
DOM/canvas/audio, load scripts via `vm`, drive `game.update()` directly.
- `smoke.js` — full simulated runs (AI driver hunts enemies, shops, repairs),
  asserts round progression, intermission contracts, death path, restart.
- `upgrades-test.js` — one mechanical assertion per shop upgrade.
- `repair-test.js` — scrap drive-over + harvest-by-shooting + intermission
  invulnerability.
- `determinism-test.js` — same seed + inputs → byte-identical run; different
  seed/inputs diverge; cosmetic Math.random noise can't leak into the sim.
  Run this after ANY change touching randomness or the update path.
- `arena-test.js` — Arena foundation: drives, camera follows + clamps to world
  bounds, stays inside walls, pauses.
- `arena-isolation-test.js` — constructing ArenaGame at boot (as main.js does,
  after Game) must NOT perturb the Gauntlet's seeded RNG stream; ArenaGame is
  self-deterministic per seed. Run after any change to Arena construction or
  the sim-RNG plumbing.
Always `node --check` every JS file after edits and re-run the harnesses.

**Visual/layout testing**: with `node serve.js` running, screenshot via the
wrapper (single `node` command = one permission rule) and Read the PNG:
`node tools/shot.js "http://localhost:8080/?touch=1&screen=shop" <out.png> 844 390`
(args: url, outPath, [width], [height], [vtb_ms]; it shells out to headless
Edge). `.claude/settings.json` allow-rules cover node/curl/Read + screenshots.
Preview URL params (dev hooks in main.js): `?touch=1` forces touch-mode;
`?screen=pause|intermission|shop|guide|options` jumps to a Gauntlet menu;
`?mode=arena` boots straight into Scrapyard Arena.
Use 1600x900 without `?touch` for desktop checks. ALWAYS screenshot both
viewports after UI/CSS changes — this caught the #intermission-button
cascade bug that text-only testing never would.

## Changelog

- **2026-07-03** — Initial build: drift physics, 6-component damage model,
  rammer+circler AI, timed waves, scrap repair, screen shake/particles/
  debris/synth audio, HUD, game over.
- **2026-07-03** — ESC pause; timed waves → discrete rounds with intermission
  + Next Round button; scrap respawn (+3/round, cap 13); real drift
  (cornering grip loss + handbrake) + tire screech; enemy wall-unstick AI.
- **2026-07-03** — Controls remap: fire = left-click/F, handbrake = Space.
- **2026-07-03** — Salvage economy + intermission shop with 15 upgrades
  (plating x3, spikes, crash frame, auto-welder, rally tires, drift master,
  rapid loader x2, heavy rounds x2, twin cannons, rear blaster, auto-turret,
  scrap magnet, salvage rig, emergency patch, armored scrap). Component
  panel rework: per-part HP bars with live max values. Welder cannot revive
  dead parts (would break the lose condition).
- **2026-07-03** — Shop UX: category tabs (gold active state + pointer
  notch), side SHOP button with B keycap, purchasability indicators
  (green/grayed+shortfall/gold-maxed), themed scrollbar.
- **2026-07-03** — Difficulty pass: removed intermission auto-repair (scrap
  piles now the only repair — drive over OR shoot to harvest); player immune
  to self-inflicted collision damage outside active rounds; enemy speed+damage
  scaling per round; 4 new enemy types (thief, minelayer, splitter+bikes,
  shielded rammer); mines are shootable; per-type salvage bounties.
  This context file created.
- **2026-07-03** — AI fix: pursuing enemies (rammer/shielded/splitter/bike)
  brake to turn when the target is >1 rad off their nose. Without it, the
  round-scaled enemy speeds nearly matching the player's created stable
  pursuit-circle stalemates (enemy orbiting away forever, all shots missing
  or hitting the shielded plow) — found via headless sim, reproduced in a
  duel harness, verified fixed (stalemated shielded kill went ∞ → 26s).
- **2026-07-03** — Skid/tire marks now expire: replaced the permanent
  offscreen marks canvas with aged segments (20s life, fading over the last
  5s), batched by fade level so drawing stays a handful of strokes.
- **2026-07-03** — AI smarts pass:
  - Circler aiming: lead factor 0.6 → 0.85; fire window tightened 170-520 →
    170-380; skips guaranteed-miss shots (fast-perpendicular target beyond
    280); denial shots — if the player is clearly driving at a scrap pile
    (velocity alignment > 0.92, pile within 350), the shell targets the pile.
  - Weak-side targeting: rammers/shielded curve their chase approach toward
    the player's most-damaged side (`weakestPlayerSide`).
  - Pack coordination: rammers never telegraph while a packmate telegraphs
    (staggered rams); circlers/minelayers spawn with alternating orbitDir.
  - Repair interruption: `game.playerRepairing` flag (set while parked on a
    pile) → rammers charge from 480 (vs 310) with a looser aim gate; circlers
    drop their fire cooldown to 0.25s.
  - Circler flees on time-to-contact (closing speed) instead of a fixed
    150px radius.
  - Enemies use the handbrake: rammer/shielded whip the nose around during
    ram recovery; bikes handbrake tight turns.
- **2026-07-03** — Acceleration-aware circler aim. Player tracks smoothed
  acceleration (0.15s EMA) + typical speed (1.5s EMA of speed). The gunner
  predicts travel using ONLY the along-track acceleration component (speed
  changes are bounded: 0..maxSpeed), trusted for tau=0.5s then regressing 50%
  toward the player's typical speed; perpendicular (turning) acceleration is
  ignored as unpredictable over 1-2s shell flights. Naive ½at² extrapolation
  was tried first and made accuracy WORSE (12% vs 39%) — documented so it
  isn't re-attempted. Verified via seeded paired trials vs a brake-drift
  evasion driver: 62.6% vs 34.1% hit rate (accuracy harness in scratchpad).
- **2026-07-03** — Wall avoidance for enemies: look-ahead steering
  (`Enemy.applyWallAvoidance`, project pos 0.55s ahead; blend steering toward
  the arena interior + brake when nosing straight in; skipped mid-ram so
  baiting rammers into walls stays viable). Circler/minelayer orbit targets
  clamped inside the arena. Stuck-recovery threshold 1.2s → 0.7s. Wall-stress
  harness: wall-contact time 27% → 14-18%, wedge events roughly halved.
  Side effect fixed: smoother enemy motion made stable shadow-orbits possible
  (player circling a circler at ~150px = zero closing speed = no flee, shots
  all miss) — added a crowding timer (`crowdT`: shadowed under 190px for
  1.2s forces a flee/reposition).
- **2026-07-03** — Circler firepower buffs (user request, two passes): bullet
  speed 175 → 340 → **500**, fire interval 2.8s → 1.5s → **0.9s** (named
  1.6 → 0.9 → **0.55s**), fire range extended to 520, lead factor 0.85 →
  0.92, miss-suppression thresholds relaxed for the short flight times.
  Final measurement vs the drift-evasion driver: ~290 hits per 24 sim-min
  (was ~108 pre-buff) — roughly 2.7x the landed-hit throughput. If human
  play finds it oppressive, gentlest dials: fire interval and range.
- **2026-07-03** — Fixed splitter/bike "moth orbit" vs a stationary player:
  at full throttle their turning circle never intersected a still target, so
  they circled forever. Close-range brake rule (splitter: d<200 & |aim|>0.45
  → throttle 0.3; bike: d<170 & |aim|>0.4 → 0.35) spirals the loop inward.
  Stationary harness: first contact 1.1s, 29 hits/45s (was: never).
- **2026-07-03** — Difficulty/economy overhaul (user request):
  - Enemy friendly-fire removed: enemy-vs-enemy collisions keep full physics
    (separation + impulse + sparks) but deal zero damage.
  - Player takes 1.5x ALL incoming damage.
  - Lean economy: kill payouts halved (`ceil((value+round)*0.5)`, elites
    20+round), clear bonus 15+5r → 8+2r. Target: one upgrade per 2-3 rounds.
  - Scrap scarcity: zero piles in round 1; 1-3 random piles per round clear,
    capped at 8 (was: 13 at start, +3/round to 13).
  - Repair Kit added to shop (repeatable, 30 salvage → 60 HP, "NO DAMAGE"
    lockout when pristine). Sim driver now dies rounds 5-6 (was: immortal).
  - Stuck-recovery now requires being near a wall (`nearWall()`) so the
    brake-to-connect behaviors don't trigger phantom mid-arena reverse-outs.
    Avoidance brake floor must stay ABOVE the 0.2 stuck-throttle threshold
    (tested at 0.2: enemies crawl walls with no recovery, contact doubles).
- **2026-07-03** — Fault-based collision damage: symmetric crash damage
  replaced with attribution by pre-impulse closing contribution (15%
  baseline + 85% by the other car's share). Enemy ramming a parked player:
  enemy ~8.9 dmg vs player ~59.4 (verified). Also means the player ramming a
  parked enemy is now a cheap attack; head-on trades deal ~57% each instead
  of 100/100. Spikes multiply the enemy's share x1.5 after attribution.
- **2026-07-03** — Intermission UI: shop no longer auto-opens at round end.
  Centered button pair instead (#open-shop-btn "SHOP (B)" + #next-round-btn);
  the side SHOP toggle stays. B / either shop button toggles the panel.
- **2026-07-03** — Repair Kit reworked to dynamic pricing: now a FULL repair
  priced at `roundIncome * missingHpFraction * 3.2` (verified: one badly hurt
  part ≈ 0.6x round income, critical ≈ 2.6x). Shop shows the live quote.
  Center intermission buttons stacked: START ROUND on top, SHOP below.
- **2026-07-03** — Round-over box: the centered START ROUND + SHOP buttons
  now sit inside a themed panel (#round-over-panel) titled "ROUND N OVER"
  (set in `showIntermission`).
- **2026-07-03** — Enemy legibility pass: display renames (GUNNER, BULLDOZER,
  HAULER, SWARMER, SCRAP THIEF), `ENEMY_INFO` catalog, first-encounter
  banners, threat-grammar colors + distinct per-type silhouettes/sizes,
  action cues (shield flash + clank, hatch blink, prong glow, pre-split
  shudder, tracking turret), pause-screen dossier. Elite banners now read
  "RUSTLORD — ELITE BULLDOZER". Spawn name tags deliberately NOT added
  (user declined).
- **2026-07-03** — Field Guide menu + per-type chassis geometry: pause-screen
  dossier list replaced with a FIELD GUIDE button opening a dedicated screen
  of cards, each with the actual car rendered nose-up on a canvas portrait.
  Every archetype now has its own body SHAPE (`carBodyPath`), not just color;
  enemy bumper bars removed (they fought the new hull shapes).
- **2026-07-04** — Boss rounds (every 5th): bosses now 4x hull + 4x damage
  (was 2.4x hull), boss rounds field HALF the normal headcount, boss bounty
  raised to 30+2r. Banners: "ROUND N — BOSS ROUND" / "BOSS: RUSTLORD".
- **2026-07-04** — Mobile layout pass (screenshot-verified): side SHOP
  button to top 20% on short screens (was overlapping FIRE); touch-pause
  moved to the extreme top-right corner (outside the arena on letterboxed
  phones); round-over menu docks to the top as a slim horizontal row on
  short screens so the arena stays drivable during intermissions; canvas
  COMPONENTS panel moves below the round stats in touch-mode
  (`game.touchMode`) since the joystick owns bottom-left; key hints
  stripped from panel buttons on touch. Dev preview hooks added
  (`?touch=1`, `?screen=...`) + headless-Edge screenshot workflow (see
  Testing). FIXED long-standing cascade bug found via screenshot: the
  `#intermission button` ID rule was overriding ALL shop button state
  colors (green/red/gold never rendered) — rescoped to
  `#round-over-panel button`; the landscape media block also must stay at
  the END of style.css to win the cascade.
- **2026-07-04** — Portrait auto-pause (mobile): rotating a phone to portrait
  force-pauses via `Game.handleOrientation(isPortrait)` (wired to a
  `matchMedia("(orientation: portrait)")` change listener in main.js; no-op
  off touch/before-start/after-over). Returning to landscape does NOT auto-
  resume — the pause screen stays up so the player taps RESUME (avoids the
  game running mid-rotation). Rotate-hint overlay resized to fit portrait
  width + a ↻ glyph. Covered by orientation-test.js.
- **2026-07-04** — Full mobile readability audit (every menu screenshotted
  at 844x390): start-screen controls line now swaps keyboard text for
  touch text ("Left stick to drive · DRIFT · FIRE") via `.kbd-only` /
  `.touch-only`; game-over "RUN IT BACK (R)" drops the "(R)" on touch;
  virtual controls now auto-hide behind any full-screen `.overlay`
  (`:has()`), removing the clutter of them bleeding through start/pause/
  guide/options/game-over. Added `?screen=hud|gameover` preview hooks.
  All states verified clean on mobile + desktop unaffected; 4 test suites
  green.
- **2026-07-04** — Landscape-first mobile: platform rule updated (mobile =
  landscape, test at ~390px viewport height). New `max-height: 500px` CSS
  block compacts every menu (overlays, shop, round-over box, guide, options,
  touch-control sizes) so nothing overflows a sideways phone. The shop +
  round-over stack previously exceeded a 390px-tall screen.
- **2026-07-04** — RESUME button on the pause screen (mobile had no way to
  unpause — the pause overlay covers the touch-pause button). "Press ESC"
  hint demoted to small text, hidden in touch-mode (.keycap-hint).
- **2026-07-04** — Platform rule added (see top): all changes must serve
  both desktop and touch. Mobile audit fixes: portrait "rotate your phone"
  overlay (touch-mode only), overscroll-behavior none (no pull-to-refresh),
  user-select/touch-callout disabled in touch-mode, keycap hints hidden in
  touch-mode, shop grid drops to 2 columns under 820px. Known remaining
  gaps tracked in BACKLOG item 1 (joystick/HUD overlap on 16:9 phones, DPR
  canvas, low-end perf audit).
- **2026-07-04** — `serve.js` added: zero-dependency Node static server
  (port 8080, binds 0.0.0.0, prints LAN URLs, no-store caching) for
  phone/LAN playtesting. `node serve.js` → http://<lan-ip>:8080. Windows
  Firewall already had inbound allow rules for node.exe.
- **2026-07-04** — BACKLOG.md created (io-game roadmap + monetization plan).
  Touch controls shipped (backlog item 1): virtual joystick in input.js
  (`Input.touch` = world direction + magnitude; Player.update converts to
  throttle/steer with brake-to-turn and opposite-pull reverse), FIRE/DRIFT
  hold-buttons merged into the fire/handbrake getters, on-screen pause
  button. Controls appear only on touch devices (`body.touch-mode` via
  pointer:coarse match or first touchstart). Verified via touch-test
  harness (steer/coast/reverse/button merge).
- **2026-07-04** — Options menu on the pause screen (OPTIONS button →
  #options-screen): master volume slider, applies live via
  `AudioSys.setVolume` (works pre-unlock too), persists in
  localStorage ("sd_volume"). ESC backs out of options → pause → resume.
- **2026-07-04** — Repair Kit tiers: 25/50/100% heal options priced
  proportionally; always buyable while damaged — underfunded buys spend all
  salvage for a pro-rata heal (amber button state). Float-snap in healPlayer
  so full heals leave hp exactly at max.
- **2026-07-03** — Fixed thief figure-eighting past piles (turn radius at full
  speed ~4x the pile's capture window): arrival slowdown inside 170px,
  brake-turn when misaligned, and reverse-brake while overlapping so it
  parks instead of coasting through. Thief harness: first bite 2.9s, pile
  eaten dry by 9s (was: never).
- **2026-07-04** — Scrapyard Arena mode FOUNDATION (BACKLOG-ARENA items 1-2).
  Start-screen mode picker (Gauntlet / Arena); `ArenaGame` + `ArenaRenderer`
  in js/arena/. Big 5200x5200 open field: player-following camera clamped to
  world bounds, scrolling tiled floor, viewport-culled world pass, boundary
  walls, scattered scrap (visual only — XP wiring is a later slice), minimap,
  placeholder level/XP HUD. main.js routes an `active` controller between the
  two modes (shared Input + AudioSys). Extracted `readDrive()` into input.js
  (shared kbd/joystick→drive) and refactored Player.update to use it —
  Gauntlet regression suites all still green. Verified via arena-test.js
  (drive/camera-follow/clamp/bounds/pause) + desktop & mobile screenshots.
  NOT yet built: XP/leveling, modular slot/loot system, bots, PvP, boss/
  events, respawn/head-start — see BACKLOG-ARENA.md.
- **2026-07-04** — Arena BOTS + COMBAT (the "bots-first" foundation; makes
  minelayer/ram/HEALTH/DURABILITY/kills-as-XP all live). `ArenaBot`
  (js/arena/arena-bot.js) extends Car — HP, a weapon, AI that farms nearest
  scrap and engages the player within 560px (cannon shoots / ram charge-rams /
  minelayer drops mines). `ArenaGame`: 8 bots kept alive (respawn 3.5s after a
  wreck); `updateProjectiles` splits player bullets (harvest scrap + damage
  bots) vs bot bullets (damage player); `updateMines` detonates on the owner's
  enemies w/ knockback; `updateCollisions`/`collidePair` do fault-based
  player↔bot crash damage (bot↔bot separate only, `pairHits` cooldown on
  `_t`). Player HP pool (HEALTH stat → maxHp, DURABILITY → `/(1+dur*0.1)`
  damage reduction); 0 HP → `dead` WRECKED overlay + 2.5s countdown →
  `respawnPlayer` resets progression to level 1 (locked "death resets"; item 9
  head-start still todo). Kills pay `60+botLevel*25` XP. Bots render red with
  name+level+HP bar (`drawBot`), red minimap dots. Player HP bar added to HUD.
  Preview: `?mode=arena&weapon=<id>&nearbot`. Gated by arena-level-test.js
  (combat section) + boot/isolation/determinism all green. NOT yet: bot
  leveling/looting drops, bot-vs-bot kills + attribution, mine HOOK.
- **2026-07-06** — Arena bot self-leveling + weapon loot + full FFA (user
  request: "bots need to use their levelups to upgrade themselves… random
  stat… start bot looting"). FFA UNIFICATION: `cars()`/`isDeadCar()`/
  `hurtCar(car,amt,source)` replace the old player-vs-bot split — every bullet
  (`b.shooter`), mine (`m.owner`), and collision now damages ANY car but its
  source and routes through one attribution path; `car.lastHitBy` records the
  killer so `awardKill` credits XP to whoever landed the wreck (player OR bot,
  bot-vs-bot included). BOT LEVELING: `ArenaBot` gains xp/statPoints/stats;
  `gainXp` (from scrap-farm drain + kills) loops the SHARED `arenaXpToNext`
  curve and spends each point on a RANDOM uncapped stat; `applyStats`
  SPEED→maxSpeed/accel, HEALTH→maxHp(+heal), `reloadMul` shortens fire
  interval, DURABILITY divides incoming damage in `hurt`. Bots spawn near the
  player's level (`randInt(1,player+2)`). LOOT: a wrecked car (bot or player)
  `dropWeapon`s a drive-over pickup; `updateLoot` swaps the player's
  `startWeapon` on pickup (drops the old one), ages loot out at 20s, caps at
  30 — placeholder for the real slot/part system (proper equip menu is later,
  user-confirmed). `respawnPlayer`/death restore `baseWeapon`. New render:
  `drawLoot` (weapon-colored chip + initial + pulsing gold ring). Preview:
  `?mode=arena&loot` drops 3 pickups. Gated by arena-level-test.js (bot-level/
  FFA/loot asserts + a 40s integration sim: population stable, loot bounded,
  state finite, bots grow off farming); full 5-suite regression + desktop
  screenshot green. NOT yet: bot part/slot looting, distinct per-weapon bot
  AI, mine HOOK.
- **2026-07-06** — Arena CENTRAL BOSS: the JUNK TITAN (BACKLOG-ARENA item 6,
  the map's "gravity well"). New `ArenaBoss` (js/arena/arena-boss.js): a huge
  (r72) slow tank at map center with **4 armor plates around a core**. Damage
  ROUTES to the plate facing the hit (`hurtBoss` picks the nearest plate by
  angle to `heading+plate.ang`); tearing a plate off `dropWeapon`s a lootable
  weapon + exposes the core beneath (hits with the facing plate gone fall
  through to `coreHp`); draining the core → `killBoss` pays **+400 XP** to the
  killer, explodes a **scrap piñata** (10 fresh piles) + a bonus weapon, and
  arms a 22s respawn. Full FFA — every bullet (`b.shooter`), mine (`m.owner`),
  and ram (`collideBoss`) damages it, and the core kill credits `lastHitBy`
  (player OR bot). Attacks: **ground-slam** (`bossSlam` — 0.9s telegraph ring
  → radial knockback + falloff damage within 330px) + a heavy slow cannon
  (`b.shooter=boss`, big radius) while the front plate survives; it crawls
  toward the nearest car. `scatterScrap` now keeps a dense ~28-pile cluster on
  the center so the Titan is worth contesting; player spawn/respawn moved to
  `playerSpawn()` (south of center) so you never appear inside it. Render
  (`ArenaRenderer.drawBoss`): rim plates that flash white on hit + vanish when
  torn, a pulsing red core, a toughness bar + "JUNK TITAN" label, a gold
  minimap diamond; first-encounter banner. Load order: arena-boss.js before
  arena.js. Preview `?mode=arena&boss`. Gated by arena-level-test.js (new
  Titan section: plate damage → tear-off loot → core kill XP+piñata → slam →
  respawn) + the 40s integration sim stays stable with the boss live; full
  regression (boot/arena/isolation/determinism/smoke) + desktop & mobile
  screenshots green. NOT yet: roaming events (scrap storm), bots converging on
  the Titan (they still target player/scrap).
- **2026-07-06** — Arena bot Titan-swarm + player health REGEN stat (user
  request). BOTS CONVERGE: `ArenaBot.update` now picks a target — the player
  if within `BOT_ENGAGE` (560), ELSE the central Titan if within
  `BOT_BOSS_RANGE` (1000), else farm scrap — and steers/spaces/fires against
  it (spacing measured to the target's SURFACE so the huge Titan is handled
  right; their shots/mines/rams already damage it via FFA). Keeps the center
  contested. REGEN: a 5th spendable stat. The player passively heals
  `REGEN_BASE` (2%/s of maxHp) + 0.5%/REGEN-point, but ONLY after
  `REGEN_DELAY` (5s) with no damage — `damagePlayer` resets `outOfCombat` to 0
  every hit, and the regen tick (end of the alive `update`) waits for the
  gate. Stat wired everywhere: `stats.regen` in reset/respawn, `#stat-regen`
  button, `STAT_LABELS`/`STAT_KEYS` (desktop key 5), HUD readout gains "RGN"
  (tightened to 10px/2-space so 5 stats fit the box), 5th SPEND-POINTS button
  fits both viewports. Bots keep their original 4-stat spread (regen is
  player-only). Gated by arena-level-test.js (converge section: a cannon bot
  closes on + fires at the Titan; regen section: no heal <5s, ~2%/s after,
  +0.5%/pt, hit resets, caps at 10) + full regression + desktop/mobile
  screenshots green.
- **2026-07-06** — Arena LEADERBOARD + leader BOUNTY (BACKLOG-ARENA item 7).
  `computeLeaderboard` ranks the player + 8 bots by level (XP tiebreak),
  throttled to 0.5s from update(); `leaderCar` = the highest-ranked LIVING car
  = the bounty target. `ArenaRenderer.drawLeaderboard` renders it under the
  minimap (top 5 desktop / top 3 on short phones): player row blue, #1 row gold
  with a ★. BOUNTY: `awardKill(killer, victim)` (refactored to take the victim
  CAR) pays `BOUNTY_XP` (150) on top of base kill XP when `victim===leaderCar`,
  with a "BOUNTY — WRECKED X" banner; the leader's coarse sector (`LB_SECTORS`
  4×4 grid) is highlighted gold on the minimap (pressure, not a pin). Player
  display name is a single swappable field `ArenaGame.playerName` ("YOU") —
  the hook for a linked Google-account handle when website accounts land.
  Gated by arena-level-test.js (rank order, leader selection, bounty math vs a
  base kill) + full regression + desktop & mobile screenshots green. NOT yet:
  bots hunting the bounty (they don't read the board); global cross-session
  board (waits on accounts).
- **2026-07-07** — Arena bot WALL AVOIDANCE + item-parking (user: bots wedge on
  side walls during fights; and stop-then-bolt on scrap/loot instead of
  lingering). WALLS: ported the Gauntlet's look-ahead avoidance to `ArenaBot` —
  `nearWall()` + `applyWallAvoidance(throttle,steer)` project the bot ~0.55s
  ahead (`ARENA.wall+100` margin), and if it lands in the danger zone blend
  steering toward the interior (weight ∝ penetration) + brake when nosing
  straight in. Runs for ALL behaviors just before `integrate` (skipped during a
  ram launch so charges stay committed). The old forward-driving wedge-breaker
  (drove INTO the wall) is replaced by a REVERSE-OUT: pinned near a wall +
  `speed<40` for 0.7s → throttle -0.6 with steering flipped toward map center
  (a car can't steer at zero speed); gated on `nearWall()` so mid-arena
  parking/orbiting never triggers a phantom back-out. PARKING: new
  `ArenaBot.parkOn(x,y)` — gentle brake to a stop + recenter (creep back if it
  drifts >22px), no violent reverse. Both loot (capture 50px, channel while
  parked) and scrap-farm (park+drain within 44px instead of driving through)
  use it, so bots sit on an item and linger instead of stopping suddenly then
  bolting. Gated by arena-level-test.js (wall: a bot driving into a wall never
  stays wedged >2.6s + isn't pinned flush; parking: a bot lingers >1.5s on a
  pile) + full regression green.
- **2026-07-07** — Arena bot MOVEMENT overhaul (user: bots poke back-and-forth /
  spin instead of driving around; and moth-orbit scrap/loot instead of grabbing
  it). Two root causes, both "steer straight AT the target": (1) COMBAT — ranged
  bots steered `aim*2.4` (nose locked on the enemy) so they could only move
  radially in/out. Rebuilt as CIRCLE-STRAFE: since bot bullets already auto-aim
  at the target, `ArenaBot.update` now steers toward a TANGENT point (target dir
  + `orbitDir`×`orbitAng`, `orbitAng` = `BOT_ORBIT_ANGLE` π/2 minus a range-error
  term, clamped — direct-in when far, ~90° orbit at `BOT_ORBIT_RANGE` 250, back
  off when close) at constant 0.8 throttle → the car drives AROUND the enemy.
  Fire arc widened to 2.0 rad; cannon lead cut 0.8→0.5 (orbiting targets CURVE,
  so full linear lead overshoots the arc → under-lead lands more). The old
  aim-based stalemate breaker (which false-fired during normal orbits) replaced
  with a genuine WEDGE breaker: pivot only when `speed<45` for 1s. `orbitDir`
  splits across bots by id. (2) NAVIGATION — bots drove full-throttle at scrap/
  loot; when it's close + off-angle the turn circle is wider than the target so
  they lap it forever. New `ArenaBot.navTo(x,y,d)` does BRAKE-TO-TURN (crawl
  0.15 when close+off-angle, ease down arriving, cruise from afar) so the nose
  swings straight onto the item — same fix the Gauntlet used for its thief/
  splitter moth-orbit. Both farm + loot-approach route through it. Gated by
  arena-level-test.js (bot-duel now lands damage in <12s via orbit + partial
  lead; navigation: bot reaches an off-angle pile, no moth-orbit) + full
  regression green. Note: two PERFECTLY symmetric dueling bots can clash-cancel
  all mutual fire (the bullet-blocking mechanic) — real chaos (asymmetry, 8
  bots, the player, collisions) breaks it; dials are `BOT_ORBIT_RANGE/ANGLE`,
  the 0.5 lead, and the fire arc.
- **2026-07-07** — Arena SPECTATE PARITY + bot-duel combat fixes (user found
  bots not colliding/shooting + circling loops while spectating). ROOT CAUSES:
  (1) the DEAD update branch never ran `updateCollisions()` — while
  wrecked/spectating, bots passed through each other AND the Titan; it also
  never ran the scrap respawn top-up (piles bots ate stayed gone) or silenced
  the player engine drone. All three now run in the dead branch — the world
  sims IDENTICALLY while dead (user rule: spectate must match live). (2)
  bot-vs-bot mutual pursuit settled into a stable orbit where neither ever got
  within the 0.55-rad fire cone → no shooting, endless circling (the SAME
  disease the Gauntlet fixed in its 2026-07-03 AI pass). Fixes in
  `ArenaBot.update`: fire cone widened to 0.85 rad; cannon shots now LEAD the
  target (`target.v × flightTime × 0.8` — trailing shots always missed between
  two moving cars); and a circling-stalemate breaker — `aimStuckT` counts time
  unable to get nose-on (>0.6 rad), after 1.2s the bot handbrake-PIVOTS
  (throttle 0.2 + handbrake integrate) to whip its nose around, mirroring the
  Gauntlet's brake-to-turn fix. Gated by arena-level-test.js (spectate-parity:
  bot↔bot + bot↔Titan collision and scrap respawn while dead; bot-duel: two
  cannon bots exchange fire AND land damage within 10s — no stalemate) + full
  regression green.
- **2026-07-07** — Arena FFA BOT TARGETING + DEATH MENU/SPECTATE + SKID MARKS
  (three user requests). FFA TARGETING: `ArenaBot.pickTarget` scores every car
  in range by effective distance — player ×`PLAYER_BIAS` 0.65 (~35% priority,
  user pick), bot-vs-bot range `BOT_VS_BOT` 450 (shorter than the player's
  560), recent attacker (grudge: set in `hurt` from `lastHitBy`, `RETALIATE_T`
  4s) ×0.5 and huntable from `RETALIATE_RANGE` 900, current target sticky
  ×0.85. Titan-swarm/loot/farm unchanged below combat. DEATH MENU + SPECTATE
  (BACKLOG-ARENA item 9 slice): no more auto-respawn — death shows a DOM
  overlay `#death-menu` (RESPAWN / SPECTATE / MAIN MENU) after a 1.2s wreck
  moment (`respawnT` now just delays the menu); `updateDeathUI` in main.js
  drives visibility. SPECTATE: `arena.spectate` + `spectateTarget()` (living
  bots by `spectateIdx`, falls back to the Titan) — dead-branch camera follows
  the target; `#spectate-ui` top-center row (NEXT BOT/N key, RESPAWN, MAIN
  MENU), "SPECTATING: name" canvas label, ESC exits to the death menu; dead
  players are untargetable so bots just fight each other. `respawnPlayer`
  clears spectate; quitToMenu hides both; stats/loadout panels hide while
  dead. SKID MARKS ported to Arena: `ArenaRenderer` gets the Gauntlet skid
  system (`recordSkids`/`updateSkids`/`drawSkids`, shared SKID_LIFE/SKID_FADE,
  4000-segment cap) + per-segment viewport culling for the 5200px map; laid by
  the player AND bots in both alive/dead update branches; cleared on reset.
  Preview `?mode=arena&dead` / `&spectate`. Gated by arena-level-test.js (FFA:
  bot-vs-bot range, 35% bias math, closer-bot-wins, retaliation from 800px +
  grudge expiry; death: no auto-respawn, spectate cam follows + cycles, dead
  player never targeted, respawn exits spectate; skids: slide lays rubber,
  ages out, bots included) + full regression + screenshots green.
- **2026-07-07** — Arena BOT LOOTING (user request): bots pick up part
  upgrades. When NOT engaged (combat first — user call), `ArenaBot.update`
  targets the nearest ground-part UPGRADE (`wouldUpgrade`: strictly higher
  tier for its slot) within `BOT_LOOT_RANGE` (600px, user pick), but only if
  UNCONTESTED — `findLootTarget` skips any drop with another living car within
  `BOT_LOOT_CONTEST` (200px), and since it re-runs every frame, a rival (or
  the player) driving up mid-pickup aborts the claim. The bot drives over,
  parks (brake under 34px), and channels `BOT_LOOT_CHANNEL` (2s) sitting on
  the part — `drawBot` shows a gold progress ring so pickups are visible +
  contestable. On completion `ArenaGame.botEquip` claims the drop (same
  single-access dead-on-claim rule as the player, no dupes), swaps the bot's
  OLD part out where the loot sat (user call — parts keep circulating),
  updates `bot.weapon` when it's a gun (AI + rendered gear follow), and
  re-applies stats. Deterministic (no RNG). Gated by arena-level-test.js
  (targets uncontested upgrade, skips contested, rejects downgrades, channel
  builds + rival-aborts, 2s claim equips + old-part swap + consumed drop) +
  full regression green.
- **2026-07-07** — Arena BULLET CLASHING (user request): bullets from
  DIFFERENT entities (player / bot / boss — and future humans) block each
  other on contact. Hidden `Bullet.strength` stat (default 1 in projectile.js;
  the Titan's heavy shell sets 3): `ArenaGame.updateBulletClashes` (run at the
  top of `updateProjectiles`, so both alive+dead branches get it) pairs
  overlapping bullets with different `shooter`s, both lose the other's
  strength, die at <=0 — so a boss shell eats 3 normal bullets before
  breaking; clash sparks at the contact point. Same-shooter bullets never
  clash. ARENA ONLY (Gauntlet untouched — user call). Flat strengths for now;
  "tier adds strength" (higher-tier cannons fire tougher bullets) added to
  BACKLOG-ARENA (user call). Gated by arena-level-test.js (cross-entity
  blocking, same-shooter immune, bot-vs-bot clash, boss shell survives 2 /
  dies to 3rd) + full regression green.
- **2026-07-07** — Arena MODULAR PART/SLOT SYSTEM (BACKLOG-ARENA item 5, the
  mode's signature pillar) + XP-rule rework + per-viewer projectile colors.
  PARTS (js/arena/arena-parts.js): 5 slots (tires/engine/weapon1/weapon2/armor),
  5 tiers common→legendary (`ARENA_TIERS`, color-coded); `makePart`,
  `partName`, `tierColor`, `tierForLevel` (seeded). EFFECTS: `applyStats` (player
  AND `ArenaBot.applyStats`) folds parts on top of stat points — tires→grip/turn,
  engine→speed/accel (`×`), armor→maxHP + `partDmgReduce`, weapon→firepower;
  `damagePlayer`/bot `hurt` divide by `(1+partDmgReduce)`. Bots carry a full
  tiered loadout that BUFFS them and defines drops. DUAL WEAPONS: `updateWeapon`
  fires weapon1+weapon2 together on FIRE, each its own `cd`, tier-scaled damage;
  `hasRam()` gates the ram charge; `startWeapon` stays synced to weapon1 for
  rendering. LOOT LOOP (replaces the old weapon-loot): `this.drops` of
  `{x,y,part,age}`; wrecked bots `dropPart(pickDrop())` (weighted to their best
  tier), the Titan drops ONE rare+ on the CORE kill (plate tear-offs no longer
  drop), player death scatters weapon1. `collectibleDrops()` = drops within
  `PICKUP_RANGE` (180); `equipPart` is single-access (claimed→dead on equip, no
  dupes), fills the slot (weapon → empty secondary else replace secondary), old
  part swaps out where the looted one sat; `slotCompare` → up/same/down.
  Despawn 30s, cap `DROP_CAP` 40. EQUIP PANEL (DOM `#arena-loadout`, main.js):
  left side, auto-shows near collectibles + PARTS/L toggle, lists slots + nearby
  parts with green↑/red↓/→ arrows AND the row box tinted to match; tap/click to
  equip; positioned via `positionArenaDom()` off the canvas rect (guarded for
  headless), compacted in touch-mode. A ⇄ SWAP PRIMARY/SECONDARY control
  (`ArenaGame.swapWeapons`, shown when both weapon slots are filled) flips
  weapon1↔weapon2 so the primary isn't permanently locked (equip only ever
  auto-replaces the secondary). Ground drops render as tier-colored chips
  with a slot glyph + collectible halo (`drawPartDrop`); the CP1 canvas loadout
  panel was removed in favor of the DOM one. XP RULES (user request): a non-boss
  kill now pays `max(KILL_FLOOR 20, 25% of the victim's total XP)` (`arenaTotalXp`)
  — leader/nemesis bonuses stack on top; DEATH drops you to 25% of your total XP
  (`arenaLevelFromTotal`, ≈63% of your level) instead of a hard reset to level 1,
  and resets your build (stat points refund for the reduced level + a fresh
  common loadout). PROJECTILE COLORS (user request): Arena bullets + mines color
  by owner RELATIVE TO THE LOCAL PLAYER — yours yellow, everyone else's (bots,
  boss, future humans) red (`drawBullet`/`drawMine` check `b.shooter`/`m.owner`
  === `arena.player`); Gauntlet already did this via `fromPlayer`. Preview
  `?mode=arena&loot` (drops 4 mixed-tier parts) + `&fire` (your yellow + enemy
  red shots). Gated by arena-level-test.js (loadout effects, dual-weapon fire,
  weapon-tier damage, part equip + secondary-replace, bot loadouts buff bots,
  boss rare+ drop, kill-XP floor + 25% math, 25%-XP death penalty) + full
  regression + desktop & mobile screenshots. NOT yet: shoot-a-part-OFF-an-enemy
  dismemberment, the minelayer HOOK, distinct per-weapon bot AI.
- **2026-07-07** — Arena SOCIAL HOOKS: killfeed + nemesis + rampage streaks
  (BACKLOG-ARENA item 8). NEMESIS: the bot that lands the killing blow becomes
  `this.nemesis` (`damagePlayer`), persists across respawn; shown as a red
  white-outlined diamond on the minimap + a red "NEMESIS" world tag over the
  car (`drawBot`). Wrecking it pays `REVENGE_XP` (120) on top of base kill XP
  ("REVENGE! WRECKED X") and clears the grudge (`awardKill`); if another car
  wrecks it first, the grudge auto-clears (`updateBots`). KILLFEED (all
  wrecks): `feedWreck(killer,victim)` + `nameOf(car)` post "X wrecked Y" for
  every bot/player/Titan wreck, newest-first, capped 8, aged out 5s
  (`tickBanners`); `drawKillfeed` renders it right-aligned just LEFT of the
  minimap (player lines blue, RAMPAGE gold, others neutral, drop-shadow, no
  box). STREAKS: each car tracks a wreck `streak` (player + `ArenaBot.streak`,
  reset on death); `bumpStreak` fires at `STREAK_MILESTONES` (3/5/8, then +5)
  with a center banner + gold feed line `NAME: n-WRECK RAMPAGE` (colon, NO em
  dash — user preference; the bounty banner was likewise switched to
  `BOUNTY! WRECKED X`). Preview `?mode=arena&social`. Gated by
  arena-level-test.js (feed post, nemesis set/persist/clear, revenge math,
  streak milestone + colon format) + full regression + desktop & mobile
  screenshots green. Mobile: the feed is COMPACT on touch (3 lines/10px) AND
  auto-hides while the SPEND POINTS panel is up (`drawKillfeed` gates on
  `touchMode && statPoints>0`) so they never crowd; desktop shows 6 lines/12px.
  NOT yet: bots reacting to their own nemesis; global/cross-session feed (waits
  on accounts).
- **2026-07-07** — Hi-DPI / native-resolution rendering (fixes blur on large &
  retina screens). The canvas was a fixed 1280×720 backing store CSS-stretched
  to the window — anything bigger/denser upscaled and looked soft. `fit()` in
  main.js now sizes the BACKING STORE to real device pixels
  (`WORLD × displayScale × dpr`); the CSS size still letterboxes 16:9. DPR is
  capped (`DPR_CAP` 2) so low-end phones don't push a 3× buffer, but the
  display-fill factor is uncapped, so a 1440p window gets a full 2560×1440
  buffer (verified via 2560×1440 screenshots — both modes now crisp). Both
  renderers keep drawing in LOGICAL 1280×720 space and scale their context to
  the backing store: `Renderer.draw` and `ArenaRenderer.draw` each start with
  `ctx.setTransform(canvas.width/WORLD.w, …)`. All Arena screen-space HUD
  (minimap/leaderboard/banners/death overlay) + the camera-viewport clamp in
  `ArenaGame.update` switched from `this.canvas.width/height` to `WORLD.w/h`
  (the logical viewport) so zoom is unchanged — only pixel density goes up.
  ui.js already used WORLD coords, so the Gauntlet HUD needed no changes; input
  is a fire-button only (no mouse→world mapping) so aim is unaffected. Full
  regression (boot/arena/isolation/determinism/level/smoke) green. Known
  softness remaining: the pre-rendered Gauntlet floor + Arena tile PATTERN
  still upscale (low-frequency, barely visible) — re-rendering them at backing
  res on resize is a later polish if needed.
- **2026-07-04** — Arena weapon behaviors (BACKLOG-ARENA item 5, all 3 starting
  weapons). Fire input (`Input.fire`, shared FIRE button + click/F) drives the
  weapon per `startWeapon`. CANNON: `updateWeapon` spawns forward `Bullet`s
  (life bumped to 2.5 for the big map) with recoil; `updateProjectiles` flies
  them + HARVESTS scrap into XP (shoot-to-farm — the useful pre-combat weapon).
  MINELAYER: drops the SAME proximity mine as the enemy MINELAYER (arm 1s, dmg
  30, `owner:"player"`; capped 25; persist, no detonation targets until bots).
  RAM: `updateRam` (before integrate) mirrors the enemy RAMMER's charge — hold
  FIRE to WIND UP (`Car.boost` 0.5 = digs in, builds `ramCharge` 0→1 over
  0.8s), release to LAUNCH a boost scaled by charge (up to 2.6x for ~1s), rev
  cue; CHARGE gauge on the HUD. RELOAD stat now LIVE (shortens cannon/mine
  interval by
  8%/point). Bullets/mines rendered in ArenaRenderer (viewport-culled). Scrap
  respawn unified (bullet + drive-over both feed one cleanup). Preview:
  `?mode=arena&weapon=<id>&fire`. Gated by arena-level-test.js; 3 weapons
  screenshot-verified. NEXT: slots/looting, then bots (combat makes
  minelayer/ram/HEALTH/DURABILITY fully matter).
- **2026-07-04** — Arena XP + leveling core loop (BACKLOG-ARENA item 3, +a
  minimal item-4 slice). `ArenaGame` gains level/xp/statPoints/stats/slots +
  maxHp/hp (reset per run). `xpToNext()` = 20+level²·6, cap 30; `addXp` loops
  level-ups; `levelUp` grants a stat point, unlocks slots at milestones
  (`SLOT_UNLOCKS`: armor@5, weapon2@10), plays a jingle + gold particle burst
  + banner. `spendStat` (cap 10/stat) → `applyStats`: SPEED +5%/pt (maxSpeed &
  accel off `ARENA_BASE`), HEALTH +25 maxHp/pt applied now; RELOAD/DURABILITY
  stored, latent until weapons/combat. XP source: driving over scrap absorbs
  it (150/s, 1 XP/unit); consumed piles respawn to `SCRAP_TARGET` (180).
  HUD: real LVL + XP bar + stat readout + spend prompt (ArenaRenderer), gold
  level-up banners, world-space particles. Stat spending is DOM buttons
  (#arena-stats, top-center, tappable) + desktop keys 1-4 — non-blocking (the
  persistent world keeps running). quitToMenu hides #arena-stats. Preview:
  `?mode=arena&weapon=cannon&xp=<n>`. Gated by arena-level-test.js; desktop +
  mobile screenshot-verified. NOT yet: weapon behaviors, looting, bots, kills-
  as-XP, combat/damage (so HEALTH/RELOAD/DURABILITY have no live effect yet).
- **2026-07-04** — Pause-menu changes for two modes: added a MAIN MENU button
  (both modes) that quits the current run to the mode-select start screen
  (`quitToMenu` in main.js — hides all overlays, resets + stops the active
  controller, `active=null`). FIELD GUIDE button now HIDDEN in Arena (Gauntlet
  only): `Game.togglePause` shows `#guide-btn`, `ArenaGame.togglePause` hides
  it; needed a new `button.hidden { display:none }` rule (the pre-existing
  `.hidden` only covered overlays/panels). OPTIONS made mode-agnostic
  (open/close moved to main.js; it guarded on `game.paused` which is false in
  Arena, so it was silently broken there). ESC now backs out of the top-most
  visible overlay via DOM checks, not per-mode flags. Preview: `?mode=arena&
  weapon=<id>&pause` shows the Arena pause menu. Gated by boot-test.js (loads
  the whole page incl. main.js, verifies wiring + MAIN MENU flow).
- **2026-07-04** — Arena starting-weapon SELECT screen. Picking "Scrapyard
  Arena" now opens a themed `#weapon-select` overlay (cannon / minelayer /
  ram) with live car portraits, before spawning. `ARENA_WEAPONS` catalog in
  arena.js; `ArenaRenderer.drawWeaponGear` (shared by in-game car +
  `renderWeaponPortrait` cards) draws each weapon's gear (cannon barrel /
  minelayer rear hatch+mines / ram plow). Choice → `ArenaGame.startWeapon`,
  rendered on the car. BACK/ESC → start; preview `?mode=arena` shows the
  picker, `?mode=arena&weapon=<id>` skips into play. Weapon BEHAVIORS are the
  next slice (BACKLOG-ARENA item 5). Desktop + mobile screenshot-verified.
- **2026-07-04** — GRADUAL per-part damage (was binary: effects only at hp 0).
  New `Car.damageFactor(k)`: 0 while a part has ≥50% health, then eases in
  (t², steep near failure) to 1 at broken — every penalty scales by it and
  lands exactly on the old broken value (no jump). WHEELS: asymmetric damage
  veers toward the worse side (→±0.55 at broken), grip/accel degrade with the
  average; the bare-axle FISHTAIL + speed-cap ramp in once BOTH sides are
  failing and reach FULL by 20% health (not 0% — user request; `fishL/fishR`
  use a 50→20% range). ENGINE: sputters below 50% (gap `rand/dE`, len
  `rand*dE`) growing into the old periodic stalls at broken. WEAPON: reload
  stretches `base/max(0.15, 1-dW)` (~6.7x near broken) then can't fire.
  BUMPERS: a damaged-but-alive front/rear bumper bleeds a `damageFactor`
  fraction of each hit through to the inner part (engine/weapon), up to full
  1.5x spill at broken. All deterministic (sin fishtail + seeded stall rolls),
  determinism suite green. Gated by gradual-damage-test.js.
- **2026-07-04** — Both-wheels-gone is now clearly punishing (was a no-op).
  When BOTH wheel-sides are destroyed, the old `-0.55 + 0.55` steer pulls
  canceled to zero so the car tracked straight. Now it's a barely-drivable
  wreck: a deterministic sin fishtail (`Car.limpPhase`, ~±30° heading wander
  you can't cleanly counter-steer), grip cratered to 0.2, accel to 0.35, and
  a forward-speed cap of 0.5x (grinding on bare axles). Deterministic (no
  RNG) so seed-replay holds. Gated by wheels-test.js.
- **2026-07-04** — Arena foundation review pass (2 fixes): (1) ArenaGame.reset()
  now save/restores `_simRandom` around world construction — building the Arena
  at page load (main.js constructs Game then ArenaGame) was consuming ~360
  seeded draws from the GAUNTLET's stream and breaking its seed-replay
  determinism; gated by new arena-isolation-test.js. (2) Minimap drops below
  the touch-pause button in touch-mode (they collided on near-16:9 phones).
  Both verified; full 10-suite regression green.
- **2026-07-04** — BACKLOG item 2 (seeded deterministic runs) CORE done.
  `js/rng.js` mulberry32 PRNG. utils.js splits randomness: SIM `rand/randInt/
  pick` route through settable `_simRandom` (Game points it at its RNG),
  COSMETIC `fxRand/fxPick` stay on Math.random and must never touch the sim
  stream. Converted particles.js + render.js (all cosmetic) to fx*; debris/
  shake/scrap-visual-seed → fx*; kept spawns/AI/scrap-placement/damage-rolls
  on seeded rand. Enemy orbitDir + engine-damage roll moved off bare
  Math.random. `renderEnemyPortrait` swaps _simRandom to Math.random around
  the throwaway Enemy so opening the Field Guide can't desync. main.js now
  runs a FIXED-TIMESTEP loop (STEP 1/60 accumulator) — physics no longer
  depends on refresh rate. `?seed=<hex|int>` locks a run (persists across
  restarts via `lockSeed`); seed shown on game-over. RULE: anything in the
  update() path that affects game state uses seeded rand; draw()/audio and
  pure-visual spawns use fx*/Math.random. Gate: determinism-test.js.
  Deferred: daily/date seed (user wants a different daily-challenge idea),
  input recording for ghost replays (foundation ready).
