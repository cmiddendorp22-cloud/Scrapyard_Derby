"use strict";
// ---------------------------------------------------------------------------
// Scrapyard Arena bot: an AI car that stands in for another player until real
// netcode (bots-first, see BACKLOG-ARENA). It roams and farms scrap, and
// engages the player when close — using the same three weapons the player can
// pick. Has HP, deals + takes damage, drops XP when wrecked, and respawns.
// Extends Car so it shares the drift physics + integrate().
// ---------------------------------------------------------------------------

const BOT_NAMES = [
  "RUSTBUCKET", "SCRAP_KING", "V8_VANDAL", "DENTED", "OVERKILL", "JUNKJAW",
  "AXLE", "CRUSHER99", "MADMAX", "GRINDER", "TOWTRUCK", "BOLTS", "DIESEL",
  "WRENCH", "SHRAPNEL", "PISTON", "GUTTER", "HAULER_X", "REBAR", "SLAG",
  "LUGNUT", "CARNAGE", "SMOKESTACK", "BACKFIRE", "TAILPIPE", "MUFFLER",
  "DENTZILLA", "OILSLICK", "RATTLE", "CLUNKER", "SPARKPLUG", "GEARHEAD",
  "ROADKILL", "FENDER", "CHASSIS", "TORQUE", "NITRO", "CAMSHAFT", "DRIVESHAFT",
  "MANIFOLD", "BUCKSHOT", "WRECKER", "CRANKSHAFT", "IRONHIDE", "SCRAPPY",
  "BONESAW", "HAMMERHEAD", "DUSTDEVIL", "GRIMEBALL", "TETANUS", "BRAKELINE",
  "COILOVER", "SIDESWIPE", "T_BONE", "ROLLCAGE", "SKIDMARK", "RADIATOR",
  "HUBCAP", "DEATHTRAP", "SLEDGE", "MAULER", "SCORCH", "RIVET", "GASKET",
  "FLATBED", "JUNKYARD", "SALVAGE", "CORROSION", "GRAVEL", "BLOWOUT",
  "TREADS", "SPINOUT", "RECKLESS", "DEMOLITION", "SCRAPHEAP", "GRUDGE",
  "BATTERAM", "OVERDRIVE",
];

const BOT_ENGAGE = 560;      // engages the PLAYER within this range
const BOT_VS_BOT = 450;      // engages OTHER BOTS within this (shorter) range
// (player priority is per-bot temperament: persona.playerBias 0.45-0.85,
//  i.e. 35% ± 20% — rolled at spawn, some bots hunt you, some ignore you)
const RETALIATE_T = 4;       // seconds a "who just hit me" grudge lasts
const RETALIATE_RANGE = 900; // a grudge target can be hunted from this far out
const GRUDGE_MUL = 0.5;      // recent attacker's distance bonus (jumps the queue)
// (target stickiness is per-bot: persona.sticky 0.75-0.95)
const BOT_BOSS_RANGE = 1000; // will divert to swarm the central Titan within this range
const BOT_ORBIT_RANGE = 250;  // ranged bots circle-strafe the target at this distance
const BOT_LOOT_RANGE = 600;   // notices ground-part UPGRADES within this range
const BOT_LOOT_CHANNEL = 2;   // seconds a bot must sit over a part to claim it
const BOT_LOOT_CONTEST = 200; // won't seek a drop if any OTHER car is this close to it
const BOT_BASE = { accel: 600, maxSpeed: 355 };

// -- shot-leading support (ported from the Gauntlet gunner's proven model) --

// per-car motion trackers: smoothed acceleration (~0.15s EMA, so collision
// spikes don't whip aim around) + typical speed (~1.5s EMA). Arena calls this
// for every car each step (player, bots, Titan); the Gauntlet Player keeps its
// own inline version.
function trackArenaMotion(c, dt) {
  const sp = Math.hypot(c.vx, c.vy);
  if (c._pvx === undefined) { c._pvx = c.vx; c._pvy = c.vy; c.smoothAx = 0; c.smoothAy = 0; c.smoothSpeed = sp; }
  const blend = Math.min(1, dt / 0.15);
  c.smoothAx += ((c.vx - c._pvx) / dt - c.smoothAx) * blend;
  c.smoothAy += ((c.vy - c._pvy) / dt - c.smoothAy) * blend;
  c._pvx = c.vx; c._pvy = c.vy;
  c.smoothSpeed += (sp - c.smoothSpeed) * Math.min(1, dt / 1.5);
}

// Acceleration-aware aim point. Only the ALONG-TRACK component of the target's
// smoothed acceleration is used — speed changes (braking/throttle) are bounded
// and predictable (speed can't drop below 0 or exceed max), so a hard brake
// predicts the shot landing where the slide dies. Perpendicular acceleration
// (turning) is a coin flip over a shell's flight and is IGNORED — naive ½at²
// was measured WORSE in the Gauntlet (12% vs 39% hits); don't re-attempt it.
// The speed trend is trusted for `tau`s then regresses 50% toward the target's
// typical speed; flight time is refined once. `leadMul` scales the final lead.
function arenaAimPoint(shooter, target, bulletSpeed, leadMul) {
  const tau = 0.5;
  let t = dist(shooter.x, shooter.y, target.x, target.y) / bulletSpeed;
  let tx = target.x, ty = target.y;
  const maxSp = target.maxSpeed || 400;
  for (let pass = 0; pass < 2; pass++) {
    const ps = Math.hypot(target.vx || 0, target.vy || 0);
    if (ps > 20) {
      const dvx = target.vx / ps, dvy = target.vy / ps;
      const aAlong = (target.smoothAx ?? 0) * dvx + (target.smoothAy ?? 0) * dvy;
      const ta = Math.min(t, tau);
      let s1 = ps + aAlong * ta, travelWindow;
      if (s1 <= 0) { travelWindow = (ps * ps) / (2 * Math.max(1, -aAlong)); s1 = 0; } // braking to a stop
      else { if (s1 > maxSp) s1 = maxSp; travelWindow = ((ps + s1) / 2) * ta; }
      const rest = 0.5 * s1 + 0.5 * (target.smoothSpeed ?? ps); // maneuver likely over → usual pace
      const travel = travelWindow + rest * (t - ta);
      tx = target.x + dvx * travel * leadMul;
      ty = target.y + dvy * travel * leadMul;
    } else { // near-stationary: plain lead
      tx = target.x + (target.vx || 0) * t * leadMul;
      ty = target.y + (target.vy || 0) * t * leadMul;
    }
    t = dist(shooter.x, shooter.y, tx, ty) / bulletSpeed;
  }
  return { x: tx, y: ty };
}

// shared XP-to-next-level curve (players + bots use the same growth)
function arenaXpToNext(level) { return 20 + level * level * 6; }

// total accumulated XP to reach `level` + `xp` into it (for kill payouts +
// the 25%-on-death penalty)
function arenaTotalXp(level, xp) {
  let total = xp || 0;
  for (let l = 1; l < level; l++) total += arenaXpToNext(l);
  return total;
}

// invert arenaTotalXp: a total-XP amount → { level, xp }, capped at `cap`
function arenaLevelFromTotal(total, cap) {
  let level = 1, xp = Math.max(0, total);
  while (level < cap && xp >= arenaXpToNext(level)) { xp -= arenaXpToNext(level); level++; }
  if (level >= cap) xp = 0;
  return { level, xp };
}

