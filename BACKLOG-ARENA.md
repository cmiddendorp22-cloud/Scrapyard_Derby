# Scrapyard Arena — New Game Mode Backlog

**Working title:** "Scrapyard Arena" (persistent free-for-all). A second,
separate game mode alongside the existing "Survival Gauntlet" (round-based
survival).

**Core pillar / identity:** *Build your car from the parts you tear off your
enemies.* No classes — your loadout is a set of SLOTS you fill with parts
scavenged from wrecks. Kill a car, its parts drop, drive over them to bolt
them on. Combat is about tearing off the specific parts you want (and
protecting your own). Nothing else in the genre does this — it's the hook.

## Locked design decisions

- **Multiplayer:** BOTS FIRST, netcode later. Client-only; fill a huge map
  with player-like AI so it feels multiplayer. Real human PvP is a later,
  separate lift (main `BACKLOG.md` #10). Deterministic RNG + fixed-timestep
  from Gauntlet item 2 keep the sim netcode-friendly for then.
- **Match format:** PERSISTENT WORLD. Spawn in anytime, play, die, respawn or
  leave. No match end, no winner — an endless arena (agar.io / diep.io feel).
- **Death:** RESET and respawn small. Death costs your build + level, which is
  what makes kills (and looting) valuable. Softened by a META-PROGRESSION
  HEAD-START (item 9).
- **Head-start (retention + monetization hook):** base starting XP scales with
  consecutive-day play streak, lifetime games / total score, and rewarded-ads
  watched. Hard-capped so it's a mild head-start, NEVER pay-to-win (item 9).
- **Progression:** MODULAR SLOT BUILD + STAT POINTS (replaces the diep.io
  class/evolution tree — dropped). Level 1→~30. Two intertwined loops:
  - **Levels unlock chassis SLOTS.** Start (lvl 1): **4 wheels + 1 engine +
    1 weapon**. Level milestones unlock: a **basic armor slot** (upgrade it
    with better armor looted from players/AI) → a **2nd weapon slot** →
    possibly more slots (TBD). Scavenged PARTS fill the slots.
  - **Levels also grant spendable STAT POINTS** (1/level): health, speed,
    reload, durability. HEALTH = size of the chassis HP buffer; DURABILITY =
    per-part damage resistance (how much punishment each part takes before it
    breaks off — slows dismemberment). (per-point magnitudes still open.)
  - The loops reinforce: higher level = more slots + stronger frame = more
    reason to hunt parts and kills.

## The modular part / slot system (the signature mechanic)

- **Starting loadout (lvl 1):** 4 wheels + 1 engine + 1 weapon. More slots
  unlock with level (armor → 2nd weapon → maybe more).
- **Slots:**
  - **4 wheel slots**, individually swappable. Wheel variants change handling
    (speed / grip / armored / off-road). Losing wheels still causes pull/drift
    (existing physics). Mismatched wheels = quirky handling to master.
  - **1 engine slot** (from start). Looted engines vary speed/accel.
  - **Weapon slots: 1 at start, 2nd unlocks with level.** Fill with any combo,
    e.g. cannon+cannon, cannon+minelayer, cannon+ram, minelayer+ram, etc.
    (final weapon list open). Weapons map to existing archetypes made
    player-usable: cannon (fire), minelayer (drop mines + HOOK, see below),
    ram (front spike/plow, body damage + boost).
  - **Armor slot: unlocks with level.** Starts basic; upgrade with better
    armor plates looted from players/AI. Soaks damage before parts take it.
- **Looting:** a killed car scatters its parts as physical debris (the game
  already spawns ground debris on death — make it functional). Drive over a
  part to bolt it into a matching slot; swapping drops your old part for
  someone else to grab. Fresh wrecks = contested hotspots (feeds convergence).
- **Part durability = dismemberment combat:** looted parts use the existing
  component-HP model. Shoot a specific part off an enemy (their cannon → now
  defenseless; their engine → now stalling) and it can be re-looted. Chain of
  custody across players = emergent drama. Show enemy part-health on approach;
  reward the surgical kill.
- **Signature weapon — Minelayer + HOOK:** the mine weapon isn't just passive
  zoning. It carries a **grapple/harpoon** that hooks onto another car and lets
  you **drag them into your own minefield.** Turns the minelayer build into a
  predator/trapper identity (lay a field, hook a victim, reel them in) instead
  of a defensive camper. This is a standout, genre-unique combo.
  - Counterplay (tuning open): the tether has a max length/duration and can be
    broken — e.g. the hooked player fights it by driving away past a distance
    threshold, or the rope/hook has HP and can be shot, or hitting an obstacle
    snaps it. Needs real counterplay so the drag-into-mines combo isn't a
    guaranteed kill.
  - Both platforms: hook is an aimed action (desktop key + touch button),
    distinct from the mine-drop input.
- **Part tiers (open):** parts could carry the level/quality of the car they
  came from, so killing a high-level player drops better gear (doubles the
  reward of hunting the strong — pairs with the leader bounty).

## What this shares with the existing game (reuse, don't rebuild)

Car physics (`Car.integrate`, drift), 6-component damage model + `drawCar` /
`carBodyPath` per-part geometry (perfect for showing looted parts), particles,
debris, skids, seeded RNG + fixed timestep, input + touch controls, audio.
Diverges in: camera (scrolling vs static), world size, economy (XP not
salvage), progression (levels+slots vs shop), win/lose (respawn vs game-over),
HUD, PvP damage (Gauntlet turns enemy-vs-enemy damage OFF; Arena needs
everyone to hurt everyone).

---

## Roadmap (in build order)

1. **Mode shell + mode select** — ✅ DONE
   - Start screen picks "Survival Gauntlet" (existing) or "Scrapyard Arena".
     main.js routes an `active` controller; Gauntlet untouched (all regression
     suites green). `ArenaGame` mirrors the `Game` interface (update/renderer.
     draw/togglePause/handleOrientation/begin) and shares input + audio.
     Preview hook: `?mode=arena`.

2. **Big scrolling world + camera (technical foundation)** — ✅ CORE DONE
   - Open field 5200x5200 with scattered scrap + hard boundary walls
     (`ARENA` in arena.js). Player-following camera, clamped so the view never
     shows past the walls. Scrolling tiled floor (128px pattern), world-space
     entity pass with **viewport culling**, screen-space minimap + placeholder
     level/XP HUD (`ArenaRenderer`). Verified desktop + mobile (arena-test.js).
   - Remaining/later: structured terrain (ramps/cover/hazards) is item 10;
     camera zoom-out-as-you-grow still open; world size may retune with
     population.

3. **XP + leveling core loop** — ✅ DONE (generic tuning)
   - `xpToNext()` rising curve (`20 + level²·6`), cap **30**. Level-up
     feedback: rising jingle (`playRoundClear`), gold particle burst, center
     banner. All state on `ArenaGame` (level/xp/statPoints/stats/slots), reset
     each run. Gated by arena-level-test.js.
   - **Slot unlocks** at milestones (`SLOT_UNLOCKS`): armor @5, 2nd weapon @10
     (generic) — state + banner; slots become fillable with item 5.
   - **Stat points, 1/level** → health / speed / reload / durability / regen
     (cap 10 each). Non-blocking DOM buttons (`#arena-stats`, top-center,
     tappable) + desktop keys 1-5. SPEED (+5%/pt), HEALTH (+25 maxHp/pt),
     RELOAD (faster fire), DURABILITY (damage reduction), and REGEN (passive
     out-of-combat heal, +0.5%/pt over a 2%/s base) all live.
   - HUD (ArenaRenderer): LVL + XP bar + stat readout + "spend" prompt.

4. **XP sources + tuning** — ✅ DONE (generic tuning)
   - ✅ Scrap piles: DRIVE INTO (150/s) or SHOOT (cannon bullets harvest) → XP
     (1 XP/unit); consumed piles respawn to `SCRAP_TARGET` (180).
   - ✅ Kills: wrecking a bot pays `60 + botLevel*25` XP ("a few levels"),
     scaled by the target's level. XP credits the KILLER (player or bot) via
     the `shooter`/`owner`/`lastHitBy` attribution chain — full FFA, so bots
     leveling off each other's kills is live. Bounty scaling still later.
   - ✅ Weapon LOOT: a wrecked car (bot OR player) drops its weapon as a
     drive-over pickup; grabbing it swaps your `startWeapon` and drops the old
     one. Placeholder for the full slot/part loot (item 5) — a proper equip
     menu comes later (user-confirmed). Loot ages out (20s) and is capped (30).

5. **Modular part / slot system** (the signature mechanic — see section above)
   - ✅ Starting-weapon SELECT SCREEN: themed picker (cannon / minelayer / ram)
     with live car portraits; choice on `ArenaGame.startWeapon`, drawn on the
     car (`ARENA_WEAPONS` + `ArenaRenderer.drawWeaponGear`).
   - ✅ Weapon BEHAVIORS (all 3, FIRE input on both platforms; RELOAD stat now
     live): CANNON fires forward bullets (reuse `Bullet`) that HARVEST scrap
     into XP (shoot-to-farm) — the fully-useful pre-combat weapon; MINELAYER
     drops the SAME proximity mine as the enemy MINELAYER (owned, arm 1s, dmg
     30; capped 25); RAM mirrors the enemy RAMMER — hold FIRE to CHARGE (digs
     in), release to LAUNCH a boost scaled by charge (up to 2.6x), CHARGE gauge.
     Body-damage / mine-detonation / the mine HOOK all wait on combat (bots).
   - ✅ SLOT MODEL + PART LOOTING (the signature mechanic — js/arena/arena-parts.js).
     5 slots (tires / engine / weapon×2 / armor), 5 color-coded TIERS
     (common→legendary). Player + bots carry loadouts; parts BUFF the car
     (`applyStats` folds them: tires→grip/turn, engine→speed/accel, armor→maxHP
     + damage-reduction, weapon→firepower — stacking on stat points). DUAL
     WEAPONS fire together on FIRE, each tier-scaled. LOOT: wrecked cars drop
     one part (bots weighted to their best tier via `pickDrop`; the Titan drops
     one rare+); ground drops render as tier-colored chips. EQUIP: a left-side
     DOM panel (`#arena-loadout`, auto-shows near collectible drops + a PARTS/L
     toggle) lists your slots + nearby parts with green↑/red↓/→ upgrade cues
     (row tinted to match); tap/click to equip — fills the slot (weapons →
     empty secondary, else replace secondary), your old part swaps out where
     the looted one sat. A ⇄ SWAP PRIMARY/SECONDARY control (shown when both
     weapon slots are filled) flips weapon1↔weapon2 so the primary is never
     locked. Drops are single-access (claimed on equip, no dupes), capped +
     despawn at 30s. Gated by arena-level-test.js (loadout effects,
     dual-weapon fire, part equip + secondary-replace, bot loadouts buff bots,
     boss rare+ drop).
   - ✅ BULLET CLASHING: bullets from DIFFERENT entities (player/bot/boss, and
     future humans) block each other on contact via a hidden `strength` stat
     (`updateBulletClashes` — both lose the other's strength, die at <=0).
     Flat for now: normal bullets 1, the Titan's heavy shell 3 (eats 3 normal
     bullets before breaking). Same-shooter bullets never clash. Arena only
     (Gauntlet untouched, user call).
   - Part durability (shoot a specific part OFF an enemy, re-loot it) + the
     minelayer HOOK are still open. Optional finer part sub-types (beyond
     tier) later.
   - BACKLOG — MORE WEAPONS (beyond cannon / minelayer / ram): expand the
     weapon-slot roster so dual-weapon loadouts have real variety + each has a
     niche (dodges the "dual-cannon meta" risk noted in Known Balance Risks).
     Every new weapon needs: a player behavior (FIRE input, both platforms), a
     bot-AI usage in `ArenaBot`, a rendered `drawWeaponGear`, tier scaling, and
     to slot into the loot/drop system. Idea seeds:
     • SHOTGUN / SCATTERGUN — short-range spread of pellets; deadly up close,
       weak at range (pairs with ram to close distance).
     • FLAMETHROWER — short cone of continuous damage + brief burn DOT; area
       denial, melts anyone who hugs you.
     • RAILGUN / SNIPER — slow charge, one high-damage long-range piercing shot
       (goes through / isn't easily bullet-clashed); the anti-camper.
     • GATLING / MINIGUN — spin-up then very high fire rate, low per-shot;
       sustained DPS but must commit.
     • FLAK / MORTAR — lobbed arcing shell that bursts on impact for area
       damage (ignores frontal cover); pairs with the minelayer's zoning.
     • GRAPPLE/HOOK weapon — the planned minelayer HOOK could be its own slot:
       reel a car in (or yourself toward cover), predator identity.
     • SHIELD / DEFLECTOR — a defensive "weapon" slot (frontal bullet block or a
       brief bubble) — ties into the RAM frontal-invuln idea above.
     • TESLA / CHAIN-ARC — short-range chain lightning that hops between nearby
       cars; anti-swarm / anti-conga-line.
     Decide fire model, damage/range/cooldown, tier scaling, and bot AI per
     weapon when building; keep sim-deterministic.
   - BACKLOG: "tier adds strength" — higher-tier cannons fire tougher bullets
     (more clash strength), so gear also wins bullet duels. Deferred (user
     call: flat 1/3 for now).
   - BACKLOG: TIRES tier → stronger/faster HANDBRAKE — better wheels should
     improve handbrake response, not just grip/turn: raise `handbrakeBoost`
     (Car's handbrake steering multiplier, base 1.3 — the Gauntlet's Drift
     Master upgrade already proves the dial) and/or shorten the slide's
     recovery so cuts snap quicker per tier. Applies to the player AND bots
     (bots now use the handbrake for nose-cuts/parking, so their tier shows
     in their driving too). Wire in `applyStats` alongside the existing
     tires→grip/turn effects.
   - BACKLOG: dropped-part DESPAWN BLINK — a ground part should BLINK as it
     nears its 30s despawn, blinking FASTER the closer it is to vanishing (so
     you can tell a drop is about to expire and race for it). Cosmetic-only
     (`fx*`/Math.random-driven, must not touch the sim): in `drawPartDrop`, once
     `d.age` passes a threshold (e.g. last ~8s) flicker the chip's alpha/
     visibility on a period that shrinks as `age → DROP_DESPAWN`. Same idea as
     the Gauntlet scrap/skid fade-outs.
   - BACKLOG: PLAYER shot spread / aim range — give the player's shots a small
     firing radius/cone out of the FRONT of the car (a bit of aim latitude)
     rather than a single dead-straight line, similar to how the bot cannon
     already auto-aims within an arc. Lets the player shoot enemies that are
     slightly off dead-center. (Tuning: cone width / how much lead-latitude.)
   - BACKLOG: RAM frontal invulnerability — a car equipped with RAM takes NO
     damage through its FRONT (and/or while actively ramming): bullets + frontal
     crashes are shrugged off, matching the Gauntlet Bulldozer's plow. Gives ram
     a defining defensive identity (the item-5 "dual-cannon meta" note wants
     each weapon to have a niche). Applies to player AND enemies.
     NOTE / potential change: reconsider if the ram is a SECONDARY (not just
     primary) — a loadout of GUN + RAM would be very hard to fight (frontal
     bullet-immunity while still shooting back). Options to weigh then: only the
     PRIMARY weapon grants the frontal shield; or frontal immunity only while
     actively charging/ramming (not passively); or ram-in-secondary gives a
     weaker/partial frontal reduction. Decide when building this.

**BOTS + COMBAT** — ✅ DONE (foundational, the "bots-first" decision).
`ArenaBot` (js/arena/arena-bot.js) extends Car: HP, a weapon (cannon/ram/
minelayer), simple AI (farm nearest scrap; engage the player within 560px —
shoot / charge-ram / drop mines). `BOT_COUNT` (8) kept alive, respawn 3.5s
after wrecking. Full FFA: every bullet/mine/collision damages any car but its
source (`cars()`/`hurtCar()`/`isDeadCar()` unify it), with `shooter`/`owner`/
`lastHitBy` attribution so kills credit the right killer. Player has HP
(HEALTH stat → maxHp, DURABILITY → damage reduction); 0 HP → WRECKED overlay →
respawn resets to level 1 (the locked "death resets" rule; head-start
softening is item 9). Bots render as red cars with name+level+HP bar; red dots
on the minimap.
- **BACKLOG: AI chase-dodge** — when one bot is actively pursuing another,
the chased bot should dodge laterally (left/right) rather than running in a
straight line, so the pursuer cannot get easy sustained shots from directly
behind. Tune this as a bot-AI behavior with a close-range/chase threshold and
a short dodge window so it feels intentional rather than erratic.
- **BACKLOG: AI mine avoidance** — bots should actively avoid enemy mines that
are not their own, including by steering away or changing course when a mine is
nearby, rather than driving straight through it. This should be a scoped
behavior for hostile mines and should stay readable/consistent so it doesn't
make bot movement feel random.
- **BACKLOG: stronger bosses** — the arena boss encounters should feel more
substantial and threatening over time. Add tuning ideas such as higher HP,
stronger attack patterns, more aggressive movement, and more rewarding drops
so boss fights are more distinct and memorable than a single standard fight.
**Bot SELF-LEVELING** (user request): bots earn XP the same way the player does
— farming scrap (`gainXp` on drive-over drain) AND kills (attributed via the
chain above) — on the SHARED `arenaXpToNext` curve. On level-up a bot spends
its point on a RANDOM stat (health/speed/reload/durability, cap 10), applied
live via `ArenaBot.applyStats`: SPEED→maxSpeed/accel, HEALTH→maxHp (+heal),
RELOAD→`reloadMul` (shorter fire interval), DURABILITY→incoming-damage divisor.
Bots spawn at a level near the player's (`randInt(1, player+2)`). Verified: a
40s sim grows bots to varied levels off farming with population stable.
**Bot LOOTING** (user request): when NOT engaged, a bot targets the nearest
ground-part UPGRADE (strictly higher tier for its slot) within `BOT_LOOT_RANGE`
(600px) — but only if UNCONTESTED (no other living car within
`BOT_LOOT_CONTEST` 200px of the drop). It drives over, parks, and channels
`BOT_LOOT_CHANNEL` (2s) sitting on the part (gold progress ring in `drawBot`);
combat or a rival arriving aborts the channel. On completion `botEquip` claims
the drop (single-access, same as the player), swaps its old part out where the
loot sat, updates `bot.weapon` if it was a gun, and re-applies stats.
**FFA bot TARGETING** (user request): bots fight EACH OTHER too. `pickTarget`
scores every car in range by effective distance — the player counts
×`persona.playerBias` (a per-SPAWN temperament roll, 0.45-0.85 = 55%-15%
priority: some bots hunt the player, some mostly ignore you — user spec,
35% ± 20 uniform), bot-vs-bot engage range is shorter (`BOT_VS_BOT`
450 vs 560), a RECENT ATTACKER (grudge, set in `hurt` off `lastHitBy`, lasts
4s) counts ×0.5 and can be hunted from 900px (snipe a farmer and it comes for
you), and the current target is sticky (persona.sticky, no flip-flopping).
Nearest effective target wins; Titan-swarm/loot/farm unchanged below combat.
NOT yet: distinct per-weapon bot AI, mine HOOK.

**BACKLOG — evasive driving when CHASED:** when an AI is being chased/shot from
behind by another car (attacker roughly on its tail + closing or firing), the
chased bot should DODGE — weave/juke left-right instead of fleeing in a straight
line, so the pursuer doesn't get free shots down a predictable lane. Detect
"being chased": an enemy within ~300-400px in the REAR arc (attacker's position
behind, its velocity/heading pointed at us), or taking hits from behind
(`lastHitBy` + hit direction). Response: overlay a serpentine steer (sin-based
weave with a per-bot seeded phase/period so bots don't all weave identically —
ties into the AI-randomness item), maybe brief handbrake feints. Should also
apply when fleeing the player. Keep seeded-deterministic.

**BACKLOG — bigger bot NAME pool:** `BOT_NAMES` in arena-bot.js is only ~20, so
duplicate names show up on the leaderboard/tags in a single run (e.g. two
"MADMAX"). Expand it a lot (target ~80-120) for variety; keep the grimy
scrapyard/derby tone. Candidate additions (dedupe against the existing 20):
LUGNUT, ROADKILL, T-BONE, SMASHMOUTH, CARNAGE, RIPTIDE, DEMOLITION, JACKHAMMER,
HELLCAT, WIDOWMAKER, GEARHEAD, CHOPSHOP, BACKFIRE, SPARKPLUG, MUFFLER, TAILPIPE,
RADIATOR, CAMSHAFT, CRANKSHAFT, MANIFOLD, DRIVESHAFT, FLATLINE, ROLLCAGE,
NITRO, TURBO, JUNKYARD, SCRAPHEAP, DEATHTRAP, RUSTLORD, IRONHIDE, BONESAW,
MEATWAGON, HEARSE, DUMPSTER, GRAVEDIGGER, RATTLE, CLUNKER, JALOPY, BEATER,
WRECKAGE, CINDERBLOCK, ANVIL, SLEDGE, MAULER, GRIMEBALL, OILSLICK, TARPIT,
BURNOUT, REDLINE, GRIDLOCK, POTHOLE, GUARDRAIL, BUMPER, FENDER, HUBCAP,
COOLANT, SIDESWIPE, FISHTAIL, DONUTS, HANDBRAKE, LEADFOOT, SCRAPPER, HELLBOX,
CORROSION, RUSTBELT, SCORCH, ASHES, CINDER, MELTDOWN, SHRAPNEL2, BUCKSHOT,
FRAGMENT, DEBRIS, WRECKING-BALL, DEMOLISHER, VULTURE, SCAVENGER, MAGPIE.
(Also consider: guarantee no dup names live at once by drawing without
replacement from the pool each run.)

✅ SMARTER SHOT LEADING DONE (full Gauntlet-gunner port, user pick):
`trackArenaMotion` maintains smoothed-accel + typical-speed trackers on every
arena car (player/bots/Titan); `arenaAimPoint` predicts with along-track accel
only (trusted 0.5s, regressed toward typical speed, flight time refined).
Bot cannons use it (`persona.lead` re-banded 0.8-1.1 around the smart
prediction); the Titan's shell leads at 0.5 (weaker — dodgeable by turning,
was fire-at-current-position). See changelog 2026-07-07.

**BACKLOG — AI PREDICTABILITY / "conga line" (user, screenshot):** bots
sometimes trail each other around the map in a line — most visible with two of
the SAME weapon (observed: two L6 MINELAYERS, DENTED + TOWTRUCK, stacked nose-
to-tail creeping along the LEFT WALL while spectating). Root cause: the AI is
fully deterministic + reactive — same target-scoring, same orbit direction math,
same nav/park rules → identical inputs produce identical paths, so two bots in
the same state mirror each other and one ends up following the other. FIX IDEAS
to make movement more human/varied: (a) per-bot randomness — small jitter on
orbit range/angle/lead + a personal "wander" offset seeded per bot (via the sim
RNG so replays stay deterministic); (b) occasionally flip `orbitDir` / re-pick
so mirrored orbits desync; (c) light SEPARATION steering (avoid stacking on a
same-weapon buddy heading the same way — a boids-style push-apart); (d) a bit of
target hysteresis/indecision so they don't all lock the exact same pick. Keep it
seeded-deterministic. (Screenshot evidence: two red minelayer cars overlapping
along the left hazard-striped wall, both L6, leaderboard shows several bots at
L7-L8 — a mid-game clump.)
✅ LAYER (a) DONE (user pick: minimal-first): per-bot seeded `persona` rolled in
the ArenaBot constructor — orbitRange ±60-70, orbitBias ±0.25, throttleMul
0.86-1.0, weavePhase/Freq/Amp (a sim-clock sine wobble applied to combat steer,
long drives >300px, and idle cruising; OFF near pickups so parking stays exact),
plus `orbitDir` rolled instead of id-parity. Engagement ranges (450/560) left
EXACT. Still open if clumping persists: (b) periodic orbit-flip/juke timers,
(c) separation steering, (d) target hysteresis — and the standstill-dash from
the evasive-driving entry below.
✅ WALL-FIGHT fix DONE (user report: edge duels hugged the wall in a shooting
line): combat orbit is now a RING-POINT GOAL clamped into the arena margin
("flatten to safe line") + an N/E/S/W wall-identity U-turn that flips orbitDir
when circling would carry the bot along/into its near wall (1s cooldown,
resize-safe — all bounds from ARENA dims). See changelog 2026-07-07.
✅ DUEL RESOLUTION DONE (user picks A+C+D): duels ESCALATE instead of orbiting
forever or mutually fleeing — orbit tightens after persona.escalateT
(spiral-in), a no-damage standoff past persona.dashAfter triggers a 1-1.5s
dive, and a give-up DURING combat escalates (tight orbit + dive) instead of
blacklist+walk-away. hurtCar zeroes the attacker's noDmgT (any damage counts).
✅ GIVE-UP factor DONE (user request + picks: area-anchor detection,
blacklist + walk-away response): confined to a 400px bubble past
persona.giveUpT (16-24s) → the current focus (target/drop/pile) is
blacklisted 10s and the bot commits to a seeded far point for 4-6s;
getting hit cancels the escape + un-blacklists the attacker.
✅ COMBAT-RANDOMNESS pass DONE (user picks 2,3,4,6,7 + wall-escape delay):
persona now also rolls aimErr (per-shot scatter), lead 0.35-0.65, fireArc
1.7-2.3, sticky 0.75-0.95, flipCdT 0.8-1.4s, unstickDelay 0.5-1.1s. Declined
for now: fire-cadence jitter, ram charge jitter, boss courage.
✅ RAM-vs-RAM circling fix DONE (user report): rams steer at an INTERCEPT
point (persona.ramLead) + brake-to-turn after persona.ramPatience seconds
off-nose; charge arms off the intercept aim. Per-bot rolls desync the
maneuvers (user rule: slight seeded randomness in most bot behaviors so
identical states never mirror into loops). See changelog 2026-07-07.

6. **Central boss + roaming events (convergence)** — ⏳ CENTRAL BOSS DONE
   - ✅ **JUNK TITAN** (`ArenaBoss`, js/arena/arena-boss.js): a giant slow tank
     parked at map center on a kept-dense scrap cluster — the gravity well.
     Showcases the signature pillar: **4 armor plates around a core**; hits
     route to the FACING plate, tearing a plate off drops a lootable weapon +
     exposes the core; drain the core for **+400 XP + a scrap piñata** (10
     fresh piles) + a bonus weapon drop. Full FFA — player AND bots damage it
     (bullets/mines/rams) via `hurtBoss`, and the core kill credits whoever
     landed it (`lastHitBy`). Attacks: **ground-slam shockwave** (telegraph
     ring → radial knockback + falloff damage within 330px) + a heavy slow
     cannon while the front plate lives. Crawls toward the nearest car.
     Respawns 22s after wrecking. Player spawn moved south of center so you
     never appear inside it. Render: rim plates (flash on hit, vanish when
     torn) + pulsing core + toughness bar + gold minimap diamond; first-
     encounter banner. Preview `?mode=arena&boss`. Gated by arena-level-test.js
     (plate damage/tear-off loot, core kill, slam, respawn) + the 40s sim.
   - ✅ Bots CONVERGE on the Titan: a bot within `BOT_BOSS_RANGE` (1000px) that
     isn't already fighting the player diverts to swarm the boss — driving in,
     shooting/mining/ramming it (its shots already damage the boss via FFA).
     Keeps the center genuinely contested.
   - Later on this item: **roaming events** — periodic "scrap storm" /
     junk-meteor cache at an announced spot.
   - BACKLOG — MORE BOSSES (beyond the JUNK TITAN): add variety so the center
     isn't always the same fight. Rotate/pick per boss-cycle, or add secondary
     bosses at other map landmarks. Idea seeds (each wants a distinct mechanic
     + signature drop, reuse `ArenaBoss` where possible):
     • THE CRUSHER — mobile wrecking-ball/flail boss that roams (vs the Titan's
       plates), swinging a tethered ball; dodge the arc.
     • THE MAGNET / SCRAP HOARDER — hoovers nearby scrap + can grapple-pull cars
       toward it (prototype the minelayer HOOK on it); pops into an XP piñata.
     • THE GUNSHIP — glass-cannon turret boss: low HP, brutal ranged barrage /
       spread; punishes standing still, rewards rushing it.
     • THE SWARM QUEEN — spawns minion bikes/drones (like the Gauntlet HAULER),
       kill the adds or burst the core.
     • THE RECYCLER — environmental hazard boss (rotating crushers / compactor
       zone) you don't "kill" so much as survive to grab the best loot.
     Tuning per boss: HP/plate model, attack telegraphs, drop tier (Titan =
     one rare+; tougher/rarer bosses could drop epic+/legendary or 2 items),
     respawn timer, whether bots swarm it. Distinct minimap marker + banner.

7. **Leaderboard + bounty system (convergence + anti-snowball)** — ✅ DONE
   - ✅ Live leaderboard: `computeLeaderboard` ranks the player + all bots by
     level (XP tiebreak), throttled to 0.5s. `ArenaRenderer.drawLeaderboard`
     shows it under the minimap (top 5 desktop / top 3 on short phones); the
     player row is blue, the #1 (bounty) row gold with a ★. The player's
     display name lives in one field, `ArenaGame.playerName` ("YOU" for now) —
     the swap point for a linked Google-account handle later.
   - ✅ Leader bounty: the current #1 living car (`leaderCar`) is the bounty
     target — wrecking it pays `BOUNTY_XP` (150) on top of the base kill XP
     (`awardKill`), with a "BOUNTY — WRECKED X" banner. Their coarse **sector**
     (world split `LB_SECTORS`=4 → a 4×4 grid) is highlighted gold on the
     minimap — pressure toward the leader, not a precise pin.
   - Gated by arena-level-test.js (ranking order, leader selection, bounty
     bonus math vs a base kill). NOT yet: bots actively hunting the bounty
     (they don't read the leaderboard); real cross-session/global board (waits
     on accounts).

8. **Social hooks — the "one more game" engine** — ✅ DONE
   - ✅ **Nemesis / revenge:** the bot that lands the killing blow becomes your
     `nemesis` (set in `damagePlayer`, persists across respawn). It's flagged on
     the minimap (red white-outlined diamond) + a red "NEMESIS" world tag over
     the car. Wrecking it pays `REVENGE_XP` (120) bonus ("REVENGE! WRECKED X")
     and clears the grudge (`awardKill`); if it dies to someone else the grudge
     auto-clears.
   - ✅ **Killfeed (all wrecks):** every wreck in the world posts a line
     (`feedWreck`/`nameOf`), newest-first, capped + aged out at 5s. Rendered
     right-aligned just LEFT of the minimap (`drawKillfeed`) — player-involved
     lines blue, RAMPAGE lines gold, others neutral, drop-shadowed (no box).
   - ✅ **Rampage streaks:** each car tracks a wreck `streak` (player +
     `ArenaBot.streak`, reset on death); milestones `STREAK_MILESTONES` (3/5/8,
     then every +5) fire a center banner + gold feed line formatted
     `NAME: n-WRECK RAMPAGE` (colon, no em dash — user preference; the bounty
     banner was switched to `BOUNTY! WRECKED X` for the same reason).
   - Mobile: the feed is COMPACT on touch (3 lines, 10px) AND auto-hides while
     the SPEND POINTS panel is up (`drawKillfeed` gate on `touchMode &&
     statPoints>0`) so they never crowd; desktop shows 6 lines at 12px.
   - Gated by arena-level-test.js (killfeed post, nemesis set/persist/clear,
     revenge bonus math, streak milestone + format).
   - NOT yet: bots reacting to their own nemesis (player-only for now);
     cross-session/global feed (waits on accounts + netcode).

9. **Meta-progression head-start + respawn screen** — ⏳ death menu + spectate done
   - ✅ DEATH MENU (no auto-respawn): 0 HP → brief wreck moment → a menu with
     RESPAWN / SPECTATE / MAIN MENU (the world keeps running behind it; XP
     drops to 25% on respawn per the death rule).
   - ✅ SPECTATE: follow-cam locked to a living bot, NEXT BOT button (+ N key)
     cycles, "SPECTATING: name" label, corner RESPAWN/MAIN MENU buttons, ESC
     back to the death menu. Dead players are untargetable/undamageable, so
     it's a clean way to watch bots fight/loot. (Was requested as temporary —
     it's clean enough to keep.) PARITY RULE (user): the dead-branch sim must
     match the live branch exactly — it runs collisions (bot↔bot + bot↔Titan),
     scrap respawn, projectiles/mines/drops/skids identically; only
     player-specific steps (input/physics/regen/weapon fire) are skipped.
     Bot-vs-bot combat also got a stalemate fix here: 0.85-rad fire cone,
     velocity-LEAD cannon shots, and a 1.2s `aimStuckT` handbrake-pivot that
     breaks mutual-orbit circling (the Gauntlet's old pursuit-circle disease).
   - BACKLOG: spectate LOADOUT view — while spectating, show the watched bot's
     equipped parts (its tires/engine/weapon/armor + tiers, tier-colored like
     the player's own panel). Natural home: reuse/retarget the `#arena-loadout`
     DOM panel (read-only — no equip buttons) or a compact canvas readout under
     the "SPECTATING: name" label; swap contents when the camera hands off or
     NEXT cycles. Lets you scout builds and see WHY a bot is winning.
   - BACKLOG: spectate KILLER hand-off — if the car you're spectating gets
     wrecked by another car (any player/bot — NOT the boss), auto-swap the
     spectate camera to whoever killed it (its `lastHitBy`) so you keep watching
     the action instead of a wreck. Falls back to the normal next-living-bot
     pick if the killer is the boss, is dead, or is you. (Hook: the camera now
     tracks `spectateCar` by REFERENCE — 2026-07-07 stability fix, view only
     moves when THAT car dies; on that death, set `spectateCar = lastHitBy`
     when it's a living bot instead of defaulting to the first living one.)
   - The HEAD-START softening below is what's left.
   - Persistent profile in localStorage (→ accounts later): consecutive-day
     streak, lifetime games, total score, ads watched.
   - `startingXP = f(streak, lifetimeScore, adsWatched)`, HARD-CAPPED to a mild
     head-start (proposal: never above ~lvl 5-8 of 30). Death still resets, so
     it only softens the early grind — never buys dominance.
   - **P2W guardrail:** ad/streak bonus is a head-start only, never permanent
     or per-life power; enforce + document the cap (main `BACKLOG.md` #8:
     never sell power).
   - Respawn screen: run stats (level, kills, best parts looted, survival
     time), your next-life head-start, RESPAWN button.

10. **Driving-game map features (LATER — deferred by design)**
    - The initial map is an open field (item 2). This pass adds structure so
      momentum/drift/handbrake decide fights and create natural chokepoints:
      **ramps** (jumps / launches over gaps or onto shortcuts), pillars &
      destructible cover, oil slicks (kill grip), speed strips,
      crushers/hazards. Revisit once the core loop (loot/level/fight) is fun on
      the open field — a big empty field underuses the driving skill that makes
      this different from twin-stick .io games, so this is "later," not "never."

11. **Arena HUD / UX polish**
    - Level bar, slot/loadout display (what's equipped + its health), minimap,
      leaderboard, killfeed, nemesis marker, bounty sector. All legible on a
      landscape phone without fighting the joystick/FIRE/DRIFT/pause cluster
      (platform rule). Visible growth: equipped looted parts render on the car
      (per-part geometry already supports this) — the agar.io "watch myself
      grow" dopamine.

12. **Monetization hooks (mode-specific)**
    - Rewarded ad → starting-XP head-start (the death-reset is the natural ad
      surface). Optional: ad to respawn once with your last build/level.
    - Cosmetic part skins (main `BACKLOG.md` #5). Never sell power.

13. **Real multiplayer / netcode (deferred)**
    - Authoritative server so the "players" are real humans; bots become
      backfill. Biggest lift; shares everything with main `BACKLOG.md` #10.

---

## Known balance risks (revisit LATER, not at first build)

- **Dual-cannon meta collapse:** the classic .io failure where everyone runs
  the safe DPS pick and every other weapon is a trap. Each weapon needs a
  clear niche that beats dual-cannon in some situation. Minelayer has the hook
  (control/predator); ram likely needs a defining perk (hook-immune while
  boosting, or shrugs off frontal fire like the Bulldozer plow). Address when
  the weapon roster is detailed — after the core loop works.

## Open design questions (refine before building the affected item)

- **Slot-unlock schedule:** at which levels do armor / 2nd weapon / any
  further slots unlock, and what are the "maybe more" slots? (items 3, 5)
- **Stat point magnitudes:** per-point effect for health / speed / reload /
  durability and any lvl-30 caps. (health/durability meaning is LOCKED: health
  = chassis HP buffer, durability = per-part resistance.) (item 3)
- **Weapon roster + each weapon's identity:** final list beyond cannon /
  minelayer(+hook) / ram (shield? turret? flamer?), illegal combos, and — key
  balance risk — a clear reason to pick each so the meta doesn't collapse to
  dual-cannon. Minelayer has the hook; ram likely needs a defining perk of its
  own (e.g. hook-immune while boosting, or shrugs off frontal fire). (item 5)
- **Mine-hook tuning:** tether length/duration, break conditions, hook HP,
  cooldown — enough counterplay that drag-into-mines isn't a free kill. (item 5)
- **Part tiers:** do parts carry the source car's level/quality? How many
  tiers? (item 5)
- **World size + population:** map dimensions, target bots on-screen / in-world
  → drives camera zoom, culling, perf budget. (item 2)
- **Camera zoom:** fixed, or zoom OUT as you level/grow like diep.io? (item 2)
- **XP economy numbers:** XP per pile vs per kill; kills-per-level; higher-level
  bounty multiplier. (item 4)
- **Head-start cap + curve:** max starting level that's fair; exact
  streak/score/ads formula. (item 9)
- **Mobile live-loadout UX:** how to swap parts / equip loot in a world that
  never pauses, on a phone, without dying while menuing. Leading idea:
  auto-equip into empty slots on pickup + non-blocking tap-chips to
  rearrange. (items 3, 5)
- **Persistence scope now:** localStorage only (single device) until accounts
  land with the leaderboard work? (item 9)
