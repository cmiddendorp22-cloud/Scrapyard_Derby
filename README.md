# Scrapyard Derby: Survival Gauntlet

Top-down 2D vehicular survival. Drive a six-part deathtrap, break enemy cars before
they break yours, and stretch a dwindling supply of scrap as far as it'll go.

Vanilla JavaScript + HTML5 Canvas. **Zero dependencies, zero build step.**

## Run it

Just open `index.html` in a browser (double-click it). The game uses classic
`<script>` tags — no modules, no fetch — so it runs straight from `file://`.

To playtest on your phone (or any device on your network):

```
cd Scrapyard_Derby
node serve.js
# open the printed http://<your-LAN-IP>:8080 URL on the phone
```

`serve.js` is a zero-dependency static server that binds to your LAN and
prints the phone URL; it serves with no-store caching so edits show up on
refresh. Touch controls appear automatically on touch devices.

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Accelerate |
| `S` / `↓` | Brake / reverse |
| `A`·`D` / `←`·`→` | Steer |
| `Space` (hold) | Handbrake — kick the back end out for a quick, rapid turn |
| `Left click` / `F` | Fire cannon |
| `N` / `Enter` | Start next round (during intermission) |
| `B` | Toggle the shop panel (during intermission) |
| `Esc` | Pause / resume |
| `R` | Restart (on game-over screen) |

## Project structure

```
index.html               page shell, overlays, script load order
css/style.css            layout + menu/game-over overlay styling
js/
  utils.js               math helpers, WORLD constants
  input.js               keyboard state -> throttle/steer/fire
  audio.js               Web Audio synth SFX (engine drone, impacts, etc.)
  particles.js           particle system + persistent detached-part debris
  entities/
    projectile.js        player & enemy bullets
    scrap.js             finite repair piles
    car.js               BASE CAR: drift physics + component damage model
    player.js            6-component player car + cannon
    enemy.js             Rammer & Circler AI (+ named elite variants)
  waves.js               RoundManager: spawn queues, intermissions, every-5th elite
  upgrades.js            upgrade catalog + intermission shop UI
  render.js              all drawing: floor, skid marks, cars, screen shake
  ui.js                  HUD, component status panel, wave banners
  game.js                orchestrator: collisions, damage routing, repairs, game over
  main.js                bootstrap + requestAnimationFrame loop
```

## How the systems fit together (for future extension)

- **Physics** (`car.js#integrate`): velocity is split into forward/lateral parts;
  lateral gets damped hard (`grip`), forward barely (`drag`). Grip fades when
  cornering hard at speed (weight transfer) and craters while the handbrake is
  held, which is what lets the back end step out into a proper slide. All cars —
  player and AI — run the same integrator.
- **Components**: `damageComponent` / `applyDamage(side, amount)` on each car.
  The player routes side hits through bumpers/wheels with 1.5× spillover once the
  absorber is destroyed; enemies use the simplified hull + engine + wheels model.
  `Game.handleComponentDestroyed` is the single hook that spawns flying parts,
  sparks, sound, and HUD banners — new component types only need a route entry
  and a debris sprite.
- **AI**: each enemy is a small state machine in `enemy.js` that outputs
  throttle/steer for the shared physics. To add an archetype, add a `type` branch
  in `update()` and a paint job in `render.js#drawCar`.
- **Rounds** (`waves.js#RoundManager`): a round spawns its enemies with staggered
  arrivals (headcount grows every other round, capped at 5; every 5th round leads
  with a named elite at 2.4× HP). Enemies also scale per round: +6% HP, +2% speed
  (cap +35%), +4% bullet/mine damage (cap +80%). The round ends when the last
  enemy dies; ~3 scrap piles respawn (capped at 13) and a Start Next Round button
  (or `N`) begins the next round after a 3s countdown. You take no self-inflicted
  collision damage outside active rounds.
- **Enemy roster**: rammer (r1+), circler (r2+), scrap thief (r3+, eats your
  piles), minelayer (r4+, proximity mines you can shoot), splitter (r5+, breaks
  into swarm bikes on death), shielded rammer (r6+, bullet-proof front plow —
  hit its sides or rear).
- **Repair economy**: scrap piles and shop-bought Repair Kits are the ONLY
  repair sources — no free repair between rounds. Round 1 has zero piles; 1-3
  random piles spawn per cleared round (cap 8). Drive over a pile (30 HP/s) or
  shoot it to harvest repairs at range (bullet damage × 0.6). Repairs target
  your lowest-HP% component automatically and can revive destroyed parts.
  Enemy fire destroys piles (Armored Scrap prevents that); thieves eat them.
- **Difficulty tuning**: the player takes 1.5× all incoming damage; salvage is
  lean (roughly one upgrade every 2-3 rounds); enemies collide with each other
  but never trade damage — only crashes involving you hurt anyone.
- **Death condition**: all six player components at 0 HP.
- **Shop & salvage** (`upgrades.js` + `Game.buyUpgrade`): kills pay salvage
  (elites pay big, plus a round-clear bonus), spent in the intermission shop.
  15 upgrades across Durability / Mobility / Weapons / Utility; some are tiered
  (Plating x3, Rapid Loader x2, Heavy Rounds x2). Instant effects apply in
  `Game.applyUpgrade`; everything else reads `game.upgrades` at the moment it
  acts (fire rate at fire time, spill multiplier at damage time), so adding an
  upgrade is usually one catalog entry + one read-site. Upgrades reset each run.
  The component panel shows live hp/max per part, so Plating tiers are visible
  immediately; Twin Cannons, Bumper Spikes, Rear Blaster and the Auto-Turret
  are all drawn on the car itself.

## Planned / easy next steps

- Garage & upgrade system between runs (component max-HP, weapon variants)
- More AI types (mine-layer, shielded, swarm bikes)
- Scrolling camera + bigger arenas with obstacles