// the frontal block only engages while the ram is actually RAMMING — i.e.
// LAUNCHED (ramBoostT > 0) and MOVING fast (user spec: it blocks only while
// moving, NOT while dug in winding up the charge).
const RAM_BLOCK_SPEED = 60;
function ramLaunchingFast(car, ramBoostT) {
  return ramBoostT > 0 && Math.hypot(car.vx || 0, car.vy || 0) > RAM_BLOCK_SPEED;
}

// is this car a RAM actively ramming (launched + moving)? (uniform for player +
// bots — the player car carries a mirrored `chargingRam` flag since its ram
// state lives on ArenaGame; bots read their own weapon + launch/speed state)
function isChargingRam(car) {
  if (!car) return false;
  if (car.chargingRam !== undefined) return car.chargingRam;   // player (mirrored)
  return car.weapon === "ram" && ramLaunchingFast(car, car.ramBoostT); // bot
}

// RAM defensive bonus — ONLY when RAM is the car's PRIMARY weapon (user spec):
// while actively RAMMING (launched + moving), a FRONTAL hit is shrugged —
//   • BULLET → always zero (plow through gunfire)
//   • CRASH  → zero UNLESS the OTHER car is ALSO a charging ram; a head-on
//     charge-vs-charge DOES deal impact damage so ram duels resolve, but a ram
//     plowing anything else (or a non-charging ram) takes nothing on the nose
//   • MINE   → still hurts (mines are the counter to ram)
// Everything else (rear/side, non-charging) is reduced 35% (general toughness).
// hitX/hitY = where the hit came FROM; srcType = "bullet"|"mine"|"crash"|"slam";
// source = the attacking car (for the charge-vs-charge crash check).
function ramDamageMul(car, isPrimaryRam, charging, hitX, hitY, srcType, source) {
  if (!isPrimaryRam) return 1;
  const frontal = hitX !== undefined && hitY !== undefined &&
    Math.abs(angleDiff(Math.atan2(hitY - car.y, hitX - car.x), car.heading)) < 1.2; // ~138° front arc
  if (charging && frontal) {
    if (srcType === "bullet") return 0;                       // frontal bullets bounce off
    if (srcType === "crash") return isChargingRam(source) ? 0.65 : 0; // only a charging ram gets through
  }
  return 0.65; // 35% shrugged off otherwise
}

// --- WHEEL DISMEMBERMENT (user spec, 2026-07-09) -----------------------------
// Every arena car carries FOUR individual wheels (FL/FR/RL/RR components). A
// BULLET chips only the ONE wheel closest to the hit; an EXPLOSION (mine/slam)
// chips the TWO closest (user spec). The wheels synthesize the Gauntlet's
// leftWheels/rightWheels side pools (`syncWheelSides`) so Car.integrate applies
// its veer/grip/accel/fishtail penalties unchanged: a side's effect = the
// AVERAGE of its two wheels' damage factors (one broken wheel = half the side
// penalty). Wheels MEND after WHEEL_REPAIR_DELAY seconds without taking ANY
// damage, healing over WHEEL_REPAIR_TIME with a visible indicator. The tires
// PART still drops as loot on a full kill — broken wheels stay bolted on
// (user call: a debuff, not a loot pinata).
const WHEEL_KEYS = ["wheelFL", "wheelFR", "wheelRL", "wheelRR"];
const WHEEL_HP_BASE = 21;      // per-WHEEL pool floor
const WHEEL_HP_TIER = 7;       // + per tires tier (tier+1): 28 common → 56 legendary = EXACTLY 2x (user)
const WHEEL_CHIP = 0.4;        // fraction of the dealt damage that also chews wheels
const WHEEL_REPAIR_DELAY = 10; // seconds without damage before wheels start mending
const WHEEL_REPAIR_TIME = 4;   // seconds to mend a fully-broken wheel once started

// a wheel's position in the car's LOCAL frame (front = +x, left = -y) — shared
// by the closest-wheel damage pick and the renderer
function wheelLocalPos(car, key) {
  return {
    x: (key[5] === "F" ? 1 : -1) * car.length * 0.32,
    y: (key[6] === "L" ? -1 : 1) * car.width / 2,
  };
}
function wheelWorldPos(car, key) {
  const l = wheelLocalPos(car, key);
  const c = Math.cos(car.heading), s = Math.sin(car.heading);
  return { x: car.x + l.x * c - l.y * s, y: car.y + l.x * s + l.y * c };
}

// fold the four wheels into the two side components Car.integrate reads: the
// side's damage factor = average of its two wheels' factors, inverted back
// into an hp value (damageFactor is t² with t=(0.5-ratio)/0.5, so ratio =
// 0.5·(1-√d)). One broken wheel ≈ half the old full-side penalty.
function syncWheelSides(car) {
  const df = (k) => {
    const c = car.components[k];
    const t = clamp((0.5 - c.hp / c.max) / 0.5, 0, 1);
    return t * t;
  };
  for (const [side, f, r] of [["leftWheels", "wheelFL", "wheelRL"], ["rightWheels", "wheelFR", "wheelRR"]]) {
    const d = (df(f) + df(r)) / 2;
    const max = car.components[f].max + car.components[r].max;
    // ratio 0.5 already means "zero effect" to damageFactor AND the fishtail
    // ramp, so healthy sides sit exactly at the no-penalty threshold
    car.components[side] = { hp: max * 0.5 * (1 - Math.sqrt(d)), max };
  }
}

// (re)size a car's wheel pools from its tires tier. Damage FRACTION carries
// across a re-tier (equipping better tires mid-fight doesn't heal you).
function setupWheels(car, tier) {
  const max = WHEEL_HP_BASE + WHEEL_HP_TIER * ((tier || 0) + 1);
  for (const k of WHEEL_KEYS) {
    const c = car.components[k];
    const frac = c ? clamp(c.hp / c.max, 0, 1) : 1;
    car.components[k] = { hp: max * frac, max };
  }
  if (car.sinceHit === undefined) car.sinceHit = WHEEL_REPAIR_DELAY; // fresh car: not "in combat"
  syncWheelSides(car);
}

function healWheelsFull(car) {
  for (const k of WHEEL_KEYS) {
    const c = car.components[k];
    if (c) c.hp = c.max;
  }
  car.sinceHit = WHEEL_REPAIR_DELAY;
  if (car.components.wheelFL) syncWheelSides(car);
}

// a hit with a known position chews wheels by how close it landed (user spec):
// BULLETS (and point contacts) chip only the CLOSEST wheel; EXPLOSIONS
// (mine/slam) chip the TWO closest, splitting the chip between them.
// `dealt` is the post-reduction damage (same number the hull lost).
function chipWheels(car, dealt, hitX, hitY, srcType) {
  if (hitX === undefined || hitX === null || dealt <= 0) return;
  if (!car.components.wheelFL) return; // portraits/stubs without wheel pools
  const byDist = WHEEL_KEYS
    .map((k) => { const w = wheelWorldPos(car, k); return { k, d: dist(hitX, hitY, w.x, w.y) }; })
    .sort((a, b) => a.d - b.d);
  if (srcType === "mine" || srcType === "slam") { // explosion: 2 closest, split
    car.damageComponent(byDist[0].k, dealt * WHEEL_CHIP * 0.5);
    car.damageComponent(byDist[1].k, dealt * WHEEL_CHIP * 0.5);
  } else { // bullet/crash/hook: the single closest wheel
    car.damageComponent(byDist[0].k, dealt * WHEEL_CHIP);
  }
  syncWheelSides(car);
}

