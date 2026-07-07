"use strict";
// ---------------------------------------------------------------------------
// Scrapyard Arena — persistent free-for-all mode (see BACKLOG-ARENA.md).
// FOUNDATION SLICE: a big open field you drive around with a following camera,
// scattered scrap, boundary walls, and a minimap. XP/leveling, the modular
// loot-build system, bots, boss/events, and PvP come in later slices.
//
// Mirrors the Gauntlet `Game` interface main.js drives against: update(dt),
// renderer.draw(), togglePause(), handleOrientation(), begin(), .started.
// Shares input + audio (passed in) so only one set of listeners exists.
// ---------------------------------------------------------------------------

const ARENA = { w: 5200, h: 5200, wall: 40 };

// leveling knobs (generic values — tune later). XP curve rises with level to a
// hard cap; each level grants 1 stat point; slots unlock at milestones.
const ARENA_BASE = { accel: 680, maxSpeed: 400 }; // pre-stat car tuning
const LEVEL_CAP = 30;
const STAT_CAP = 10;              // max points per stat
const SCRAP_TARGET = 180;         // world stays topped up to this many piles
const XP_PER_SCRAP = 1;           // XP per unit of scrap absorbed
const REGEN_DELAY = 5;            // seconds out of combat before health regen kicks in
const REGEN_BASE = 0.02;          // 2% of maxHp per second, +0.5%/REGEN point
const BOUNTY_XP = 150;            // bonus XP for wrecking the current #1 (leader bounty)
const LB_SECTORS = 4;             // minimap is split into an NxN grid for the bounty sector
const REVENGE_XP = 120;           // bonus XP for wrecking your nemesis (the bot that last killed you)
const KILL_FLOOR = 20;            // minimum XP for any non-boss kill (so fresh enemies still pay)
const PICKUP_RANGE = 180;         // a ground part within this range is "collectible" (shows in the panel)
const DROP_DESPAWN = 30;          // seconds a dropped part lingers before vanishing
const DROP_CAP = 40;              // max ground parts before the oldest is culled
const STREAK_MILESTONES = [3, 5, 8]; // wreck-streak counts that trigger a RAMPAGE callout (then every +5)
const SLOT_UNLOCKS = { 5: "armor", 10: "weapon2" }; // level → slot unlocked
const BOT_COUNT = 8;             // bots kept alive in the world
const BOT_RESPAWN = 3.5;         // seconds before a wrecked bot returns

// Starting weapons the player picks before spawning (their loadout's 1st weapon
// slot). Behaviors land with the modular slot system (BACKLOG-ARENA item 5);
// for now the pick is stored on ArenaGame.startWeapon and shown on the car.
const ARENA_WEAPONS = [
  { id: "cannon",    name: "CANNON",
    desc: "Reliable forward gun. Point, shoot, farm scrap and pick off cars at range." },
  { id: "minelayer", name: "MINELAYER",
    desc: "Drop proximity mines and hook enemies into them. A trapper's toolkit." },
  { id: "ram",       name: "RAM",
    desc: "Armored plow and boost. No bullets — chase them down and crush them." },
];

class ArenaGame {
  constructor(canvas, input, audio) {
    this.canvas = canvas;
    this.input = input;
    this.audio = audio;
    this.renderer = new ArenaRenderer(canvas, this);
    this.started = false;
    this.paused = false;
    this.touchMode = false;
    this.startWeapon = "cannon"; // chosen on the weapon-select screen before begin()
    // The player's display name on the leaderboard. Placeholder for now; when
    // Google accounts are linked (website), this becomes the account handle.
    this.playerName = "YOU";
    this.seed = RNG.randomSeed();
    this.rng = new RNG(this.seed);
    this.reset();
  }

  reset() {
    // progression state (a fresh run each time — death/quit resets it)
    this.level = 1;
    this.xp = 0;
    this.statPoints = 0;
    this.stats = { health: 0, speed: 0, reload: 0, durability: 0, regen: 0 };
    this.slots = { armor: false, weapon2: false };
    this.maxHp = 100;
    this.hp = 100;
    this.outOfCombat = 0;             // seconds since last damage (regen gate)
    this.particles = new Particles(); // level-up bursts now, combat FX later
    this.banners = [];                // lightweight center banners
    // weapon state (behaviors per this.startWeapon)
    this.bullets = [];                // cannon shots
    this.mines = [];                  // minelayer drops
    this.fireCooldown = 0;
    // ram charge (hold FIRE to wind up, release to launch a boost)
    this.ramCharge = 0;               // 0..1 while holding
    this.ramBoostT = 0;               // remaining launch-boost time
    this.ramLaunchStr = 1;            // Car.boost applied during the launch
    // combat
    this.bots = [];
    this.botRespawns = [];            // {t} timers for wrecked bots
    this.dead = false;                // player wrecked → death menu
    this.respawnT = 0;                // brief wreck moment before the menu shows
    this.spectate = false;            // watching bots from the death menu
    this.spectateIdx = 0;             // which living bot the camera follows
    this.kills = 0;
    this.pairHits = new Map();        // car-pair collision-damage cooldown
    this._t = 0;                      // sim clock (collision cooldown keys)
    this.drops = [];                  // dropped parts on the ground {x,y,part,age,dead}
    this.playerLastHitBy = null;      // who last damaged the player (attribution)
    this.boss = null;                 // central Junk Titan (built below)
    this.bossRespawnT = 0;            // countdown to the next Titan
    this._sawBoss = false;            // first-encounter banner latch
    this.leaderboard = [];            // ranked [{car,name,level,xp,isPlayer,dead}]
    this.leaderCar = null;            // current #1 (the bounty target)
    this.lbTimer = 0;                 // throttle for recomputing the leaderboard
    this.killfeed = [];               // recent wrecks [{text, you, streak, age}]
    this.nemesis = null;              // the bot that last wrecked you (revenge target)
    this.playerStreak = 0;            // your consecutive wrecks without dying

    if (this.renderer && this.renderer.resetMarks) this.renderer.resetMarks(); // fresh floor per run

    this.rng = new RNG(this.seed);
    // Own the sim RNG stream while building the world, then hand it back.
    // reset() runs at construction time (page load), BEFORE begin() points
    // _simRandom at this mode — without the swap, the Car stall-roll + scrap
    // scatter here consume ~360 draws from the GAUNTLET's seeded stream and
    // break its seed-replay determinism (verified by harness). Same pattern
    // as Renderer.renderEnemyPortrait.
    const prevRandom = _simRandom;
    setSimRandom(() => this.rng.next());
    // player uses the same drift tuning as the Gauntlet player car. Spawns off
    // dead-center — the Junk Titan owns the middle (see PLAYER_SPAWN).
    const sp = this.playerSpawn();
    this.player = new Car(sp.x, sp.y, -Math.PI / 2, {
      accel: ARENA_BASE.accel, maxSpeed: ARENA_BASE.maxSpeed, turnRate: 2.9, grip: 7, drag: 0.6,
    });
    this.loadout = this.freshLoadout(this.startWeapon); // 5 slots of parts (item 5)
    this.applyStats(); // set car tuning / maxHp from stats + equipped parts
    this.cam = { x: this.player.x, y: this.player.y };
    this.scrap = [];
    this.scatterScrap(SCRAP_TARGET);
    this.bots = [];
    for (let i = 0; i < BOT_COUNT; i++) this.spawnBot();
    // central boss (the map's gravity well) — sits on the dense center cluster
    this.boss = new ArenaBoss(ARENA.w / 2, ARENA.h / 2);
    this.bossRespawnT = 0;
    this._sawBoss = false;
    setSimRandom(prevRandom);
    this.computeLeaderboard(); // seed the standings before the first tick
  }

