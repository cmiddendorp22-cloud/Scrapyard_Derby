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
`theme → net → utils → rng → input → audio → particles → projectile → scrap → car →
player → enemy → waves → render → ui → upgrades → game →
arena/arena-parts → arena/arena-player → arena/arena-render → arena/arena-bot →
arena/arena-boss → arena/arena → main`

- `js/arena/arena-player.js` — `ArenaPlayer`: one human's game-state (car +
  hp/stats/loadout/level/weapon-cooldowns), extracted off ArenaGame so the sim
  can carry MULTIPLE humans (multiplayer M0). ArenaGame holds `players[]` +
  `localPlayer`; `defineLocalPlayerAccessors` proxies `this.hp`/`this.stats`/
  `this.player`/... to `localPlayer` so all existing call sites + tests are
  untouched. (Named ArenaPlayer to avoid the Gauntlet's `Player` class.)
- `js/theme.js` — THE color palette (`THEME`): single source for UI chrome +
  gameplay-identity colors. Canvas code reads `THEME.*` directly; at load it
  injects every entry as a CSS variable (`--kebab-case`) so style.css uses
  `var(--accent)` etc. Retheme the game by editing this one file. Sprite/art
  tones (crate wood, boss hulls, wheel rust, floor) are deliberately NOT
  themed. Gauntlet canvas (render.js/ui.js) not yet converted (mode disabled).

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
- **2026-07-09** — Player car now has a floating HP bar (user), same size/pos/
  style as the bots' (`drawCar` for the player, then a bar above it in the
  world pass) but GREEN (`#5fd35f`) so yours reads apart from the red bot bars.
- **2026-07-11** — MULTIPLAYER M1 server SAFEGUARDS + free hosting path (user:
  "completely free, no credit card"). Since no reliable always-on cloud host is
  free-without-a-card anymore, the chosen path for now is HOST-ON-YOUR-PC + a
  free **Cloudflare quick tunnel** (`cloudflared tunnel --url
  http://localhost:8090`) → a public `wss://<random>.trycloudflare.com` URL, no
  account/card; verified end-to-end (the public URL reached the local sim's
  health endpoint). SAFEGUARDS added to server.js: a ROOM CODE gates joins
  (`ROOM_CODE` env or a random 5-char code printed at startup — a client must
  send `{type:"join", room, name}` with the right code FIRST or it's rejected +
  closed), plus `MAX_PLAYERS` (12), `MAX_PER_IP` (3), a 5s unauthenticated-join
  timeout, and a per-connection message-rate ceiling. Verified: correct code
  joins + drives, wrong code REJECTED + closed, two players still see each other
  through the gate. `server/README.md` documents the free tunnel + room-code
  runbook; the root Dockerfile still covers a real (card-based) always-on host
  later. Test clients (test-client/two.js) send the join now. NEXT: client
  ONLINE mode (a join screen for wss URL + room code, then stream input + render
  snapshots).
- **2026-07-11** — MULTIPLAYER M1 (server side): AUTHORITATIVE ws SERVER, built
  + verified headless (user hosts the client on Netlify — which can't run a
  realtime server, so the client stays static-on-Netlify and the sim server
  runs separately; decided a dedicated Node host over WebRTC P2P). New `server/`
  folder, ISOLATED from the client root so Netlify keeps serving pure static
  files (root has no package.json; `server/` has its own + `ws` 8.21, git-
  ignored node_modules). `server/sim-host.js` loads the SAME game sim scripts
  the browser runs (every `<script>` in index.html EXCEPT main.js) into a Node
  vm with the boot-test's stubbed DOM/canvas + a no-op renderer/audio, and
  bridges out `ArenaGame`/`ArenaPlayer`/`Car`/`ARENA`/`VIEW`/`RNG`/`readDrive`;
  `createWorld()` builds one authoritative `ArenaGame`, marks the constructor's
  localPlayer dead + empties `players[]` (no human sits at the server — clients
  fill it). `server/server.js` (Node + `ws`): fixed-timestep loop (60Hz sim,
  ~20Hz snapshot), each connection = a new `ArenaPlayer` with its own input
  object fed by `{type:"input",...}` messages, broadcasts compact JSON
  `{type:"snap", cars/bullets/mines/boss/scrap/crates/drops, self}` to all.
  Verified with Node ws clients (server/test-sim|client|two.js): headless world
  ticks, a client's input drives its car (443px), snapshots stream ~20Hz, and
  TWO clients see each other's cars in one world. `server/README.md` documents
  run + hosting. NEXT (M1 client): browser "online" mode — connect, stream local
  input, and RENDER server snapshots (stop local simming); then M2 interpolation.
  The M0 N-player refactor is what made the server a ~0-rewrite drop-in.