// out-of-combat mending: gated on time since the car last took ANY damage
// (the damage sites zero car.sinceHit), then a steady heal with a flag the
// renderer uses for the "wheels mending" indicator. `delay` lets the caller
// shorten the gate (the player's REGEN stat trims 0.5s per point — user).
function tickWheelRepair(car, dt, delay = WHEEL_REPAIR_DELAY) {
  if (!car.components.wheelFL) return;
  car.sinceHit = (car.sinceHit ?? WHEEL_REPAIR_DELAY) + dt;
  car.wheelMending = false;
  if (car.sinceHit < Math.max(1, delay)) return;
  for (const k of WHEEL_KEYS) {
    const c = car.components[k];
    if (c.hp < c.max) {
      c.hp = Math.min(c.max, c.hp + (c.max / WHEEL_REPAIR_TIME) * dt);
      car.wheelMending = true;
    }
  }
  if (car.wheelMending) syncWheelSides(car);
}

class ArenaBot extends Car {
  constructor(x, y, weapon, level, name) {
    super(x, y, rand(0, TAU), { accel: BOT_BASE.accel, maxSpeed: BOT_BASE.maxSpeed, turnRate: 2.5, grip: 7, drag: 0.6 });
    this.weapon = weapon;
    this.level = level;
    this.xp = 0;
    this.statPoints = 0;                 // spent instantly (randomly) on level-up
    this.stats = { health: 0, speed: 0, reload: 0 }; // (durability removed — armor part covers it)
    // name is assigned without-replacement by ArenaGame.spawnBot (no two living
    // bots share); the pick() fallback is for direct construction (tests)
    this.name = name || pick(BOT_NAMES);
    this.fireTimer = rand(0.4, 1.4);
    this.hookCd = rand(1, HOOK_CD); // minelayer hook cooldown (staggered so they don't all fire at once)
    this.playerSeenT = 0;           // continuous time visible on the player's screen (attack gate)
    this.stunT = 0;                 // >0 = hooked/reeled → can't shoot (set by the hook)
    this.ramCharge = 0; this.ramBoostT = 0; this.ramLaunchStr = 1;
    this.lootChannel = 0;                // seconds spent sitting over a part drop
    this.hitFlash = 0;
    this.lastHitBy = null;               // for kill attribution
    this.grudge = null;                  // who hit me recently (retaliation target)
    this.grudgeT = 0;                    // grudge time left
    this.combatTarget = null;            // sticky current target (no flip-flopping)
    // PERSONALITY: seeded per-bot quirks so no two bots drive identically —
    // different preferred ranges/orbits/wobble break the mirror-image movement
    // (conga lines, mutual-cancel standstills). Sim-RNG → deterministic per seed.
    this.persona = {
      orbitRange: BOT_ORBIT_RANGE + rand(-60, 70), // preferred fighting distance
      orbitBias: rand(-0.25, 0.25),                // tighter or wider circling
      throttleMul: rand(0.86, 1.0),                // how hard they drive in combat
      weavePhase: rand(0, TAU),                    // personal steering-wobble phase
      weaveFreq: rand(1.6, 2.6),                   // wobble speed (rad per sim-second)
      weaveAmp: rand(0.10, 0.30),                  // wobble strength
      ramLead: rand(0.55, 0.95),                   // how much a ram leads its target
      ramPatience: rand(0.7, 1.3),                 // seconds off-nose before braking to turn
      ramSnapChance: rand(0.45, 0.8),              // odds a misalignment triggers a handbrake nose-cut
      aimErr: rand(0.02, 0.05),                    // per-shot aim scatter (~1-3°): marksmen vs sprayers
      hookErr: rand(0.08, 0.18),                   // per-HOOK scatter (~5-10°): hooks miss a lot more than guns (user)
      reactionT: rand(0.2, 0.55),                  // human-ish reflex: delay before attacking a player who just came on screen (user)
      lead: rand(0.8, 1.1),                        // lead multiplier around the SMART prediction (under/over-leaders)
      fireArc: rand(1.2, 1.6),                     // will-shoot cone (narrowed, user): only fire when reasonably lined up, not spraying sideways
      sticky: rand(0.75, 0.95),                    // target loyalty: duelists vs opportunists
      flipCdT: rand(0.8, 1.4),                     // wall U-turn cooldown (desyncs wall escapes)
      unstickDelay: rand(0.5, 1.1),                // how long pinned-on-wall before reversing out
      giveUpT: rand(16, 24),                       // seconds confined to a small area before giving up
      cowardice: rand(0.7, 1.3),                   // scales the low-HP flee odds (brave vs skittish)
      // temperament toward the PLAYER, rolled once per spawn (user spec):
      // 35% ± 20% priority → distance multiplier 0.45 (55%: player-hunter)
      // to 0.85 (15%: mostly ignores you unless provoked)
      playerBias: rand(0.45, 0.85),
      escalateT: rand(6, 10),                      // seconds dueling before the orbit starts tightening
      escalateRate: rand(0.05, 0.10),              // orbit shrink per second once escalating
    };
    // duel-resolution state: fights ESCALATE instead of orbiting forever
    this.fightT = 0; this.fightTarget = null;      // time spent on the current opponent
    this.noDmgT = 0;                               // engaged time since I last dealt damage
    this.dashT = 0;                                // active dive-attack time left
    this.ramSnapT = 0; this.ramSnapCd = 0;         // ram handbrake nose-cut window + re-roll cooldown
    this.nextDashAt = rand(4, 10);                 // no-damage seconds until the next dive — re-rolled per dive
    // GIVE-UP state: anchor bubble detector + boredom blacklist + escape run
    this.anchorX = x; this.anchorY = y; this.anchorT = 0;
    this.lastFocus = null;               // what I'm currently pursuing (car/drop/pile)
    this.boredOf = null; this.boredT = 0; // blacklisted focus ("bored of you")
    this.escapeX = 0; this.escapeY = 0; this.escapeT = 0; // committed walk-away
    this.fleeing = false;                // escape is a low-HP RETREAT (hits don't cancel it)
    this.fleeCheckT = rand(1.5, 3);      // seconds until the next flee decision
    this.offNoseT = 0;                   // time unable to point at the ram target
    this.orbitDir = pick([1, -1]);       // circle-strafe direction (seeded roll)
    this.flipCd = 0;                     // U-turn cooldown (wall-aware orbit flip)
    this.stuckT = 0;                     // seconds barely moving while engaged (wedge breaker)
    this.streak = 0;                     // consecutive wrecks (RAMPAGE callouts)
    this.deadFlag = false;               // (Car has .dead; keep our own so we control removal)
    // a full tiered loadout (by level): buffs this bot AND is what it drops
    this.loadout = {
      tires: makePart("tires", "tires", tierForLevel(level)),
      engine: makePart("engine", "engine", tierForLevel(level)),
      weapon: makePart("weapon", weapon, tierForLevel(level)),
      armor: makePart("armor", "armor", tierForLevel(level)),
    };
    this.applyStats();
    this.hp = this.maxHp; // full HP including the armor part's bonus
  }

  // gain XP → level up → spend the point on a RANDOM stat (user request)
  gainXp(amount) {
    this.xp += amount;
    while (this.xp >= arenaXpToNext(this.level)) {
      this.xp -= arenaXpToNext(this.level);
      this.level++;
      const opts = Object.keys(this.stats).filter((k) => this.stats[k] < 10);
      if (opts.length) this.stats[pick(opts)]++;
      this.applyStats(true); // heal by the HP the level gained
    }
  }