  // player spawn/respawn point — south of center so you never appear inside
  // the Titan (which sits at the map's middle)
  playerSpawn() { return { x: ARENA.w / 2, y: ARENA.h / 2 + 820 }; }

  // spawn one bot at a random spot away from the player
  spawnBot() {
    let x, y, tries = 0;
    do {
      x = rand(ARENA.wall + 100, ARENA.w - ARENA.wall - 100);
      y = rand(ARENA.wall + 100, ARENA.h - ARENA.wall - 100);
    } while (dist(x, y, this.player.x, this.player.y) < 700 && tries++ < 20);
    const weapon = pick(["cannon", "cannon", "ram", "minelayer"]); // cannon-weighted
    const level = randInt(1, Math.max(1, this.level + 2)); // scale with the player
    this.bots.push(new ArenaBot(x, y, weapon, level));
  }

  // -- leveling ---------------------------------------------------------------

  xpToNext() { return arenaXpToNext(this.level); } // shared player/bot curve

  addXp(amount) {
    if (this.level >= LEVEL_CAP) return;
    this.xp += amount;
    while (this.level < LEVEL_CAP && this.xp >= this.xpToNext()) {
      this.xp -= this.xpToNext();
      this.levelUp();
    }
    if (this.level >= LEVEL_CAP) this.xp = 0; // maxed — bar sits full
  }

  levelUp() {
    this.level++;
    this.statPoints++;
    const slot = SLOT_UNLOCKS[this.level];
    if (slot && !this.slots[slot]) {
      this.slots[slot] = true;
      this.banner(slot === "armor" ? "ARMOR SLOT UNLOCKED" : "2ND WEAPON SLOT UNLOCKED",
        "loot one from a wreck");
    } else {
      this.banner("LEVEL " + this.level, "+1 stat point");
    }
    this.audio.playRoundClear();                       // rising level-up jingle
    this.particles.sparks(this.player.x, this.player.y, fxRand(0, TAU), 22, 260); // gold burst
  }

  // spend 1 banked point into a stat (non-blocking — called mid-drive)
  spendStat(name) {
    if (this.statPoints <= 0 || !(name in this.stats) || this.stats[name] >= STAT_CAP) return;
    this.stats[name]++;
    this.statPoints--;
    this.applyStats();
  }

  // recompute derived values from stats. SPEED + HEALTH act now; RELOAD +
  // DURABILITY are stored and take effect once weapons/combat land (item 5).
  applyStats() {
    const L = this.loadout || {};
    // SPEED stat + ENGINE part both scale top speed & accel
    const spd = 1 + this.stats.speed * 0.05;
    const eng = L.engine ? 1 + 0.05 * (L.engine.tier + 1) : 1; // +5%/tier
    this.player.maxSpeed = ARENA_BASE.maxSpeed * spd * eng;
    this.player.engineAccel = ARENA_BASE.accel * spd * eng;
    // TIRES part → grip + turn (better handling)
    const tt = L.tires ? L.tires.tier + 1 : 0;
    this.player.grip = 7 + 1.0 * tt;
    this.player.turnRate = 2.9 + 0.08 * tt;
    // HEALTH stat + ARMOR part → max HP; DURABILITY stat + ARMOR → damage cut
    const at = L.armor ? L.armor.tier + 1 : 0;
    this.maxHp = 100 + this.stats.health * 25 + 20 * at;
    this.partDmgReduce = this.stats.durability * 0.1 + 0.05 * at;
    this.hp = Math.min(this.hp, this.maxHp);
  }

  // a fresh starting loadout: common tires/engine/armor + your picked weapon in
  // the primary slot, secondary empty (fill both from loot)
  freshLoadout(weaponType) {
    return {
      tires: makePart("tires", "tires", 0),
      engine: makePart("engine", "engine", 0),
      weapon1: makePart("weapon", weaponType || "cannon", 0),
      weapon2: null,
      armor: makePart("armor", "armor", 0),
    };
  }

  hasRam() {
    const L = this.loadout;
    return !!(L && ((L.weapon1 && L.weapon1.type === "ram") || (L.weapon2 && L.weapon2.type === "ram")));
  }

