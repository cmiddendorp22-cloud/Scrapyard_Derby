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
const SCRAP_HEAL_FRAC = 0.03;     // a FULL pile absorbed heals 3% of maxHp (pro-rata partial)
// LOOT CRATES (user): destructible boxes scattered around the map so roaming
// pays off — crack one open (bullets or a moving car) for a LOW-tier part.
const CRATE_COUNT = 7;            // crates alive on the map at once
const CRATE_HP = 2;               // bullet hits to crack one
const CRATE_R = 16;               // crate body radius
const CRATE_BREAK_SPEED = 60;     // a car touching faster than this smashes it
const CRATE_RESPAWN_MIN = 30;     // seconds until a broken crate respawns...
const CRATE_RESPAWN_MAX = 60;     // ...somewhere else (seeded roll)
const REGEN_DELAY = 5;            // seconds out of combat before health regen kicks in
const REGEN_BASE = 0.02;          // 2% of maxHp per second, +0.5%/REGEN point
const BOUNTY_XP = 150;            // bonus XP for wrecking the current #1 (leader bounty)
const LB_SECTORS = 4;             // minimap is split into an NxN grid for the bounty sector
const REVENGE_XP = 120;           // bonus XP for wrecking your nemesis (the bot that last killed you)
const KILL_FLOOR = 20;            // minimum XP for any non-boss kill (so fresh enemies still pay)
const PICKUP_RANGE = 180;         // a ground part within this range is "collectible" (shows in the panel)
const DROP_DESPAWN = 30;          // seconds a dropped part lingers before vanishing
const MINE_LIFE = 20;             // seconds a mine sits before it despawns
const DROP_CAP = 40;              // max ground parts before the oldest is culled
const AIM_CONE = Math.PI;        // player mouse-aim: full 360° — shots fire straight at the cursor (user)
// -- minelayer HOOK (drag a car into your minefield) --
const HOOK_MAX_LEN = 375;        // reach / leash length — SAME at every tier (user)
// hook extend speed scales slightly with the minelayer tier (user): slow at low
// tiers, faster at high — but a small range (barely changes bottom→top)
const HOOK_SPEED = 1270;         // extend speed — SAME at every tier (the old uncommon value, user)
const MINE_BASE = 135;           // player mine base damage (× the 0.75→1.5 tier mult)
const HOOK_CD = 6;               // seconds between hooks (at reload 0)
const HOOK_CD_MIN = 4;           // hook cooldown at MAX reload (linear between)
const HOOK_REEL_TIME = 1.2;      // reel a grabbed car/self in over this long (slower pull, user)
const HOOK_STUN_AFTER = 0.5;     // a hooked car stays stunned (can't shoot) this long after the reel
const HOOK_DAMAGE = 15;          // small chip on the grab (user: pulled + small damage)
const HOOK_HEAD_R = 12;          // grab radius of the hook head
// -- RAILGUN (loot-only sniper, user): fire a PIERCING slug, then a long reload --
const RAIL_DMG = 97.5;           // slug damage before tier scaling (user: halved from 195)
const RAIL_SPEED = 2200;         // slug speed (user: a lot quicker — near-hitscan feel)
const RAIL_LIFE = 1.0;           // slug lifetime (~2200px reach)
const RAIL_CD = 2.2;             // reload between shots (shortened by RELOAD; no charge-up — user)
const RAIL_STRENGTH = 3;         // pierce/clash budget: cars cost 1, scrap 1.5, boss absorbs
const BANNER_FULL = 3;           // seconds a center banner shows when nothing is queued (user)
const BANNER_MIN = 1;            // minimum show time when more banners are waiting (user)
const STREAK_MILESTONES = [3, 5, 8]; // wreck-streak counts that trigger a RAMPAGE callout (then every +5)
const SLOT_UNLOCKS = { 5: "armor" }; // level → slot unlocked (single weapon slot for now — user)
const BOT_COUNT = 8;             // bots kept alive in the world
const BOT_RESPAWN = 3.5;         // seconds before a wrecked bot returns