  // derive tuning from level + stats + equipped PARTS (gear buffs the bot too)
  applyStats(healOnGain) {
    const L = this.loadout || {};
    const spd = 1 + this.stats.speed * 0.05;
    const eng = L.engine ? 1 + 0.05 * (L.engine.tier + 1) : 1; // engine part → speed/accel
    this.maxSpeed = BOT_BASE.maxSpeed * spd * eng;
    this.engineAccel = BOT_BASE.accel * spd * eng;
    const tt = L.tires ? L.tires.tier + 1 : 0;                 // tires part → grip/turn/handbrake
    this.grip = 7 + 1.0 * tt;
    this.turnRate = 2.5 + 0.08 * tt;
    this.handbrakeBoost = 1.3 + 0.10 * tt;                     // sharper drift per tier (base 1.3)
    setupWheels(this, L.tires ? L.tires.tier : 0);             // left/right wheel pools (dismemberment)
    const at = L.armor ? L.armor.tier + 1 : 0;                 // armor part → HP + reduction
    const newMax = 80 + this.level * 20 + this.stats.health * 25 + 20 * at;
    const inc = newMax - (this.maxHp || newMax);
    this.maxHp = newMax;
    this.partDmgReduce = 0.10 * at; // ARMOR part alone (durability stat removed)
    if (healOnGain) this.hp = Math.min(this.maxHp, this.hp + Math.max(0, inc));
  }

  reloadMul() { return 1 + this.stats.reload * 0.08; } // shortens fire interval
  weaponMul() { return 1 + 0.12 * (this.loadout.weapon.tier + 1); } // weapon tier → damage

  // drop ONE part on death, weighted toward the highest tier (RNG so not always best)
  pickDrop() {
    const parts = [this.loadout.tires, this.loadout.engine, this.loadout.weapon, this.loadout.armor].filter(Boolean);
    if (!parts.length) return null;
    let total = 0; for (const p of parts) total += (p.tier + 1) * (p.tier + 1);
    let r = rand(0, total);
    for (const p of parts) { r -= (p.tier + 1) * (p.tier + 1); if (r <= 0) return { slot: p.slot, type: p.type, tier: p.tier, cd: 0 }; }
    const last = parts[parts.length - 1];
    return { slot: last.slot, type: last.type, tier: last.tier, cd: 0 };
  }

  // FFA target selection: every car in range is scored by EFFECTIVE distance —
  // the player is biased ×PLAYER_BIAS (slightly prioritized), a recent attacker
  // (grudge) jumps the queue and can be hunted from farther out, and the
  // current target is sticky so bots don't flip-flop mid-duel.
  pickTarget(game) {
    let best = null, bs = 1e9;
    // veterans get BOLDER (user rule): temperament shifts toward hunter with
    // level, and detection ranges grow (up to +50% at high level) — a L20 bot
    // seeks out fights a L2 bot would drive past.
    const bias = Math.max(0.4, this.persona.playerBias - (this.level - 1) * 0.01);
    const rangeMul = 1 + Math.min(0.5, (this.level - 1) * 0.02);
    const consider = (c, range) => {
      if (c === this.boredOf) return; // gave up on them recently
      const d = dist(this.x, this.y, c.x, c.y);
      if (d > (c === this.grudge ? RETALIATE_RANGE : range * rangeMul)) return;
      let eff = d;
      if (c === game.player) eff *= bias; // per-bot temperament (hunter … passive), bolder with level
      if (c === this.grudge) eff *= GRUDGE_MUL;
      if (c === this.combatTarget) eff *= this.persona.sticky; // per-bot loyalty
      if (eff < bs) { bs = eff; best = c; }
    };
    if (!game.isDeadCar(game.player)) consider(game.player, BOT_ENGAGE);
    for (const b of game.bots) { if (b !== this && !b.deadFlag) consider(b, BOT_VS_BOT); }
    return best;
  }

  // drive TO a point (scrap / loot / escape) with SPEED-AWARE ARRIVAL:
  // reducing throttle alone never sheds drift momentum (drag is weak by
  // design), which is what made fast bots orbit piles — so the car carries a
  // distance-based speed BUDGET and genuinely BRAKES when over it. And when
  // it's near the item but not FACING it, a handbrake tap craters the grip so
  // the steering whips the nose directly onto the target (user spec).
  navTo(tx, ty, d) {
    const a = angleDiff(Math.atan2(ty - this.y, tx - this.x), this.heading);
    const aa = Math.abs(a);
    const steer = clamp(a * 2.6, -1, 1);
    let throttle;
    const budget = clamp(d * 2.2, 70, this.maxSpeed);  // how fast is OK at this distance
    if (this.speed > budget) throttle = -0.55;         // over budget → real braking
    else if (aa > 1.2) throttle = 0.28;                // sharply off → slow to pivot toward it
    else if (d < 90 && aa > 0.35) throttle = 0.15;     // close but off-angle → crawl on
    else if (d < 160) throttle = aa > 0.6 ? 0.35 : 0.6; // arriving → ease down (no overshoot)
    else throttle = aa > 0.8 ? 0.5 : 0.9;              // cruising in from afar
    // handbrake nose-snap: close + misaligned + moving → cut and FACE it
    const hb = d < 140 && aa > 0.5 && this.speed > 60;
    return { steer, throttle, hb };
  }

  // PARK on an item and stay there (scrap draining / loot channel). Gentle stop
  // + recenter — no violent reverse that overshoots and makes it bolt off.
  parkOn(tx, ty) {
    const toItem = angleDiff(Math.atan2(ty - this.y, tx - this.x), this.heading);
    const dd = dist(this.x, this.y, tx, ty);
    let throttle;
    if (this.speed > 55) throttle = -0.3;  // coming in hot → brake to a stop
    else if (dd > 22) throttle = 0.13;     // drifted off-center → creep back onto it
    else throttle = 0;                      // parked, holding station
    return { steer: clamp(toItem * 1.2, -1, 1), throttle };
  }

  nearWall() {
    const m = ARENA.wall + this.radius + 40;
    return this.x < m || this.x > ARENA.w - m || this.y < m || this.y > ARENA.h - m;
  }

  // Look-ahead wall avoidance (mirrors the Gauntlet enemy AI): project our
  // position ~0.55s ahead; if it lands in the wall danger zone, blend steering
  // toward the arena interior (harder the deeper) and brake when nosing in.
  applyWallAvoidance(throttle, steer) {
    const look = 0.55, margin = ARENA.wall + 100;
    const fx = this.x + this.vx * look, fy = this.y + this.vy * look;
    let ax = 0, ay = 0, pen = 0;
    if (fx < margin)           { const q = (margin - fx) / margin;             ax += q; pen = Math.max(pen, q); }
    if (fx > ARENA.w - margin) { const q = (fx - (ARENA.w - margin)) / margin; ax -= q; pen = Math.max(pen, q); }
    if (fy < margin)           { const q = (margin - fy) / margin;             ay += q; pen = Math.max(pen, q); }
    if (fy > ARENA.h - margin) { const q = (fy - (ARENA.h - margin)) / margin; ay -= q; pen = Math.max(pen, q); }
    if (pen <= 0) return [throttle, steer];
    pen = Math.min(pen, 1);
    const err = angleDiff(Math.atan2(ay, ax), this.heading);
    const w = Math.min(0.9, pen * 1.7);
    steer = steer * (1 - w) + clamp(err * 2.5, -1, 1) * w;
    const f = this.forward;
    if (pen > 0.4 && f.x * ax + f.y * ay < -0.3) throttle = Math.min(throttle, 0.2);
    return [throttle, steer];
  }