- **2026-07-11** — SECURITY pass (input handling + text boxes + web hardening,
  user request). SERVER (the trust boundary — every field off the wire is
  untrusted): `sanitizeName` strips C0/C1 controls + zero-width + bidi-override
  formatting chars (spoof/HUD-corruption vectors), collapses whitespace, clamps
  to 14, never empty — applied to join + rename (names are BROADCAST to and
  drawn by other clients). `spendStat` now takes an ALLOWLIST (health/speed/
  reload/regen — the old `name in stats` matched prototype keys like
  `toString`/`__proto__`); `respawn` weapon is allowlisted (cannon/shotgun/
  minelayer/ram/railgun, else falls back). Numeric inputs use `Number.isFinite`
  (JSON `1e999` parses to Infinity → rejected; wrong types → ignored; throttle/
  steer already clamped). `ws` `maxPayload: 4096` caps a single message (floods
  close with 1009, server unaffected). Opt-in Origin allowlist (`ALLOW_ORIGINS`)
  for a public deploy. CLIENT text boxes (defense-in-depth, server re-validates):
  `cleanName`/`cleanRoom` mirror the server rules and reflect the cleaned value
  back into the field; `normalizeUrl` only lets ws://|wss:// reach the
  WebSocket ctor (maps http(s)→ws(s), rejects javascript:/data:/file:/other
  schemes, blocks ws:// from an https page = mixed content), caps length; the
  SERVER `<input>` gained `maxlength=200`. STATIC-SITE hardening: new root
  `_headers` (Netlify) sets a strict CSP (`script-src 'self'` — no inline JS in
  the app, verified; `connect-src 'self' ws: wss:` for the game socket;
  `object-src/base-uri/form-action/frame-ancestors` locked) + `X-Frame-Options`
  DENY, `nosniff`, `no-referrer`, COOP; `serve.js` mirrors those headers and
  adds GET/HEAD-only, null-byte + tightened path-traversal guards. XSS surface
  audited clean: all user text (names/leaderboard/killfeed) renders on CANVAS
  (`fillText`), never `innerHTML`; every `innerHTML` sink writes `""` or a
  static string. Gated by two live tests (server sec-test: hostile name
  sanitized + clamped, proto-pollution/bad-weapon/Infinity/wrong-type barrage
  leaves the server ticking with finite state; payload-test: 6KB msg closed
  1009 + fresh client unaffected) + CSP render check (Arena draws fully under
  the strict policy) + full 6-suite regression green. NOTE: editing source with
  regex `\u`/`\s` escapes via Bash heredoc/`node -e` mangles backslashes
  through shell+JSON — use the Write tool (literal) or build the class from
  char codes.
- **2026-07-11** — MULTIPLAYER M3 (client PREDICTION + reconciliation) + host
  hardening for a bigger provider. PREDICTION: the local car now drives
  immediately off input (no round-trip lag). Each input carries a monotonic
  `seq` (`NetClient.inputSeq`/`pending`); `predictDrive` integrates the local
  car forward every frame with the SAME physics + wall-clamp the server uses.
  RECONCILIATION: each snapshot the server echoes `ack` (last input seq it
  applied) + the self car's `vx/vy` and drive params (`ms/ac/tr/gr/dg/hb` —
  they change with stats/parts, so the client must predict with matching
  physics); `reconcileSelf` drops acked inputs, resets a scratch car to the
  authoritative state, REPLAYS the still-unacked inputs, then eases the real
  car toward that result (`RECON_SMOOTH` 0.35; hard-snaps past `RECON_SNAP`
  250px = respawn/teleport). The self car's position is now owned by
  prediction (interpolation still smooths REMOTE cars + boss from M2; bullets
  extrapolate; static entities latest). Ram-boost/collision divergence is
  transient and corrected on the next snapshot. HOST HARDENING (user:
  "scalable into a bigger provider"): server honors `SIGTERM`/`SIGINT`
  (graceful shutdown — closes sockets + listener, hard-cap 3s), reads the real
  client IP from `X-Forwarded-For` when `TRUST_PROXY=1` (per-IP cap works
  behind a load balancer), still binds host-injected `$PORT`; the root
  Dockerfile now runs NON-ROOT (`node` user) with a `/` HEALTHCHECK. README
  documents the env-var table + the scaling boundary (one process = one
  authoritative world; run more instances for more games; multi-room manager
  is a future step, nothing blocks it). Gated by interp-test.js (unchanged,
  8/8) + a live m3-protocol test (server echoes advancing `ack` + velocity +
  physics params; seq'd input drives the car, 7/7) + full 6-suite regression
  green + live screenshot (predicted self car drives responsively, LVL 2,
  HUD/leaderboard/minimap intact). NEXT (M4/polish): online loot/loadout UI
  (equip is server-side, panel hidden); reconnect + room-list; snapshot
  delta/binary compression; optional single-process multi-room.
- **2026-07-11** — MULTIPLAYER M2 (client smoothing): INTERPOLATION so the
  ~20Hz server snapshots render as smooth 60fps motion. `NetClient` now keeps a
  small ring BUFFER of recent snapshots (`_buf`, last 12, with client-clock
  arrival times + `lastSnapAt`); `interpPositions(rt)` finds the two snapshots
  bracketing render time `rt` and lerps every car + the boss (position + a
  shortest-path angle lerp). `applyOnlineSnapshot` renders REMOTE cars + the
  boss at `rt = now - 100ms` (INTERP_DELAY) = interpolated in the recent past;
  the LOCAL car instead eases toward the latest authoritative position
  (`SELF_SMOOTH` 0.35 exponential, hard-snaps on respawn/teleport > 220px) so
  your own driving keeps ~zero added lag; bullets extrapolate straight-line
  along their velocity to the same `rt` so shots stay visually consistent with
  the cars that fired them. Static entities (mines/scrap/crates/drops) + self
  HUD stats stay on the latest snapshot. No server or protocol change — pure
  client render smoothing. Gated by interp-test.js (midpoint lerp, short-path
  angle wrap across pi, clamp before-oldest/after-newest, newly-appeared car
  uses latest, null boss) + full 6-suite regression green; live screenshot
  confirmed correct render (self drove to LVL 2, spend-points panel + boss bar
  + bot + leaderboard all intact). NEXT (M3): true local INPUT PREDICTION +
  server reconciliation (input seq numbers + replay) for zero-lag self motion
  under real latency; online loot/loadout UI; reconnect/room-list polish.
- **2026-07-11** — MULTIPLAYER M1: CLIENT ONLINE MODE (the browser plays the
  authoritative server's world; closes the M1 loop). `js/net.js` `NetClient`
  opens a WebSocket, JOINs a room (`{type:"join",room,name}`), streams local
  INPUT up each frame and stashes the latest world SNAPSHOT; `onState`
  callback drives the join UI. Start screen gained a red PLAY ONLINE button →
  `#online-screen` join form (server address / room code / name, remembered in
  localStorage). While online the client STOPS simulating: `onlineFrame()`
  replaces the local `active.update` loop — it sends input (`readDrive` +
  `mouseWorldAngle` aim), then `applyOnlineSnapshot()` rebuilds `arena`'s
  entities from `net.snap` (Cars cached by netId; humans → `players[]` with
  the local one blue + others teal/named via the M0 `drawPlayerCar` path, bots
  → `bots[]`, plus bullets/mines/scrap/crates/drops/boss/leaderboard/camera)
  so the EXISTING renderer + HUD draw the server's world with no renderer
  changes. Spend-stat + respawn + MAIN MENU route to the server when
  `onlineActive` (`{type:"spendStat"|"respawn"}`; server got a `spendStat`
  handler); offline paths untouched. Load order: `net.js` right after
  `theme.js`. Server snapshot now includes the boss radius + the self player's
  xp/statPoints/stats/slots. DEV/preview hooks (match the existing `?screen`/
  `?mode` convention): `?connect=ws://host&room=CODE&name=X` auto-joins on
  load, `&drive=t,s` feeds a constant throttle/steer for screenshot testing.
  New `tools/shot-live.js` — a REAL-TIME (CDP, non-virtual-time) headless
  screenshot so realtime ws streams can be captured (the `--virtual-time-
  budget` `shot.js` can't wait for a live socket). VERIFIED end-to-end: local
  gated server (`ROOM_CODE=TEST`) + two headless browsers both render one
  shared world — each sees the other human as a distinct teal named car
  alongside red bots (RUSTBUCKET L10 / OVERDRIVE L3), the roaming Magnet boss,
  loot chips, minimap + live leaderboard; server logged "2 online"; the
  spendStat/respawn/input messages keep it ticking without crashing. Full
  6-suite regression green. NEXT (M2): client-side interpolation + input
  prediction (snapshots are ~20Hz, currently rendered raw = slight stutter);
  online loot/loadout UI (equip is server-side, panel hidden in M1);
  reconnect/room-list polish.
- **2026-07-11** — MULTIPLAYER M0 steps 2-4: N-PLAYER SIM (offline; still one
  local human, but the sim now carries N). Every per-human method takes an
  optional `player = this.localPlayer` arg (so all existing zero-arg call sites
  + tests are unchanged) and uses `player.car`/`player.hp`/... instead of
  `this.*`: resolvePlayerInputs, updateRam, updateWeapon, updatePlayerHook,
  updateRailgun, playerAimAngle, hasRam/hasRailgun/hasMinelayer, addXp, levelUp,
  spendStat, applyStats, healFromScrap, xpToNext, damagePlayer, respawnPlayer,
  playerDeathDrop. Combat routing generalized: `cars()` = every player car +
  bots; new `playerOf(car)` (the multi-player replacement for `car ===
  this.player`) drives `isDeadCar`, `hurtCar`, `minelayerTierOf`; damage to any
  player's car routes to that ArenaPlayer. Local-only feedback (level-up
  banner/jingle, WRECKED/RESPAWNED banners, game-over sound, spectate) is gated
  on `player.isLocal`. UPDATE LOOP restructured: the WORLD always sims (one code
  path — the old alive/dead branch split is gone; spectate-parity is now
  structural), each ALIVE player runs `updatePlayerDrive` (ram/drive-from-own-
  input/walls/weapons) BEFORE the world step, then per-player scrap-XP + wheel-
  mend + regen after — RNG-consumer order preserved byte-for-byte (determinism
  green). RENDER: the world pass draws EVERY alive player car via
  `drawPlayerCar` (local = blue, other humans = teal + name/level tag, green HP
  bar); on-car railgun state reads `playerOf(car)`. `ArenaPlayer` gained
  `_fireActive`/`_abilityHeld`/`aimAngle` (a remote player supplies aimAngle
  from its input stream; local uses the cursor). Fixed a test flake exposed by
  the parity-buffed bots (arena-test's camera check now neutralizes combat up
  front — a dead local player correctly freezes the camera, which isn't what
  that foundation test measures). Gated by a new 2-player test (2nd player
  drives + fires from its own input, per-player damage routing, local
  unaffected) — 8/8 stability + full regression green. NEXT: M1 — a Node + `ws`
  server runs this sim headless, 2 browsers connect and render server snapshots.
- **2026-07-11** — MULTIPLAYER M0 step 1: PLAYER STATE EXTRACTION (user:
  started the multiplayer effort; decided friends-first rooms, Node + `ws`
  server, and to do the offline N-player refactor first). New `ArenaPlayer`
  (js/arena/arena-player.js) owns one human's game-state — car, progression
  (level/xp/stats/loadout/slots), combat (hp/maxHp/dead/kills/nemesis/streak/
  outOfCombat), and weapon cooldowns (ram/hook/railgun). ArenaGame now holds
  `this.players` (a list) + `this.localPlayer`; `defineLocalPlayerAccessors`
  installs get/set proxies so `this.hp`/`this.stats`/`this.loadout`/
  `this.level`/`this.player`/... all route to `localPlayer` — every existing
  call site in arena.js/arena-render.js/main.js AND all 6 test suites are
  UNCHANGED and green. Behavior-preserving structural change: WHERE the state
  lives moved, not what it does. reset()'s field assignments route through the
  accessors so its body was untouched. NEXT (M0 step 2): generalize the
  per-human sim methods (updateWeapon/updateRam/updatePlayerHook/updateRailgun/
  damagePlayer/regen/driving) to take a `player` arg + loop over players[], so
  multiple humans can be simulated; then split input from control (step 3) and
  render all player cars (step 4), before any networking (M1). Gated by a new
  M0 test (localPlayer/players wiring + accessor proxying).
- **2026-07-10** — GLOBAL damage/health halving + guide fixes (user).
  (1) HEALTH stat halved: +25 → +12.5 maxHp per point (player AND bots — one
  formula each, tooltip updated). (2) ALL weapon damage halved for everyone
  (parity table = one change covers both): cannon 26 → 13, shotgun pellet
  22.5 → 11.25, `MINE_BASE` 135 → 67.5 (hook blast follows automatically),
  `RAIL_DMG` 97.5 → 48.75. Hook grab chip (15) + boss attacks untouched.
  Net effect: fights last longer relative to the parity-buffed fire rates.
  (3) Field guide: killed the horizontal scrollbar (`.menu-panel` gets
  `overflow-x: hidden` + a `> * { max-width: 100% }` guard — the 700px
  arena-guide grid exceeded the 760px panel minus padding) and fixed stale
  copy ("two Weapon slots" → the single-slot reality, wrecks AND crates).
  Tests updated to the constants (not literals) where possible.
- **2026-07-10** — Junk Titan shells 3x faster (user): heavy-cannon interval
  0.7s → 0.233s (still gated on the FRONT plate surviving + 820px range; the
  shells remain slow/dodgeable strength-3 rounds — it's a barrage now).
- **2026-07-10** — FULL PLAYER/BOT PARITY (user Q&A: full weapon parity +
  exact player stat formulas + bot regen). WEAPONS: a shared `WEAPON_STATS`
  table (arena-parts.js) now feeds BOTH the player's `updateWeapon` and the
  bot fire code — identical damage, fire intervals (bot cannon 0.7s → 0.3s!),
  bullet speeds/life, tier scaling (damage x1+0.12t, rate x1+0.10t x reload);
  bot farm-shots use the same cannon round; `mineDamageOf` lost its bot-level
  term (everyone = MINE_BASE x tier); `fireRailgun` lost the bot +1%/level;
  bot railgun reload = the player's RAIL_CD/reload formula. CHASSIS/STATS:
  bots now use `ARENA_BASE` (was a slower BOT_BASE), turnRate 2.9, and the
  player's EXACT maxHp formula `100 + 25·health + 20·armorTier` — the old
  `80 + 20·level` is GONE; instead a level-N bot spawns with N-1 stat points
  spent randomly (`spendRandomStat`), so level matters only through points +
  gear, like the player. REGEN: bots carry the full stat set incl. REGEN —
  same 2%/s base +0.5%/pt after 5s without a hit (`outOfCombat`, reset in
  `hurt`), and REGEN trims their wheel-mend gate 0.5s/pt too. Bots are
  markedly deadlier now (3x cannon fire rate, real mines at low level) —
  their personas (aim scatter, reaction delay, hookErr) are the only
  handicap; all combat dials now live in ONE table. Test fallout fixed
  (duel/spectate tests isolate with unkillable pins — parity guns wreck bots
  mid-test otherwise; L1-bot-vs-player car compare pins common gear). Gated
  by a new parity section (shared cannon round dmg/speed/life/interval, no
  mine level term, player HP formula, N-1 spawn points, bot regen + hit
  reset, base-car equality) — 10/10 stability + full regression green.
- **2026-07-10** — Magnet armor HARDENED (user bug report + rule change):
  outside its OVERLOAD window the Magnet now takes damage from the hook
  BLAST ONLY. Closed the two other bypasses: (1) mines dragged into its core
  pop HARMLESSLY on the armored hull (clank; they still chunk 3x during
  overload) — the old "mines are its weakness" design is retired; (2) the
  hook's GRAB chip no longer bypasses (`hurtBoss` without the bypass flag —
  it clanks while armored; `hookBossImpact`'s detonation keeps the bypass).
  Bot AI updated: minelayer bots now ALSO bait the overload instead of
  feeding mines into armor (their hook stays the anytime contribution); the
  Arena field guide's Magnet entry rewritten (hook detonation is the only
  armor-piercer). Gated by arena-level-test.js (armored mine = no damage,
  overloaded mine = damage, grab chip clanks, blast still bypasses) — 5/5
  stability + full regression green.
- **2026-07-10** — Weapon-select grid is a 2x2 SQUARE (user): `#weapon-grid`
  flex-wrap (3+1) → CSS grid `repeat(2, 1fr)`, cards centered per cell.
  Desktop + mobile screenshots green.
- **2026-07-10** — Layout editor entry moved to OPTIONS + TAB toggle + ONE-BIG-
  PANEL menus (user, 3 asks). (1) EDIT HUD LAYOUT left the pause screen: it's
  now an Options row (HUD LAYOUT: EDIT + RESET, "(TAB)" kbd hint); the button
  stays Arena-only via the same show/hide in the two togglePause fns. (2) TAB
  toggles the editor from ANYWHERE in an Arena run: it pauses the world under
  the editor and exits back to where you came from (`layoutEditReturn`:
  "options" | "pause" | "resume" — TAB from live play returns straight to
  play); ESC also exits the editor cleanly (guard at the top of the ESC
  chain); browser focus-cycling suppressed. (3) EVERY overlay menu's content
  now sits inside ONE `.menu-panel` container (user pick: flat rows +
  dividers, applied to ALL overlays): weapon-select, pause, options, both
  guides, death menu, game-over — wrapped via a depth-matching HTML transform;
  `.options-row` lost its per-row box (full-width flat line, `+`-sibling
  divider, label flex-left) and the panel is scrollable at `max-height: 94vh`
  (start screen untouched — it has its own backlog item). Desktop + mobile
  screenshots of options/pause/weapon-select green; full regression green.
- **2026-07-10** — HUD LAYOUT: UI SCALE + drag-to-reposition (user Q&A;
  closes the backlog item; DISMEMBERMENT-BEYOND-WHEELS dropped from the
  backlog per user). `ArenaRenderer.layout = {scale, pos}`: four movable
  CANVAS GROUPS — "hud" (LVL panel + gauges; the DOM stat/loadout column
  follows via `positionArenaDom`), "minimap" (leaderboard rides along),
  "killfeed", "bossbar" — each draw fn wrapped by `wrapGroup(key, defX, defY)`
  (translate→scale→untranslate, so internal draw code runs UNCHANGED; anchors
  stored as VIEWPORT FRACTIONS = resize/aspect-safe). TOUCH CONTROLS
  (joystick/FIRE/DRIFT/ability/pause) store window-fraction overrides under
  "dom:<id>". EDITING: desktop holds **H** and drags (H suppresses firing via
  `input.layoutEdit` in resolvePlayerInputs); the pause screen's EDIT HUD
  LAYOUT button (Arena-only; game.js hides it in Gauntlet) hides the overlay
  for drag-anything mode with a floating DONE — the touch path, but mouse
  works too. Dashed labelled outlines + a hint render via `drawLayoutEdit`
  while editing. UI SCALE: one global slider in Options (70-140%) — canvas
  groups scale in their wraps, DOM panels + touch controls via a `--ui-scale`
  CSS var (transform: scale). RESET LAYOUT button restores defaults.
  Persisted per DEVICE TYPE (`sd_layout_desktop`/`sd_layout_touch`) — the
  {scale, pos} blob is the thing a website account profile syncs per-user
  later (user). TDZ trap dodged: `fit()` calls the hoisted
  `applyTouchControlLayout` at boot before module consts init — the id list
  is inlined there. Preview `?mode=arena&layout[&edit]`. Gated by
  arena-level-test.js (default anchors, fractional overrides, group hit
  boxes) + full regression; desktop + mobile + options screenshots green.
- **2026-07-10** — Center-banner QUEUE (user: too many popups). Only ONE
  center banner shows at a time (`banners[0]`); new ones queue behind it.
  The active banner stays `BANNER_FULL` 3s when nothing waits, yields after
  `BANNER_MIN` 1s when the queue is backed up (queued banners start fresh —
  only the active one ages). LEVEL-UP banners are tagged (`kind: "level"`)
  and DEDUPE in the queue — fast leveling shows only the newest "LEVEL N"
  (the active banner is never cut). Queue capped at 6 waiting (oldest queued
  dropped) so a chaotic fight can't build stale backlog. `drawBanners`
  renders just the head with fade tied to its current stay time. Also added
  backlog item: POTENTIAL ITEM SET COMBINATIONS (set bonuses for matching
  parts). Gated by arena-level-test.js (3s solo, 1s yield + fresh start +
  FIFO order + drain, level dedupe keeps newest, active never deduped).
- **2026-07-10** — COLOR THEME system (user: no hardcoded UI colors). New
  `js/theme.js` loaded FIRST: a semantic `THEME` object (accent/text/danger/
  success/info/warn + gameplay identity: player/playerShot/enemy/botCar/boss/
  overload/tier colors) that canvas code reads directly AND self-injects as
  CSS variables (`--accent` etc.) so style.css shares it via `var()`. ~88 CSS
  + ~60 canvas replacements; `ARENA_TIERS` colors now reference THEME; the
  crosshair default color derives from `themeRGB(THEME.playerShot)`.
  CONSOLIDATION merges (user-approved, all near-identical): dim golds
  #a58a3d→#c9a227; borders #4c4238→#5a5148; deep bgs #17130f→#15130f; shop
  green #3c8f66→success; gray #777→textFaint; nemesis reds #ff5b4d/#ff3b30→
  enemy #ff5c5c; row text #d8cfc0→text #e8e2d6. NOT themed (by design):
  sprite/art tones (crate wood, boss hulls, wheels, floor, telegraph rgba
  effects) + the dormant Gauntlet canvas renderer (its DOM menus themed via
  shared CSS). Harnesses parse index.html script tags, so theme.js flowed
  into tests automatically. Screenshots pixel-identical pre/post; full
  regression green.
- **2026-07-10** — Shotgun 2.5x damage + red OFF chip (user). Player pellets
  9 → 22.5 x tier (a full 6-pellet point-blank volley ~135+ before armor);
  bot pellets (7+lvl) → (17.5+2.5·lvl), both x weaponMul. The crosshair
  picker's OFF chip (slashed circle) now always draws BRIGHT RED (#e0301e)
  regardless of the chosen crosshair color (`chipColor(style)` special-case).
- **2026-07-10** — Reload arc scoped to ABILITIES + arc toggle + slower blink
  + red OFF pills (user, 4 asks). (1) The crosshair's reload arc now shows
  ONLY deliberate long cooldowns: the railgun's reload and the minelayer's
  HOOK (`xhairCooldownFrac` reads `hookCd`/`hookCooldown`); cannon/shotgun/
  mines/ram show NO arc (`w.cdMax` removed — unused). (2) RELOAD INDICATOR
  toggle in Options (`#xhair-arc-btn`, persisted `sd_xhair_arc`) hides the
  arc entirely; the reload color-dim stays. (3) Despawn blink slowed AGAIN
  (user: still too fast): freq now 1→3 rad/s (6s → 2s breathing periods),
  alpha floor 0.45. (4) Option pill toggles generalized `#fullscreen-btn` →
  `button.option-toggle` (specificity-matched to beat `.overlay button`):
  OFF = BRIGHT RED (user), ON = green — fullscreen + reload-indicator both.
  Short-phone media block compacted further (6 options rows + BACK now fit
  390px). Desktop + mobile screenshots green.
- **2026-07-10** — Crosshair OFF + RGB color + calmer despawn blink (user, 3
  asks). (1) DESPAWN BLINK slowed way down: a dying ground part now pulses
  gently (`drawPartDrop` freq 6→32 rad/s reduced to 2→7, alpha floor 0.3 →
  0.35) — the old flicker was overwhelming. (2) Crosshair OFF: a 5th
  slashed-circle chip in the picker disables the reticle AND keeps the OS
  cursor visible (`updateCursor` gates on style !== "off"); the default stays
  the classic cross. (3) CROSSHAIR COLOR: an RGB slider row (R/G/B 0-255,
  per-channel accent colors + a live swatch) — the reticle, its reload-dim
  state (55% of the chosen color), and the preview chips all follow it;
  persisted as `sd_xhair_color`. Short-phone media block compacted so the
  taller options menu fits 390px (BACK was clipping). Desktop + mobile
  screenshots green.
- **2026-07-10** — Custom CROSSHAIR + options picker (user Q&A; closes the
  backlog item). The OS cursor is hidden while actually playing Arena
  (`updateCursor` in the rAF loop: only alive + unpaused; menus/death get it
  back) and replaced by a canvas reticle at the cursor
  (`ArenaRenderer.drawCrosshair`, drawn last in the HUD pass; desktop only —
  touch has no cursor). FOUR STYLES via the shared `drawCrosshairShape`
  (cross / dot / ring / chevrons, all dark-outlined for readability) + a
  RELOAD SWEEP: an arc closes around the reticle while the equipped weapon is
  on cooldown (railgun `railCd`, spammables via the new `w.cdMax` stored at
  fire time), the reticle dims while reloading and flashes white for 160ms
  when ready. OPTIONS MENU: a CROSSHAIR row of live canvas preview chips
  (gold border = active) + a SIZE slider (60-180%), both persisted
  (`sd_xhair_style`/`sd_xhair_size`), applied live via
  `arena.renderer.xhair`. All chip DOM calls stub-guarded (headless boot).
  Preview `?mode=arena&xhair` (fakes a cursor for screenshots). Platform gap
  (by design): no crosshair on touch — shots aim out the nose there.
- **2026-07-10** — BACKLOG-ARENA.md PRUNED (user): completed items deleted
  from the backlog (history lives in this changelog); stale text fixed
  (dual-slot references, old railgun charge description, removed durability
  stat); now a 30-item open list grouped gameplay / AI / world / meta / UI /
  big-lifts. RULE going forward: when an Arena item ships, DELETE it from
  BACKLOG-ARENA.md instead of marking it done.
- **2026-07-10** — Railgun damage halved (user): `RAIL_DMG` 195 → 97.5 (a
  full-tier-scaled slug two-shots most cars instead of one-shotting rookies;
  speed/reload/pierce unchanged).
- **2026-07-10** — Railgun DE-CHARGED + tooltip fix + tougher tires (user, 3
  asks). (1) The railgun's charge-up is GONE: it now fires a full-damage slug
  straight off the FIRE channel (left-click / auto-fire / touch FIRE) with
  just the long `RAIL_CD` 2.2s RELOAD between shots — `weaponAbility` returns
  null for it (no SNIPE button), `railCharge` deleted everywhere, the HUD
  gauge shows READY/RELOAD only, and the on-car visuals are ready-cyan vs
  reload-red coils + the refill bar (charge bloom removed). Bots fire it
  directly when lined up. (2) The RELOAD stat tooltip only mentions the hook
  cooldown while a MINELAYER is equipped (`statEffectText` gates on
  `hasMinelayer()`). (3) Higher-tier TIRES are harder to break: per-wheel
  pools retuned (`WHEEL_HP_BASE` 21 + `WHEEL_HP_TIER` 7) so legendary wheels
  (56) are EXACTLY 2x common (28). All gated in arena-level-test.js — 5/5
  stability + full regression green.
- **2026-07-10** — Railgun tuning + RELOAD audit + on-car sniper states (user,
  3 quick asks). (1) RAILGUN x3 DAMAGE + much faster slug: `RAIL_DMG` 65 →
  195, `RAIL_SPEED` 1250 → 2200 (near-hitscan), `RAIL_LIFE` 1.0 (~2200px
  reach). (2) RELOAD now works for EVERY weapon — audit found the RAM ignored
  it; its wind-up now builds `(1 + reload*0.08)x` faster (player) /
  `reloadMul()` (bots). Cannon/shotgun/mines/hook/railgun already scaled.
  Gated by a per-weapon reload test. (3) SNIPER STATE ON THE CAR: the rail's
  coil accents brighten with CHARGE + a growing cyan muzzle bloom (flares at
  full), and while RELOADING the coils dim red with a thin refill bar along
  the barrel — driven by `_railState` in `drawCar` for the player AND bots
  (you can see an enemy sniper spinning up). Test mode's tier buttons also
  spawn a railgun now. Preview `?mode=arena&railgun[&reloading]`.
- **2026-07-10** — Arena BOSS ATTACK BUFFS (user: "more attacks and firerate
  for current bosses"; no new boss, no scaling — kept flat). TITAN: heavy
  cannon fires every 0.7s (was 1.0) + a new SHRAPNEL RING — every 8-13s
  (seeded) with a car within 700px, a 0.6s spin-up telegraph (tightening
  orange band in `drawBoss`) then 12 evenly-spaced radial slugs (speed 250,
  dmg 16, gaps to slip between; fires even with plates gone). MAGNET: a new
  DEBRIS FLING — the instant its overload window closes it hurls 8 radial junk
  slugs (speed 330, dmg 20), punishing cars still hugging it when the
  vulnerability ends (`debrisFling`). Gated by arena-level-test.js (ring
  telegraph + 12 even slugs, fling on overload end) — 8/8 stability + full
  regression green.
- **2026-07-10** — Arena SINGLE WEAPON SLOT (user: "easier; might change it
  back"). The dual primary/secondary model is retired: `weapon2` stays a
  DORMANT null on the loadout (field kept for a future revival), `targetSlot`
  routes every weapon drop to `weapon1` (equip = replace + old weapon swaps
  out), `swapWeapons` + the ⇄ panel control + the WPN2 row are gone, and
  `hasRam`/`hasMinelayer`/`minelayerTierOf` read weapon1 only. INPUT MODEL
  simplified: spammables (cannon/shotgun/mines) on FIRE (left-click / F
  auto-fire / touch FIRE); HOLD abilities (ram CHARGE, railgun SNIPE) on
  LEFT-hold; the HOOK on RIGHT-click; ONE touch ability button
  (`#touch-ability2` dormant). `resolvePlayerInputs` → `_fireActive` +
  `_abilityHeld`. Start-screen hint updated. Test suites rewritten for the
  single slot.
- **2026-07-10** — Arena RAILGUN (user Q&A): a LOOT-ONLY sniper — never a
  starting pick (not in `ARENA_WEAPONS`/bot spawn pool); FOUND in crates (15%
  of weapon rolls, `ARENA_BASIC_WEAPONS` otherwise) and central-boss drops
  (`ARENA_WEAPON_TYPES` now includes it). HOLD left-click/SNIPE to charge
  (`RAIL_CHARGE_T` 1s, min 0.35 to fire), release a PIERCING slug: `RAIL_DMG`
  65 x tier x charge, speed 1250, ~1750px reach, `strength` 3 shared between
  bullet clashes AND a pierce budget (`pierceStep` in updateProjectiles) —
  each car costs 1 (full damage each, once, via `hitSet`), a WHOLE drained
  scrap pile 1.5 ("two piles' worth", pays XP/heal to the shooter), mines
  detonate + crates break for 1 each, a BOSS absorbs it outright. Cooldown
  `RAIL_CD` 2.2s / reload. BOTS use looted railguns (charge while lined up →
  lead the slug). Render: long rail barrel + coil accents (`drawWeaponGear`),
  white-hot lance slug (`drawBullet`), SNIPE/RELOAD charge gauge in the HUD.
  Fixed en route: fresh cars have `stunT` undefined — gate with `> 0` checks,
  never `<= 0`. Preview `?mode=arena&railgun`. Gated by arena-level-test.js
  (charge-release + fizzle + cooldown, pierce-two-cars full damage, 2-pile
  budget, loot-only asserts, bot fires it) — 10/10 stability + full regression.
- **2026-07-10** — Arena FAIRNESS batch (user): (1) BOT ATTACK GATE — bots
  only attack the PLAYER when they'd be visible on the player's screen
  (logical 1280x720 rect) AND after a human-ish REACTION delay:
  `persona.reactionT` (0.2-0.55s roll), `playerSeenT` tracks continuous
  on-screen time (off-screen resets it, so every re-entry pays the delay).
  Gates gunfire/mines (`attackGate` in the fire block), the hook throw, and
  ram wind-ups; bot-vs-bot/boss combat ungated. (2) CRATES never SPAWN inside
  the player's view frame (`cratePos` rejects the view rect + 80px margin) —
  no loot popping into existence on screen. (3) REGEN also trims the WHEEL
  mend gate: 0.5s per point (10s → 5s at max), via `tickWheelRepair`'s new
  `delay` param (player only; bots keep 10s). All gated by arena-level-test.js
  (off-screen never fired on + reaction delay + reset-on-exit, 40 cratePos
  rolls all outside the view, wheel mend at 7s with REGEN 6).
- **2026-07-09** — Arena LOOT CRATES (user Q&A; closes the "map loot spawning"
  backlog item). `CRATE_COUNT` 7 destructible crates scattered around the map
  (seeded `cratePos`: away from the center boss, the player, and each other) so
  ROAMING pays off. Crack one with 2 bullet hits (`CRATE_HP`, splinter-crack
  visual after the first), by driving through it faster than
  `CRATE_BREAK_SPEED` 60 (a parked car resting on one is safe), or with a mine
  blast (`detonateMine` pops crates in radius). Always drops ONE part a step
  above starting gear (user: 70% UNCOMMON / 30% RARE, any slot — the player
  already starts with commons), then respawns somewhere else 30-60s later (`updateCrates`, run
  in alive + dead branches — spectate parity). BOTS (user spec): when NOT in
  combat, a crate on the bot's SCREEN (logical 1280x720 rect, same gate as the
  hook) beats scrap EVERY time — they drive THROUGH it at speed (no arrival
  braking) so contact smashes it, then the drop flows through normal loot AI.
  Render: `drawCrate` banded wooden box + gold latch, slight seeded tilt,
  viewport-culled; no minimap marker (discovery reward). Preview
  `?mode=arena&crate`. Gated by arena-level-test.js (spawn count, 2-hit
  shoot-open + low-tier drop + 30-60s respawn relocate, smash-through +
  parked-safe, bot picks an on-screen crate over closer scrap) + crate
  neutralization added to 3 older idle-bot tests (farm-shot, moth-orbit,
  park-linger) whose destinations crates could divert — 8/8 stability + full
  regression green.
- **2026-07-09** — Arena WHEEL DISMEMBERMENT (user Q&A; the first slice of the
  shoot-parts-off pillar — WHEELS ONLY for now). Every arena car (player + bots)
  carries FOUR individual wheels (`wheelFL/FR/RL/RR` components; `setupWheels`
  sizes each `WHEEL_HP_BASE` 22 + `WHEEL_HP_TIER` 5 x (tires tier+1); damage
  FRACTION carries across a re-tier so equipping better tires never heals). A
  BULLET (or crash/hook chip) chews only the ONE wheel CLOSEST to the hit; an
  EXPLOSION (mine/slam) chews the TWO closest, splitting the chip (user spec) —
  `chipWheels` takes `WHEEL_CHIP` 40% of the dealt damage ON TOP of the hull
  damage, wired into `damagePlayer` + `ArenaBot.hurt`. PHYSICS: the four wheels
  fold into the Gauntlet's leftWheels/rightWheels side pools (`syncWheelSides`:
  side damage-factor = AVERAGE of its two wheels' factors, inverted back to an
  hp so `Car.integrate` applies its veer/grip/fishtail unchanged — one broken
  wheel = half the side penalty, all four = fishtail + 0.5x cap). Broken wheels
  STAY ON THE CAR as a debuff (user call — not loot; the tires part still drops
  on a full kill) and MEND after `WHEEL_REPAIR_DELAY` 10s without taking ANY
  damage, healing over `WHEEL_REPAIR_TIME` 4s (`tickWheelRepair` in the player
  alive update + `ArenaBot.update` — spectate parity holds). UI: per-wheel
  cues on the model (chip flash, browning, broken hangs askew + rusty, green
  mend pulse) PLUS a nose-up 4-pip WHEEL DIAGRAM in the top-left HUD panel
  (green→red per wheel, dark = broken, pulsing green = mending; shows the
  watched bot's wheels while spectating) — user asked for a readout beyond the
  model. Respawn = fresh wheels. Helpers in arena-bot.js next to `ramDamageMul`;
  no RNG. Preview `?mode=arena&wheels`. Gated by arena-level-test.js (1-wheel
  bullets + 2-wheel explosions + chip math, veer, half-penalty solo wheel,
  4-broken cap, 10s gate + gradual mend + hit reset, tier pools + fraction
  carry, respawn, bots) — 5/5 stability + full regression green.
- **2026-07-09** — Arena HOOK FAIRNESS pass (user; replaces the old
  "hook counterplay" backlog item). (1) Bots only THROW a hook when they'd be
  visible ON THE TARGET'S SCREEN — a logical-1280x720 rect centered on the
  target (`onTargetScreen` gate in the bot hook branch; deterministic
  regardless of window shape) — no more getting hooked by a car you can't see.
  (2) Bot hooks MISS more: a per-spawn `persona.hookErr` (0.08-0.18 rad,
  ~5-10°) smears every hook throw — much sloppier than gun `aimErr` (0.02-0.05).
  (3) A LAUNCHED RAM can't be GRABBED (user pick: "immune while launched
  only") — `updateHooks` skips `isChargingRam` cars in the grab sweep (head
  passes through); an already-grabbed ram stays grabbed, and the immunity is
  primary-slot-only like the other ram perks. Gated by arena-level-test.js
  (off-screen vertical throw blocked + on-screen throws, hookErr band +
  sloppier-than-guns, launched-ram pass-through + idle-ram grabbed).
- **2026-07-09** — FILL-THE-SCREEN + FULLSCREEN (user; area-locked, fair). New
  `VIEW` logical viewport in utils.js (separate from `WORLD`, the fixed Gauntlet
  play field). `fit()` in main.js AREA-LOCKS `VIEW` to the window aspect ratio
  (`setView(aspect)`: `VIEW.w = sqrt(AREA*ar)`, `VIEW.h = sqrt(AREA/ar)`, product
  = 1280*720 const), clamped to 4:3..21:9 (extremes letterbox). The canvas CSS
  fills the window at that aspect (uniform scale = NO distortion) and the backing
  store stays hi-dpi. RESULT: Arena fills the screen edge-to-edge on 16:10 /
  ultrawide / resized windows with no black bars, and every monitor sees the same
  visible AREA (fair — deliberately NOT the io-game "wider screen sees more"
  model, per user). Gauntlet keeps a fixed 1280x720 (letterboxed) since its arena
  has walls. All Arena viewport refs moved `WORLD.w/h → VIEW.w/h`: the
  ArenaRenderer transform + culling + all screen-space HUD (minimap/leaderboard/
  killfeed/boss bar/banners/death overlay/spectate label), the camera clamp
  (alive + spectate), the mouse→world aim mapping, and `positionArenaDom`'s scale.
  `fit()` re-runs on every mode switch so `VIEW` matches the active mode.
  Gauntlet render.js/ui.js untouched (`VIEW==WORLD` there). FULLSCREEN toggle
  added to the Options menu (`#fullscreen-btn`, ON/OFF pill, Fullscreen API on
  `documentElement`; browsers require a gesture to ENTER so the pref is
  remembered but not auto-applied on load; `fullscreenchange` → relabel + `fit()`;
  all calls guarded for headless). Verified no-distortion + correct HUD anchoring
  via screenshots at 2560x1080 (ultrawide), 1920x1200 (16:10), 1920x1080 (16:9),
  and 844x390 (mobile, now fills instead of letterboxing) + the Options toggle;
  full regression green. Backlog: the crosshair item + the broader screen-size
  audit (tiny phones/tablets/hit-targets) + UI scale/reposition remain open.
- **2026-07-09** — Arena scrap now HEALS the player (user): absorbing a FULL
  scrap pile heals 3% of maxHp (`SCRAP_HEAL_FRAC` 0.03), pro-rata for a partial
  absorption. `healFromScrap(drain, pile.maxAmount)` = `maxHp * 0.03 *
  drain/maxAmount`, clamped at maxHp, no-op while dead/pristine. Wired into BOTH
  player scrap paths (drive-over + shoot-to-harvest); still grants the same XP.
  Bots unchanged (scrap → XP only). Gated by arena-level-test.js (full pile =
  3%, half = 1.5%, clamps, dead-safe).
- **2026-07-09** — SPEND-POINTS panel moved to top-left under the HUD (user):
  `#arena-stats` restyled from a bottom-center dock to a left-column panel;
  `positionArenaDom` places it at logical (16,146) under the LVL/HP HUD and
  pushes the loadout panel below it when it's showing. Short-phone media block
  compacted. Also de-em-dashed the label ("SPEND POINTS: N").
- **2026-07-09** — PARTS/loadout panel opens on entering an Arena run (user):
  `loadoutOpen = true` set in `chooseWeapon` (+ the `?weapon=` preview + test
  mode); still toggleable with PARTS / L.
- **2026-07-09** — Player shooting is now 360° (user): `AIM_CONE` 0.6 rad →
  180° → 205° → `Math.PI` (full circle) — shots fire STRAIGHT at the cursor in
  any direction (the clamp is now a no-op; shots + hook aim identically).
- **2026-07-09** — Player-death drop + multiplayer level hook (user). PLAYER
  DEATH now drops ONE equipped part chosen at random, WEIGHTED toward the
  highest tier (weight `(tier+1)²`, same as bots' `pickDrop`) via
  `playerDeathDrop()` — was: always dropped `weapon1`. Bot-spawn level scaling
  now goes through `lobbyLevel()` (returns `this.level` today; the documented
  MULTIPLAYER hook to fold in all human players' levels — avg/max — later).
  Gated by arena-level-test.js (weighted-to-best drop). Map/box loot spawning
  still an open idea (see BACKLOG-ARENA).
- **2026-07-09** — Hook speed + reach are now FLAT at every tier (user): dropped
  the per-tier `HOOK_SPEED_MIN/MAX` for a single `HOOK_SPEED` 1270 (the old
  uncommon value); `HOOK_MAX_LEN` 375 for all tiers. Only mine/hook DAMAGE still
  varies by tier (`mineTierMul` 0.75→1.5). (`hookSpeedOf` now returns the flat
  value.)
- **2026-07-09** — Mine damage +50% (user): `MINE_BASE` 90 → 135, bot mine
  `24+2·lvl` → `36+3·lvl`. Since `mineDamageOf` is the single source, the hook
  detonation (1 mine to a car, 3× to a boss) scaled up with it automatically.
- **2026-07-09** — Death XP penalty harsher (user): respawn keeps 10% of your
  total XP (was 25%) — `respawnPlayer`'s `kept` 0.25 → 0.10. Kill reward (25% of
  a victim's XP) unchanged.
- **2026-07-09** — Fix: spawn at FULL HP. `begin()` ran `applyStats` (which sets
  maxHp 120 from the starting common armor) but never set `hp = maxHp`, so you
  started at 100/120 (83%). Added `this.hp = this.maxHp` in `begin()`. Gated by
  arena-level-test.js.
- **2026-07-09** — Spending HEALTH keeps your HP PERCENTAGE (user): `spendStat`
  captures `hp/maxHp` before `applyStats`, then sets `hp = frac * maxHp` — so a
  +25-max-HP upgrade at 70% leaves you at 70% of the new max (full stays full;
  non-health stats leave current HP untouched since they don't change maxHp).
  Gated by arena-level-test.js.
- **2026-07-09** — STAT-HOVER TOOLTIPS (permanent) + hook tuning. TOOLTIPS: the
  Arena SPEND-POINTS stat buttons now show a `#stat-tooltip` on hover with what
  the NEXT point does, current→next (HEALTH +25 max HP, SPEED +5% speed/accel,
  RELOAD +8% fire rate & the hook-cooldown drop, REGEN +0.5%/s) — `statEffectText`
  in main.js reads the live values. HOOK faster overall (`HOOK_SPEED_MIN/MAX`
  400/1000 → 750/1650). (Briefly tried carrying the car's velocity on the hook
  head — reverted per user; the hook travels at its own speed only.)
- **2026-07-09** — TEMPORARY TEST MODE (dev-only, user asked — DELETE LATER). A
  "🛠 TEST MODE" button on the start screen launches Arena (cannon) with a
  floating `#test-panel`: +1/+5/+10 LVL, HEAL, GODMODE toggle (`arena._godmode`,
  gated in `damagePlayer`), KILL ME (full death→respawn flow), SPAWN BOT at a
  typed level, spawn a full part set (every slot + ALL weapon types incl. the
  loot-only railgun) at any TIER, SPAWN TITAN/MAGNET, OVERLOAD (the Magnet),
  WRECK BOTS (test loot). All
  self-contained in clearly-commented blocks to remove when done: the
  `#test-panel`/`#test-mode-btn` HTML, the TEST MODE CSS block, `initTestPanel`
  (+ its call, the quitToMenu hide line, and the one `_godmode` line in
  `damagePlayer`). Not covered by tests (throwaway).
- **2026-07-09** — Weapon PRIMARY/SECONDARY input model (user Q&A, scalable) +
  hook/mine tuning. INPUT MODEL: each weapon declares an ABILITY via
  `ArenaGame.weaponAbility` (ram→CHARGE hold, minelayer→HOOK click, cannon/
  shotgun→none); `resolvePlayerInputs()` maps raw signals (mouseDown/hookHeld/
  autoFire/touchFire/touchAbility1-2) → `_fireActive` (spammables: cannon/
  shotgun/mines) + `_primHeld` (left) + `_secHeld` (right) per the loadout.
  SPAMMABLES fire on FIRE (left-click / auto-fire toggle / touch FIRE), both
  slots together — EXCEPT a primary click-ability (minelayer hook) claims
  left-click, so spammables (its mines) go on the auto-fire toggle only.
  ABILITIES bind by slot: PRIMARY → left-click, SECONDARY → right-click (a
  hold-charge ram coexists with spammable fire on left; the hook claims left).
  `updateRam`/`updatePlayerHook` fire off the ram/minelayer's SLOT channel;
  `updateWeapon` gates on `_fireActive`. Bots unaffected (single weapon =
  primary). TOUCH: the HOOK button became two ABILITY buttons (`#touch-ability1`
  primary / `#touch-ability2` secondary), labelled HOOK/CHARGE + shown per
  equipped ability by `updateAbilityButtons` in main.js. Start-screen hint +
  input.js signals updated (removed `input.hook`/`touchHook`). MINE DAMAGE now
  scales with the minelayer TIER (user): `mineTierMul` 0.75× (common) → 1.5×
  (legendary) on `MINE_BASE` 90 (single source `mineDamageOf`; bots also ×level).
  HOOK is SLOWER + tier-scaled (user, harder to land): extend speed 1600 →
  `HOOK_SPEED_MIN` 400 (common, easy to dodge) … `HOOK_SPEED_MAX` 1000
  (legendary; stored per-hook), reel time 0.5 → 1.2s. HOOK DETONATION now 1 mine to a car
  (was 2), TRIPLE a mine to a boss. Bot hook-lead + player mines read the
  tier-scaled values. Gated by arena-level-test.js (input-model: primary=left/
  secondary=right, mines-on-auto-fire, touch buttons; mine 0.75/1.5×; hook
  speed rises small with tier) + updated ram/minelayer/mine tests + touch
  screenshots — 12/12 stability + full regression green.
- **2026-07-09** — MINELAYER HOOK (signature feature, user Q&A). A grapple that
  grabs the first car in its path and REELS it toward you (into your minefield).
  Separate input from FIRE/autofire (user): desktop RIGHT-CLICK fires it
  FULL-CIRCLE toward the cursor — no forward-cone clamp, unlike shots
  (`mouseWorldAngle` split out from the cone-clamped `playerAimAngle`);
  `input.hook` = right-mouse `hookHeld` (contextmenu suppressed);
  touch gets a HOOK button (`#touch-hook`, auto-aims the nearest car in reach
  since there's no cursor). `ArenaGame.hooks` = active grapples; `fireHook`
  (one at a time per owner), `updatePlayerHook` (gated by `hasMinelayer()` +
  `hookCd`), `updateHooks` extends the head at `HOOK_SPEED` 1600 to `HOOK_MAX_LEN`
  750 (long leash), grabs the first car within `HOOK_HEAD_R`, chips `HOOK_DAMAGE`
  15 on the grab (user: pulled + small damage), then reels it to the owner over
  `HOOK_REEL_TIME` 0.5s. CONTACT DETONATION (user): when the reeled car reaches
  the hooker's BODY it blows up (`hookImpact`) — launches the two apart + deals
  TWO MINES of damage (`2 * mineDamageOf(owner)`, scales with the hooker's
  minelayer) to the HOOKED car ONLY (not the hooker); srcType "mine" so it
  bypasses ram frontal immunity. STUN (user): a hooked car is stunned
  (`stunT`, can't shoot/mine/hook/ram-charge) while reeled AND `HOOK_STUN_AFTER`
  0.5s after — gated in the player's updateWeapon/updatePlayerHook and the bot's
  fire/hook/ram branches. BOSS HOOK (user): hooking a boss INVERTS the reel —
  the boss is too big to pull, so it drags the HOOKER to IT (`reelingBoss` skips
  `collideBoss` so only the boss takes the blast); chips on grab + detonates for
  2 mines to the BOSS ONLY, bypassing the Magnet's armor (`hurtBoss(...,
  bypass=true)` — hurts it even when not overloaded); boss never stunned/moved;
  hooker flung out, takes no damage. Bots hook bosses too (boss-exclusion
  dropped from their gate). MINE DAMAGE doubled + single-sourced (user): both
  the dropped mines AND the hook blast now read `mineDamageOf` (player 60·tier,
  bots 2× base) — change it in one place and both update; the blast stays
  `2 * mineDamageOf`. Bots now LEAD their hooks (`arenaAimPoint(this, target,
  HOOK_SPEED, persona.lead)` — the same predictor as their shots, with the
  hook's travel speed) so they land on crossing targets instead of firing at the
  target's current spot. Cooldown between hooks scales with RELOAD —
  `hookCooldown` drops it linearly from `HOOK_CD` 6s (reload 0) to `HOOK_CD_MIN`
  4s (max reload), set at fire (miss included);
  misses die at max reach / a wall. BOTS too (user): minelayer bots fire a hook
  at an in-range car (not a boss) to drag you into their field (`hookCd`
  staggered per spawn). Renderer `drawHook` draws a dashed chain + head, yellow
  for yours / red for others (matches bullets/mines); runs in the alive AND dead
  (spectate) branches. Touch button added to the FIRE/DRIFT row (HOOK·DRIFT·FIRE,
  screenshot-verified). Preview `?mode=arena&hook`. Gated by arena-level-test.js
  (grab → reel-in → chip damage → spent; one-at-a-time; miss at range; a bot
  hooks an in-range target) — 12/12 stability + full regression green. NOTE:
  closes the long-standing "minelayer HOOK" backlog item; still open on the
  weapon: bot mines-first-then-hook coordination, hooked-target counterplay.
- **2026-07-09** — `F` is now an AUTO-FIRE TOGGLE (user), not hold-to-fire:
  pressing F flips `Input.autoFire` (once per press — OS key-repeat ignored via
  `e.repeat`), which keeps `input.fire` true until pressed again. Left-click +
  the touch FIRE button remain hold-to-fire. Applies to both modes (shared
  Input). Start-screen hint updated ("LEFT CLICK to fire · F toggles
  auto-fire").
- **2026-07-09** — Player MOUSE-AIM cone + narrowed bot fire cone + spectate
  build readout (user). (1) MOUSE AIM: the player's shots no longer fire on a
  single fixed line out the nose — on desktop they fire toward the CURSOR,
  clamped to a small forward cone (`AIM_CONE` 0.6 rad ≈ ±34°), still originating
  from the front of the car (`ArenaGame.playerAimAngle` maps client mouse →
  logical viewport → world via the camera; cannon + shotgun both use it, recoil
  follows the shot). Input now tracks `mouseX/mouseY` + `hasMouse`. On TOUCH /
  before the mouse moves, shots go straight out the nose (mobile unchanged —
  the one platform gap: no cursor aim on touch). (2) BOT FIRE CONE narrowed
  (user, "might mess up how they shoot"): `persona.fireArc` 1.7-2.3 → 1.2-1.6
  rad, so bots only fire when reasonably lined up instead of spraying sideways
  (verified bots still land shots — duel/combat tests green). (3) SPECTATE
  BUILD: while spectating a bot, the top-left HUD panel now shows THAT bot's
  LVL + HP/XP bars + stat build (health/speed/reload — no regen row; bots have
  no regen) in a reddish tint, and its unspent-points line if any (bots
  auto-spend on level-up, so it's normally absent — the line still shows for
  the player). `drawHud` sources its subject from `spectateTarget()` while
  dead+spectating, else the player; the ram charge gauge is alive-player only.
  Gated by arena-level-test.js (mouse dead-ahead → 0, 90°-off clamps to the
  cone edge, within-cone partial aim, touch ignores the mouse, bot fireArc
  band) + spectate screenshot.
- **2026-07-09** — RAM frontal block now requires ACTIVELY RAMMING (user): the
  front only shrugs damage while LAUNCHED + MOVING (`ramLaunchingFast` =
  `ramBoostT > 0 && speed > RAM_BLOCK_SPEED` 60), NOT while winding up the
  charge (dug in). Winding up (ramCharge>0, not launched) or a stalled launch
  now takes normal 35%-off damage — you can shoot a ram that's revving up. The
  `charging` arg to `ramDamageMul`, the player's mirrored `chargingRam` flag,
  and `isChargingRam` (the head-on charge-vs-charge check) all switched from
  `ramCharge>0 || ramBoostT>0` to `ramLaunchingFast`. Gated by arena-level-test.js
  (winding-up + stalled-launch frontal bullet both take 35%, launched+moving
  immune).
- **2026-07-09** — Shotgun pellet clash strength set to 0.35 (user): pellets are
  weak in the bullet-clash system, so a normal cannon bullet (strength 1) is
  eaten crossing ~3 pellets before it breaks (sequential pairwise resolution:
  breaks 2 outright, dies on the 3rd) — shotgun blasts can't out-trade a cannon
  round at range. Player + bot pellets both set `b.strength = 0.35`. Gated by
  arena-level-test.js (pellet strength + cannon-vs-3-pellets clash).
- **2026-07-09** — Arena boss-movement + bot-vs-Magnet AI (user Q&A). MAGNET
  MOVEMENT: the Magnet now HUNTS the nearest living car (slow relentless stalk,
  `boss.prey`) instead of random-waypoint roaming — its pull field is a MOVING
  threat you must keep fleeing (maxSpeed 55→60). JUNK TITAN movement unchanged
  (slow crawl toward nearest — user kept it). MAGNET made HARDER (user: must be
  tough, not easily outplayed): coreHp 1400→1800. BOTS vs MAGNET (new
  `magnetTarget`/`magnetVuln` awareness in `ArenaBot.update`): (a) they HOLD AT
  THE PULL'S EDGE — the circle-strafe ring is pinned to `MAGNET_PULL_R*~0.82`
  (out of the crush) instead of the persona orbit range; (b) gun bots BAIT THE
  OVERLOAD — cannon/shotgun hold fire vs the armored Magnet (shots just bounce)
  and only open up during its overload window, while minelayers keep FEEDING
  MINES into the pull anytime (mines are its weakness); (c) a RAM vs a
  non-vulnerable Magnet doesn't charge into the crush — it falls through to the
  ring-orbit (holds at the edge) and only commits its charge once the Magnet
  overloads (`ramEngaged` gates `updateRam`). Gated by arena-level-test.js
  (Magnet turns toward its nearest prey; a gun bot holds fire vs the armored
  Magnet and opens up when it overloads) — 12/12 stability + full regression
  green.
- **2026-07-09** — Arena small-batch (user): (1) RAM FRONTAL CRASH refined —
  while charging, a ram-primary now takes crash damage on the nose ONLY if the
  OTHER car is ALSO a charging ram (head-on charge-vs-charge resolves duels);
  plowing anything else, or a non-charging ram, does 0 frontal crash damage.
  Frontal bullets still fully immune while charging; mines always hurt; 35% off
  everything else. `ramDamageMul` now takes the attacking `source` +
  `isChargingRam(car)` (uniform via a `chargingRam` flag mirrored onto the
  player car in `updateRam`, read off `weapon`/charge state for bots);
  `hurtCar`/`damagePlayer`/`ArenaBot.hurt` thread `source`. (2) RESPAWN WEAPON
  RE-PICK — the death/spectate RESPAWN buttons now reopen the weapon-select
  screen (`openRespawnWeaponSelect`, a `weaponRespawn` flag branches
  `chooseWeapon`/`backToStart`); `respawnPlayer(weapon)` spawns with the chosen
  weapon and makes it the new default `baseWeapon` (omitting keeps the last).
  `updateDeathUI` is gated on `!weaponRespawn` so the death/spectate overlays
  don't re-show on top of the picker while you're still `dead` (preview
  `?mode=arena&respawnpick`).
  (3) WALL-CLAMP fix — the roaming Magnet (unlike the stationary Titan) could
  shove a wall-pinned car out of bounds via `collideBoss` (no re-clamp);
  `updateCollisions` now re-clamps every living car to the world after all
  pushes. Gated by arena-level-test.js (ram: frontal crash from a non-charging
  foe = 0, from a charging ram = 35% off, rear/mine still hurt; respawn re-pick
  equips + updates default) + arena-test hardened (neutralizes the boss/bots
  for the pure movement/bounds check). NOTE: session permission-rule edits to
  `.claude/settings.json` only take effect next session start.
- **2026-07-08** — Arena backlog batch 4 (user Q&A: Magnet boss + field guide
  built; roaming events + head-start meta skipped). (1) THE MAGNET — a SECOND
  central boss (`ArenaMagnet` in arena-boss.js) that ALTERNATES with the Junk
  Titan on respawn (`spawnCentralBoss` seed-picks; the Titan still leads). A
  ROAMING gravity well: a constant inward pull (quadratic ramp within
  `MAGNET_PULL_R` 640) you fight with throttle; it periodically freezes +
  telegraphs a hard MEGA-PULL (`ArenaGame.magnetMegaPull` — yank + heavy
  falloff damage) then OVERLOADS for ~2.6s, its ONLY vulnerable window (normal
  weapons pling off otherwise — `hurtBoss` branches on `kind==="magnet"`, plays
  a clank). It drags loose SCRAP toward the core (HEALS it) and MINES (bypass
  the armor = its weakness, credited to the mine owner), and CRUSHES cars
  mashed against it (`MAGNET_CRUSH_DPS`). Full boss generalization: `kind`/
  `name`/`tagline`/`killXp` on both bosses; `nameOf`, `killBoss`, the
  first-encounter banner (`_sawBossKinds` per-type), the minimap diamond
  (purple vs gold), and `drawBossBar` (cyan "OVERLOADED" / "CHARGING!" states)
  all read the boss kind. Renderer `drawMagnet` — red/blue magnet poles, a
  faint pull-field ring + inward streaks, a collapsing mega-pull telegraph, a
  bright-cyan core while overloaded. Preview `?mode=arena&magnet[&overload]`.
  (2) ARENA FIELD GUIDE — a pause-screen reference (`#arena-guide-screen`,
  `buildArenaGuide` in main.js) built from the live ARENA_WEAPONS/ARENA_TIERS
  catalogs: WEAPONS (live portraits), PART SLOTS + 5 tier chips, STATS, and the
  two bosses. Shown via a `#arena-guide-btn` that appears only in Arena (the
  Gauntlet keeps its enemy guide); ESC/BACK → pause. Preview `?mode=arena&
  guide`. Gated by arena-level-test.js (new Magnet section: pull, overload-only
  vulnerability, mine-weakness + scrap-heal, mega-pull, kill/respawn, Titan/
  Magnet alternation) + boot-test (guide button wiring) — 12/12 stability +
  full regression + desktop & mobile screenshots (Magnet normal/overloaded,
  guide) green.
- **2026-07-08** — Arena backlog batch 3 (user Q&A: shotgun, ram defense,
  tires→handbrake; player shot-spread skipped). (1) SHOTGUN weapon (one new
  weapon end-to-end): a 6-pellet short-range cone (each pellet life 0.34s,
  speed 620) — devastating point-blank, useless at range as pellets fan out +
  die fast. Player fires the spread in `updateWeapon` (0.75s cd, heavy recoil);
  bots fire it ONLY within 340px (`ArenaBot.update` shotgun branch, else hold
  and close); twin stubby barrels in `drawWeaponGear`; added to
  `ARENA_WEAPON_TYPES` (so it flows through loot/drops/equip automatically) +
  the bot spawn weapon pool + the weapon-select screen (`ARENA_WEAPONS`).
  (2) RAM FRONTAL DEFENSE (user-refined): ONLY when RAM is the PRIMARY (weapon1)
  slot — a frontal BULLET while charging/ramming does 0 damage (bullets only,
  ~138° front arc); everything else (rear bullets, ALL mines + crashes,
  non-charging) is 35% off. Mines + crashes still hurt head-on so ram-vs-ram
  duels resolve (user call — no frontal stalemates). Shared
  `ramDamageMul(car, isPrimaryRam, charging, hitX, hitY, srcType)` in
  arena-bot.js; `hurtCar`/`damagePlayer`/`ArenaBot.hurt` now thread a hit
  position + srcType ("bullet"/"mine"/"crash"/"slam") from all 7 damage sites.
  Player + bots (a bot's single `weapon==="ram"` is its primary). (3) TIRES
  tier → sharper HANDBRAKE: both `applyStats` set `handbrakeBoost = 1.3 + 0.10*
  (tier+1)` (base 1.3 → ~1.8 legendary), so better wheels whip the nose around
  faster on a drift (player + bots). Gated by arena-level-test.js (new batch-3
  section: shotgun spread + short-range bot gate, ram frontal-bullet immunity
  vs crash/mine still hurting + secondary-grants-nothing, tires→handbrake) +
  a robustness fix to the standoff-dive test (re-pin a clean engaged setup so
  it's independent of the preceding spiral, since adding shotgun to the bot
  pool shifts the sim RNG stream) — 20/20 stability + full regression + shotgun
  screenshots (weapon-select card + in-game gear) green.
- **2026-07-08** — Arena backlog batch 1 (user Q&A, 3 of 4 built; AI
  chase-dodge dropped from backlog per user). (1) BOT MINE AVOIDANCE:
  `ArenaBot.avoidMines` projects ~0.4s ahead and, for any HOSTILE mine near
  that point (its OWN mines ignored), blends steering away — capped weight
  (≤0.8) so combat lines stay readable; runs each step right after wall
  avoidance, skipped mid ram-launch so charges stay committed. (2) DROPPED-PART
  DESPAWN BLINK: `drawPartDrop` flickers a ground part's alpha in its final ~8s
  (`remain < 8`), the blink frequency ramping ~6→~32 as `age → DROP_DESPAWN`,
  so you can see a drop about to expire and race for it (cosmetic — render-clock
  driven, no sim touch). (3) BIGGER NAME POOL + NO LIVE DUPES: `BOT_NAMES`
  expanded ~20→~78; `ArenaGame.uniqueBotName` draws WITHOUT REPLACEMENT (a name
  no living bot holds) so the leaderboard/killfeed never show duplicate handles
  in a run (seeded pick → deterministic; the `ArenaBot` ctor takes an optional
  `name`, `pick(BOT_NAMES)` fallback for direct test construction). Gated by
  arena-level-test.js (hostile-mine dodge + own-mine ignored, unique names hold
  across 28 spawns) — 5/5 stability + full regression (boot/arena/isolation/
  determinism/smoke) green.
- **2026-07-07** — Arena mine + spectate polish (user). (1) MINES DESPAWN:
  every mine carries `age`; `updateMines` marks it dead past `MINE_LIFE` (20s)
  so minefields don't linger forever (both player + bot mine pushes now seed
  `age:0`). (2) OWN-MINE OWNER-SAFE: `detonateMine` skips `m.owner` in its
  damage loop — shooting your own mine (3 hits) blows it up + catches nearby
  enemies (credited to the shooter) but never hurts you; matches the
  drive-over rule where a mine never triggers on its owner. (3) SPECTATE NEXT
  DEBOUNCED: holding N (OS key-repeat) or spamming the button no longer blurs
  through every bot — `trySpectateNext` in main.js gates `arena.nextSpectate`
  to one swap per 150ms (wall-clock `performance.now`); `nextSpectate` itself
  is unchanged so tests calling it directly are unaffected. Gated by
  arena-level-test.js (owner-safe blast + still-hits-others, 20s despawn) +
  fixed a class of test flakes the "any bot bullet harvests scrap" change
  introduced — combat/FFA/killfeed/nemesis tests now clear `scrap` before
  firing a bot/player bullet at a car so a random pile can't eat the shot
  (10/10 stability) + full regression green.
- **2026-07-07** — Arena slot/spectate/boss-UI mini-batch (user Q&A; skips →
  backlog). (1) WEAPON-2 OPEN FROM L1: the L10 unlock was cosmetic anyway
  (never enforced) — gate + banner removed, `SLOT_UNLOCKS` = armor@5 only,
  `slots.weapon2` deleted. (2) ONE WEAPON TYPE PER CAR: hard guard in
  `equipPart` (before the claim, so a refused equip doesn't consume the drop)
  — a weapon drop whose type matches the OTHER weapon slot is rejected;
  structurally unreachable today via type-matching targetSlot, guarded for
  future weapons/paths + invariant test (simulated buggy routing). (3)
  SPECTATE PARTS VIEW: while spectating, the `#arena-loadout` panel shows the
  WATCHED bot's four slots read-only ("NAME — PARTS", tier-colored, no
  pickups/swap; rebuilds on NEXT/handoff via a spectate signature;
  `buildLoadoutPanel` resets the title). (4) BOSS TITLE/BAR gated to ~1200px:
  `drawBossBar` returns unless the CAMERA (works alive + spectating) is
  within 1200px of the Titan. BACKLOGGED (user): per-weapon SECONDARY-slot
  behaviors (generalized from "ram can't charge in secondary"), in-game WIKI
  screen, AUTOMATIC REVIVE. Gated by arena-level-test.js (weapon2-no-gate
  asserts, dupe-guard refusal + drop-not-consumed) + full regression, 4/4
  stability + spectate-parts screenshot.
- **2026-07-07** — Arena FLEE is now OPPONENT-AWARE (user picks: veto +
  scaling + attacker-only bloodlust). The low-HP flee roll now reads the
  target's health (`foeFrac`: player = game.hp, Titan = hpFrac(), bot =
  hp/maxHp): (1) FINISH-HIM VETO — never flee from a foe in worse shape than
  me or under 15% HP (won fights get finished); (2) RELATIVE SCALING — flee
  odds ×= clamp(foeFrac/myFrac, 0.15, 1.5): healthy foes are fled as before,
  mutual wrecks slug it out; (3) BLOODLUST — if the enemy I'VE been hitting
  (its lastHitBy === me; playerLastHitBy for the player) drops under 20%, I
  commit 100%: fleeing disabled, `fightT` forced past escalateT (tight
  orbit), dive interval HALVED — but merely SEEING a stranger's dying victim
  changes nothing (user rule: attacker-only). Gated by arena-level-test.js
  (no flee from a dying/worse-off foe, healthy-foe critical flee unchanged,
  bloodlust escalation for MY prey + nothing for a stranger's) + a mine-test
  isolation fix (scrap/bots could eat its bullets) — 6/6 stability runs +
  full regression green.
- **2026-07-07** — Arena SPEND POINTS panel moved to the BOTTOM (user: it and
  the new top-center JUNK TITAN healthbar blocked each other). `#arena-stats`
  now docks flush to the bottom-center (bottom: 0, top-only radius, no bottom
  border; same in the short-phone media block) — clears the boss bar/banners
  entirely, and on touch it sits centered between the joystick and DRIFT/FIRE
  (screenshot-verified both viewports). The killfeed's touch-mode auto-hide
  gate (`touchMode && statPoints>0`) was removed — it existed only because the
  panel shared the top band; the feed now stays visible while points pend.
- **2026-07-07** — BATCH of 8 user-picked changes (14 queued via Q&A; 6
  skipped — see BACKLOG-ARENA "User queue"). (1) DURABILITY STAT REMOVED:
  player stats are now health/speed/reload/regen (bots: health/speed/reload);
  ARMOR's per-tier damage reduction doubled 0.05→0.10 (`partDmgReduce = 0.10 *
  tier+1` both classes); stat button/keys/HUD updated (keys 1-4). (2)
  SAME-TYPE WEAPON → MATCHING SLOT: `targetSlot` checks a weapon drop's type
  against weapon1 THEN weapon2 before the empty/secondary fallback — a
  higher-tier cannon now green-arrows + swaps into your cannon slot EVEN IF
  PRIMARY. (3) SHOOTABLE MINES: 3 bullet hits pop a mine (`m.hp ??= 3`;
  `detonateMine(m, source)` — AoE falloff dmg + knockback to cars/Titan,
  credited to the shooter; own-mine remote detonation allowed). (4) BOTS
  SHOOT-TO-FARM: farming cannon bots fire at their pile (60-420px, aligned,
  no audio); ANY gainXp-capable shooter's bullet harvests scrap into ITS XP.
  (5) LOW-HP FLEE: engaged bots roll to retreat on a 2-3.5s cadence (NOT
  per-frame — compounding; user spec), odds ((0.5-hp%)/0.5)^1.5×1.4×
  persona.cowardice under 50% HP; retreats reuse the escape run but survive
  hits (`fleeing` flag) unlike bored walk-aways. (6) LEVEL AGGRESSION:
  pickTarget's playerBias shifts −0.01/level (floor 0.4) + detect ranges grow
  +2%/level (cap +50%). (7) BOSS UI: plate-torn banners gated to within
  1000px (or you did it); `drawBossBar` pins a slim JUNK TITAN HP bar
  top-center whenever it's alive (y=64 while spectating to clear the button
  row). (8) ENDLESS GAUNTLET: mode renamed, start-screen button disabled +
  grayed ("COMING SOON", `.mode-disabled` CSS); page title → "Scrapyard
  Derby"; all Gauntlet code/tests intact. NOTE: a PowerShell text-replace
  mojibake'd arena.js mid-batch — repaired byte-exact via cp1252 round-trip;
  lesson: use the Edit tool for source edits. Gated by arena-level-test.js
  (new batch section: slot-match incl. primary replace, 3-hit mine pop +
  credit, bot farm-shot + harvest XP, critical-flee + hit-doesn't-cancel +
  full-HP-never, L21 detect range, banner gating) + durability asserts
  rewritten to armor + full regression, 5/5 stability runs + screenshots
  (start screen, boss bar, 4-stat panel).
- **2026-07-07** — Arena RAM handbrake NOSE-CUT (user: rams should handbrake
  to whip their front onto enemies "more often but not necessarily all the
  time"). In the ram combat branch: when badly off the intercept aim
  (>0.6 rad), moving (speed>90), and in range (td<500), the bot rolls against
  `persona.ramSnapChance` (0.45-0.8, per-spawn) — success opens a 0.25-0.45s
  handbrake window (`ramSnapT`, grip craters → the steer whips the nose onto
  the target), decline just starts a 0.8-1.6s re-roll cooldown (`ramSnapCd`),
  so the same situation sometimes snaps and sometimes muscles through.
  NEVER mid-launch (`ramBoostT>0` — charges stay committed). All rolls
  seeded-deterministic. Gated by arena-level-test.js (chance=1 snaps,
  chance=0 declines + cools down, launch-safe, persona band) — 5/5 stability
  runs + full regression green.
- **2026-07-07** — Arena PILE-ORBIT fix v2: speed-aware arrival + handbrake
  nose-snap (user: bots still circled scrap piles). ROOT CAUSE of the residual
  orbiting: `navTo`'s brake-to-turn only reduced THROTTLE, but in this drift
  model weak drag means cutting throttle doesn't shed existing momentum — a
  bot arriving at ~300px/s blew through the 44px capture window and lapped on
  momentum (give-up rescued it only after 16-24s). FIX 1 (speed-aware
  arrival): `navTo` now carries a distance-based speed BUDGET
  (`clamp(d*2.2, 70, maxSpeed)`) and applies REAL braking (throttle -0.55)
  whenever actual speed exceeds it — enforced physics, not hoped-for. FIX 2
  (user spec): a handbrake NOSE-SNAP — within 140px, more than 0.5 rad off,
  and moving (>60) → handbrake craters the grip so the steering whips the
  nose to FACE the item directly. `navTo` now returns `{steer, throttle, hb}`
  and `ArenaBot.update` plumbs `hb` into integrate (cleared during the
  wall reverse-out); all `navTo` users (loot approach, farm, escape runs)
  inherit both fixes. Gated by arena-level-test.js (over-budget → negative
  throttle, under-budget → none; close+off-angle+moving → hb, far → no hb;
  the moth-orbit reach + park-linger tests still pass) — 5/5 stability runs +
  full regression green.
- **2026-07-07** — Arena SPECTATE stability fix (user: the view randomly
  swapped bots). ROOT CAUSE: `spectateTarget()` indexed into the FILTERED
  living-bots array (`live[spectateIdx % live.length]`) — any bot dying or
  respawning anywhere reshuffled the array, so the same index silently
  pointed at a different car. FIX: the camera now tracks `spectateCar` by
  REFERENCE — it only moves when THAT car dies (hands off to a living bot;
  Titan fallback) or the NEXT button cycles (`nextSpectate` walks the living
  list relative to the current car). `spectateIdx` removed. Gated by
  arena-level-test.js (another bot dying + a respawn arriving do NOT move the
  view; the watched car's own death does) + full regression green.
- **2026-07-07** — Arena bot PLAYER TEMPERAMENT (user spec): the global
  player-priority (PLAYER_BIAS 0.65 = ~35% boost) is now a per-bot SPAWN roll —
  `persona.playerBias = rand(0.45, 0.85)`, i.e. 35% ± 20 points, uniform (user
  confirm): 0.45 = 55% priority (player-hunter) … 0.85 = 15% (mostly ignores
  you unless provoked). Rolled once per spawn/respawn, used in `pickTarget`'s
  player scoring; engagement ranges (560/450), grudge/retaliation, and
  bot-vs-bot scoring untouched — a passive bot still comes for you if you
  shoot it. PLAYER_BIAS constant removed. Gated by arena-level-test.js
  (band check; same geometry picks the player at 0.45 but the closer bot at
  0.85; exact-math asserts pin 0.65) — 5/5 stability runs + full regression.
- **2026-07-07** — Arena SHOT LEADING: full Gauntlet-gunner port (user picks:
  full model + weaker Titan lead; closes the "smarter shot leading" backlog
  item). `trackArenaMotion(car, dt)` (arena-bot.js) runs on EVERY arena car
  each step — player (after wall clamp in arena.js), bots (end of
  ArenaBot.update), the Titan (after its crawl) — maintaining the Gauntlet
  Player's two trackers: smoothed accel (0.15s EMA, collision-spike-proof) +
  typical speed (1.5s EMA). `arenaAimPoint(shooter, target, bulletSpeed,
  leadMul)` is the ported predictor: ALONG-TRACK accel only (bounded by
  0..maxSpeed; a hard brake predicts the shot landing where the slide dies),
  perpendicular/turning accel IGNORED (the Gauntlet measured naive ½at² at
  12% vs 39% hits — documented, don't re-attempt), trend trusted tau=0.5s
  then regressed 50% toward typical speed, flight time refined once. Bot
  cannons use it with `persona.lead` RE-BANDED 0.8-1.1 around the smart
  prediction (was 0.35-0.65 around naive linear); aim scatter unchanged. The
  TITAN's heavy shell also leads now, at 0.5 (user pick: threatening vs
  straight-liners, dodgeable by turning; it previously fired at your current
  position — trivially outdriven). Gated by arena-level-test.js (tracker
  convergence, near-linear lead for constant-velocity targets, brake-
  shortened lead, a real bot shot + Titan shell both angled AHEAD of a
  crossing mover) — 6/6 stability runs + full regression green.
- **2026-07-07** — Arena DUEL RESOLUTION (user: the duel-test flake exposed a
  real gameplay issue — two ranged bots can orbit at range forever, bullets
  clashing/missing, and the give-up factor then made BOTH walk away: fights
  evaporated instead of resolving). Three mechanisms (user pick: A+C+D), all
  persona-jittered per the standing randomness rule: (A) ESCALATION — a duel
  clock (`fightT`, reset on target change) starts tightening the orbit ring
  after `persona.escalateT` (6-10s) at `persona.escalateRate` (5-10%/s, floor
  35%): fights spiral inward, hit rates climb, someone wins. (C) STANDOFF
  DIVE — `noDmgT` counts engaged time since the bot last DEALT damage
  (`hurtCar` zeroes `source.noDmgT` — any bullet/mine/collision counts); past
  `persona.dashAfter` (5-8s) the bot commits to a 1-1.5s straight dive at the
  target, guns free. (D) COMBAT-AWARE GIVE-UP — the area-anchor give-up now
  checks: if the stuck focus IS the combat target, it escalates (forces the
  tight-orbit phase + an immediate dive) instead of blacklist+flee; walk-away
  remains for non-combat focuses only. So "both bots run away from each
  other" can no longer be a mutual combat outcome. Duel-test personas pin the
  new fields too (asymmetric). Gated by arena-level-test.js (escalated duel
  closes <230px; no-damage triggers a dive; hurtCar resets the clock; combat
  give-up escalates, never flees) — 6/6 stability runs + full regression.
  TWEAK (user): the dive interval is no longer a fixed persona roll —
  `nextDashAt` re-rolls INDEPENDENTLY per dive from `rand(4, 10)`, so bots
  never settle into a predictable dive rhythm (persona.dashAfter removed).
- **2026-07-07** — Arena bot GIVE-UP factor (user request: bots stuck doing
  the same thing / in a small area >20s must change plans). DETECTION (user
  pick: area anchor): each bot keeps an anchor point — moving >400px re-anchors
  and resets the timer; staying inside the bubble past `persona.giveUpT`
  (16-24s roll, per the standing randomness rule) triggers the give-up. One
  bubble catches EVERY loop shape (circling fights, wall dances, pickup
  oscillation) with no per-behavior bookkeeping. RESPONSE (user pick:
  blacklist + walk away): the bot's `lastFocus` (current combat target / loot
  drop / scrap pile, tracked per behavior branch) goes on a 10s `boredOf`
  blacklist — filtered out of `pickTarget`, `findLootTarget`, and farm pile
  selection — and the bot commits to a seeded far point (700-1100px, clamped
  in-world) for 4-6s (`escapeT`), no firing/ram wind-ups mid-escape, wall
  avoidance still active. SURVIVAL BEATS BOREDOM: `hurt()` cancels the escape
  AND un-blacklists an attacker (so a blacklisted rival that opens fire gets
  retaliated against). Gated by arena-level-test.js (bubble re-anchor, trigger
  past patience, focus blacklisted + far escape point, blacklist filters
  loot + combat targeting, hit cancels + un-blacklists) — plus the cannon-duel
  test's personas are now pinned ASYMMETRICALLY (identical twins clash-cancel
  all mutual bullets; the test verifies the mechanism, not persona dice) —
  6/6 stable runs + full regression green.
- **2026-07-07** — Arena bot COMBAT-RANDOMNESS pass (user audit + picks; the
  standing rule: bots get slight seeded randomness in most behaviors so
  identical states never mirror into loops). Six new `persona` rolls, all
  wired into formerly-shared constants: `aimErr` 0.02-0.05 rad (per-SHOT
  scatter via sim `rand()` added to the cannon angle — marksmen vs sprayers),
  `lead` 0.35-0.65 (replaces the flat 0.5 bullet-lead factor), `fireArc`
  1.7-2.3 (replaces the flat 2.0 will-shoot cone), `sticky` 0.75-0.95
  (replaces STICKY_MUL 0.85 target loyalty — duelists vs opportunists;
  engagement ranges 450/560 untouched), `flipCdT` 0.8-1.4s (wall U-turn
  cooldown), `unstickDelay` 0.5-1.1s (how long pinned on a wall before the
  reverse-out; release window rides on it). Declined by user (not added):
  fire-cadence jitter, ram charge/launch jitter, boss-courage range. Gated by
  arena-level-test.js (persona fields exist + stay in tuning bands) + all AI
  tests (ram/cannon duels, wall fights, converge, parking) stable across 3
  random-seed runs + full regression green.
- **2026-07-07** — Arena RAM-vs-RAM circling fix: intercept lead +
  personality-desynced brake-to-turn (user report: two ram bots loop circling
  each other). ROOT CAUSE: rams steered at the target's CURRENT position;
  two moving rams each stay ~90° off the other's nose so the charge gate
  (|aim|<0.4) never arms — endless mutual orbit (the ranged bots were cured
  via ring-orbit but rams kept straight-chase steering). FIX: rams now steer
  at an INTERCEPT point (`target.pos + target.v × time-to-reach ×
  persona.ramLead`), which geometrically collapses mutual circles into
  head-ons; plus the Gauntlet rammer's BRAKE-TO-TURN — off-nose (>0.6 rad)
  for longer than `persona.ramPatience` seconds → throttle 0.25 so the nose
  can swing on. BOTH knobs are per-bot persona rolls (ramLead 0.55-0.95,
  ramPatience 0.7-1.3s) + weave on ram steering, per the user's standing
  rule: bots get slight seeded randomness in most behaviors so identical
  states never mirror into loops. The charge now arms off the INTERCEPT aim
  (`updateRam(dt, engaged, ramAim)`), so launches fire when lined up with
  where the target WILL be. Gated by arena-level-test.js (ram-vs-ram from
  the classic circling setup: contact + damage within 12s, stable across
  3 random-seed runs) + full regression green.
- **2026-07-07** — Arena WALL-FIGHT fix: ring-point orbit + N/E/S/W U-turn
  (user: two bots dueling near a map edge hugged the wall in a line shooting
  at each other). ROOT CAUSE: circle-strafe steered along a tangent DIRECTION;
  near a wall the look-ahead avoidance cancelled the inward component, leaving
  both cars motion parallel to the wall — nothing ever pulled a fight back to
  open ground. FIX 1 (user pick: "flatten to safe line", option A): ranged
  combat now steers toward a RING-POINT GOAL (Gauntlet circler pattern) — an
  actual world point on a ring of `persona.orbitRange + target.radius` around
  the enemy, a personal step (`0.55 + orbitBias` rad) ahead of the bot's ring
  angle, CLAMPED into `[ARENA.wall+110, ARENA.w/h - …]` — so near a wall the
  goal itself flattens onto the safe line and bends the fight inward (ring
  geometry also self-corrects range, replacing the old rangeErr/orbitAng
  math; BOT_ORBIT_ANGLE removed). FIX 2 (U-turn safety net, user spec: must
  be wall-identity-based N/E/S/W + resize-safe): identify the near wall by
  comparing x/y against `ARENA.wall+130` bands (all from ARENA dims — map
  resizes keep working), take its inward normal, and if the bot's ring-tangent
  travel direction dots against it (< -0.3) flip `orbitDir`, with a 1s
  `flipCd` cooldown so it can't oscillate. Covers the enemy-pinned-flat case
  where clamped goals degenerate. Gated by arena-level-test.js (U-turn
  geometry: west-wall + enemy-due-north flips orbitDir + sets cooldown + no
  second flip during cooldown; migration: a grudge-locked wall duel reaches
  >320px off the wall within 8s) + all prior AI tests + full regression green.
- **2026-07-07** — Arena bot PERSONALITY (AI-randomness layer 1 of the
  "conga line / predictability" backlog item; user picked minimal-first). Each
  `ArenaBot` rolls a seeded `persona` at spawn (sim RNG → deterministic per
  seed): `orbitRange` (±60-70 around BOT_ORBIT_RANGE), `orbitBias` (±0.25 on
  the circle-strafe angle), `throttleMul` (0.86-1.0 combat drive), and
  `weavePhase/Freq/Amp` — a SIM-CLOCK sine steering wobble applied to combat
  steer, long drives (>300px to a target), and idle cruising, but OFF near
  pickups so parking/brake-to-turn stays exact. `orbitDir` is now a seeded
  roll instead of id-parity. Two bots in the same state no longer compute
  identical paths (mirror-lock standstills, conga lines). Deliberately NOT
  touched: engagement ranges (450/560 exact — targeting-test boundaries),
  no juke timers/dashes yet (layers b-d still backlogged). Gated by
  arena-level-test.js (personas exist + differ across bots + same seed rolls
  identical personas) + all prior AI tests (duel/nav/wall/parking/converge/
  looting) + full regression green.
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
