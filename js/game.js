"use strict";
// ---------------------------------------------------------------------------
// Game: owns all state and runs the frame — entity updates, collisions,
// damage resolution, the repair economy, screen shake, and win/lose flow.
// ---------------------------------------------------------------------------

// shown in the banner when the player loses a component
const PART_HINTS = {
  frontBumper: "Front-end collisions now hurt more",
  rearBumper:  "Rear collisions now hurt more",
  leftWheels:  "Car pulls hard to the left",
  rightWheels: "Car pulls hard to the right",
  engine:      "Engine will randomly stall",
  weapon:      "Cannon offline",
};

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.input = new Input();
    this.audio = new AudioSys();
    this.ui = new UI();
    this.renderer = new Renderer(canvas, this);
    this.shop = new Shop(this);
    this.started = false;
    this.paused = false;
    // deterministic sim RNG (see rng.js). A URL-locked seed persists across
    // restarts (replay a challenge); otherwise every run rolls a fresh seed.
    // The arrow reads this.rng each call, so reassigning it in reset() is fine.
    this.seed = RNG.randomSeed();
    this.lockSeed = false;
    this.rng = new RNG(this.seed);
    setSimRandom(() => this.rng.next());
    // one shared hook so every car's part-destruction feeds the same effects
    this.handleComponentDestroyed = (car, key) => this.onPartDestroyed(car, key);
    this.reset();
  }

  // fix the seed for this + future runs (URL ?seed=, or a challenge)
  setSeed(seed) {
    this.seed = seed >>> 0;
    this.lockSeed = true;
    this.rng = new RNG(this.seed);
  }

  reset() {
    // fresh RNG stream each run: same seed if locked, else a new random seed
    if (!this.lockSeed) this.seed = RNG.randomSeed();
    this.rng = new RNG(this.seed);
    this.player = new Player(WORLD.w / 2, WORLD.h / 2);
    this.player.onComponentDestroyed = this.handleComponentDestroyed;
    this.enemies = [];
    this.bullets = [];
    this.scrap = [];
    this.particles = new Particles();
    this.debris = new GroundDebris();
    this.rounds = new RoundManager();
    this.kills = 0;
    this.time = 0;
    this.trauma = 0;        // screen-shake energy, 0..1
    this.shakeX = 0; this.shakeY = 0;
    this.over = false;
    this.pairHits = new Map(); // per-car-pair damage cooldown
    this.repairFx = 0;
    this.mines = [];           // minelayer proximity mines
    this.playerRepairing = false; // parked on a pile right now (AI punishes this)
    this.seenTypes = new Set(); // enemy types met this run (intro banners + dossier)
    // run economy + upgrades (a restart wipes both)
    this.salvage = 0;
    this.upgrades = {};        // id -> owned tier
    this.floatTexts = [];      // "+N salvage" popups
    this.driftZones = [];      // Drift Master spark trail
    this.driftZoneTimer = 0;
    // NO scrap in round 1 — piles arrive 1-3 at a time after each clear
    this.renderer.resetMarks();
    this.ui.reset();
    this.hideIntermission();
  }

  scatterScrap(n) {
    let guard = 0;
    while (this.scrap.length < n && guard++ < 400) {
      const x = rand(80, WORLD.w - 80), y = rand(80, WORLD.h - 80);
      if (dist(x, y, this.player.x, this.player.y) < 150) continue; // never on top of the player
      if (this.scrap.some((s) => dist(x, y, s.x, s.y) < 110)) continue;
      this.scrap.push(new ScrapPile(x, y));
    }
  }

  // kick off the first round (called after the start screen / a restart)
  begin() {
    this.started = true;
    this.rounds.requestNext(this);
  }

  togglePause() {
    if (!this.started || this.over) return;
    this.paused = !this.paused;
    document.getElementById("pause-screen").classList.toggle("hidden", !this.paused);
    if (this.paused) {
      document.getElementById("guide-btn").classList.remove("hidden"); // Gauntlet has the Field Guide
    } else { // resuming closes the sub-menus too
      document.getElementById("guide-screen").classList.add("hidden");
      document.getElementById("options-screen").classList.add("hidden");
      this.guideOpen = false;
    }
    if (this.audio.ctx) this.paused ? this.audio.ctx.suspend() : this.audio.ctx.resume();
  }

  // Mobile only: rotating a phone to portrait auto-pauses (the rotate-hint
  // overlay covers the screen). Rotating back to landscape does NOT auto-
  // resume — it leaves the pause screen up so the player taps RESUME, which
  // avoids the game running for the split-second the phone is mid-rotation.
  handleOrientation(isPortrait) {
    if (!this.touchMode || !this.started || this.over) return;
    if (isPortrait && !this.paused) this.togglePause(); // guard ensures pause, never resume
  }

  // first sighting of a type: teach it with a banner
  noteEnemySeen(type) {
    if (this.seenTypes.has(type)) return;
    this.seenTypes.add(type);
    const info = ENEMY_INFO[type];
    this.ui.addBanner("NEW ENEMY: " + info.name, info.tip);
  }

  // -- options: full-screen menu reached from the pause screen ---------------

  openOptions() {
    if (!this.paused) return;
    document.getElementById("pause-screen").classList.add("hidden");
    document.getElementById("options-screen").classList.remove("hidden");
    this.optionsOpen = true;
  }

  closeOptions() {
    document.getElementById("options-screen").classList.add("hidden");
    if (this.paused) document.getElementById("pause-screen").classList.remove("hidden");
    this.optionsOpen = false;
  }

  // -- field guide: full-screen menu reached from the pause screen -----------

  openGuide() {
    if (!this.paused) return;
    this.buildGuide();
    document.getElementById("pause-screen").classList.add("hidden");
    document.getElementById("guide-screen").classList.remove("hidden");
    this.guideOpen = true;
  }

  closeGuide() {
    document.getElementById("guide-screen").classList.add("hidden");
    if (this.paused) document.getElementById("pause-screen").classList.remove("hidden");
    this.guideOpen = false;
  }

  // one card per encountered type, with the actual car rendered on a canvas
  buildGuide() {
    const grid = document.getElementById("guide-grid");
    grid.innerHTML = "";
    let any = false;
    for (const t in ENEMY_INFO) { // catalog order
      if (!this.seenTypes.has(t)) continue;
      any = true;
      const info = ENEMY_INFO[t];
      const card = document.createElement("div");
      card.className = "guide-card";
      const cv = document.createElement("canvas");
      cv.width = 96;
      cv.height = 76;
      cv.className = "guide-portrait";
      this.renderer.renderEnemyPortrait(t, cv);
      const text = document.createElement("div");
      const name = document.createElement("div");
      name.className = "guide-name";
      name.textContent = info.name;
      const tip = document.createElement("div");
      tip.className = "guide-tip";
      tip.textContent = info.tip;
      text.appendChild(name);
      text.appendChild(tip);
      card.appendChild(cv);
      card.appendChild(text);
      grid.appendChild(card);
    }
    if (!any) grid.innerHTML = '<div class="guide-tip">No enemies encountered yet</div>';
  }

  // -- shop --------------------------------------------------------------------

  // roughly what one round pays out right now (kills + clear bonus)
  roundIncomeEstimate() {
    const r = Math.max(1, this.rounds.round);
    const count = Math.min(1 + Math.floor((r - 1) / 2), 5);
    const perKill = Math.ceil((10 + r) * 0.5);
    return count * perKill + 8 + 2 * r;
  }

  // Repair Kit price scales with how wrecked the car is: one badly hurt part
  // (~15% missing) ≈ half a round's income; critically hurt (~70-85%) ≈ 2-3
  // rounds' income
  repairKitCost() {
    const comps = Object.values(this.player.components);
    const max = comps.reduce((a, c) => a + c.max, 0);
    const missing = comps.reduce((a, c) => a + (c.max - c.hp), 0);
    return Math.max(10, Math.round(this.roundIncomeEstimate() * (missing / max) * 3.2));
  }

  // Repair Kit purchase: `frac` selects 25/50/100% of missing HP. Always
  // buyable — if salvage can't cover the chosen option, spend everything and
  // heal proportionally to what was paid.
  buyRepairKit(frac) {
    const comps = Object.values(this.player.components);
    const missing = comps.reduce((a, c) => a + (c.max - c.hp), 0);
    if (missing <= 0.01 || this.salvage <= 0) return; // pristine or broke
    const fullCost = this.repairKitCost();
    const spend = Math.min(Math.ceil(fullCost * frac), this.salvage);
    if (spend <= 0) return;
    this.salvage -= spend;
    this.upgrades.repairKit = (this.upgrades.repairKit || 0) + 1;
    this.healPlayer(missing * (spend / fullCost));
    this.audio.playBuy();
    this.shop.refresh();
  }

  buyUpgrade(id) {
    const def = UPGRADES.find((u) => u.id === id);
    if (!def) return;
    if (def.repeat) return this.buyRepairKit(1); // legacy path: full heal
    const tier = this.upgrades[id] || 0;
    if (tier >= def.costs.length) return;
    const cost = def.costs[Math.min(tier, def.costs.length - 1)];
    if (this.salvage < cost) return;
    this.salvage -= cost;
    this.upgrades[id] = tier + 1;
    this.applyUpgrade(id, tier + 1);
    this.audio.playBuy();
    this.shop.refresh();
  }

  // pour repair HP into the most-damaged components until spent (can revive)
  healPlayer(total) {
    let remaining = total;
    for (let guard = 0; remaining > 0.01 && guard < 12; guard++) {
      let worst = null, worstR = 1;
      for (const k in this.player.components) {
        const c = this.player.components[k];
        const r = c.hp / c.max;
        if (c.hp < c.max && r < worstR) { worstR = r; worst = k; }
      }
      if (!worst) break;
      const c = this.player.components[worst];
      const amt = Math.min(remaining, c.max - c.hp);
      c.hp += amt;
      if (c.max - c.hp < 1e-6) c.hp = c.max; // snap: float drift must not leave "almost pristine" parts
      remaining -= amt;
    }
    this.particles.repairGlow(this.player.x, this.player.y);
    this.audio.playRepair();
  }

  // instant effects; everything else is read from this.upgrades where it acts
  // (repair kits go through buyRepairKit, not here)
  applyUpgrade(id, tier) {
    const p = this.player;
    if (id === "plating") p.applyPlating(tier);
    else if (id === "rallyTires") p.wheelPullMul = 0.5;
    else if (id === "driftMaster") p.handbrakeBoost = 1.55;
    else if (id === "emergencyPatch") p.patchCharge = true;
    else if (id === "scrapMagnet") {
      for (const s of this.scrap) { s.amount *= 1.5; s.maxAmount *= 1.5; }
    }
  }

  addTrauma(t) { this.trauma = Math.min(1, this.trauma + t); }

  // -- main frame --------------------------------------------------------------

  update(dt) {
    if (!this.started || this.paused) return;

    if (this.over) {
      // let the wreck smolder behind the game-over screen
      this.particles.update(dt);
      this.debris.update(dt);
      this.renderer.updateSkids(dt);
      this.updateShake(dt);
      if (this.input.restart) this.restart();
      return;
    }

    this.time += dt;
    const p = this.player;

    p.update(dt, this.input, this);
    for (const e of this.enemies) e.update(dt, this);

    // car-vs-car: player against every enemy, enemies against each other
    for (let i = 0; i < this.enemies.length; i++) {
      this.collideCars(p, this.enemies[i]);
      for (let j = i + 1; j < this.enemies.length; j++) {
        this.collideCars(this.enemies[i], this.enemies[j]);
      }
    }
    this.collideWalls(p);
    for (const e of this.enemies) this.collideWalls(e);

    this.updateBullets(dt);
    this.updateMines(dt);
    this.updateScrap(dt);

    // bury the dead
    for (const e of this.enemies) if (e.dead) this.destroyEnemy(e);
    this.enemies = this.enemies.filter((e) => !e.dead);

    this.rounds.update(dt, this);
    this.particles.update(dt);
    this.debris.update(dt);
    this.updateShake(dt);
    this.ui.update(dt);
    this.updateUpgradeEffects(dt);

    // salvage popups drift upward and fade
    for (const t of this.floatTexts) { t.age += dt; t.y -= 28 * dt; }
    this.floatTexts = this.floatTexts.filter((t) => t.age < t.life);

    // engine + tire audio, damage smoke
    this.audio.setEngine(clamp(p.speed / p.maxSpeed, 0, 1), p.stalled);
    this.audio.setScreech(p.speed > 60 ? clamp((p.lateralSpeed - 70) / 180, 0, 1) : 0);
    if (p.compRatio("engine") < 0.4 && Math.random() < dt * 10) {
      this.particles.smoke(p.x, p.y, !p.compAlive("engine"));
    }
    if (p.stalled && Math.random() < dt * 20) this.particles.smoke(p.x, p.y, true);

    // tire rubber (fades away after ~20s)
    this.renderer.recordSkids(p);
    for (const e of this.enemies) this.renderer.recordSkids(e);
    this.renderer.updateSkids(dt);

    if (p.destroyed) this.gameOver();
  }

  // per-frame upgrade behaviors: Auto-Welder + Drift Master's spark trail
  updateUpgradeEffects(dt) {
    const p = this.player;
    if (this.upgrades.autoWelder && this.rounds.state === "active") {
      // welds the worst SURVIVING part — it cannot revive destroyed ones,
      // or the all-parts-dead lose condition could never trigger
      let worst = null, worstR = 1;
      for (const k in p.components) {
        const c = p.components[k];
        const r = c.hp / c.max;
        if (c.hp > 0 && c.hp < c.max && r < worstR) { worstR = r; worst = k; }
      }
      if (worst) p.repairComponent(worst, 3 * dt);
    }
    if (this.upgrades.driftMaster) {
      // hard slides shed burning sparks that stay hot for a moment
      if (this.input.handbrake && p.lateralSpeed > 100 && p.speed > 140) {
        this.driftZoneTimer -= dt;
        if (this.driftZoneTimer <= 0) {
          this.driftZoneTimer = 0.07;
          this.driftZones.push({ x: p.x, y: p.y, life: 1.1 });
          if (this.driftZones.length > 80) this.driftZones.shift();
          this.particles.sparks(p.x, p.y, fxRand(0, TAU), 2, 90);
        }
      }
      for (const z of this.driftZones) z.life -= dt;
      this.driftZones = this.driftZones.filter((z) => z.life > 0);
      for (const e of this.enemies) {
        if (e.dead) continue;
        for (const z of this.driftZones) {
          if (dist(e.x, e.y, z.x, z.y) < 26) {
            e.applyDamage(e.impactSide(z.x, z.y), 30 * dt, this);
            if (Math.random() < dt * 20) this.particles.sparks(e.x, e.y, fxRand(0, TAU), 2, 120);
            break;
          }
        }
      }
    }
  }

  // trauma-based shake: quadratic falloff feels punchy without lingering
  updateShake(dt) {
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma * 14;
    this.shakeX = fxRand(-1, 1) * s;
    this.shakeY = fxRand(-1, 1) * s;
  }

  // -- collisions ---------------------------------------------------------------

  collideCars(a, b) {
    if (a.dead || b.dead) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 0.001;
    const minD = a.radius + b.radius;
    if (d >= minD) return;

    const nx = dx / d, ny = dy / d;
    // positional separation
    const push = (minD - d) / 2;
    a.x -= nx * push; a.y -= ny * push;
    b.x += nx * push; b.y += ny * push;

    // impulse (equal masses, some bounce). Capture each car's contribution
    // to the crash BEFORE the impulse rewrites the velocities — damage is
    // attributed by who was actually driving into whom.
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv >= 0) return; // already separating
    const aTowards = Math.max(0, a.vx * nx + a.vy * ny);    // a pushing into b
    const bTowards = Math.max(0, -(b.vx * nx + b.vy * ny)); // b pushing into a
    const j = -(1 + 0.45) * rv / 2;
    a.vx -= nx * j; a.vy -= ny * j;
    b.vx += nx * j; b.vy += ny * j;

    // damage, gated per pair so one crunch doesn't multi-hit across frames.
    // Enemies bounce off each other but NEVER trade damage — only crashes
    // involving the player hurt anyone.
    const impact = -rv;
    const key = a.id < b.id ? a.id + ":" + b.id : b.id + ":" + a.id;
    const last = this.pairHits.get(key) ?? -1;
    if (impact > 70 && this.time - last > 0.3) {
      this.pairHits.set(key, this.time);
      const cx = a.x + nx * a.radius, cy = a.y + ny * a.radius; // contact point
      const sev = clamp(impact / 500, 0, 1);
      const playerInvolved = a === this.player || b === this.player;
      if (playerInvolved) {
        // fault-based damage: each car is hurt by the OTHER car's aggression.
        // A rammer hitting a stationary player takes only the 15% baseline;
        // a player plowing into a parked enemy barely scratches themselves.
        const dmgTotal = (impact - 40) * 0.11;
        const total = Math.max(1, aTowards + bTowards);
        // bosses hit 4x harder in collisions (bossDmgMul; 1 for regulars)
        let dmgA = dmgTotal * (0.15 + 0.85 * (bTowards / total)) * (b.bossDmgMul ?? 1);
        let dmgB = dmgTotal * (0.15 + 0.85 * (aTowards / total)) * (a.bossDmgMul ?? 1);
        // Bumper Spikes: whatever the player's crash deals, deal 50% more
        if (this.upgrades.spikes) {
          if (a === this.player) dmgB *= 1.5;
          else dmgA *= 1.5;
        }
        a.applyDamage(a.impactSide(cx, cy), dmgA, this);
        b.applyDamage(b.impactSide(cx, cy), dmgB, this);
        this.particles.sparks(cx, cy, Math.atan2(ny, nx), 6 + Math.floor(sev * 14), 260);
        this.audio.playImpact(sev);
        this.addTrauma(0.15 + sev * 0.5);
      } else {
        // enemy-on-enemy bonk: just a visual scrape
        this.particles.sparks(cx, cy, Math.atan2(ny, nx), 4, 160);
      }
    }
  }

  collideWalls(car) {
    const m = WORLD.wall + car.radius;
    let impact = 0, hit = false, cx = car.x, cy = car.y;
    if (car.x < m)           { impact = Math.max(impact, -car.vx); car.x = m;           car.vx *= -0.45; cx = car.x - car.radius; hit = true; }
    if (car.x > WORLD.w - m) { impact = Math.max(impact, car.vx);  car.x = WORLD.w - m; car.vx *= -0.45; cx = car.x + car.radius; hit = true; }
    if (car.y < m)           { impact = Math.max(impact, -car.vy); car.y = m;           car.vy *= -0.45; cy = car.y - car.radius; hit = true; }
    if (car.y > WORLD.h - m) { impact = Math.max(impact, car.vy);  car.y = WORLD.h - m; car.vy *= -0.45; cy = car.y + car.radius; hit = true; }

    // only meaningful hits damage; scrapes are free — and the player is safe
    // from self-inflicted crashes outside of an active round
    const canHurt = car !== this.player || this.rounds.state === "active";
    if (hit && impact > 130 && canHurt) {
      const dmg = (impact - 90) * 0.07;
      car.applyDamage(car.impactSide(cx, cy), dmg, this);
      const sev = clamp(impact / 500, 0, 1);
      this.particles.sparks(cx, cy, Math.atan2(car.y - cy, car.x - cx), 5 + Math.floor(sev * 10), 220);
      this.audio.playImpact(sev * 0.8);
      if (car === this.player) this.addTrauma(0.1 + sev * 0.35);
    }
  }

  // -- bullets -------------------------------------------------------------------

  updateBullets(dt) {
    for (const b of this.bullets) {
      b.update(dt);
      if (b.dead) continue;

      // walls
      if (b.x < WORLD.wall || b.x > WORLD.w - WORLD.wall || b.y < WORLD.wall || b.y > WORLD.h - WORLD.wall) {
        b.dead = true;
        this.particles.sparks(b.x, b.y, Math.atan2(-b.vy, -b.vx), 4, 120);
        continue;
      }

      // scrap piles: player shots HARVEST them (remote repair); enemy shots
      // destroy them unless Armored Scrap makes them bulletproof cover
      for (const s of this.scrap) {
        if (!s.dead && dist(b.x, b.y, s.x, s.y) < s.radius * 0.8) {
          if (b.fromPlayer) {
            const moved = this.harvestScrap(s, b.damage * 0.6 * (this.upgrades.scrapMagnet ? 2 : 1));
            if (moved > 0) {
              this.particles.repairGlow(this.player.x, this.player.y);
              this.audio.playRepair();
            }
          } else if (!this.upgrades.armoredScrap) {
            s.amount -= b.damage * 0.6;
            if (s.amount <= 0) s.dead = true;
          }
          this.particles.scrapPuff(s.x, s.y);
          b.dead = true;
          break;
        }
      }
      if (b.dead) continue;

      if (b.fromPlayer) {
        // shooting a mine detonates it harmlessly
        for (const m of this.mines) {
          if (!m.dead && dist(b.x, b.y, m.x, m.y) < 12) {
            m.dead = true;
            b.dead = true;
            this.particles.sparks(m.x, m.y, fxRand(0, TAU), 12, 220);
            this.audio.playImpact(0.35);
            break;
          }
        }
        if (b.dead) continue;
        for (const e of this.enemies) {
          if (!e.dead && dist(b.x, b.y, e.x, e.y) < e.radius + b.radius) {
            // bulldozer's plow deflects frontal shots entirely — CLANK + flash
            if (e.type === "shielded" && e.impactSide(b.x, b.y) === "front") {
              this.particles.sparks(b.x, b.y, Math.atan2(b.vy, b.vx) + Math.PI, 8, 240);
              this.audio.playClank();
              e.shieldFlash = 0.15;
            } else {
              e.applyDamage(e.impactSide(b.x, b.y), b.damage, this);
              this.particles.sparks(b.x, b.y, Math.atan2(b.vy, b.vx) + Math.PI, 6, 180);
              this.audio.playImpact(0.25);
            }
            b.dead = true;
            break;
          }
        }
      } else {
        const p = this.player;
        if (dist(b.x, b.y, p.x, p.y) < p.radius + b.radius) {
          p.applyDamage(p.impactSide(b.x, b.y), b.damage, this);
          this.particles.sparks(b.x, b.y, Math.atan2(b.vy, b.vx) + Math.PI, 8, 200);
          this.audio.playImpact(0.4);
          this.addTrauma(0.22);
          b.dead = true;
        }
      }
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
    this.scrap = this.scrap.filter((s) => !s.dead);
  }

  // -- repair economy --------------------------------------------------------------
  // Scrap piles are the ONLY repair source: drive over them, or shoot them to
  // harvest at range. There is no free repair between rounds.

  // move up to `amount` HP from a pile into the player's most-damaged
  // component (lowest HP%; can revive destroyed parts). Returns HP moved.
  harvestScrap(s, amount) {
    const p = this.player;
    let worst = null, worstR = 1;
    for (const k in p.components) {
      const c = p.components[k];
      const r = c.hp / c.max;
      if (c.hp < c.max && r < worstR) { worstR = r; worst = k; }
    }
    if (!worst) return 0; // car is pristine; don't waste the pile
    const amt = Math.min(amount, s.amount);
    p.repairComponent(worst, amt);
    s.amount -= amt;
    if (s.amount <= 0) s.dead = true;
    return amt;
  }

  updateScrap(dt) {
    const p = this.player;
    this.playerRepairing = false;
    for (const s of this.scrap) {
      if (s.dead || dist(p.x, p.y, s.x, s.y) >= s.radius + p.radius * 0.6) continue;
      const rate = this.upgrades.scrapMagnet ? 60 : 30;
      const moved = this.harvestScrap(s, rate * dt); // slow repair: you linger, exposed
      if (moved > 0) {
        this.playerRepairing = true; // enemies smell blood while you're parked
        this.repairFx += dt;
        if (this.repairFx > 0.12) {
          this.repairFx = 0;
          this.audio.playRepair();
          this.particles.repairGlow(p.x, p.y);
          // keep the Repair Kit's damage-based quote current while healing
          if (this.rounds.state === "intermission") this.shop.refresh();
        }
      }
    }
    this.scrap = this.scrap.filter((s) => !s.dead); // thieves kill piles too

  }

  // -- minelayer mines ---------------------------------------------------------------

  updateMines(dt) {
    const p = this.player;
    for (const m of this.mines) {
      if (m.dead) continue;
      if (m.arm > 0) { m.arm -= dt; continue; } // still arming
      if (dist(m.x, m.y, p.x, p.y) < 30 + p.radius * 0.6) {
        m.dead = true;
        p.applyDamage(p.impactSide(m.x, m.y), m.dmg, this);
        const ang = Math.atan2(p.y - m.y, p.x - m.x);
        p.vx += Math.cos(ang) * 260; // blast knockback
        p.vy += Math.sin(ang) * 260;
        this.particles.explosion(m.x, m.y);
        this.audio.playExplosion();
        this.addTrauma(0.5);
      }
    }
    this.mines = this.mines.filter((m) => !m.dead);
  }

  // -- round transitions ---------------------------------------------------------------

  // last enemy of the round just died
  onRoundCleared(round) {
    // NO free repair — scrap piles are the only way to fix the car.
    // The breather just clears live ordnance and restocks some scrap.
    this.bullets = [];
    this.mines = [];
    // 1-3 fresh piles per cleared round (capped so they can't be stockpiled)
    this.scatterScrap(Math.min(8, this.scrap.length + randInt(1, 3)));
    const bonus = 8 + 2 * round; // lean clear bonus; most income is kills
    this.salvage += bonus;
    this.ui.addBanner("ROUND " + round + " CLEARED", "+" + bonus + " salvage — repair at scrap piles");
    this.audio.playRoundClear();
    this.showIntermission();
  }

  showIntermission() {
    document.getElementById("round-over-title").textContent =
      "ROUND " + this.rounds.round + " OVER";
    // key hints are meaningless on touch
    document.getElementById("next-round-btn").textContent =
      "START ROUND " + (this.rounds.round + 1) + (this.touchMode ? "" : " (N)");
    document.getElementById("open-shop-btn").textContent = this.touchMode ? "SHOP" : "SHOP (B)";
    document.getElementById("intermission").classList.remove("hidden");
    document.getElementById("shop").classList.add("hidden"); // shop stays CLOSED until asked for
    document.getElementById("shop-toggle").classList.remove("hidden");
    this.shop.refresh();
  }

  hideIntermission() {
    document.getElementById("intermission").classList.add("hidden");
    document.getElementById("shop-toggle").classList.add("hidden");
  }

  // B key / side button: collapse or reopen the shop while in the breather,
  // so you can drive around the arena without the panel in the way
  toggleShop() {
    if (!this.started || this.over || this.paused || this.rounds.state !== "intermission") return;
    document.getElementById("shop").classList.toggle("hidden");
    this.shop.refresh();
  }

  // -- destruction events ------------------------------------------------------------

  // any car (player or enemy) just lost a component
  onPartDestroyed(car, key) {
    const partType =
      key === "leftWheels" || key === "rightWheels" ? "wheel" :
      key === "frontBumper" || key === "rearBumper" ? "bumper" :
      key === "weapon" ? "weapon" : "chunk";
    // fling the broken part off the side it lived on; it stays on the floor
    const off = {
      frontBumper: 0, rearBumper: Math.PI,
      leftWheels: -Math.PI / 2, rightWheels: Math.PI / 2,
      engine: fxRand(0, TAU), weapon: 0,
    }[key] ?? fxRand(0, TAU);
    this.debris.addPart(partType, car.x, car.y, car.heading + off);
    this.particles.sparks(car.x, car.y, car.heading + off, 12, 300);
    this.particles.smoke(car.x, car.y, true);
    this.audio.playPartBreak();

    if (car === this.player) {
      this.addTrauma(0.5);
      this.ui.addBanner(PLAYER_COMPONENTS[key].label.toUpperCase() + " DESTROYED", PART_HINTS[key]);
    }
  }

  destroyEnemy(e) {
    this.kills++;
    // salvage payout: elites are worth a heist, Salvage Rig skims 50% extra;
    // economy threats (thief) and tanks (splitter) pay a bounty, bikes are chaff
    const typeValue = { rammer: 10, circler: 10, shielded: 14, thief: 12, minelayer: 12, splitter: 18, bike: 3 };
    // lean payouts: an upgrade should take 2-3 rounds of earnings; bosses pay
    // extra since their rounds field half the usual headcount
    const base = e.named
      ? 30 + this.rounds.round * 2
      : Math.ceil(((typeValue[e.type] ?? 10) + this.rounds.round) * 0.5);
    const amt = Math.round(base * (this.upgrades.salvageRig ? 1.5 : 1));
    this.salvage += amt;
    this.floatTexts.push({ x: e.x, y: e.y - 20, text: "+" + amt + " SALVAGE", age: 0, life: 1.2 });
    // splitters break apart into a swarm instead of dying clean
    if (e.type === "splitter") {
      const n = randInt(2, 3);
      for (let i = 0; i < n; i++) {
        const bike = new Enemy(e.x + rand(-24, 24), e.y + rand(-24, 24), "bike", e.scaleOpts);
        bike.onComponentDestroyed = this.handleComponentDestroyed;
        this.enemies.push(bike);
      }
      this.ui.addBanner("IT SPLITS!", "Swarmers released");
      this.noteEnemySeen("bike");
    }
    this.particles.explosion(e.x, e.y);
    // the wreck rains parts that stay on the floor
    this.debris.addPart("wheel", e.x, e.y, fxRand(0, TAU));
    this.debris.addPart("wheel", e.x, e.y, fxRand(0, TAU));
    for (let i = 0; i < 3; i++) this.debris.addPart("chunk", e.x, e.y, fxRand(0, TAU));
    this.audio.playExplosion();
    this.addTrauma(0.4);
    if (e.named) this.ui.addBanner(e.name + " DESTROYED", "");
  }

  // -- game over / restart -------------------------------------------------------------

  gameOver() {
    if (this.over) return;
    this.over = true;
    this.audio.playGameOver();
    this.audio.engineOff();
    this.particles.explosion(this.player.x, this.player.y);
    for (let i = 0; i < 4; i++) {
      this.debris.addPart(fxPick(["wheel", "chunk", "bumper"]), this.player.x, this.player.y, fxRand(0, TAU));
    }
    this.addTrauma(1);
    this.hideIntermission();

    // dying mid-round means that round wasn't cleared
    const cleared = this.rounds.state === "intermission" ? this.rounds.round : this.rounds.round - 1;
    document.getElementById("final-stats").innerHTML =
      `Rounds cleared: <b>${Math.max(0, cleared)}</b><br>` +
      `Enemies destroyed: <b>${this.kills}</b><br>` +
      `Time alive: <b>${fmtTime(this.time)}</b><br>` +
      `<span class="seed-line">seed ${this.seed.toString(16)}</span>`;
    document.getElementById("gameover-screen").classList.remove("hidden");
  }

  restart() {
    document.getElementById("gameover-screen").classList.add("hidden");
    this.reset();
    this.begin();
  }
}