  // Look-ahead MINE avoidance (user request): project ~0.4s ahead and, for any
  // HOSTILE mine near that point (my own mines ignored), blend steering away
  // from it. Subtle (capped blend) so combat lines stay readable; skipped mid
  // ram-launch (charges stay committed, same as wall avoidance).
  avoidMines(throttle, steer, game) {
    if (!game.mines || !game.mines.length) return [throttle, steer];
    const look = 0.4;
    const fx = this.x + this.vx * look, fy = this.y + this.vy * look;
    const R = this.radius + 46; // clearance to keep around a live mine
    let ax = 0, ay = 0, worst = 0;
    for (const m of game.mines) {
      if (m.dead || m.owner === this) continue; // never dodge my OWN mines
      const d = dist(fx, fy, m.x, m.y);
      if (d >= R) continue;
      const q = (R - d) / R;
      const dx = (fx - m.x) || 0.01, dy = (fy - m.y) || 0.01;
      const inv = q / Math.hypot(dx, dy);
      ax += dx * inv; ay += dy * inv; // push away from the mine
      if (q > worst) worst = q;
    }
    if (worst <= 0) return [throttle, steer];
    const err = angleDiff(Math.atan2(ay, ax), this.heading);
    const w = Math.min(0.8, worst * 1.5);
    steer = steer * (1 - w) + clamp(err * 2.6, -1, 1) * w;
    return [throttle, steer];
  }