  banner(text, sub) {
    this.banners.push({ text, sub: sub || "", age: 0, dur: 2.2 });
    if (this.banners.length > 3) this.banners.shift();
  }

  // -- weapons (per this.startWeapon; behaviors land here, item 5) ------------

  // RAM: hold FIRE to CHARGE (the car digs in / winds up), release to LAUNCH a
  // boost whose strength scales with how long you held — the player-controlled
  // version of the enemy RAMMER's telegraph→charge. Runs BEFORE integrate
  // since it sets the Car.boost multiplier the physics reads. Body-damage vs
  // cars arrives with combat.
  updateRam(dt) {
    const p = this.player;
    if (!this.hasRam()) { p.boost = 1; return; }
    if (this.ramBoostT > 0) {                 // mid-launch: strong boost, timed
      this.ramBoostT -= dt;
      p.boost = this.ramBoostT > 0 ? this.ramLaunchStr : 1;
    } else if (this.input.fire) {              // holding: wind up + build charge
      this.ramCharge = Math.min(1, this.ramCharge + dt / 0.8); // ~0.8s to full
      p.boost = 0.5;                           // dig in — slow while charging
    } else if (this.ramCharge > 0.12) {        // released with charge → LAUNCH
      this.ramLaunchStr = 1.6 + this.ramCharge * 1.0; // up to 2.6x
      this.ramBoostT = 0.5 + this.ramCharge * 0.5;    // up to ~1.0s
      this.ramCharge = 0;
      p.boost = this.ramLaunchStr;
      this.audio.playRev(); // rev on launch (same cue as the enemy rammer)
    } else {
      this.ramCharge = 0;
      p.boost = 1;
    }
  }

  // Fire BOTH equipped weapons on FIRE, each on its own cooldown. Tier scales
  // damage + fire rate; RELOAD stat also shortens the interval. Ram weapons are
  // handled in updateRam (they charge instead of firing here).
  updateWeapon(dt) {
    const reloadMul = 1 + this.stats.reload * 0.08;
    for (const w of [this.loadout.weapon1, this.loadout.weapon2]) {
      if (!w) continue;
      w.cd = (w.cd || 0) - dt;
      if (w.type === "ram") continue;
      if (!this.input.fire || w.cd > 0) continue;
      const t = w.tier + 1, dmul = 1 + 0.12 * t, rate = reloadMul * (1 + 0.10 * t);
      const p = this.player, f = p.forward;
      if (w.type === "cannon") {
        w.cd = 0.3 / rate;
        const bx = p.x + f.x * (p.length / 2 + 6), by = p.y + f.y * (p.length / 2 + 6);
        const b = new Bullet(bx, by, p.heading, 560, true, 26 * dmul);
        b.life = 2.5;       // longer range for the big map
        b.shooter = p;      // kill attribution
        this.bullets.push(b);
        this.particles.sparks(bx, by, p.heading, 3, 140);
        p.vx -= f.x * 20; p.vy -= f.y * 20; // recoil
        this.audio.playShoot();
      } else if (w.type === "minelayer") {
        w.cd = 1.0 / rate;
        const mx = p.x - f.x * (p.length / 2 + 4), my = p.y - f.y * (p.length / 2 + 4);
        this.mines.push({ x: mx, y: my, owner: this.player, arm: 1.0, dmg: 30 * dmul, dead: false });
        if (this.mines.length > 25) this.mines.shift();
        this.particles.scrapPuff(mx, my);
      }
    }
  }

