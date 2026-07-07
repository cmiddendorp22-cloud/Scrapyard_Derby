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
];

const BOT_ENGAGE = 560;      // engages the PLAYER within this range
const BOT_VS_BOT = 450;      // engages OTHER BOTS within this (shorter) range
const PLAYER_BIAS = 0.65;    // player's distance counts ×0.65 → ~35% priority
const RETALIATE_T = 4;       // seconds a "who just hit me" grudge lasts
const RETALIATE_RANGE = 900; // a grudge target can be hunted from this far out
const STICKY_MUL = 0.85;     // current target's distance bonus (no flip-flopping)
const GRUDGE_MUL = 0.5;      // recent attacker's distance bonus (jumps the queue)
const BOT_BOSS_RANGE = 1000; // will divert to swarm the central Titan within this range
const BOT_ORBIT_RANGE = 250;  // ranged bots circle-strafe the target at this distance
const BOT_ORBIT_ANGLE = Math.PI / 2; // base steer offset from the target: ~90° = drive AROUND it
const BOT_LOOT_RANGE = 600;   // notices ground-part UPGRADES within this range
const BOT_LOOT_CHANNEL = 2;   // seconds a bot must sit over a part to claim it
const BOT_LOOT_CONTEST = 200; // won't seek a drop if any OTHER car is this close to it
const BOT_BASE = { accel: 600, maxSpeed: 355 };

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

class ArenaBot extends Car {
  constructor(x, y, weapon, level) {
    super(x, y, rand(0, TAU), { accel: BOT_BASE.accel, maxSpeed: BOT_BASE.maxSpeed, turnRate: 2.5, grip: 7, drag: 0.6 });
    this.weapon = weapon;
    this.level = level;
    this.xp = 0;
    this.statPoints = 0;                 // spent instantly (randomly) on level-up
    this.stats = { health: 0, speed: 0, reload: 0, durability: 0 };
    this.name = pick(BOT_NAMES);
    this.fireTimer = rand(0.4, 1.4);
    this.ramCharge = 0; this.ramBoostT = 0; this.ramLaunchStr = 1;
    this.lootChannel = 0;                // seconds spent sitting over a part drop
    this.hitFlash = 0;
    this.lastHitBy = null;               // for kill attribution
    this.grudge = null;                  // who hit me recently (retaliation target)
    this.grudgeT = 0;                    // grudge time left
    this.combatTarget = null;            // sticky current target (no flip-flopping)
    this.orbitDir = (this.id % 2) ? 1 : -1; // circle-strafe direction (split across bots)
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
    const tt = L.tires ? L.tires.tier + 1 : 0;                 // tires part → grip/turn
    this.grip = 7 + 1.0 * tt;
    this.turnRate = 2.5 + 0.08 * tt;
    const at = L.armor ? L.armor.tier + 1 : 0;                 // armor part → HP + reduction
    const newMax = 80 + this.level * 20 + this.stats.health * 25 + 20 * at;
    const inc = newMax - (this.maxHp || newMax);
    this.maxHp = newMax;
    this.partDmgReduce = this.stats.durability * 0.1 + 0.05 * at;
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
    const consider = (c, range) => {
      const d = dist(this.x, this.y, c.x, c.y);
      if (d > (c === this.grudge ? RETALIATE_RANGE : range)) return;
      let eff = d;
      if (c === game.player) eff *= PLAYER_BIAS;
      if (c === this.grudge) eff *= GRUDGE_MUL;
      if (c === this.combatTarget) eff *= STICKY_MUL;
      if (eff < bs) { bs = eff; best = c; }
    };
    if (!game.isDeadCar(game.player)) consider(game.player, BOT_ENGAGE);
    for (const b of game.bots) { if (b !== this && !b.deadFlag) consider(b, BOT_VS_BOT); }
    return best;
  }