  update(dt, game) {
    if (this.stunT > 0) this.stunT -= dt; // hooked → stunned (can't shoot), ticks down after the reel
    tickWheelRepair(this, dt);            // wheels mend after 10s without a hit
    // attack-gate tracking (user): how long I've been CONTINUOUSLY visible on
    // the player's screen (logical 1280x720 rect). Off-screen resets it, so
    // every re-entry pays the reaction delay again.
    const pOnScreen = !game.dead &&
      Math.abs(game.player.x - this.x) < WORLD.w / 2 && Math.abs(game.player.y - this.y) < WORLD.h / 2;
    this.playerSeenT = pOnScreen ? this.playerSeenT + dt : 0;
    if (this.grudgeT > 0) { this.grudgeT -= dt; if (this.grudgeT <= 0) this.grudge = null; }
    if (this.flipCd > 0) this.flipCd -= dt;
    if (this.boredT > 0) { this.boredT -= dt; if (this.boredT <= 0) this.boredOf = null; }
    // GIVE-UP detector (user rule): confined to a ~400px bubble longer than my
    // personal patience → blacklist whatever I was pursuing + walk away. The
    // bubble catches ANY loop shape (circling fights, wall dances, pickup
    // oscillation) without per-behavior bookkeeping. Getting hurt cancels the
    // walk-away (survival beats boredom — see hurt()).
    if (dist(this.x, this.y, this.anchorX, this.anchorY) > 400) {
      this.anchorX = this.x; this.anchorY = this.y; this.anchorT = 0;
    } else this.anchorT += dt;
    if (this.escapeT <= 0 && this.anchorT > this.persona.giveUpT) {
      this.anchorT = 0;
      if (this.combatTarget && this.lastFocus === this.combatTarget) {
        // stuck IN A FIGHT: escalate, don't flee — force the tight-orbit phase
        // + an immediate dive so the duel resolves instead of both walking off
        this.fightT = Math.max(this.fightT, this.persona.escalateT + 6);
        this.dashT = 1.2;
      } else {
        this.boredOf = this.lastFocus; this.boredT = 10; // done with THAT thing for a while
        const ea = rand(0, TAU), er = rand(700, 1100);   // seeded far-off point, clamped in-world
        const em = ARENA.wall + 140;
        this.escapeX = clamp(this.x + Math.cos(ea) * er, em, ARENA.w - em);
        this.escapeY = clamp(this.y + Math.sin(ea) * er, em, ARENA.h - em);
        this.escapeT = rand(4, 6);
        this.fleeing = false; // a bored walk-away, not a retreat — hits cancel it
      }
    }
    // pick a combat target: any car in range (player slightly prioritized,
    // recent attackers hunted — FFA), else the central Titan if near (bots
    // swarm it → the "always contested" gravity well). Otherwise loot/farm.
    let target = this.pickTarget(game);
    this.combatTarget = target;
    let td = target ? dist(this.x, this.y, target.x, target.y) : 1e9;
    if (!target && game.boss && !game.boss.dead) {
      const db = dist(this.x, this.y, game.boss.x, game.boss.y);
      if (db < BOT_BOSS_RANGE) { target = game.boss; td = db; }
    }
    const engaged = target !== null;
    const aim = engaged ? angleDiff(Math.atan2(target.y - this.y, target.x - this.x), this.heading) : 0;
    // MAGNET awareness (user picks): against the Magnet, bots hold at the pull's
    // EDGE (out of the crush) and only truly threaten it during its OVERLOAD
    // window — normal weapons bounce off its armor otherwise. Minelayers still
    // feed mines into the pull anytime (mines are its weakness).
    const magnetTarget = engaged && target === game.boss && target.kind === "magnet";
    const magnetVuln = magnetTarget && target.isVulnerable && target.isVulnerable();
    // minelayer bots HOOK a car into their minefield (user: bots too). Fires in
    // the target's direction independent of the nose; gated by range + cooldown.
    if (this.hookCd > 0) this.hookCd -= dt;
    // hook a car (drag it into your field) OR the central boss (drag YOURSELF in).
    // FAIRNESS GATE (user): a bot only THROWS a hook when it would be ON the
    // target's screen — within a viewport-sized rect centered on the target
    // (logical 1280x720, so it's deterministic regardless of window shape).
    // No getting hooked by a car you can't even see.
    const onTargetScreen = engaged &&
      Math.abs(target.x - this.x) < WORLD.w / 2 && Math.abs(target.y - this.y) < WORLD.h / 2;
    if (this.weapon === "minelayer" && engaged && onTargetScreen && this.hookCd <= 0 && td < HOOK_MAX_LEN &&
        this.stunT <= 0 && this.attackGate(game, target)) {
      // LEAD the hook at where the target will be (same predictor as their shots,
      // with the hook's travel speed) so it lands on a moving car — then smear it
      // with a per-shot SCATTER much sloppier than gun aim (user: bots should
      // miss hooks more; persona.hookErr = marksmen vs flailers, seeded)
      const hp = arenaAimPoint(this, target, game.hookSpeedOf(this), this.persona.lead);
      const ang = Math.atan2(hp.y - this.y, hp.x - this.x) + rand(-1, 1) * this.persona.hookErr;
      if (game.fireHook(this, ang)) this.hookCd = game.hookCooldown(this.stats.reload);
    }

    // duel clock: time spent fighting THIS opponent (drives escalation) + time
    // engaged without landing damage (drives the standoff-breaker dive)
    if (engaged && target === this.fightTarget) this.fightT += dt;
    else { this.fightT = 0; this.fightTarget = target; }
    if (engaged && this.weapon !== "ram") this.noDmgT += dt; else this.noDmgT = 0;

    // opponent-aware courage: how healthy is my target compared to me, and
    // am I the one who's been hurting them?
    const foeFrac = !engaged ? 1
      : target === game.player ? game.hp / game.maxHp
      : target.hpFrac ? target.hpFrac()  // the Titan
      : target.hp / target.maxHp;
    const foeLastHitter = !engaged ? null
      : target === game.player ? game.playerLastHitBy : target.lastHitBy;
    // BLOODLUST (user rule): if the enemy I'VE been hitting drops under 20%,
    // I commit 100% to the kill — tight orbit, eager dives, no fleeing.
    // Merely SEEING a stranger that low changes nothing.
    const bloodlust = engaged && foeFrac < 0.2 && foeLastHitter === this;
    if (bloodlust) this.fightT = Math.max(this.fightT, this.persona.escalateT + 4);

    // LOW-HP FLEE: a wounded bot increasingly decides to run — odds rise
    // sharply as health drops (near-certain when critical), scaled by its
    // cowardice roll AND by how much healthier the enemy is. Decided every
    // few SECONDS, not per frame (compounding rolls would flee instantly).
    if (engaged && this.escapeT <= 0 && !bloodlust) {
      this.fleeCheckT -= dt;
      if (this.fleeCheckT <= 0) {
        this.fleeCheckT = rand(2, 3.5);
        const hpFrac = this.hp / this.maxHp;
        // FINISH-HIM veto: never run from someone worse off than me, or from
        // an enemy that's nearly dead — those are won fights
        if (hpFrac < 0.5 && foeFrac > hpFrac && foeFrac > 0.15) {
          let odds = Math.pow((0.5 - hpFrac) / 0.5, 1.5) * 1.4 * this.persona.cowardice;
          odds *= clamp(foeFrac / Math.max(0.05, hpFrac), 0.15, 1.5); // healthier foe → likelier flight
          if (rand(0, 1) < odds) {
            const away = Math.atan2(this.y - target.y, this.x - target.x) + rand(-0.5, 0.5);
            const em = ARENA.wall + 140, er = rand(600, 900);
            this.escapeX = clamp(this.x + Math.cos(away) * er, em, ARENA.w - em);
            this.escapeY = clamp(this.y + Math.sin(away) * er, em, ARENA.h - em);
            this.escapeT = rand(3, 5);
            this.fleeing = true; // a RETREAT — getting hit doesn't cancel it
          }
        }
      }
    }

    let throttle = 0, steer = 0, wantFire = false, hb = false;
    // personal steering wobble (sim-clock driven → deterministic); applied in
    // combat + on long drives so identical bots take visibly different lines
    const P = this.persona;
    const weave = Math.sin(game._t * P.weaveFreq + P.weavePhase) * P.weaveAmp;
    let ramAim = aim; // rams aim at the INTERCEPT point (set below)
    const escaping = this.escapeT > 0;
    if (escaping) {
      // gave up on a loop — commit to the walk-away point, then resume life
      this.escapeT -= dt;
      this.lootChannel = 0;
      const ed = dist(this.x, this.y, this.escapeX, this.escapeY);
      ({ steer, throttle, hb } = this.navTo(this.escapeX, this.escapeY, ed));
      steer = clamp(steer + weave * 0.5, -1, 1);
      if (ed < 120) this.escapeT = 0; // arrived — back to normal AI
      if (this.escapeT <= 0) this.fleeing = false; // the retreat is over
    } else if (engaged) {
      this.lastFocus = target;
      this.lootChannel = 0; // combat first — getting engaged aborts any pickup
      // a RAM vs a non-vulnerable Magnet doesn't charge into the crush — it
      // falls through to the ring-orbit (holds at the pull's edge) and only
      // commits its charge once the Magnet OVERLOADS
      if (this.weapon === "ram" && !(magnetTarget && !magnetVuln)) {
        // ram: INTERCEPT — chase where the target will be, not where it is.
        // Two rams steering at each other's current position circle forever
        // (each stays ~90° off the other's nose, so the charge never arms);
        // leading the target collapses the circle into a head-on. Per-bot
        // ramLead + weave desync the maneuver so two rams never mirror it.
        const tt = td / Math.max(120, this.speed + 60); // rough time-to-reach
        const ix = target.x + (target.vx || 0) * tt * P.ramLead;
        const iy = target.y + (target.vy || 0) * tt * P.ramLead;
        ramAim = angleDiff(Math.atan2(iy - this.y, ix - this.x), this.heading);
        steer = clamp(ramAim * 2.4 + weave * 0.5, -1, 1);
        // BRAKE-TO-TURN (Gauntlet rammer fix): badly off-nose for longer than
        // this bot's personal patience → slow down so the nose can swing on
        if (Math.abs(ramAim) > 0.6) this.offNoseT += dt; else this.offNoseT = 0;
        if (this.offNoseT > P.ramPatience) throttle = 0.25;
        else throttle = Math.abs(ramAim) > 1 ? 0.4 : 0.9;
        // handbrake NOSE-CUT (user: often, not always): a misaligned, moving
        // ram may whip its front onto the enemy — each opportunity rolls
        // against persona.ramSnapChance (with a cooldown between rolls), and
        // never mid-launch (the charge stays committed).
        if (this.ramSnapT > 0) { this.ramSnapT -= dt; hb = true; }
        else if (this.ramSnapCd > 0) this.ramSnapCd -= dt;
        else if (this.ramBoostT <= 0 && Math.abs(ramAim) > 0.6 && this.speed > 90 && td < 500) {
          this.ramSnapCd = rand(0.8, 1.6);
          if (rand(0, 1) < P.ramSnapChance) this.ramSnapT = rand(0.25, 0.45);
        }
      } else if (this.dashT > 0) {
        // STANDOFF-BREAKER: no damage landed for too long → commit to a short
        // straight dive at the target, guns blazing, to force the exchange
        this.dashT -= dt;
        steer = clamp(aim * 2.4 + weave * 0.4, -1, 1);
        throttle = 1.0;
        wantFire = Math.abs(aim) < P.fireArc;
      } else {
        // each dive interval is an INDEPENDENT 4-10s roll (user spec) — bots
        // never settle into a predictable dive rhythm. Bloodlust halves the
        // wait: dive eagerly to finish a prey that's nearly dead.
        if (this.noDmgT > this.nextDashAt * (bloodlust ? 0.5 : 1)) { this.dashT = rand(1.0, 1.5); this.noDmgT = 0; this.nextDashAt = rand(4, 10); }
        // ranged: CIRCLE-STRAFE via a RING-POINT GOAL (Gauntlet circler
        // pattern). Drive toward an actual point on a ring around the enemy,
        // a step ahead of where we sit on that ring — following it produces
        // the orbit, and being inside/outside the ring self-corrects range.
        // The point is FLATTENED into the arena's safe margin (user pick:
        // option A), so near a wall the goal itself bends the fight back
        // toward open ground instead of avoidance fighting the orbit.
        // ESCALATION: the longer this duel runs, the TIGHTER the ring — fights
        // spiral inward (each bot at its own seeded rate) so damage eventually
        // lands and someone wins, instead of orbiting at range forever.
        const tight = Math.max(0.35, 1 - Math.max(0, this.fightT - P.escalateT) * P.escalateRate);
        const cur = Math.atan2(this.y - target.y, this.x - target.x); // my angle on the ring
        const ahead = cur + this.orbitDir * (0.55 + P.orbitBias);     // a personal step ahead
        // ring distance: normally the persona orbit (Titan-safe). Vs the MAGNET,
        // hold near the PULL'S EDGE (out of the crush) — a bit inside the radius
        // for weapon range but well clear of the strong inner pull.
        const ring = magnetTarget
          ? MAGNET_PULL_R * (0.82 + P.orbitBias * 0.1)
          : P.orbitRange * tight + (target.radius || 0);
        const m = ARENA.wall + 110; // safe margin — derives from ARENA, resize-proof
        const gx = clamp(target.x + Math.cos(ahead) * ring, m, ARENA.w - m);
        const gy = clamp(target.y + Math.sin(ahead) * ring, m, ARENA.h - m);
        steer = clamp(angleDiff(Math.atan2(gy - this.y, gx - this.x), this.heading) * 2.2 + weave, -1, 1);
        throttle = 0.8 * P.throttleMul; // always on the move — that's the "driving around"
        // U-TURN safety net: identify which wall (N/E/S/W from ARENA dims) I'm
        // pressed against; if my circling direction carries me ALONG/INTO it
        // rather than toward the interior, flip the orbit (cooldown so it
        // can't rapid-flip). Covers the enemy-pinned-flat-on-the-wall case.
        if (this.flipCd <= 0) {
          const band = ARENA.wall + 130;
          let nx = 0, ny = 0; // inward normal of the wall(s) I'm near
          if (this.x < band) nx = 1;                 // West wall → interior is +x
          else if (this.x > ARENA.w - band) nx = -1; // East wall → interior is -x
          if (this.y < band) ny = 1;                 // North wall → interior is +y
          else if (this.y > ARENA.h - band) ny = -1; // South wall → interior is -y
          if (nx !== 0 || ny !== 0) {
            // my travel direction on the ring = tangent at my ring angle
            const tx = -Math.sin(cur) * this.orbitDir, ty = Math.cos(cur) * this.orbitDir;
            if (tx * nx + ty * ny < -0.3) { this.orbitDir *= -1; this.flipCd = P.flipCdT; } // personal cadence
          }
        }
      }
      // fire across a wide arc (shots lead + auto-aim, so the nose need not be
      // dead-on) — the arc width is a persona roll: patient vs spray-and-pray
      wantFire = this.weapon !== "ram" && Math.abs(aim) < P.fireArc;
      // vs the MAGNET: EVERY bot baits the overload — the armor now blocks
      // everything but the hook blast (user rule), so mines fired early would
      // just clank off. Minelayers contribute their HOOK anytime instead.
      if (magnetTarget && !magnetVuln) wantFire = false;
    } else {
      this.offNoseT = 0;
      // loot: an uncontested part UPGRADE in range beats farming
      const drop = this.findLootTarget(game);
      if (drop) {
        this.lastFocus = drop;
        const dd = dist(this.x, this.y, drop.x, drop.y);
        if (dd < 50) { // parked on the part — sit and channel the pickup
          ({ steer, throttle } = this.parkOn(drop.x, drop.y));
          this.lootChannel += dt;
          if (this.lootChannel >= BOT_LOOT_CHANNEL) game.botEquip(this, drop);
        } else {
          this.lootChannel = 0; // channel only accrues while parked on the part
          ({ steer, throttle, hb } = this.navTo(drop.x, drop.y, dd));
          if (dd > 300) steer = clamp(steer + weave * 0.7, -1, 1); // vary the route, not the parking
        }
      } else {
        this.lootChannel = 0;
        // LOOT CRATE (user): a crate on the bot's SCREEN beats scrap every
        // time (same logical-viewport rect as the hook gate). Drive THROUGH it
        // at speed — contact smashes it open (no arrival braking on purpose).
        let crate = null, crd = 1e9;
        for (const c of game.crates || []) {
          if (c.dead || c === this.boredOf) continue;
          if (Math.abs(c.x - this.x) > WORLD.w / 2 || Math.abs(c.y - this.y) > WORLD.h / 2) continue;
          const cd0 = dist(this.x, this.y, c.x, c.y);
          if (cd0 < crd) { crd = cd0; crate = c; }
        }
        if (crate) {
          this.lastFocus = crate;
          ({ steer, throttle, hb } = this.navTo(crate.x, crate.y, Math.max(crd, 420)));
          if (crd > 300) steer = clamp(steer + weave * 0.7, -1, 1);
        } else {
        // farm: navigate to the nearest scrap pile, then PARK on it to drain
        // (don't drive through — that's the sudden-stop-then-bolt behavior)
        let best = null, bd = 1e9;
        for (const s of game.scrap) { if (s.dead || s === this.boredOf) continue; const sd = dist(this.x, this.y, s.x, s.y); if (sd < bd) { bd = sd; best = s; } }
        if (best) {
          this.lastFocus = best;
          if (bd < 44) ({ steer, throttle } = this.parkOn(best.x, best.y));
          else {
            ({ steer, throttle, hb } = this.navTo(best.x, best.y, bd));
            if (bd > 300) steer = clamp(steer + weave * 0.7, -1, 1); // different lines to the same pile
            // cannon bots SHOOT the pile on the way in — their bullets harvest
            // it into THEIR XP (mirrors the player's shoot-to-farm). Quiet
            // (no audio): eight farming bots would be a constant drumroll.
            if (this.weapon === "cannon" && bd > 60 && bd < 420 && this.fireTimer <= 0) {
              const pa = angleDiff(Math.atan2(best.y - this.y, best.x - this.x), this.heading);
              if (Math.abs(pa) < 0.35) {
                this.fireTimer = 0.85 / this.reloadMul();
                const fb = new Bullet(this.x + Math.cos(this.heading) * 24, this.y + Math.sin(this.heading) * 24,
                  Math.atan2(best.y - this.y, best.x - this.x), 460, false, (10 + this.level) * this.weaponMul());
                fb.shooter = this;
                game.bullets.push(fb);
              }
            }
          }
        } else { this.lastFocus = null; throttle = 0.5; steer = weave; } // idle cruise wanders apart too
        } // (close the crate-else: crate seek replaced scrap farming this frame)
      }
    }

    // ram boost (before integrate); other weapons fire after. The charge arms
    // off the INTERCEPT aim — nose on the predicted position = launch. No
    // wind-ups while walking away from a given-up loop.
    // don't wind up a charge while merely holding at a non-vulnerable Magnet's
    // edge — the ram waits for the overload before committing
    const ramEngaged = engaged && !escaping && !(magnetTarget && !magnetVuln) && this.stunT <= 0 &&
      this.attackGate(game, target); // no wind-ups on a player who can't see you yet
    if (this.weapon === "ram") this.updateRam(dt, ramEngaged, ramAim);
    else this.boost = 1;
    this.chargingRam = this.weapon === "ram" && ramLaunchingFast(this, this.ramBoostT); // launched + moving → frontal-crash checks

    // --- wall handling (all behaviors) ---
    const ramLaunching = this.weapon === "ram" && this.ramBoostT > 0;
    if (!ramLaunching) [throttle, steer] = this.applyWallAvoidance(throttle, steer);
    if (!ramLaunching) [throttle, steer] = this.avoidMines(throttle, steer, game);
    // wedge recovery: pinned near a wall + barely moving → REVERSE out (a car
    // can't steer at zero speed, so driving forward can never recover). Only
    // near a wall, so mid-arena parking/orbiting never triggers a phantom back-out.
    if (this.speed < 40 && this.nearWall() && !ramLaunching) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > this.persona.unstickDelay) { // personal delay — escapes desync
      const toIn = angleDiff(Math.atan2(ARENA.h / 2 - this.y, ARENA.w / 2 - this.x), this.heading);
      throttle = -0.6;
      steer = -clamp(toIn * 2, -1, 1); // reversing flips steering → nose swings toward the interior
      hb = false;                      // no handbrake while backing out
      if (this.stuckT > this.persona.unstickDelay + 1.7) this.stuckT = 0; // release + retry
    }