  // Bullet-vs-bullet clashing: shots from DIFFERENT entities block each other.
  // Each bullet has a hidden `strength` (1 normal, 3 boss shell) — on overlap
  // both lose the other's strength, dying at <=0, so a boss shell eats 3
  // normal bullets before breaking. Same-shooter bullets never clash.
  updateBulletClashes() {
    const bs = this.bullets;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (a.dead) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        if (b.dead || a.shooter === b.shooter) continue;
        if (dist(a.x, a.y, b.x, b.y) >= a.radius + b.radius) continue;
        const sa = a.strength, sb = b.strength;
        a.strength -= sb; b.strength -= sa;
        if (a.strength <= 0) a.dead = true;
        if (b.strength <= 0) b.dead = true;
        this.particles.sparks((a.x + b.x) / 2, (a.y + b.y) / 2, Math.atan2(b.vy - a.vy, b.vx - a.vx), 5, 160);
        if (a.dead) break; // this bullet is spent — stop pairing it
      }
    }
  }

  // FFA bullets: PLAYER shots also harvest scrap; every shot damages any car
  // except its shooter (tracked via b.shooter for kill attribution).
  updateProjectiles(dt) {
    this.updateBulletClashes();
    for (const b of this.bullets) {
      b.update(dt);
      if (b.dead) continue;
      if (b.x < ARENA.wall || b.x > ARENA.w - ARENA.wall || b.y < ARENA.wall || b.y > ARENA.h - ARENA.wall) { b.dead = true; continue; }
      if (b.fromPlayer) { // player shots farm scrap
        let ate = false;
        for (const s of this.scrap) {
          if (s.dead || dist(b.x, b.y, s.x, s.y) >= s.radius * 0.8) continue;
          const drain = Math.min(b.damage * 0.6, s.amount);
          s.amount -= drain; this.addXp(drain * XP_PER_SCRAP);
          this.particles.scrapPuff(s.x, s.y);
          if (s.amount <= 0) s.dead = true;
          b.dead = true; ate = true; break;
        }
        if (ate) continue;
      }
      // the Titan takes bullet damage too (any shot but its own)
      if (this.boss && !this.boss.dead && b.shooter !== this.boss &&
          dist(b.x, b.y, this.boss.x, this.boss.y) < this.boss.radius + b.radius) {
        this.hurtBoss(b.x, b.y, b.damage, b.shooter);
        this.particles.sparks(b.x, b.y, Math.atan2(b.vy, b.vx) + Math.PI, 6, 180);
        b.dead = true; continue;
      }
      for (const car of this.cars()) { // damage any car but the shooter
        if (car === b.shooter || this.isDeadCar(car)) continue;
        if (dist(b.x, b.y, car.x, car.y) >= car.radius + b.radius) continue;
        this.hurtCar(car, b.damage, b.shooter);
        this.particles.sparks(b.x, b.y, Math.atan2(b.vy, b.vx) + Math.PI, 6, 180);
        b.dead = true; break;
      }
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
  }

  // -- combat helpers ---------------------------------------------------------

  cars() { return [this.player, ...this.bots]; }            // all live-ish cars
  isDeadCar(car) { return car === this.player ? this.dead : car.deadFlag; }

  // route damage to the right HP pool + record the attacker for attribution
  hurtCar(car, amount, source) {
    if (car === this.player) { this.playerLastHitBy = source; this.damagePlayer(amount); }
    else { car.lastHitBy = source; car.hurt(amount); }
  }

  updateBots(dt) {
    for (const bot of this.bots) {
      if (bot.deadFlag) continue;
      bot.update(dt, this);
      // bots farm scrap too (XP → their own leveling)
      for (const s of this.scrap) {
        if (s.dead || dist(bot.x, bot.y, s.x, s.y) >= s.radius + bot.radius * 0.6) continue;
        const drain = Math.min(120 * dt, s.amount);
        s.amount -= drain; bot.gainXp(drain * XP_PER_SCRAP);
        if (s.amount <= 0) s.dead = true;
      }
    }
    // wrecked bots: pay XP to whoever killed them, drop their weapon, respawn
    for (let i = this.bots.length - 1; i >= 0; i--) {
      const bot = this.bots[i];
      if (!bot.deadFlag) continue;
      this.bots.splice(i, 1);
      this.feedWreck(bot.lastHitBy, bot);
      this.bumpStreak(bot.lastHitBy);
      this.awardKill(bot.lastHitBy, bot); // reads nemesis for the revenge bonus, may clear it
      if (bot === this.nemesis) this.nemesis = null; // else the grudge escaped (someone else got them)
      this.dropPart(bot.x, bot.y, bot.pickDrop()); // drops one of its parts (weighted to its best)
      this.particles.explosion(bot.x, bot.y);
      this.audio.playExplosion();
      this.botRespawns.push(BOT_RESPAWN);
    }
    for (let i = this.botRespawns.length - 1; i >= 0; i--) {
      this.botRespawns[i] -= dt;
      if (this.botRespawns[i] <= 0) { this.botRespawns.splice(i, 1); this.spawnBot(); }
    }
  }

  // grant kill XP to the attacker (player or a bot). Wrecking the current #1
  // (leader bounty) or your nemesis (revenge) pays a bonus on top.
  awardKill(killer, victim) {
    const bounty = victim === this.leaderCar;
    const revenge = killer === this.player && victim === this.nemesis;
    // base kill reward = 25% of the victim's accumulated XP (not bosses — they
    // pay their own flat bonus in killBoss), floored so fresh enemies still pay;
    // leader/nemesis add flat bonuses
    const base = Math.max(KILL_FLOOR, Math.ceil(0.25 * arenaTotalXp(victim.level, victim.xp || 0)));
    const xp = base + (bounty ? BOUNTY_XP : 0) + (revenge ? REVENGE_XP : 0);
    if (killer === this.player) {
      this.kills++;
      this.addXp(xp);
      const tag = revenge ? "REVENGE! WRECKED " : bounty ? "BOUNTY! WRECKED " : "WRECKED ";
      this.banner(tag + victim.name, "+" + xp + " XP");
      if (revenge) this.nemesis = null; // grudge settled
    } else if (killer && killer.gainXp) {
      killer.gainXp(xp); // a bot leveled off the kill
    }
  }

  // -- social hooks: killfeed + nemesis + rampage streaks (item 8) ------------

  // display name for any wrecker/victim (player, a bot, or the Titan)
  nameOf(car) {
    if (!car) return "THE ARENA";
    if (car === this.player) return this.playerName;
    if (car === this.boss) return "JUNK TITAN";
    return car.name || "BOT";
  }

  // push one "X wrecked Y" line onto the killfeed (newest first, capped)
  feedWreck(killer, victim) {
    this.killfeed.unshift({
      text: this.nameOf(killer) + " wrecked " + this.nameOf(victim),
      you: killer === this.player || victim === this.player,
      streak: false, age: 0,
    });
    if (this.killfeed.length > 8) this.killfeed.pop();
  }

  // bump the killer's wreck streak; announce RAMPAGE milestones (player + bots)
  bumpStreak(killer) {
    let s;
    if (killer === this.player) s = ++this.playerStreak;
    else if (killer && killer.streak !== undefined) s = ++killer.streak;
    else return; // the Titan / walls don't rampage
    if (STREAK_MILESTONES.includes(s) || (s > STREAK_MILESTONES[STREAK_MILESTONES.length - 1] && s % 5 === 0)) {
      const line = this.nameOf(killer) + ": " + s + "-WRECK RAMPAGE";
      this.banner(line, "");
      this.killfeed.unshift({ text: line, you: killer === this.player, streak: true, age: 0 });
      if (this.killfeed.length > 8) this.killfeed.pop();
    }
  }

  // rank the player + all bots into live standings (level, then XP). The
  // highest-ranked LIVING car is the leader / bounty target. Cheap (9 entries)
  // but throttled from update() so it isn't recomputed every frame.
  computeLeaderboard() {
    const entries = [{ car: this.player, name: this.playerName, level: this.level, xp: this.xp, isPlayer: true, dead: this.dead }];
    for (const b of this.bots) entries.push({ car: b, name: b.name, level: b.level, xp: b.xp, isPlayer: false, dead: b.deadFlag });
    entries.sort((a, b) => (b.level - a.level) || (b.xp - a.xp));
    this.leaderboard = entries;
    const live = entries.find((e) => !e.dead);
    this.leaderCar = live ? live.car : null;
  }

  // full FFA collisions: any car pair collides + trades fault-based damage
  updateCollisions() {
    const cars = this.cars();
    for (let i = 0; i < cars.length; i++) {
      if (this.isDeadCar(cars[i])) continue;
      for (let j = i + 1; j < cars.length; j++) {
        if (this.isDeadCar(cars[j])) continue;
        this.collidePair(cars[i], cars[j]);
      }
    }
    if (this.boss && !this.boss.dead) for (const c of cars) this.collideBoss(c);
  }

  collidePair(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.001;
    const minD = a.radius + b.radius;
    if (d >= minD) return;
    const nx = dx / d, ny = dy / d, push = (minD - d) / 2;
    a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv >= 0) return;
    const aTow = Math.max(0, a.vx * nx + a.vy * ny), bTow = Math.max(0, -(b.vx * nx + b.vy * ny));
    const j = -1.45 * rv / 2;
    a.vx -= nx * j; a.vy -= ny * j; b.vx += nx * j; b.vy += ny * j;
    const impact = -rv;
    const key = a.id < b.id ? a.id + ":" + b.id : b.id + ":" + a.id;
    if (impact > 70 && this._t - (this.pairHits.get(key) ?? -1) > 0.3) {
      this.pairHits.set(key, this._t);
      const total = Math.max(1, aTow + bTow), dmg = (impact - 40) * 0.11;
      this.hurtCar(a, dmg * (0.15 + 0.85 * (bTow / total)), b); // each hurt by the OTHER's push
      this.hurtCar(b, dmg * (0.15 + 0.85 * (aTow / total)), a);
      const cx = a.x + nx * a.radius, cy = a.y + ny * a.radius;
      this.particles.sparks(cx, cy, Math.atan2(ny, nx), 8, 240);
      this.audio.playImpact(clamp(impact / 500, 0, 1));
    }
  }

  // -- central Junk Titan boss (BACKLOG-ARENA item 6) -------------------------

  updateBossWorld(dt) {
    if (!this.boss) return;
    if (!this.boss.dead) { this.boss.update(dt, this); return; }
    this.bossRespawnT -= dt;
    if (this.bossRespawnT <= 0) this.boss = new ArenaBoss(ARENA.w / 2, ARENA.h / 2);
  }

  // route incoming damage to the plate FACING the hit; if that plate is gone,
  // the core is exposed there and takes it instead. Tearing a plate off drops a
  // lootable weapon (the signature "rip a part off the enemy" mechanic).
  hurtBoss(hitX, hitY, amount, source) {
    const boss = this.boss;
    if (!boss || boss.dead) return;
    boss.lastHitBy = source;
    boss.hitFlash = 0.1;
    let plate = null, best = 1e9;
    const hitAng = Math.atan2(hitY - boss.y, hitX - boss.x);
    for (const p of boss.plates) {
      const diff = Math.abs(angleDiff(hitAng, boss.heading + p.ang));
      if (diff < best) { best = diff; plate = p; }
    }
    if (plate && !plate.dead) {
      plate.hp -= amount; plate.hit = 0.12;
      if (plate.hp <= 0) {
        plate.dead = true;
        const wa = boss.heading + plate.ang;
        const px = boss.x + Math.cos(wa) * boss.radius, py = boss.y + Math.sin(wa) * boss.radius;
        this.particles.explosion(px, py); // the single rare+ drop comes from the CORE kill
        this.audio.playExplosion();
        this.banner("TITAN PLATE TORN OFF", "core exposed — hit the gap");
      }
    } else {
      boss.coreHp -= amount;
      boss.hitFlash = 0.14;
      if (boss.coreHp <= 0) { boss.dead = true; this.killBoss(source); }
    }
  }

  // core down: big XP to the killer + a scrap piñata + a bonus weapon drop
  killBoss(killer) {
    const boss = this.boss, xp = 400;
    this.feedWreck(killer, boss);
    this.bumpStreak(killer);
    if (killer === this.player) {
      this.kills++; this.addXp(xp);
      this.banner("JUNK TITAN WRECKED", "+" + xp + " XP");
    } else if (killer && killer.gainXp) {
      killer.gainXp(xp); // a bot toppled it
    }
    for (let i = 0; i < 10; i++) { // explode the hoard into fresh scrap
      const a = rand(0, TAU), r = rand(40, 220);
      const x = clamp(boss.x + Math.cos(a) * r, ARENA.wall + 80, ARENA.w - ARENA.wall - 80);
      const y = clamp(boss.y + Math.sin(a) * r, ARENA.wall + 80, ARENA.h - ARENA.wall - 80);
      this.scrap.push(new ScrapPile(x, y));
    }
    // the Titan drops ONE part, always rare+ (mostly rare/epic, rarely legendary)
    const slot = pick(["tires", "engine", "weapon", "armor"]);
    const type = slot === "weapon" ? pick(ARENA_WEAPON_TYPES) : slot;
    this.dropPart(boss.x, boss.y, makePart(slot, type, pick([2, 2, 3, 3, 4])));
    this.particles.explosion(boss.x, boss.y);
    this.particles.sparks(boss.x, boss.y, 0, 40, 420);
    this.audio.playExplosion();
    this.bossRespawnT = BOSS_RESPAWN;
  }

  // ground-slam shockwave: radial knockback + falloff damage to nearby cars
  bossSlam() {
    const boss = this.boss, R = BOSS_SLAM_R;
    for (const c of this.cars()) {
      if (this.isDeadCar(c)) continue;
      const d = dist(boss.x, boss.y, c.x, c.y);
      if (d > R) continue;
      const ang = Math.atan2(c.y - boss.y, c.x - boss.x), f = 1 - d / R;
      c.vx += Math.cos(ang) * 520 * f; c.vy += Math.sin(ang) * 520 * f;
      this.hurtCar(c, 30 * f, boss);
    }
    this.particles.explosion(boss.x, boss.y);
    this.particles.sparks(boss.x, boss.y, 0, 34, 380);
    this.audio.playExplosion();
  }

  // a car ramming the Titan: it barely budges, shoves the car back, and the
  // facing plate takes the hit (credited to the car — ram builds can peel it)
  collideBoss(car) {
    const boss = this.boss;
    if (!boss || boss.dead || this.isDeadCar(car)) return;
    const dx = boss.x - car.x, dy = boss.y - car.y, d = Math.hypot(dx, dy) || 0.001;
    const minD = boss.radius + car.radius;
    if (d >= minD) return;
    const nx = dx / d, ny = dy / d;
    car.x -= nx * (minD - d); car.y -= ny * (minD - d); // push the car clear
    const closing = car.vx * nx + car.vy * ny;          // car driving INTO the boss
    if (closing <= 0) return;
    car.vx -= nx * closing * 1.6; car.vy -= ny * closing * 1.6; // bounce back
    boss.vx += nx * closing * 0.12; boss.vy += ny * closing * 0.12;
    const key = "boss:" + car.id;
    if (closing > 60 && this._t - (this.pairHits.get(key) ?? -1) > 0.3) {
      this.pairHits.set(key, this._t);
      const px = car.x + nx * car.radius, py = car.y + ny * car.radius;
      this.hurtBoss(px, py, (closing - 30) * 0.10, car); // plate takes the ram
      this.hurtCar(car, (closing - 30) * 0.05, boss);     // you take a knock too
      this.particles.sparks(px, py, Math.atan2(ny, nx), 8, 240);
      this.audio.playImpact(clamp(closing / 500, 0, 1));
    }
  }

  updateMines(dt) {
    for (const m of this.mines) {
      if (m.dead) continue;
      if (m.arm > 0) { m.arm -= dt; continue; }
      // the Titan trips mines too (any mine but its own — the boss has none)
      if (this.boss && !this.boss.dead && m.owner !== this.boss &&
          dist(m.x, m.y, this.boss.x, this.boss.y) < 30 + this.boss.radius) {
        m.dead = true;
        this.hurtBoss(m.x, m.y, m.dmg, m.owner);
        this.particles.explosion(m.x, m.y);
        this.audio.playExplosion();
        continue;
      }
      for (const car of this.cars()) { // detonate on any car but the owner
        if (car === m.owner || this.isDeadCar(car)) continue;
        if (dist(m.x, m.y, car.x, car.y) >= 30 + car.radius * 0.6) continue;
        m.dead = true;
        const ang = Math.atan2(car.y - m.y, car.x - m.x);
        car.vx += Math.cos(ang) * 240; car.vy += Math.sin(ang) * 240; // knockback
        this.hurtCar(car, m.dmg, m.owner);
        this.particles.explosion(m.x, m.y);
        this.audio.playExplosion();
        break;
      }
    }
    this.mines = this.mines.filter((m) => !m.dead);
  }

  // DURABILITY reduces damage taken; hitting 0 HP wrecks the player.
  damagePlayer(amount) {
    if (this.dead) return;
    this.outOfCombat = 0; // taking a hit resets the regen timer
    this.hp -= amount / (1 + this.partDmgReduce); // DURABILITY stat + ARMOR part
    if (this.hp <= 0) {
      this.dead = true;
      this.respawnT = 1.2; // brief wreck moment, then the death menu (main.js)
      const killer = this.playerLastHitBy;
      this.feedWreck(killer, this.player);
      this.bumpStreak(killer);              // your killer's streak grows
      this.playerStreak = 0;                // yours resets on death
      if (killer && killer.gainXp) this.nemesis = killer; // a BOT becomes your nemesis
      if (this.loadout.weapon1) this.dropPart(this.player.x, this.player.y, this.loadout.weapon1); // scatter your gun
      this.particles.explosion(this.player.x, this.player.y);
      if (this.audio.playGameOver) this.audio.playGameOver();
      this.banner("WRECKED", "");
    }
  }

  // death penalty (softened, user request): drop to 25% of your accumulated XP
  // (you keep ~63% of your level) and re-earn from there. Your build resets —
  // stats to zero (with the reduced level's points to re-spend) + a fresh
  // common loadout of your original weapon.
  // the bot the spectate camera follows (wraps; falls back to the Titan)
  spectateTarget() {
    const live = this.bots.filter((b) => !b.deadFlag);
    if (!live.length) return this.boss && !this.boss.dead ? this.boss : null;
    return live[this.spectateIdx % live.length];
  }
  nextSpectate() { this.spectateIdx++; }

  respawnPlayer() {
    this.dead = false;
    this.spectate = false;
    const kept = 0.25 * arenaTotalXp(this.level, this.xp);
    const lv = arenaLevelFromTotal(kept, LEVEL_CAP);
    this.level = lv.level; this.xp = lv.xp;
    this.statPoints = this.level - 1;                   // points for your reduced level
    this.stats = { health: 0, speed: 0, reload: 0, durability: 0, regen: 0 };
    this.slots = { armor: this.level >= 5, weapon2: this.level >= 10 };
    this.startWeapon = this.baseWeapon;
    this.loadout = this.freshLoadout(this.baseWeapon);
    this.applyStats();
    this.hp = this.maxHp;
    this.outOfCombat = 0;
    const sp = this.playerSpawn();
    this.player.x = sp.x; this.player.y = sp.y;
    this.player.vx = this.player.vy = 0;
    this.banner("RESPAWNED", "back to level " + this.level);
  }

  // -- part loot: wrecks drop parts; equip them from the loadout panel --------

  dropPart(x, y, part) {
    if (!part) return;
    this.drops.push({ x, y, part, age: 0, dead: false });
    if (this.drops.length > DROP_CAP) { // cull the oldest live drop
      const i = this.drops.findIndex((d) => !d.dead);
      if (i >= 0) this.drops[i].dead = true;
    }
  }

  updateDrops(dt) {
    for (const d of this.drops) {
      if (d.dead) continue;
      d.age += dt;
      if (d.age > DROP_DESPAWN) d.dead = true; // despawn so the ground doesn't fill up
    }
    this.drops = this.drops.filter((d) => !d.dead);
  }

  // ground parts within reach of the player (what the panel offers to equip)
  collectibleDrops() {
    if (this.dead) return [];
    const p = this.player;
    return this.drops.filter((d) => !d.dead && dist(p.x, p.y, d.x, d.y) <= PICKUP_RANGE);
  }

  // which loadout slot a part would fill: fixed for tires/engine/armor; weapons
  // fill an empty weapon slot, else REPLACE the secondary (user rule)
  targetSlot(part) {
    if (part.slot !== "weapon") return part.slot;
    if (!this.loadout.weapon1) return "weapon1";
    if (!this.loadout.weapon2) return "weapon2";
    return "weapon2";
  }

  // a BOT claims a ground part after channeling on it (same single-access
  // claim as the player — dead the instant it's taken, no dupes). Its old
  // part swaps out where the loot sat, same as the player's rule.
  botEquip(bot, drop) {
    bot.lootChannel = 0;
    if (!drop || drop.dead || bot.deadFlag) return;
    drop.dead = true; // claimed
    const key = drop.part.slot === "weapon" ? "weapon" : drop.part.slot;
    const old = bot.loadout[key];
    bot.loadout[key] = drop.part;
    if (key === "weapon") bot.weapon = drop.part.type; // AI + rendered gear follow the new gun
    if (old) this.dropPart(drop.x, drop.y, old);
    bot.applyStats();
    this.particles.scrapPuff(drop.x, drop.y);
  }

  // swap which weapon is primary vs secondary (both fire, but primary renders
  // on the car + is the one a new weapon can't auto-replace)
  swapWeapons() {
    const L = this.loadout;
    if (!L.weapon1 || !L.weapon2) return;
    const t = L.weapon1; L.weapon1 = L.weapon2; L.weapon2 = t;
    this.startWeapon = L.weapon1.type; // keep the rendered/primary weapon in sync
    this.banner("PRIMARY: " + partName(L.weapon1), "");
  }

  // compare `part` to what's in its target slot by tier: 1 upgrade / 0 same /
  // -1 downgrade (an empty slot counts as an upgrade)
  slotCompare(part) {
    const cur = this.loadout[this.targetSlot(part)];
    if (!cur) return 1;
    return part.tier > cur.tier ? 1 : part.tier < cur.tier ? -1 : 0;
  }

  // equip a ground drop: single-access (marked dead immediately so it can't be
  // grabbed twice / duped — the hook for a real per-drop claim lock in netcode).
  // The replaced part swaps out to where the looted one sat.
  equipPart(drop) {
    if (!drop || drop.dead || this.dead) return false;
    if (dist(this.player.x, this.player.y, drop.x, drop.y) > PICKUP_RANGE) return false;
    drop.dead = true; // claim it NOW
    const slot = this.targetSlot(drop.part);
    const old = this.loadout[slot];
    this.loadout[slot] = drop.part;
    if (slot === "weapon1") this.startWeapon = drop.part.type; // keep primary render in sync
    if (old) this.dropPart(drop.x, drop.y, old); // your old part lands in the pile you took from
    this.applyStats();
    this.banner("EQUIPPED " + partName(drop.part), old ? "swapped " + partName(old) : "");
    if (this.audio.playRepair) this.audio.playRepair();
    return true;
  }

  tickBanners(dt) {
    for (const b of this.banners) b.age += dt;
    this.banners = this.banners.filter((b) => b.age < b.dur);
    for (const k of this.killfeed) k.age += dt;
    this.killfeed = this.killfeed.filter((k) => k.age < 5); // lines linger 5s
  }

  // scatter scrap across the world as XP nodes. A dense cluster is kept around
  // the central Junk Titan (the "gravity well") so the middle is worth the
  // risk — top-up refills the cluster first, then scatters the rest at random.
  scatterScrap(n) {
    const cx = ARENA.w / 2, cy = ARENA.h / 2;
    let cluster = 0;
    for (const s of this.scrap) if (!s.dead && dist(s.x, s.y, cx, cy) < 720) cluster++;
    let guard = 0;
    while (this.scrap.length < n && guard++ < n * 8) {
      let x, y;
      if (cluster < 28) { // bias toward the center until the cluster is topped up
        const a = rand(0, TAU), r = rand(140, 700);
        x = cx + Math.cos(a) * r; y = cy + Math.sin(a) * r; cluster++;
      } else {
        x = rand(ARENA.wall + 80, ARENA.w - ARENA.wall - 80);
        y = rand(ARENA.wall + 80, ARENA.h - ARENA.wall - 80);
      }
      if (dist(x, y, this.player.x, this.player.y) < 260) continue; // keep spawn clear
      this.scrap.push(new ScrapPile(x, y));
    }
  }

  begin() {
    this.started = true;
    this.baseWeapon = this.startWeapon; // respawn reverts to your original pick
    this.loadout = this.freshLoadout(this.startWeapon); // build slots from the pick
    this.applyStats();
    setSimRandom(() => this.rng.next()); // this mode owns the sim RNG while active
  }

  togglePause() {
    if (!this.started) return;
    this.paused = !this.paused;
    document.getElementById("pause-screen").classList.toggle("hidden", !this.paused);
    if (this.paused) {
      document.getElementById("guide-btn").classList.add("hidden"); // no Field Guide in Arena
    } else {
      document.getElementById("options-screen").classList.add("hidden"); // clean up sub-menus
    }
    if (this.audio.ctx) this.paused ? this.audio.ctx.suspend() : this.audio.ctx.resume();
  }

  // mobile: portrait auto-pauses (matches Gauntlet behavior)
  handleOrientation(isPortrait) {
    if (!this.touchMode || !this.started) return;
    if (isPortrait && !this.paused) this.togglePause();
  }

  update(dt) {
    if (!this.started || this.paused) return;
    this._t += dt;
    const p = this.player;

    // live standings + bounty target (throttled — cheap but not every frame)
    this.lbTimer -= dt;
    if (this.lbTimer <= 0) { this.lbTimer = 0.5; this.computeLeaderboard(); }

    // WRECKED: the world keeps living; the death menu (or spectate) decides
    // what happens next — no auto-respawn.
    if (this.dead) {
      if (this.respawnT > 0) this.respawnT -= dt; // wreck moment before the menu
      this.updateBots(dt);
      this.updateBossWorld(dt);
      this.updateCollisions(); // bots still crash into each other + the Titan
      this.updateProjectiles(dt);
      this.updateMines(dt);
      this.updateDrops(dt);
      // scrap eaten by bots still respawns (same top-up as the alive branch)
      if (this.scrap.some((s) => s.dead)) {
        this.scrap = this.scrap.filter((s) => !s.dead);
        this.scatterScrap(SCRAP_TARGET);
      }
      // bots keep laying rubber while you're wrecked/spectating (cosmetic)
      this.renderer.updateSkids(dt);
      for (const b of this.bots) if (!b.deadFlag) this.renderer.recordSkids(b);
      this.particles.update(dt);
      this.tickBanners(dt);
      this.audio.setEngine(0, false); // no car — kill the engine drone
      this.audio.setScreech(0);
      // spectate: camera follows the chosen living bot (clamped like normal play)
      if (this.spectate) {
        const t = this.spectateTarget();
        if (t) {
          this.cam.x = clamp(t.x, WORLD.w / 2, ARENA.w - WORLD.w / 2);
          this.cam.y = clamp(t.y, WORLD.h / 2, ARENA.h - WORLD.h / 2);
        }
      }
      return;
    }

    // ram charge/boost sets p.boost, which the physics reads — before integrate
    this.updateRam(dt);

    // drive (shared keyboard/joystick handling)
    const d = readDrive(this.input, p.heading);
    p.integrate(dt, d.throttle, d.steer, d.handbrake);

    // world-boundary walls: clamp + soft bounce
    const m = ARENA.wall + p.radius;
    if (p.x < m)            { p.x = m;            if (p.vx < 0) p.vx *= -0.4; }
    if (p.x > ARENA.w - m)  { p.x = ARENA.w - m;  if (p.vx > 0) p.vx *= -0.4; }
    if (p.y < m)            { p.y = m;            if (p.vy < 0) p.vy *= -0.4; }
    if (p.y > ARENA.h - m)  { p.y = ARENA.h - m;  if (p.vy > 0) p.vy *= -0.4; }

    // weapon fire, then combat: bots think, Titan crawls, cars collide, shots resolve
    this.updateWeapon(dt);
    this.updateBots(dt);
    this.updateBossWorld(dt);
    this.updateCollisions();
    this.updateProjectiles(dt);
    this.updateMines(dt);
    this.updateDrops(dt);

    // first-encounter banner the first time you get near the Titan
    if (this.boss && !this.boss.dead && !this._sawBoss &&
        dist(p.x, p.y, this.boss.x, this.boss.y) < 1000) {
      this._sawBoss = true;
      this.banner("JUNK TITAN", "tear off its plates");
    }

    // XP from scrap: drive over a pile to absorb it (the other farm path).
    for (const s of this.scrap) {
      if (s.dead || dist(p.x, p.y, s.x, s.y) >= s.radius + p.radius * 0.6) continue;
      const drain = Math.min(150 * dt, s.amount);
      s.amount -= drain;
      this.addXp(drain * XP_PER_SCRAP);
      if (Math.random() < dt * 24) this.particles.repairGlow(p.x, p.y); // cosmetic sparkle
      if (s.amount <= 0) s.dead = true;
    }
    // respawn any scrap consumed by bullets OR drive-over (seeded → deterministic)
    if (this.scrap.some((s) => s.dead)) {
      this.scrap = this.scrap.filter((s) => !s.dead);
      this.scatterScrap(SCRAP_TARGET);
    }

    // skid marks: age existing rubber + lay new segments for any sliding car
    this.renderer.updateSkids(dt);
    this.renderer.recordSkids(p);
    for (const b of this.bots) if (!b.deadFlag) this.renderer.recordSkids(b);

    // passive health regen: only after REGEN_DELAY seconds without taking a hit
    // (any damage above resets outOfCombat). Rate scales with the REGEN stat.
    this.outOfCombat += dt;
    if (this.hp < this.maxHp && this.outOfCombat >= REGEN_DELAY) {
      const rate = REGEN_BASE + this.stats.regen * 0.005; // +0.5%/point
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * rate * dt);
      if (fxRand() < dt * 8) this.particles.repairGlow(p.x, p.y); // cosmetic
    }

    this.particles.update(dt);
    this.tickBanners(dt);

    // camera follows the player, clamped so the view never shows past the walls.
    // Viewport is the LOGICAL 1280x720 (the backing store is hi-dpi; the
    // renderer scales its context, so world units seen stay fixed = same zoom).
    const vw = WORLD.w, vh = WORLD.h;
    this.cam.x = clamp(p.x, vw / 2, ARENA.w - vw / 2);
    this.cam.y = clamp(p.y, vh / 2, ARENA.h - vh / 2);

    // engine + tire audio
    this.audio.setEngine(clamp(p.speed / p.maxSpeed, 0, 1), false);
    this.audio.setScreech(p.speed > 60 ? clamp((p.lateralSpeed - 70) / 180, 0, 1) : 0);
  }
}