// Starting weapons the player picks before spawning (their loadout's 1st weapon
// slot). Behaviors land with the modular slot system (BACKLOG-ARENA item 5);
// for now the pick is stored on ArenaGame.startWeapon and shown on the car.
const ARENA_WEAPONS = [
  { id: "cannon",    name: "CANNON",
    desc: "Classic Gun Class" },
  { id: "minelayer", name: "MINELAYER",
    desc: "Drop proximity mines and hook enemies into them." },
  { id: "ram",       name: "RAM",
    desc: "Armored Front, boost into enemies and crush them." },
  { id: "shotgun",   name: "SHOTGUN",
    desc: "Close-range pellet spread — devastating up close, useless at range." },
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
    this.stats = { health: 0, speed: 0, reload: 0, regen: 0 };
    this.slots = { armor: false }; // ONE weapon slot for now (user, 2026-07-09)
    this.maxHp = 100;
    this.hp = 100;
    this.outOfCombat = 0;             // seconds since last damage (regen gate)
    this.particles = new Particles(); // level-up bursts now, combat FX later
    this.banners = [];                // lightweight center banners
    // weapon state (behaviors per this.startWeapon)
    this.bullets = [];                // cannon shots
    this.mines = [];                  // minelayer drops
    this.hooks = [];                  // active minelayer hooks {owner, angle, hx, hy, len, state, target, reelT, dead}
    this.hookCd = 0;                  // player's hook cooldown
    this.fireCooldown = 0;
    // ram charge (hold FIRE to wind up, release to launch a boost)
    this.ramCharge = 0;               // 0..1 while holding
    this.ramBoostT = 0;               // remaining launch-boost time
    this.ramLaunchStr = 1;            // Car.boost applied during the launch
    // railgun (loot-only): a piercing slug on FIRE with a long reload
    this.railCd = 0;                  // reload after a shot
    // combat
    this.bots = [];
    this.botRespawns = [];            // {t} timers for wrecked bots
    this.dead = false;                // player wrecked → death menu
    this.respawnT = 0;                // brief wreck moment before the menu shows
    this.spectate = false;            // watching bots from the death menu
    this.spectateCar = null;          // the exact car the camera follows (by reference)
    this.kills = 0;
    this.pairHits = new Map();        // car-pair collision-damage cooldown
    this._t = 0;                      // sim clock (collision cooldown keys)
    this.drops = [];                  // dropped parts on the ground {x,y,part,age,dead}
    this.playerLastHitBy = null;      // who last damaged the player (attribution)
    this.boss = null;                 // central boss (Titan/Magnet — built below)
    this.bossRespawnT = 0;            // countdown to the next boss
    this._sawBossKinds = {};          // first-encounter banner latch, per boss kind
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
    this.crates = [];
    this.scatterCrates();
    this.bots = [];
    for (let i = 0; i < BOT_COUNT; i++) this.spawnBot();
    // central boss (the map's gravity well) — the Junk Titan leads (its
    // signature); respawns then alternate with the roaming Magnet
    this.boss = new ArenaBoss(ARENA.w / 2, ARENA.h / 2);
    this.bossRespawnT = 0;
    this._sawBossKinds = {};
    setSimRandom(prevRandom);
    this.computeLeaderboard(); // seed the standings before the first tick
  }

  // player spawn/respawn point — south of center so you never appear inside
  // the Titan (which sits at the map's middle)
  playerSpawn() { return { x: ARENA.w / 2, y: ARENA.h / 2 + 820 }; }

  // reference level that bot spawns scale to. Single-player = your level; this
  // is the MULTIPLAYER hook — when there are multiple human players, fold in all
  // their levels here (avg/max) so bots track the whole lobby, not one player.
  lobbyLevel() {
    // TODO(multiplayer): return avg (or max) of every human player's level.
    // Example for later: const ls = this.players.map(p => p.level); return Math.round(ls.reduce((a,b)=>a+b,0)/ls.length);
    return this.level;
  }

  // spawn one bot at a random spot away from the player
  spawnBot() {
    let x, y, tries = 0;
    do {
      x = rand(ARENA.wall + 100, ARENA.w - ARENA.wall - 100);
      y = rand(ARENA.wall + 100, ARENA.h - ARENA.wall - 100);
    } while (dist(x, y, this.player.x, this.player.y) < 700 && tries++ < 20);
    const weapon = pick(["cannon", "cannon", "ram", "minelayer", "shotgun"]); // cannon-weighted
    const level = randInt(1, Math.max(1, this.lobbyLevel() + 2)); // scale with the lobby
    this.bots.push(new ArenaBot(x, y, weapon, level, this.uniqueBotName()));
  }

  // a bot name no LIVING bot is currently using (draw without replacement), so
  // the leaderboard/killfeed never shows duplicate handles; falls back to the
  // full pool if every name is somehow taken. Seeded pick → deterministic.
  uniqueBotName() {
    const used = new Set(this.bots.map((b) => b.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    return pick(free.length ? free : BOT_NAMES);
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

  // absorbing scrap also heals the player: a FULL pile = SCRAP_HEAL_FRAC of
  // maxHp, pro-rata for a partial absorption (drive-over or shoot-to-harvest).
  healFromScrap(drain, maxAmount) {
    if (this.dead || this.hp <= 0 || this.hp >= this.maxHp || maxAmount <= 0) return;
    const heal = this.maxHp * SCRAP_HEAL_FRAC * (drain / maxAmount);
    this.hp = Math.min(this.maxHp, this.hp + heal);
  }

  levelUp() {
    this.level++;
    this.statPoints++;
    const slot = SLOT_UNLOCKS[this.level];
    if (slot && !this.slots[slot]) {
      this.slots[slot] = true;
      this.banner("ARMOR SLOT UNLOCKED", "loot one from a wreck");
    } else {
      this.banner("LEVEL " + this.level, "+1 stat point", "level"); // dedupes in the queue
    }
    this.audio.playRoundClear();                       // rising level-up jingle
    this.particles.sparks(this.player.x, this.player.y, fxRand(0, TAU), 22, 260); // gold burst
  }

  // spend 1 banked point into a stat (non-blocking — called mid-drive)
  spendStat(name) {
    if (this.statPoints <= 0 || !(name in this.stats) || this.stats[name] >= STAT_CAP) return;
    const frac = this.maxHp > 0 ? clamp(this.hp / this.maxHp, 0, 1) : 1; // HP% before the change
    this.stats[name]++;
    this.statPoints--;
    this.applyStats();
    this.hp = frac * this.maxHp; // upgrading HEALTH keeps the SAME HP% at the new max (user)
  }

  // recompute derived values from stats (health/speed/reload/regen) +
  // equipped parts. Damage reduction comes from the ARMOR part alone.
  applyStats() {
    const L = this.loadout || {};
    // SPEED stat + ENGINE part both scale top speed & accel
    const spd = 1 + this.stats.speed * 0.05;
    const eng = L.engine ? 1 + 0.05 * (L.engine.tier + 1) : 1; // +5%/tier
    this.player.maxSpeed = ARENA_BASE.maxSpeed * spd * eng;
    this.player.engineAccel = ARENA_BASE.accel * spd * eng;
    // TIRES part → grip + turn (better handling) + a sharper HANDBRAKE per tier
    // (better tires whip the nose around faster on a drift; base 1.3)
    const tt = L.tires ? L.tires.tier + 1 : 0;
    this.player.grip = 7 + 1.0 * tt;
    this.player.turnRate = 2.9 + 0.08 * tt;
    this.player.handbrakeBoost = 1.3 + 0.10 * tt;
    setupWheels(this.player, L.tires ? L.tires.tier : 0); // left/right wheel pools (dismemberment)
    // HEALTH stat + ARMOR part → max HP; ARMOR alone → damage cut (the
    // DURABILITY stat was removed — per-tier value doubled to compensate)
    const at = L.armor ? L.armor.tier + 1 : 0;
    this.maxHp = 100 + this.stats.health * 25 + 20 * at;
    this.partDmgReduce = 0.10 * at;
    this.hp = Math.min(this.hp, this.maxHp);
  }

  // a fresh starting loadout: common tires/engine/armor + your picked weapon in
  // the primary slot, secondary empty (fill both from loot)
  freshLoadout(weaponType) {
    return {
      tires: makePart("tires", "tires", 0),
      engine: makePart("engine", "engine", 0),
      weapon1: makePart("weapon", weaponType || "cannon", 0),
      weapon2: null, // DORMANT: single weapon slot for now (user, 2026-07-09)
      armor: makePart("armor", "armor", 0),
    };
  }

  hasRam() {
    const L = this.loadout;
    return !!(L && L.weapon1 && L.weapon1.type === "ram");
  }

  hasRailgun() {
    const L = this.loadout;
    return !!(L && L.weapon1 && L.weapon1.type === "railgun");
  }

  // center banners are a QUEUE (user): only banners[0] is ever ON SCREEN; the
  // rest wait their turn. The active banner shows BANNER_FULL (3s) when
  // nothing waits, but advances after BANNER_MIN (1s) when the queue is
  // backed up. LEVEL-UP banners dedupe in the queue (only the newest queued
  // one survives — leveling 3x fast shows one "LEVEL N"). Queue capped so a
  // chaotic fight can't build a backlog of stale news.
  banner(text, sub, kind) {
    if (kind === "level") { // drop older queued level-ups (never the active banner)
      for (let i = this.banners.length - 1; i >= 1; i--) {
        if (this.banners[i].kind === "level") this.banners.splice(i, 1);
      }
    }
    this.banners.push({ text, sub: sub || "", age: 0, kind: kind || "" });
    if (this.banners.length > 7) this.banners.splice(1, 1); // cap: drop the oldest QUEUED
  }

  // -- weapons: SINGLE-SLOT input model (user, 2026-07-09: one weapon slot for
  // now — dual slots may return later, so `weapon1` keeps its name and
  // `weapon2` stays a dormant null). Each weapon declares an ABILITY if it has
  // one:
  //   • ram → CHARGE (hold LEFT-click to wind up, release to launch)
  //   • minelayer → HOOK (RIGHT-click, aimed at the cursor)
  //   • cannon/shotgun/railgun → none (FIRE-channel only; the railgun is just
  //     a slow, piercing FIRE weapon with a long reload — no charge, user)
  // Spammables fire on the FIRE channel (left-click / F auto-fire toggle /
  // touch FIRE). HOLD abilities live on left-click too (their weapon has no
  // spammable, so left is free); the hook is a CLICK ability on RIGHT-click so
  // mines keep left. Touch gets ONE ability button. Add a weapon + its entry
  // here and it slots in.
  weaponAbility(type) {
    if (type === "ram") return { name: "CHARGE", hold: true };
    if (type === "minelayer") return { name: "HOOK", hold: false };
    return null; // cannon / shotgun / railgun: FIRE-channel only
  }

  // resolve the raw inputs into this frame's channels, given the loadout
  resolvePlayerInputs() {
    const inp = this.input;
    const w = this.loadout && this.loadout.weapon1;
    const ab = this.weaponAbility(w && w.type);
    this._fireActive = inp.fire; // spammables: left-click / auto-fire / touch FIRE
    // the ability channel: HOLD abilities read the left button (+ touch ability
    // button); CLICK abilities (hook) read the right button (+ touch button)
    this._abilityHeld = ab
      ? (ab.hold ? (inp.mouseDown || inp.touchAbility1) : (inp.hookHeld || inp.touchAbility1))
      : false;
    // HUD layout-edit (hold H): clicks move panels, they don't fire
    if (inp.layoutEdit) { this._fireActive = false; this._abilityHeld = false; }
  }

  // RAM: HOLD left-click to CHARGE (dig in / wind up), release to LAUNCH a
  // boost scaled by hold time. Runs BEFORE integrate (sets the Car.boost the
  // physics reads).
  updateRam(dt) {
    this.resolvePlayerInputs();
    const p = this.player;
    const held = this.hasRam() ? this._abilityHeld : false;
    if (!this.hasRam() || this.player.stunT > 0) { p.boost = 1; p.chargingRam = false; if (this.ramBoostT > 0) this.ramBoostT -= dt; return; }
    if (this.ramBoostT > 0) {                 // mid-launch: strong boost, timed
      this.ramBoostT -= dt;
      p.boost = this.ramBoostT > 0 ? this.ramLaunchStr : 1;
    } else if (held) {                         // holding: wind up + build charge
      // RELOAD speeds the wind-up (the ram's version of a faster fire rate)
      this.ramCharge = Math.min(1, this.ramCharge + dt * (1 + this.stats.reload * 0.08) / 0.8); // ~0.8s to full at reload 0
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
    // mirror "actively ramming" onto the player CAR (ramDamageMul/isChargingRam
    // read it): launched + moving. Single slot = the ram is always primary.
    p.chargingRam = ramLaunchingFast(p, this.ramBoostT);
  }

  // Raw FULL-CIRCLE angle from the player to the mouse cursor (any direction),
  // or null if there's no cursor (touch / mouse hasn't moved / no canvas rect).
  // Maps client mouse coords → the logical viewport → world (inverse of the
  // render camera transform).
  mouseWorldAngle() {
    const p = this.player, inp = this.input;
    if (this.touchMode || !inp || !inp.hasMouse || !this.canvas.getBoundingClientRect) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const lx = ((inp.mouseX - rect.left) / rect.width) * VIEW.w;    // → logical screen x (0..VIEW.w)
    const ly = ((inp.mouseY - rect.top) / rect.height) * VIEW.h;    // → logical screen y (0..VIEW.h)
    const wx = lx - VIEW.w / 2 + this.cam.x;                        // → world (undo camera translate)
    const wy = ly - VIEW.h / 2 + this.cam.y;
    return Math.atan2(wy - p.y, wx - p.x);
  }

  // Direction the player's SHOTS travel: the cursor angle CLAMPED to a small
  // forward cone (`AIM_CONE`) — nudge off the nose but never backward — from the
  // FRONT of the car. Touch / no cursor → straight out the nose. (The HOOK does
  // NOT use this — it fires full-circle toward the cursor, see updatePlayerHook.)
  playerAimAngle() {
    const want = this.mouseWorldAngle();
    if (want === null) return this.player.heading;
    return this.player.heading + clamp(angleDiff(want, this.player.heading), -AIM_CONE, AIM_CONE);
  }

  // Fire the equipped weapon on FIRE. Tier scales damage + fire rate; RELOAD
  // stat also shortens the interval. Ram charges in updateRam and the railgun
  // in updateRailgun (hold abilities — they don't fire here).
  updateWeapon(dt) {
    this.resolvePlayerInputs();
    const reloadMul = 1 + this.stats.reload * 0.08;
    for (const w of [this.loadout.weapon1]) {
      if (!w) continue;
      w.cd = (w.cd || 0) - dt;
      if (w.type === "ram" || w.type === "railgun") continue;
      if (!this._fireActive || w.cd > 0 || this.player.stunT > 0) continue; // spammables on the FIRE channel; stunned → can't fire
      const t = w.tier + 1, dmul = 1 + 0.12 * t, rate = reloadMul * (1 + 0.10 * t);
      const p = this.player, f = p.forward;
      const aimAng = this.playerAimAngle(); // mouse-aim within the forward cone
      const af = { x: Math.cos(aimAng), y: Math.sin(aimAng) };
      if (w.type === "cannon") {
        w.cd = 0.3 / rate;
        const bx = p.x + f.x * (p.length / 2 + 6), by = p.y + f.y * (p.length / 2 + 6); // from the front of the car
        const b = new Bullet(bx, by, aimAng, 560, true, 26 * dmul);
        b.life = 2.5;       // longer range for the big map
        b.shooter = p;      // kill attribution
        this.bullets.push(b);
        this.particles.sparks(bx, by, aimAng, 3, 140);
        p.vx -= af.x * 20; p.vy -= af.y * 20; // recoil opposite the shot
        this.audio.playShoot();
      } else if (w.type === "shotgun") {
        // close-range pellet spread: several short-lived pellets in a cone.
        // Big damage if most connect up close, harmless at range (pellets die
        // fast + fan out). Heavy recoil, slower cooldown than the cannon.
        w.cd = 0.75 / rate;
        const pellets = 6, spread = 0.20;
        const bx = p.x + f.x * (p.length / 2 + 6), by = p.y + f.y * (p.length / 2 + 6);
        for (let i = 0; i < pellets; i++) {
          const ang = aimAng + (i / (pellets - 1) - 0.5) * 2 * spread; // spread centered on the aim
          const b = new Bullet(bx, by, ang, 620, true, 22.5 * dmul); // 2.5x (user) — point-blank volleys hit HARD
          b.life = 0.34; b.radius = 3; // short reach
          b.strength = 0.35; // weak pellets: one normal cannon bullet (str 1) breaks ~3 of them
          b.shooter = p;
          this.bullets.push(b);
        }
        this.particles.sparks(bx, by, aimAng, 8, 220);
        p.vx -= af.x * 55; p.vy -= af.y * 55; // heavy kick opposite the shot
        this.audio.playShoot();
      } else if (w.type === "minelayer") {
        w.cd = 1.0 / rate;
        const mx = p.x - f.x * (p.length / 2 + 4), my = p.y - f.y * (p.length / 2 + 4);
        this.mines.push({ x: mx, y: my, owner: this.player, arm: 1.0, age: 0, dmg: this.mineDamageOf(this.player), dead: false });
        if (this.mines.length > 25) this.mines.shift();
        this.particles.scrapPuff(mx, my);
      }
    }
  }

  // -- minelayer HOOK: fire a grapple that grabs the first car in its path and
  // reels it toward you (into your minefield). Separate from FIRE/autofire —
  // right-click (toward the cursor) on desktop, a HOOK button on touch. --------
  hasMinelayer() {
    const L = this.loadout;
    return !!(L && L.weapon1 && L.weapon1.type === "minelayer");
  }

  // touch has no cursor → aim the hook at the nearest car within reach (else nose)
  hookAutoAim(owner) {
    let best = null, bd = HOOK_MAX_LEN;
    for (const c of this.cars()) {
      if (c === owner || this.isDeadCar(c)) continue;
      const d = dist(owner.x, owner.y, c.x, c.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best ? Math.atan2(best.y - owner.y, best.x - owner.x) : owner.heading;
  }

  // RELOAD shortens the hook cooldown linearly: HOOK_CD (6s) at reload 0 down to
  // HOOK_CD_MIN (4s) at max reload (STAT_CAP). Shared by the player + bots.
  hookCooldown(reload) {
    return HOOK_CD - (HOOK_CD - HOOK_CD_MIN) * clamp((reload || 0) / STAT_CAP, 0, 1);
  }

  updatePlayerHook(dt) {
    this.resolvePlayerInputs();
    if (this.hookCd > 0) this.hookCd -= dt;
    // the hook fires on the ability channel (right-click / touch ability button)
    if (!this.hasMinelayer() || !this._abilityHeld || this.hookCd > 0 || this.player.stunT > 0) return; // stunned → no hook
    // FULL-CIRCLE toward the cursor (no forward-cone clamp — user); touch auto-aims
    let ang;
    if (this.touchMode) ang = this.hookAutoAim(this.player);
    else { ang = this.mouseWorldAngle(); if (ang === null) ang = this.player.heading; }
    if (this.fireHook(this.player, ang)) this.hookCd = this.hookCooldown(this.stats.reload);
  }

  // RAILGUN (loot-only): fires a PIERCING slug on the FIRE channel — no
  // charge-up (user), just a long RELOAD between shots (strength budget:
  // cars 1, scrap piles 1.5, mines/crates 1, the boss absorbs it).
  updateRailgun(dt) {
    if (this.railCd > 0) this.railCd -= dt;
    if (!this.hasRailgun()) return;
    this.resolvePlayerInputs();
    if (!this._fireActive || this.railCd > 0 || this.player.stunT > 0) return;
    this.fireRailgun(this.player, this.playerAimAngle(), this.loadout.weapon1.tier);
    this.railCd = RAIL_CD / (1 + this.stats.reload * 0.08); // RELOAD shortens it
  }

  // shared player/bot railgun shot. Damage = RAIL_DMG x tier; the slug carries
  // a STRENGTH budget it spends piercing things (see updateProjectiles).
  fireRailgun(owner, angle, tier) {
    const dmg = RAIL_DMG * (1 + 0.12 * ((tier || 0) + 1)) *
      (owner === this.player ? 1 : 1 + (owner.level || 1) * 0.01); // bots: tiny level scale
    const b = new Bullet(owner.x + Math.cos(angle) * (owner.length / 2 + 8),
      owner.y + Math.sin(angle) * (owner.length / 2 + 8), angle, RAIL_SPEED, owner === this.player, dmg);
    b.life = RAIL_LIFE;
    b.radius = 5;
    b.strength = RAIL_STRENGTH;
    b.pierce = true;
    b.railgun = true;
    b.hitSet = new Set(); // things already pierced (no double-damage across frames)
    b.shooter = owner;
    this.bullets.push(b);
    this.particles.sparks(b.x, b.y, angle, 10, 320);
    owner.vx -= Math.cos(angle) * 90; owner.vy -= Math.sin(angle) * 90; // heavy kick
    this.audio.playShoot();
    if (this.audio.playImpact) this.audio.playImpact(0.6); // extra thump
  }

  // launch a hook (returns false if the owner already has one out — one at a time)
  fireHook(owner, angle) {
    if (this.hooks.some((h) => h.owner === owner && !h.dead)) return false;
    this.hooks.push({
      owner, angle,
      hx: owner.x + Math.cos(angle) * owner.radius,
      hy: owner.y + Math.sin(angle) * owner.radius,
      len: 0, speed: this.hookSpeedOf(owner), // tier-scaled extend speed
      state: "out", target: null, reelT: 0, dead: false,
    });
    if (this.audio.playShoot) this.audio.playShoot();
    return true;
  }

  updateHooks(dt) {
    for (const h of this.hooks) {
      if (h.dead) continue;
      const owner = h.owner;
      if (this.isDeadCar(owner)) { h.dead = true; continue; }
      if (h.state === "out") {
        const spd = h.speed || HOOK_SPEED;
        h.hx += Math.cos(h.angle) * spd * dt;
        h.hy += Math.sin(h.angle) * spd * dt;
        h.len += spd * dt;
        // grab the FIRST car the head reaches (not the owner). A ram mid-LAUNCH
        // is immune to the GRAB (user: ram's counter-pick vs the hook) — the
        // head passes through it; an already-grabbed ram stays grabbed.
        for (const c of this.cars()) {
          if (c === owner || this.isDeadCar(c)) continue;
          if (isChargingRam(c)) continue; // launched ram: can't be grabbed
          if (dist(h.hx, h.hy, c.x, c.y) < HOOK_HEAD_R + c.radius) {
            h.state = "reel"; h.target = c; h.reelT = 0;
            this.hurtCar(c, HOOK_DAMAGE, owner, h.hx, h.hy, "hook"); // small chip on the grab
            if (this.audio.playImpact) this.audio.playImpact(0.4);
            break;
          }
        }
        // else grab the central BOSS — too big to pull, so the reel drags YOU to
        // IT (user); chips it on the grab, bypassing the Magnet's armor
        if (h.state === "out" && this.boss && !this.boss.dead &&
            dist(h.hx, h.hy, this.boss.x, this.boss.y) < HOOK_HEAD_R + this.boss.radius) {
          h.state = "reel"; h.target = this.boss; h.reelT = 0; owner.reelingBoss = true;
          this.hurtBoss(h.hx, h.hy, HOOK_DAMAGE, owner, true);
          if (this.audio.playImpact) this.audio.playImpact(0.4);
        }
        if (h.state === "out" && (h.len >= HOOK_MAX_LEN ||
            h.hx < ARENA.wall || h.hx > ARENA.w - ARENA.wall || h.hy < ARENA.wall || h.hy > ARENA.h - ARENA.wall)) {
          h.dead = true; // missed / hit a wall
        }
      } else { // "reel"
        const c = h.target;
        const isBoss = c && c.kind; // a boss (titan/magnet) — invert the reel
        if (!c || (isBoss ? c.dead : this.isDeadCar(c))) { h.dead = true; owner.reelingBoss = false; continue; }
        h.reelT += dt;
        if (isBoss) {
          // the boss is the ANCHOR: reel the HOOKER in (don't move/stun the boss)
          owner.reelingBoss = true;
          const dx = c.x - owner.x, dy = c.y - owner.y, d = Math.hypot(dx, dy) || 1;
          const gap = c.radius + owner.radius + 6;
          const toGo = Math.max(0, d - gap);
          const remaining = Math.max(dt, HOOK_REEL_TIME - h.reelT);
          const move = toGo * Math.min(1, dt / remaining);
          const nx = dx / d, ny = dy / d;
          owner.x += nx * move; owner.y += ny * move;
          owner.vx = nx * (move / dt); owner.vy = ny * (move / dt);
          const m = ARENA.wall + owner.radius;
          owner.x = clamp(owner.x, m, ARENA.w - m); owner.y = clamp(owner.y, m, ARENA.h - m);
          h.hx = c.x; h.hy = c.y; // tether anchored on the boss
          if (dist(owner.x, owner.y, c.x, c.y) <= gap + 12) { this.hookBossImpact(owner, c); h.dead = true; owner.reelingBoss = false; }
          else if (h.reelT >= HOOK_REEL_TIME) { h.dead = true; owner.reelingBoss = false; }
        } else { // drag the target toward the owner over ~HOOK_REEL_TIME
          c.stunT = HOOK_STUN_AFTER; // STUNNED while reeled + HOOK_STUN_AFTER after (can't shoot)
          const dx = owner.x - c.x, dy = owner.y - c.y, d = Math.hypot(dx, dy) || 1;
          const gap = owner.radius + c.radius + 6;
          const toGo = Math.max(0, d - gap);
          const remaining = Math.max(dt, HOOK_REEL_TIME - h.reelT);
          const move = toGo * Math.min(1, dt / remaining);
          const nx = dx / d, ny = dy / d;
          c.x += nx * move; c.y += ny * move;
          c.vx = nx * (move / dt); c.vy = ny * (move / dt); // carry the reel momentum
          const m = ARENA.wall + c.radius; // stay in-world
          c.x = clamp(c.x, m, ARENA.w - m); c.y = clamp(c.y, m, ARENA.h - m);
          h.hx = c.x; h.hy = c.y; // the tether follows the reeled car
          const newD = dist(owner.x, owner.y, c.x, c.y);
          if (newD <= gap + 10) { this.hookImpact(owner, c); h.dead = true; }   // reached the body → DETONATE
          else if (h.reelT >= HOOK_REEL_TIME) h.dead = true;                    // timed out (blocked) → release
        }
      }
    }
    this.hooks = this.hooks.filter((h) => !h.dead);
  }

  // the equipped minelayer's tier for a car (player: the single weapon slot;
  // bot: its weapon), or 0 if none — drives mine damage + hook speed
  minelayerTierOf(owner) {
    if (owner === this.player) {
      const L = this.loadout;
      const w = (L.weapon1 && L.weapon1.type === "minelayer") ? L.weapon1 : null;
      return w ? w.tier : 0;
    }
    return owner.loadout && owner.loadout.weapon ? owner.loadout.weapon.tier : 0;
  }

  // minelayer tier multiplier (user): 0.75× at common → 1.5× at legendary, linear
  mineTierMul(tier) { return 0.75 + 0.75 * clamp((tier || 0) / TIER_MAX, 0, 1); }

  // THE single source of truth for a car's mine damage — the mines they DROP and
  // the hook's detonation both read this. Scales 0.75→1.5 with the minelayer
  // tier (user); bots also scale with level.
  mineDamageOf(owner) {
    const mul = this.mineTierMul(this.minelayerTierOf(owner));
    if (owner === this.player) return MINE_BASE * mul;
    return (36 + 3 * (owner.level || 1)) * mul; // +50% (was 24 + 2*level)
  }

  // hook extend speed — flat, the SAME at every tier (user); only mine/hook
  // DAMAGE varies by tier (see mineDamageOf)
  hookSpeedOf() { return HOOK_SPEED; }

  // the reeled car reaches the hooker's BODY → it DETONATES (user): launch the
  // two apart and deal ONE MINE of damage to the HOOKED car ONLY (not the
  // hooker). srcType "mine" so it bypasses ram frontal immunity (mines counter ram).
  hookImpact(owner, victim) {
    const dx = victim.x - owner.x, dy = victim.y - owner.y, d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d, KICK = 460;
    victim.vx = nx * KICK; victim.vy = ny * KICK;               // launch the hooked car away
    owner.vx -= nx * KICK * 0.7; owner.vy -= ny * KICK * 0.7;   // hooker recoils the other way
    this.hurtCar(victim, this.mineDamageOf(owner), owner, victim.x, victim.y, "mine");
    const ex = (owner.x + victim.x) / 2, ey = (owner.y + victim.y) / 2;
    this.particles.explosion(ex, ey);
    this.particles.sparks(ex, ey, 0, 20, 320);
    if (this.audio.playExplosion) this.audio.playExplosion();
  }

  // the hooker reels THEMSELVES into a BOSS (user) → detonate: fling the hooker
  // back out + deal TRIPLE a mine of damage to the BOSS ONLY (bypasses Magnet
  // armor). The boss isn't stunned or moved (it's the anchor).
  hookBossImpact(owner, boss) {
    const dx = owner.x - boss.x, dy = owner.y - boss.y, d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d, KICK = 520;
    owner.vx = nx * KICK; owner.vy = ny * KICK; // fling the hooker back out
    const hx = boss.x + nx * boss.radius, hy = boss.y + ny * boss.radius; // the side they hit
    this.hurtBoss(hx, hy, 3 * this.mineDamageOf(owner), owner, true);
    this.particles.explosion(hx, hy);
    this.particles.sparks(hx, hy, 0, 24, 340);
    if (this.audio.playExplosion) this.audio.playExplosion();
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

  // a RAILGUN slug's frame step: it pierces instead of dying, spending its
  // STRENGTH budget (user spec) — a whole scrap pile costs 1.5 (so ~2 piles
  // exhaust it), cars/mines/crates cost 1 each, the boss absorbs it outright.
  // hitSet dedups multi-frame overlaps so nothing is damaged twice.
  pierceStep(b) {
    for (const s of this.scrap) { // drains entire piles it passes over
      if (s.dead || b.hitSet.has(s) || dist(b.x, b.y, s.x, s.y) >= s.radius * 0.8 + b.radius) continue;
      b.hitSet.add(s);
      const drain = s.amount;
      s.amount = 0; s.dead = true;
      if (b.fromPlayer) { this.addXp(drain * XP_PER_SCRAP); this.healFromScrap(drain, s.maxAmount); }
      else if (b.shooter && b.shooter.gainXp) b.shooter.gainXp(drain * XP_PER_SCRAP);
      this.particles.scrapPuff(s.x, s.y);
      b.strength -= 1.5;
    }
    for (const m of this.mines) { // detonates mines outright (credited to the shooter)
      if (m.dead || dist(b.x, b.y, m.x, m.y) >= 9 + b.radius) continue;
      this.detonateMine(m, b.shooter);
      b.strength -= 1;
    }
    for (const c of this.crates) { // smashes crates open on the way through
      if (c.dead || dist(b.x, b.y, c.x, c.y) >= c.r + b.radius) continue;
      this.breakCrate(c);
      b.strength -= 1;
    }
    // the boss ABSORBS the slug: full damage, but nothing pierces a boss
    if (this.boss && !this.boss.dead && b.shooter !== this.boss &&
        dist(b.x, b.y, this.boss.x, this.boss.y) < this.boss.radius + b.radius) {
      this.hurtBoss(b.x, b.y, b.damage, b.shooter);
      this.particles.sparks(b.x, b.y, Math.atan2(b.vy, b.vx) + Math.PI, 10, 260);
      b.dead = true;
      return;
    }
    for (const car of this.cars()) { // full damage to EACH car in its path, once
      if (car === b.shooter || this.isDeadCar(car) || b.hitSet.has(car)) continue;
      if (dist(b.x, b.y, car.x, car.y) >= car.radius + b.radius) continue;
      b.hitSet.add(car);
      this.hurtCar(car, b.damage, b.shooter, b.x, b.y, "bullet");
      this.particles.sparks(b.x, b.y, Math.atan2(b.vy, b.vx) + Math.PI, 8, 220);
      b.strength -= 1;
    }
    if (b.strength <= 0) b.dead = true;
  }

  // FFA bullets: PLAYER shots also harvest scrap; every shot damages any car
  // except its shooter (tracked via b.shooter for kill attribution).
  updateProjectiles(dt) {
    this.updateBulletClashes();
    for (const b of this.bullets) {
      b.update(dt);
      if (b.dead) continue;
      if (b.x < ARENA.wall || b.x > ARENA.w - ARENA.wall || b.y < ARENA.wall || b.y > ARENA.h - ARENA.wall) { b.dead = true; continue; }
      if (b.pierce) { this.pierceStep(b); continue; } // railgun slugs spend a strength budget instead of dying
      // shots farm scrap: player bullets → player XP, BOT bullets → that
      // bot's XP (bots shoot-to-farm too; the Titan's shells don't harvest)
      if (b.fromPlayer || (b.shooter && b.shooter.gainXp)) {
        let ate = false;
        for (const s of this.scrap) {
          if (s.dead || dist(b.x, b.y, s.x, s.y) >= s.radius * 0.8) continue;
          const drain = Math.min(b.damage * 0.6, s.amount);
          s.amount -= drain;
          if (b.fromPlayer) { this.addXp(drain * XP_PER_SCRAP); this.healFromScrap(drain, s.maxAmount); }
          else b.shooter.gainXp(drain * XP_PER_SCRAP);
          this.particles.scrapPuff(s.x, s.y);
          if (s.amount <= 0) s.dead = true;
          b.dead = true; ate = true; break;
        }
        if (ate) continue;
      }
      // mines are SHOOTABLE: the third hit detonates one (AoE, credited to
      // the shooter — popping your OWN minefield remotely is legal play)
      let popped = false;
      for (const m of this.mines) {
        if (m.dead || dist(b.x, b.y, m.x, m.y) >= 9 + b.radius) continue;
        m.hp = (m.hp ?? 3) - 1;
        this.particles.sparks(b.x, b.y, Math.atan2(b.vy, b.vx) + Math.PI, 4, 140);
        if (m.hp <= 0) this.detonateMine(m, b.shooter);
        b.dead = true; popped = true; break;
      }
      if (popped) continue;
      // loot crates are SHOOTABLE: CRATE_HP hits crack one open
      let boxed = false;
      for (const c of this.crates) {
        if (c.dead || dist(b.x, b.y, c.x, c.y) >= c.r + b.radius) continue;
        c.hp -= 1;
        this.particles.sparks(b.x, b.y, Math.atan2(b.vy, b.vx) + Math.PI, 4, 140);
        if (c.hp <= 0) this.breakCrate(c);
        b.dead = true; boxed = true; break;
      }
      if (boxed) continue;
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
        this.hurtCar(car, b.damage, b.shooter, b.x, b.y, "bullet"); // bullet pos → hit direction
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
  hurtCar(car, amount, source, hitX, hitY, srcType) {
    if (source && source.noDmgT !== undefined) source.noDmgT = 0; // attacker IS landing damage
    if (car === this.player) { this.playerLastHitBy = source; this.damagePlayer(amount, hitX, hitY, srcType, source); }
    else { car.lastHitBy = source; car.hurt(amount, hitX, hitY, srcType, source); }
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

  // display name for any wrecker/victim (player, a bot, or a boss)
  nameOf(car) {
    if (!car) return "THE ARENA";
    if (car === this.player) return this.playerName;
    if (car && car.kind && car.name && (car.kind === "titan" || car.kind === "magnet")) return car.name;
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
    // keep every car inside the world after collision/boss pushes — a roaming
    // boss or a hard shove against a wall must never eject a car out of bounds
    for (const c of cars) {
      if (this.isDeadCar(c)) continue;
      const m = ARENA.wall + c.radius;
      c.x = clamp(c.x, m, ARENA.w - m);
      c.y = clamp(c.y, m, ARENA.h - m);
    }
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
      this.hurtCar(a, dmg * (0.15 + 0.85 * (bTow / total)), b, b.x, b.y, "crash"); // each hurt by the OTHER's push
      this.hurtCar(b, dmg * (0.15 + 0.85 * (aTow / total)), a, a.x, a.y, "crash");
      const cx = a.x + nx * a.radius, cy = a.y + ny * a.radius;
      this.particles.sparks(cx, cy, Math.atan2(ny, nx), 8, 240);
      this.audio.playImpact(clamp(impact / 500, 0, 1));
    }
  }

  // -- central Junk Titan boss (BACKLOG-ARENA item 6) -------------------------

  // spawn the next central boss — ALTERNATES between the Junk Titan and the
  // roaming Magnet on respawn (seeded pick → deterministic). `force` lets the
  // preview hooks pin a specific one.
  spawnCentralBoss(force) {
    const kind = force || pick(["titan", "magnet"]);
    return kind === "magnet"
      ? new ArenaMagnet(ARENA.w / 2, ARENA.h / 2)
      : new ArenaBoss(ARENA.w / 2, ARENA.h / 2);
  }

  updateBossWorld(dt) {
    if (!this.boss) return;
    if (!this.boss.dead) { this.boss.update(dt, this); return; }
    this.bossRespawnT -= dt;
    if (this.bossRespawnT <= 0) this.boss = this.spawnCentralBoss();
  }

  // hard inward YANK + heavy damage when the Magnet unleashes its mega-pull
  // (called from ArenaMagnet.update at the end of its wind-up)
  magnetMegaPull(boss) {
    for (const c of this.cars()) {
      if (this.isDeadCar(c)) continue;
      const dx = boss.x - c.x, dy = boss.y - c.y, d = Math.hypot(dx, dy) || 1;
      if (d > MAGNET_PULL_R) continue;
      const closeness = 1 - d / MAGNET_PULL_R;
      c.vx += (dx / d) * 900 * (0.4 + closeness); c.vy += (dy / d) * 900 * (0.4 + closeness);
      this.hurtCar(c, 26 + 34 * closeness, boss, boss.x, boss.y, "slam"); // worse the closer you are
    }
    this.particles.explosion(boss.x, boss.y);
    this.particles.sparks(boss.x, boss.y, 0, 44, 460);
    if (this.audio.playExplosion) this.audio.playExplosion();
  }

  // route incoming damage to the plate FACING the hit; if that plate is gone,
  // the core is exposed there and takes it instead. Tearing a plate off drops a
  // lootable weapon (the signature "rip a part off the enemy" mechanic).
  // `bypass` = ignore the Magnet's armor (hook explosion + mines — its weakness)
  hurtBoss(hitX, hitY, amount, source, bypass) {
    const boss = this.boss;
    if (!boss || boss.dead) return;
    boss.lastHitBy = source;
    boss.hitFlash = 0.1;
    // THE MAGNET has no plates — it's armored EXCEPT during its overload window
    // (bait the mega-pull, then burn the exposed core). Mines + the hook blast
    // bypass this (its weakness).
    if (boss.kind === "magnet") {
      if (!bypass && !boss.isVulnerable()) { boss.hitFlash = 0.06; if (this.audio.playClank) this.audio.playClank(); return; }
      boss.coreHp -= amount;
      boss.hitFlash = 0.14;
      if (boss.coreHp <= 0) { boss.dead = true; this.killBoss(source); }
      return;
    }
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
        // Titan chatter only when it's YOUR fight: you're nearby or you did it
        if (source === this.player || dist(this.player.x, this.player.y, boss.x, boss.y) < 1000) {
          this.banner("TITAN PLATE TORN OFF", "core exposed — hit the gap");
        }
      }
    } else {
      boss.coreHp -= amount;
      boss.hitFlash = 0.14;
      if (boss.coreHp <= 0) { boss.dead = true; this.killBoss(source); }
    }
  }

  // core down: big XP to the killer + a scrap piñata + a bonus weapon drop
  killBoss(killer) {
    const boss = this.boss, xp = boss.killXp || 400;
    this.feedWreck(killer, boss);
    this.bumpStreak(killer);
    if (killer === this.player) {
      this.kills++; this.addXp(xp);
      this.banner(boss.name + " WRECKED", "+" + xp + " XP");
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
      this.hurtCar(c, 30 * f, boss, boss.x, boss.y, "slam");
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
    if (car.reelingBoss) return; // being hook-reeled into the boss → the hook owns this contact (no crash chip)
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
      this.hurtCar(car, (closing - 30) * 0.05, boss, boss.x, boss.y, "crash"); // you take a knock too
      this.particles.sparks(px, py, Math.atan2(ny, nx), 8, 240);
      this.audio.playImpact(clamp(closing / 500, 0, 1));
    }
  }

  // blow a mine where it sits: knockback + falloff damage to anything near,
  // credited to `source` (whoever shot it — kill attribution flows through)
  detonateMine(m, source) {
    m.dead = true;
    for (const car of this.cars()) {
      if (this.isDeadCar(car) || car === m.owner) continue; // your own mine never hurts YOU
      const d = dist(m.x, m.y, car.x, car.y);
      if (d > 90 + car.radius * 0.5) continue;
      const f = clamp(1 - d / 140, 0.3, 1);
      const ang = Math.atan2(car.y - m.y, car.x - m.x);
      car.vx += Math.cos(ang) * 240 * f; car.vy += Math.sin(ang) * 240 * f;
      this.hurtCar(car, m.dmg * f, source, m.x, m.y, "mine");
    }
    if (this.boss && !this.boss.dead && dist(m.x, m.y, this.boss.x, this.boss.y) < 90 + this.boss.radius) {
      this.hurtBoss(m.x, m.y, m.dmg, source);
    }
    for (const c of this.crates) { // the blast cracks nearby crates open too
      if (!c.dead && dist(m.x, m.y, c.x, c.y) < 90 + c.r) this.breakCrate(c);
    }
    this.particles.explosion(m.x, m.y);
    this.audio.playExplosion();
  }

  updateMines(dt) {
    for (const m of this.mines) {
      if (m.dead) continue;
      m.age = (m.age || 0) + dt;
      if (m.age > MINE_LIFE) { m.dead = true; continue; } // despawn — no lingering fields forever
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
        this.hurtCar(car, m.dmg, m.owner, m.x, m.y, "mine");
        this.particles.explosion(m.x, m.y);
        this.audio.playExplosion();
        break;
      }
    }
    this.mines = this.mines.filter((m) => !m.dead);
  }

  // ARMOR reduces damage taken; hitting 0 HP wrecks the player.
  damagePlayer(amount, hitX, hitY, srcType, source) {
    if (this.dead) return;
    if (this._godmode) return; // TEST MODE (dev) — remove later
    // RAM primary defense (user spec): while charging/ramming, frontal BULLETS
    // do 0 damage and a frontal CRASH does 0 UNLESS the other car is ALSO a
    // charging ram (mines always hurt); everything else is 35% off — ONLY when
    // RAM is in the PRIMARY (weapon1) slot.
    const ramPrimary = !!(this.loadout && this.loadout.weapon1 && this.loadout.weapon1.type === "ram");
    amount *= ramDamageMul(this.player, ramPrimary, ramLaunchingFast(this.player, this.ramBoostT), hitX, hitY, srcType, source);
    this.outOfCombat = 0; // taking a hit resets the regen timer
    const dealt = amount / (1 + this.partDmgReduce); // ARMOR part damage reduction
    this.hp -= dealt;
    chipWheels(this.player, dealt, hitX, hitY, srcType); // bullets chew the closest wheel, blasts the closest two
    if (amount > 0) this.player.sinceHit = 0;   // any real hit stalls the wheel mend
    if (this.hp <= 0) {
      this.dead = true;
      this.respawnT = 1.2; // brief wreck moment, then the death menu (main.js)
      const killer = this.playerLastHitBy;
      this.feedWreck(killer, this.player);
      this.bumpStreak(killer);              // your killer's streak grows
      this.playerStreak = 0;                // yours resets on death
      if (killer && killer.gainXp) this.nemesis = killer; // a BOT becomes your nemesis
      this.dropPart(this.player.x, this.player.y, this.playerDeathDrop()); // drop ONE part, weighted to your best (user)
      this.particles.explosion(this.player.x, this.player.y);
      if (this.audio.playGameOver) this.audio.playGameOver();
      this.banner("WRECKED", "");
    }
  }

  // death penalty (user request): drop to 10% of your accumulated XP and
  // re-earn from there. Your build resets —
  // stats to zero (with the reduced level's points to re-spend) + a fresh
  // common loadout of your original weapon.
  // the car the spectate camera follows — tracked by REFERENCE, so deaths of
  // OTHER bots never move the view; only the watched car's own death (or the
  // NEXT button) swaps to another living bot. Falls back to the Titan.
  spectateTarget() {
    if (this.spectateCar && !this.spectateCar.deadFlag && this.bots.includes(this.spectateCar)) {
      return this.spectateCar;
    }
    const live = this.bots.filter((b) => !b.deadFlag);
    this.spectateCar = live.length ? live[0] : null;
    return this.spectateCar || (this.boss && !this.boss.dead ? this.boss : null);
  }
  nextSpectate() {
    const live = this.bots.filter((b) => !b.deadFlag);
    if (!live.length) return;
    this.spectateCar = live[(live.indexOf(this.spectateCar) + 1) % live.length];
  }

  // Respawn with a freshly CHOSEN weapon (the death flow re-opens the weapon
  // picker — user request). A re-pick becomes your new default `baseWeapon`;
  // omitting it keeps the last one.
  respawnPlayer(weapon) {
    this.dead = false;
    this.spectate = false;
    const w = weapon || this.baseWeapon;
    if (weapon) this.baseWeapon = weapon;               // the new pick sticks for next time
    const kept = 0.10 * arenaTotalXp(this.level, this.xp); // keep 10% of total XP on death (user)
    const lv = arenaLevelFromTotal(kept, LEVEL_CAP);
    this.level = lv.level; this.xp = lv.xp;
    this.statPoints = this.level - 1;                   // points for your reduced level
    this.stats = { health: 0, speed: 0, reload: 0, regen: 0 };
    this.slots = { armor: this.level >= 5 };
    this.startWeapon = w;
    this.loadout = this.freshLoadout(w);
    this.applyStats();
    this.hp = this.maxHp;
    healWheelsFull(this.player); // fresh life = fresh wheels
    this.railCd = 0;
    this.outOfCombat = 0;
    const sp = this.playerSpawn();
    this.player.x = sp.x; this.player.y = sp.y;
    this.player.vx = this.player.vy = 0;
    this.player.stunT = 0; // clear any leftover hook stun
    this.banner("RESPAWNED", "back to level " + this.level);
  }

  // -- part loot: wrecks drop parts; equip them from the loadout panel --------

  // on PLAYER death, drop ONE equipped part chosen at random but WEIGHTED toward
  // the highest tier — same weighting bots use in pickDrop (user).
  playerDeathDrop() {
    const L = this.loadout;
    const parts = [L.tires, L.engine, L.weapon1, L.armor].filter(Boolean);
    if (!parts.length) return null;
    let total = 0; for (const p of parts) total += (p.tier + 1) * (p.tier + 1);
    let r = rand(0, total);
    for (const p of parts) { r -= (p.tier + 1) * (p.tier + 1); if (r <= 0) return { slot: p.slot, type: p.type, tier: p.tier, cd: 0 }; }
    const last = parts[parts.length - 1];
    return { slot: last.slot, type: last.type, tier: last.tier, cd: 0 };
  }

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

  // which loadout slot a part would fill: fixed for tires/engine/armor; ONE
  // weapon slot (user, 2026-07-09), so every weapon drop targets it.
  targetSlot(part) {
    if (part.slot !== "weapon") return part.slot;
    return "weapon1";
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
    const slot = this.targetSlot(drop.part);
    drop.dead = true; // claim it NOW
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
    // only the ACTIVE banner (banners[0]) ages; queued ones wait fresh. It
    // yields after BANNER_MIN when others wait, else lingers to BANNER_FULL.
    if (this.banners.length) {
      const b = this.banners[0];
      b.age += dt;
      const stay = this.banners.length > 1 ? BANNER_MIN : BANNER_FULL;
      if (b.age >= stay) this.banners.shift();
    }
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

  // -- loot crates: roaming reward (user). Crack with bullets or a moving car --

  cratePos() { // a seeded spot away from the center boss, the player's VIEW, and other crates
    for (let t = 0; t < 24; t++) {
      const x = rand(ARENA.wall + 120, ARENA.w - ARENA.wall - 120);
      const y = rand(ARENA.wall + 120, ARENA.h - ARENA.wall - 120);
      if (dist(x, y, ARENA.w / 2, ARENA.h / 2) < 900) continue;              // not in the boss's yard
      // never pop into existence where the player can SEE it (user): outside
      // the view frame — a logical-1280x720 rect on the player + a margin
      if (Math.abs(x - this.player.x) < WORLD.w / 2 + 80 &&
          Math.abs(y - this.player.y) < WORLD.h / 2 + 80) continue;
      if (this.crates.some((c) => !c.dead && dist(x, y, c.x, c.y) < 500)) continue; // spread out
      return { x, y };
    }
    return { x: rand(ARENA.wall + 120, ARENA.w - ARENA.wall - 120), y: rand(ARENA.wall + 120, ARENA.h - ARENA.wall - 120) };
  }

  scatterCrates() {
    while (this.crates.length < CRATE_COUNT) {
      const p = this.cratePos();
      this.crates.push({ x: p.x, y: p.y, r: CRATE_R, hp: CRATE_HP, dead: false, respawnT: 0, seed: fxRand(0, TAU) });
    }
  }

  // crack it open: ALWAYS drops one part a step above starting gear — UNCOMMON,
  // sometimes RARE (user: the player already starts with commons), then arms a
  // respawn.
  breakCrate(c) {
    if (c.dead) return;
    c.dead = true;
    c.respawnT = rand(CRATE_RESPAWN_MIN, CRATE_RESPAWN_MAX);
    const slot = pick(["tires", "engine", "armor", "weapon"]);
    // weapon crates: a small chance of the loot-only RAILGUN (user), else basics
    const type = slot === "weapon" ? (rand() < 0.15 ? "railgun" : pick(ARENA_BASIC_WEAPONS)) : slot;
    const tier = rand() < 0.7 ? 1 : 2;
    this.dropPart(c.x, c.y, makePart(slot, type, tier));
    this.particles.scrapPuff(c.x, c.y);
    this.particles.sparks(c.x, c.y, fxRand(0, TAU), 8);
    if (this.audio.playImpact) this.audio.playImpact(0.5);
  }

  updateCrates(dt) {
    for (const c of this.crates) {
      if (c.dead) { // respawn somewhere else once the timer runs out
        c.respawnT -= dt;
        if (c.respawnT <= 0) {
          const p = this.cratePos();
          c.x = p.x; c.y = p.y; c.hp = CRATE_HP; c.dead = false; c.seed = fxRand(0, TAU);
        }
        continue;
      }
      // a moving car smashes straight through it (bots deliberately don't brake)
      for (const car of this.cars()) {
        if (this.isDeadCar(car)) continue;
        if (dist(car.x, car.y, c.x, c.y) < c.r + car.radius &&
            Math.hypot(car.vx, car.vy) > CRATE_BREAK_SPEED) {
          this.breakCrate(c);
          break;
        }
      }
    }
  }

  begin() {
    this.started = true;
    this.baseWeapon = this.startWeapon; // respawn reverts to your original pick
    this.loadout = this.freshLoadout(this.startWeapon); // build slots from the pick
    this.applyStats();
    this.hp = this.maxHp; // spawn at FULL hp (the starting common armor bumps maxHp to 120)
    setSimRandom(() => this.rng.next()); // this mode owns the sim RNG while active
  }

  togglePause() {
    if (!this.started) return;
    this.paused = !this.paused;
    document.getElementById("pause-screen").classList.toggle("hidden", !this.paused);
    if (this.paused) {
      document.getElementById("guide-btn").classList.add("hidden");        // the Gauntlet enemy guide
      document.getElementById("arena-guide-btn").classList.remove("hidden"); // ...Arena has its own
      document.getElementById("layout-edit-btn").classList.remove("hidden"); // HUD layout editor (Arena only)
    } else {
      document.getElementById("options-screen").classList.add("hidden");   // clean up sub-menus
      document.getElementById("arena-guide-screen").classList.add("hidden");
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
      this.updateHooks(dt);    // bots keep hooking each other while you spectate
      this.updateProjectiles(dt);
      this.updateMines(dt);
      this.updateCrates(dt);   // crates keep smashing/respawning while you spectate
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
          this.cam.x = clamp(t.x, VIEW.w / 2, ARENA.w - VIEW.w / 2);
          this.cam.y = clamp(t.y, VIEW.h / 2, ARENA.h - VIEW.h / 2);
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
    trackArenaMotion(p, dt); // bots lead their shots off these trackers

    if (p.stunT > 0) p.stunT -= dt; // hooked → stunned (can't shoot); ticks down after the reel

    // weapon fire, then combat: bots think, Titan crawls, cars collide, shots resolve
    this.updateWeapon(dt);
    this.updatePlayerHook(dt); // fire the minelayer hook (right-click / HOOK button)
    this.updateRailgun(dt);    // charge/release the loot-only railgun (left hold / SNIPE)
    this.updateBots(dt);
    this.updateBossWorld(dt);
    this.updateCollisions();
    this.updateHooks(dt);      // reel grabbed cars (final say on their position)
    this.updateProjectiles(dt);
    this.updateMines(dt);
    this.updateCrates(dt);
    this.updateDrops(dt);

    // first-encounter banner the first time you get near EACH boss type
    if (this.boss && !this.boss.dead && !this._sawBossKinds[this.boss.kind] &&
        dist(p.x, p.y, this.boss.x, this.boss.y) < 1000) {
      this._sawBossKinds[this.boss.kind] = true;
      this.banner(this.boss.name, this.boss.tagline);
    }

    // XP from scrap: drive over a pile to absorb it (the other farm path).
    for (const s of this.scrap) {
      if (s.dead || dist(p.x, p.y, s.x, s.y) >= s.radius + p.radius * 0.6) continue;
      const drain = Math.min(150 * dt, s.amount);
      s.amount -= drain;
      this.addXp(drain * XP_PER_SCRAP);
      this.healFromScrap(drain, s.maxAmount);
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

    // wheels mend after 10s without a hit (damagePlayer zeroes player.sinceHit);
    // the REGEN stat trims the wait, 0.5s per point (user)
    tickWheelRepair(p, dt, WHEEL_REPAIR_DELAY - 0.5 * this.stats.regen);

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
    // Viewport is the LOGICAL VIEW (area-locked to the window; the backing store
    // is hi-dpi and the renderer scales its context, so the visible world AREA
    // stays constant across monitors = same amount seen, no per-screen edge).
    const vw = VIEW.w, vh = VIEW.h;
    this.cam.x = clamp(p.x, vw / 2, ARENA.w - vw / 2);
    this.cam.y = clamp(p.y, vh / 2, ARENA.h - vh / 2);

    // engine + tire audio
    this.audio.setEngine(clamp(p.speed / p.maxSpeed, 0, 1), false);
    this.audio.setScreech(p.speed > 60 ? clamp((p.lateralSpeed - 70) / 180, 0, 1) : 0);
  }
}