    this.integrate(dt, throttle, steer, hb);

    // world bounds
    const m = ARENA.wall + this.radius;
    this.x = clamp(this.x, m, ARENA.w - m);
    this.y = clamp(this.y, m, ARENA.h - m);

    trackArenaMotion(this, dt); // feed the shot-leading trackers (I'm a target too)

    // ranged weapons fire toward the current target (RELOAD shortens the interval)
    this.fireTimer -= dt;
    if (wantFire && target && this.fireTimer <= 0 && this.weapon !== "ram" && this.stunT <= 0 &&
        this.attackGate(game, target)) { // player must be able to SEE the attacker (+ reaction time)
      // acceleration-aware lead (arenaAimPoint — the Gauntlet gunner's model):
      // distance sets flight time, along-track accel + typical-speed regression
      // set the travel. persona.lead scales it (under/over-leaders) and every
      // shot carries the personal aim scatter.
      const ap = arenaAimPoint(this, target, 460, this.persona.lead);
      const ang = Math.atan2(ap.y - this.y, ap.x - this.x) + rand(-this.persona.aimErr, this.persona.aimErr);
      if (this.weapon === "cannon") {
        this.fireTimer = 0.7 / this.reloadMul();
        const b = new Bullet(this.x + Math.cos(ang) * 24, this.y + Math.sin(ang) * 24, ang, 460, false, (10 + this.level) * this.weaponMul());
        b.shooter = this; // kill attribution
        game.bullets.push(b);
        game.audio.playEnemyShoot();
      } else if (this.weapon === "shotgun") {
        // close-range pellet spread — only fire when actually close (this is a
        // short-reach weapon); otherwise hold and keep closing the distance
        if (td < 340) {
          this.fireTimer = 0.9 / this.reloadMul();
          const pellets = 6, spread = 0.20;
          for (let i = 0; i < pellets; i++) {
            const pang = ang + (i / (pellets - 1) - 0.5) * 2 * spread;
            const pb = new Bullet(this.x + Math.cos(pang) * 24, this.y + Math.sin(pang) * 24, pang, 620, false, (17.5 + 2.5 * this.level) * this.weaponMul()); // 2.5x (user)
            pb.life = 0.34; pb.radius = 3;
            pb.strength = 0.35; // weak pellets — a normal cannon bullet breaks ~3
            pb.shooter = this;
            game.bullets.push(pb);
          }
          game.audio.playEnemyShoot();
        } else this.fireTimer = 0.12; // re-check soon, don't waste the volley at range
      } else if (this.weapon === "minelayer") {
        this.fireTimer = 1.6 / this.reloadMul();
        const f = this.forward;
        game.mines.push({ x: this.x - f.x * 26, y: this.y - f.y * 26, owner: this, arm: 1.0, age: 0, dmg: game.mineDamageOf(this), dead: false });
      } else if (this.weapon === "railgun") {
        // looted sniper: a single led slug when lined up, then a long reload
        this.fireTimer = 2.6 / this.reloadMul();
        const rp = arenaAimPoint(this, target, RAIL_SPEED, this.persona.lead);
        const rang = Math.atan2(rp.y - this.y, rp.x - this.x) + rand(-this.persona.aimErr, this.persona.aimErr);
        game.fireRailgun(this, rang, this.loadout.weapon.tier);
      }
    }
    if (this.hitFlash > 0) this.hitFlash -= dt;
  }

  // ATTACK GATE (user): a bot may only attack the PLAYER when it would be
  // visible on the player's screen (logical 1280x720 rect — same convention as
  // the hook gate) AND after a human-ish reaction delay: playerSeenT tracks
  // continuous on-screen time (ticked in update), persona.reactionT is the
  // per-bot reflex roll. Attacks on bots/bosses are ungated.
  attackGate(game, target) {
    if (target !== game.player) return true;
    return this.playerSeenT >= this.persona.reactionT;
  }

  // would this part be a straight tier upgrade for my loadout?
  wouldUpgrade(part) {
    const key = part.slot === "weapon" ? "weapon" : part.slot;
    const cur = this.loadout[key];
    return !cur || part.tier > cur.tier;
  }

  // nearest ground-part UPGRADE within range that nobody else is close to
  // (uncontested — no other living car within BOT_LOOT_CONTEST of the drop)
  findLootTarget(game) {
    let best = null, bd = 1e9;
    for (const d of game.drops) {
      if (d.dead || d === this.boredOf) continue; // skip drops I gave up on
      const dd = dist(this.x, this.y, d.x, d.y);
      if (dd > BOT_LOOT_RANGE || dd >= bd) continue;
      if (!this.wouldUpgrade(d.part)) continue;
      let contested = false;
      for (const c of game.cars()) {
        if (c === this || game.isDeadCar(c)) continue;
        if (dist(c.x, c.y, d.x, d.y) < BOT_LOOT_CONTEST) { contested = true; break; }
      }
      if (contested) continue;
      best = d; bd = dd;
    }
    return best;
  }

  // charge while lined up + close, launch a boosted ram (like the enemy RAMMER)
  updateRam(dt, engaged, aimToP) {
    if (this.ramBoostT > 0) { this.ramBoostT -= dt; this.boost = this.ramBoostT > 0 ? this.ramLaunchStr : 1; return; }
    if (engaged && Math.abs(aimToP) < 0.4) {
      // RELOAD speeds the wind-up (same rule as the player's ram)
      this.ramCharge = Math.min(1, this.ramCharge + dt * this.reloadMul() / 0.7);
      this.boost = 0.6;
      if (this.ramCharge >= 1) { this.ramLaunchStr = 2.4; this.ramBoostT = 0.8; this.ramCharge = 0; }
    } else { this.ramCharge = Math.max(0, this.ramCharge - dt); this.boost = 1; }
  }

  hurt(amount, hitX, hitY, srcType, source) {
    // RAM primary defense (bots carry a single weapon, so this.weapon === "ram"
    // IS their primary). A fully-shrugged hit still registers a grudge below
    // (the bot reacts to being shot at even when it tanks the damage).
    amount *= ramDamageMul(this, this.weapon === "ram", ramLaunchingFast(this, this.ramBoostT), hitX, hitY, srcType, source);
    const dealt = amount / (1 + (this.partDmgReduce || 0)); // ARMOR part reduction
    this.hp -= dealt;
    chipWheels(this, dealt, hitX, hitY, srcType); // bullets chew the closest wheel, blasts the closest two
    if (amount > 0) this.sinceHit = 0;    // any real hit stalls the wheel mend
    this.hitFlash = 0.12;
    // remember the attacker (hurtCar sets lastHitBy just before calling us) —
    // retaliation: they jump the targeting queue for a few seconds
    if (this.lastHitBy && this.lastHitBy !== this) { this.grudge = this.lastHitBy; this.grudgeT = RETALIATE_T; }
    if (!this.fleeing) this.escapeT = 0; // being hit cancels a bored walk-away — but NOT a retreat
    if (this.boredOf === this.lastHitBy) { this.boredOf = null; this.boredT = 0; } // ...and un-blacklists an attacker
    if (this.hp <= 0) this.deadFlag = true;
  }
}