  // drive TO a point (scrap / loot) with BRAKE-TO-TURN: at full throttle the
  // turning circle is wider than a close target, so the car orbits it forever
  // ("moth orbit"). Slowing when close AND off-angle shrinks the turn radius so
  // the nose swings straight onto the item and the car arrives.
  navTo(tx, ty, d) {
    const a = angleDiff(Math.atan2(ty - this.y, tx - this.x), this.heading);
    const aa = Math.abs(a);
    const steer = clamp(a * 2.6, -1, 1);
    let throttle;
    if (aa > 1.2) throttle = 0.28;                     // sharply off → slow to pivot toward it
    else if (d < 90 && aa > 0.35) throttle = 0.15;     // close but off-angle → crawl on
    else if (d < 160) throttle = aa > 0.6 ? 0.35 : 0.6; // arriving → ease down (no overshoot)
    else throttle = aa > 0.8 ? 0.5 : 0.9;              // cruising in from afar
    return { steer, throttle };
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

  update(dt, game) {
    if (this.grudgeT > 0) { this.grudgeT -= dt; if (this.grudgeT <= 0) this.grudge = null; }
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

    let throttle = 0, steer = 0, wantFire = false;
    if (engaged) {
      this.lootChannel = 0; // combat first — getting engaged aborts any pickup
      const surf = td - (target.radius || 0); // to the target's SURFACE (Titan is huge)
      if (this.weapon === "ram") {
        // ram: line up and CHARGE straight through the target
        steer = clamp(aim * 2.4, -1, 1);
        throttle = Math.abs(aim) > 1 ? 0.4 : 0.9;
      } else {
        // ranged: CIRCLE-STRAFE — drive AROUND the target instead of nosing
        // straight at it (which caused the radial back-and-forth). Bullets
        // auto-aim, so steering toward a TANGENT point (offset ~90° from the
        // target, spiraling in/out to hold range) keeps the car moving
        // laterally around the enemy while still shooting it.
        const toTarget = Math.atan2(target.y - this.y, target.x - this.x);
        const rangeErr = clamp((surf - BOT_ORBIT_RANGE) / 260, -1, 1); // + far / - close
        const orbitAng = clamp(BOT_ORBIT_ANGLE - rangeErr * 1.2, 0.3, 2.6); // direct-in when far, orbit at range, back off when close
        const desired = toTarget + this.orbitDir * orbitAng;
        steer = clamp(angleDiff(desired, this.heading) * 2.2, -1, 1);
        throttle = 0.8; // always on the move — that's the "driving around"
      }
      // fire across a wide arc (shots lead + auto-aim, so the nose need not be dead-on)
      wantFire = this.weapon !== "ram" && Math.abs(aim) < 2.0;
    } else {
      // loot: an uncontested part UPGRADE in range beats farming
      const drop = this.findLootTarget(game);
      if (drop) {
        const dd = dist(this.x, this.y, drop.x, drop.y);
        if (dd < 50) { // parked on the part — sit and channel the pickup
          ({ steer, throttle } = this.parkOn(drop.x, drop.y));
          this.lootChannel += dt;
          if (this.lootChannel >= BOT_LOOT_CHANNEL) game.botEquip(this, drop);
        } else {
          this.lootChannel = 0; // channel only accrues while parked on the part
          ({ steer, throttle } = this.navTo(drop.x, drop.y, dd));
        }
      } else {
        this.lootChannel = 0;
        // farm: navigate to the nearest scrap pile, then PARK on it to drain
        // (don't drive through — that's the sudden-stop-then-bolt behavior)
        let best = null, bd = 1e9;
        for (const s of game.scrap) { if (s.dead) continue; const sd = dist(this.x, this.y, s.x, s.y); if (sd < bd) { bd = sd; best = s; } }
        if (best) {
          if (bd < 44) ({ steer, throttle } = this.parkOn(best.x, best.y));
          else ({ steer, throttle } = this.navTo(best.x, best.y, bd));
        } else throttle = 0.5;
      }
    }

    // ram boost (before integrate); other weapons fire after
    if (this.weapon === "ram") this.updateRam(dt, engaged, aim);
    else this.boost = 1;

    // --- wall handling (all behaviors) ---
    const ramLaunching = this.weapon === "ram" && this.ramBoostT > 0;
    if (!ramLaunching) [throttle, steer] = this.applyWallAvoidance(throttle, steer);
    // wedge recovery: pinned near a wall + barely moving → REVERSE out (a car
    // can't steer at zero speed, so driving forward can never recover). Only
    // near a wall, so mid-arena parking/orbiting never triggers a phantom back-out.
    if (this.speed < 40 && this.nearWall() && !ramLaunching) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 0.7) {
      const toIn = angleDiff(Math.atan2(ARENA.h / 2 - this.y, ARENA.w / 2 - this.x), this.heading);
      throttle = -0.6;
      steer = -clamp(toIn * 2, -1, 1); // reversing flips steering → nose swings toward the interior
      if (this.stuckT > 2.4) this.stuckT = 0; // periodically release + retry the behavior
    }

    this.integrate(dt, throttle, steer, false);

    // world bounds
    const m = ARENA.wall + this.radius;
    this.x = clamp(this.x, m, ARENA.w - m);
    this.y = clamp(this.y, m, ARENA.h - m);

    // ranged weapons fire toward the current target (RELOAD shortens the interval)
    this.fireTimer -= dt;
    if (wantFire && target && this.fireTimer <= 0 && this.weapon !== "ram") {
      // lead moving targets by their velocity over the shell's flight time.
      // Partial lead (0.5): orbiting targets CURVE, so full linear lead
      // overshoots the arc — under-leading lands more of the time.
      const lt = (dist(this.x, this.y, target.x, target.y) / 460) * 0.5;
      const ax = target.x + (target.vx || 0) * lt, ay = target.y + (target.vy || 0) * lt;
      const ang = Math.atan2(ay - this.y, ax - this.x);
      if (this.weapon === "cannon") {
        this.fireTimer = 0.7 / this.reloadMul();
        const b = new Bullet(this.x + Math.cos(ang) * 24, this.y + Math.sin(ang) * 24, ang, 460, false, (10 + this.level) * this.weaponMul());
        b.shooter = this; // kill attribution
        game.bullets.push(b);
        game.audio.playEnemyShoot();
      } else if (this.weapon === "minelayer") {
        this.fireTimer = 1.6 / this.reloadMul();
        const f = this.forward;
        game.mines.push({ x: this.x - f.x * 26, y: this.y - f.y * 26, owner: this, arm: 1.0, dmg: (12 + this.level) * this.weaponMul(), dead: false });
      }
    }
    if (this.hitFlash > 0) this.hitFlash -= dt;
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
      if (d.dead) continue;
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
      this.ramCharge = Math.min(1, this.ramCharge + dt / 0.7);
      this.boost = 0.6;
      if (this.ramCharge >= 1) { this.ramLaunchStr = 2.4; this.ramBoostT = 0.8; this.ramCharge = 0; }
    } else { this.ramCharge = Math.max(0, this.ramCharge - dt); this.boost = 1; }
  }

  hurt(amount) {
    this.hp -= amount / (1 + (this.partDmgReduce || 0)); // DURABILITY stat + ARMOR part
    this.hitFlash = 0.12;
    // remember the attacker (hurtCar sets lastHitBy just before calling us) —
    // retaliation: they jump the targeting queue for a few seconds
    if (this.lastHitBy && this.lastHitBy !== this) { this.grudge = this.lastHitBy; this.grudgeT = RETALIATE_T; }
    if (this.hp <= 0) this.deadFlag = true;
  }
}
