"use strict";
// ---------------------------------------------------------------------------
// Enemy cars. Six archetypes, all riding the shared Car physics:
//   rammer    — chases, telegraphs ~0.5s (flash + rev), then charges
//   circler   — orbits at range, lobs slow projectiles, flees if crowded
//   shielded  — rammer variant with a bullet-proof front plow: shoot its
//               sides/rear, or outplay the charge
//   thief     — ignores you; drives pile to pile eating your repair scrap
//   minelayer — keeps its distance and seeds the arena with proximity mines
//   splitter  — slow armored hauler; splits into 2-3 swarm bikes on death
//   bike      — tiny, fast, fragile chaser (spawned by splitters)
// Enemies use the simplified damage model: hull HP + engine + wheels.
// Per-round scaling (hp/speed/damage) arrives via opts from the RoundManager.
// ---------------------------------------------------------------------------

const ENEMY_NAMES = [
  "RUSTLORD", "MAD MAGGIE", "THE COMPACTOR", "DIESEL KING",
  "SCRAP QUEEN", "GRAVEL GHOST", "PISTON PETE", "WRECKONING",
];

// Player-facing identity per type: display name, one-line tactic, and body
// color. Color = threat grammar: reds/oranges want to TOUCH you, blues/
// purples shoot from range, gold is after your economy.
const ENEMY_INFO = {
  rammer:    { name: "RAMMER",      color: "#c0392b", tip: "Telegraphs, then charges — sidestep and punish" },
  shielded:  { name: "BULLDOZER",   color: "#7d1f12", tip: "Armored plow blocks bullets — hit its sides or rear" },
  splitter:  { name: "HAULER",      color: "#a04000", tip: "Slow and heavy... something's inside" },
  bike:      { name: "SWARMER",     color: "#e67e22", tip: "Fast and fragile — they hunt in packs" },
  circler:   { name: "GUNNER",      color: "#8e44ad", tip: "Orbits and shoots — close in or break its aim" },
  minelayer: { name: "MINELAYER",   color: "#4a69bd", tip: "Seeds mines behind itself — shoot them to clear a path" },
  thief:     { name: "SCRAP THIEF", color: "#b8952e", tip: "It's after your repair piles, not you" },
};

// Sizes double as silhouette language: within the red "contact" family the
// rammer is a standard car, the bulldozer is short + wide, the hauler is the
// biggest thing in the arena, and swarmers are tiny. The thief is lean and
// low; the minelayer is a long flatbed.
const ENEMY_BASE = {
  rammer:    { hull: 110, tuning: { accel: 600, maxSpeed: 355, turnRate: 2.2, grip: 6.5, drag: 0.6 } },
  circler:   { hull: 85,  tuning: { accel: 540, maxSpeed: 335, turnRate: 2.7, grip: 7.2, drag: 0.6 } },
  shielded:  { hull: 150, tuning: { accel: 560, maxSpeed: 325, turnRate: 2.0, grip: 6.5, drag: 0.6, radius: 24, length: 46, width: 34 } },
  thief:     { hull: 70,  tuning: { accel: 620, maxSpeed: 375, turnRate: 2.9, grip: 7.5, drag: 0.6, radius: 19, length: 40, width: 20 } },
  minelayer: { hull: 90,  tuning: { accel: 520, maxSpeed: 320, turnRate: 2.6, grip: 7.0, drag: 0.6, radius: 22, length: 52, width: 24 } },
  splitter:  { hull: 220, tuning: { accel: 430, maxSpeed: 280, turnRate: 1.8, grip: 6.0, drag: 0.6, radius: 28, length: 58, width: 34 } },
  bike:      { hull: 30,  tuning: { accel: 700, maxSpeed: 430, turnRate: 3.4, grip: 6.0, drag: 0.6, radius: 12, length: 26, width: 14 } },
};

class Enemy extends Car {
  // opts: { named, hpScale, speedScale, dmgScale }
  constructor(x, y, type, opts = {}) {
    const named = !!opts.named;
    const base = ENEMY_BASE[type];
    const tuning = { ...base.tuning };
    const speedScale = opts.speedScale ?? 1;
    tuning.accel *= speedScale;
    tuning.maxSpeed *= speedScale;
    if (named) { // named elites hit the gas harder
      tuning.accel *= 1.15;
      tuning.maxSpeed *= 1.1;
      tuning.radius = 26;
      tuning.length = 52;
      tuning.width = 30;
    }
    super(x, y, rand(0, TAU), tuning);

    this.type = type;
    this.named = named;
    this.name = named ? pick(ENEMY_NAMES) : null;
    this.scaleOpts = { // kept so splitters can pass scaling to their bikes
      hpScale: opts.hpScale ?? 1,
      speedScale,
      dmgScale: opts.dmgScale ?? 1,
    };
    this.dmgScale = this.scaleOpts.dmgScale;

    // bosses: 4x health and 4x damage dealt (collisions, bullets, mines)
    this.bossDmgMul = named ? 4 : 1;
    const hpMul = this.scaleOpts.hpScale * (named ? 4 : 1);
    this.maxHull = Math.round(base.hull * hpMul);
    this.hull = this.maxHull;
    this.defineComponents({
      engine: Math.round(60 * hpMul),
      leftWheels: Math.round(45 * hpMul),
      rightWheels: Math.round(45 * hpMul),
    });

    // AI state
    this.state = type === "rammer" || type === "shielded" ? "chase" : "orbit";
    this.stateT = 0;
    this.orbitDir = rand() < 0.5 ? -1 : 1;
    this.fireInterval = named ? 0.55 : 0.9; // relentless cadence — dodging is constant work
    this.fireTimer = rand(0.5, this.fireInterval);
    this.mineTimer = rand(2, 3.5);
    this.crowdT = 0; // how long the player has been shadowing us up close
    // wall-wedge recovery (cars can't steer at zero speed, so back out)
    this.stuckT = 0;
    this.unstickT = 0;
    // visual action-cue state
    this.shieldFlash = 0;        // bulldozer: lights up when the plow deflects a shot
    this.eating = false;         // scrap thief: prongs glow while munching a pile
    this.gunAngle = this.heading; // gunner: turret barrel tracks its last shot
  }

  setState(s) { this.state = s; this.stateT = 0; }

  nearWall() {
    const m = WORLD.wall + this.radius + 40;
    return this.x < m || this.x > WORLD.w - m || this.y < m || this.y > WORLD.h - m;
  }

  // Project our position ~0.55s ahead; if it lands in the wall danger zone,
  // blend steering toward the arena interior (harder the deeper it lands)
  // and brake when we're nosing straight in, so the turn can actually bite.
  applyWallAvoidance(throttle, steer) {
    const look = 0.55;
    const margin = WORLD.wall + 70;
    const fx = this.x + this.vx * look;
    const fy = this.y + this.vy * look;
    let ax = 0, ay = 0, pen = 0;
    if (fx < margin)           { const q = (margin - fx) / margin;             ax += q; pen = Math.max(pen, q); }
    if (fx > WORLD.w - margin) { const q = (fx - (WORLD.w - margin)) / margin; ax -= q; pen = Math.max(pen, q); }
    if (fy < margin)           { const q = (margin - fy) / margin;             ay += q; pen = Math.max(pen, q); }
    if (fy > WORLD.h - margin) { const q = (fy - (WORLD.h - margin)) / margin; ay -= q; pen = Math.max(pen, q); }
    if (pen <= 0) return [throttle, steer];
    pen = Math.min(pen, 1);
    const err = angleDiff(Math.atan2(ay, ax), this.heading);
    const w = Math.min(0.85, pen * 1.6);
    steer = steer * (1 - w) + clamp(err * 2.5, -1, 1) * w;
    const f = this.forward;
    // NOTE: keep this above the stuck-detector's 0.2 throttle threshold —
    // if avoidance braking can't trigger the reverse-out, enemies crawl
    // along walls with no recovery path (tested: contact time doubles)
    if (pen > 0.45 && f.x * ax + f.y * ay < -0.3) throttle = Math.min(throttle, 0.25);
    return [throttle, steer];
  }

  // Simplified damage: everything chips the hull; side hits also chew that
  // side's wheels, frontal/rear hits sometimes crack the engine.
  applyDamage(side, amount, game) {
    this.hull -= amount;
    if (side === "left" || side === "right") {
      this.damageComponent(side === "left" ? "leftWheels" : "rightWheels", amount * 0.8);
    } else if (rand() < 0.35) {
      this.damageComponent("engine", amount * 0.7);
    }
    if (this.hull <= 0) this.dead = true;
  }

  update(dt, game) {
    const p = game.player;
    this.stateT += dt;
    const toP = Math.atan2(p.y - this.y, p.x - this.x);
    const d = dist(this.x, this.y, p.x, p.y);
    const aim = angleDiff(toP, this.heading);

    let throttle = 0, steer = 0, hb = false;
    switch (this.type) {
      case "rammer":
      case "shielded":  [throttle, steer, hb] = this.aiRam(dt, game, d, aim); break;
      case "circler":   [throttle, steer] = this.aiCircle(dt, game, p, d, aim, toP); break;
      case "thief":     [throttle, steer] = this.aiThief(dt, game, toP); break;
      case "minelayer": [throttle, steer] = this.aiMinelayer(dt, game, p, d, toP); break;
      // pursuers ease off the gas when the target is behind them — slowing
      // tightens the turn radius, so they come around instead of orbiting.
      // The extra close-range brake matters vs a STATIONARY player: at full
      // throttle their turning circle never intersects the target and they
      // moth-orbit forever; braking spirals the loop inward until they connect.
      case "splitter": {
        const align = Math.abs(aim);
        let thr = align > 1 ? 0.5 : 0.85;
        if (d < 200 && align > 0.45) thr = 0.3;
        [throttle, steer] = [thr, clamp(aim * 1.8, -1, 1)];
        break;
      }
      case "bike": {
        const align = Math.abs(aim);
        let thr = align > 1.2 ? 0.6 : 1;
        if (d < 170 && align > 0.4) thr = 0.35;
        [throttle, steer] = [thr, clamp(aim * 3, -1, 1)];
        hb = align > 1.5; // bikes handbrake-whip their tight turns
        break;
      }
    }

    // look-ahead wall avoidance: steer away BEFORE hitting the wall, instead
    // of only recovering after a wedge. Skipped mid-ram — charges stay
    // committed, so baiting a rammer into the wall remains real counterplay.
    if (this.state !== "ram" && this.unstickT <= 0) {
      [throttle, steer] = this.applyWallAvoidance(throttle, steer);
    }

    // stuck against a wall while trying to move? reverse out — steering has no
    // authority at zero speed, so driving forward harder can never recover
    if (this.unstickT > 0) {
      this.unstickT -= dt;
      throttle = -0.8;
      steer = -clamp(aim * 2, -1, 1); // reversing flips steering: swings the nose toward the player
      hb = false;
    } else if (this.speed < 28 && throttle > 0.2 && !this.stalled && this.nearWall()) {
      // only near a wall — deliberate slow maneuvering mid-arena (brake-to-
      // connect, tight turns) must not trigger phantom reverse-outs
      this.stuckT += dt;
      if (this.stuckT > 0.7) { this.unstickT = 0.9; this.stuckT = 0; }
    } else {
      this.stuckT = 0;
    }

    this.integrate(dt, throttle, steer, hb);
    if (this.shieldFlash > 0) this.shieldFlash -= dt;

    // battered enemies trail smoke
    if (this.hull < this.maxHull * 0.35 && Math.random() < dt * 8) {
      game.particles.smoke(this.x, this.y);
    }
  }

  // -- archetype brains ---------------------------------------------------------

  aiRam(dt, game, d, aim) {
    const heavy = this.type === "shielded"; // slower wind-up, harder hit
    const p = game.player;
    let throttle = 0, steer = 0, hb = false;
    switch (this.state) {
      case "chase": {
        // curve the approach toward the player's weakest side — hits there
        // spill into inner components at a damage bonus
        let steerErr = aim;
        const side = this.weakestPlayerSide(p);
        if (side !== null && d > 120) {
          const ang = p.heading + side;
          const tx = p.x + Math.cos(ang) * 70;
          const ty = p.y + Math.sin(ang) * 70;
          steerErr = angleDiff(Math.atan2(ty - this.y, tx - this.x), this.heading);
        }
        steer = clamp(steerErr * 2.2, -1, 1);
        // brake to turn: full throttle with the player behind us just widens
        // the turn circle into a permanent stalemate orbit
        throttle = Math.abs(steerErr) > 1 ? 0.45 : 0.85;
        // a player parked on a scrap pile invites a longer-range punish charge
        const range = game.playerRepairing ? 480 : 310;
        const aimGate = game.playerRepairing ? 0.6 : 0.4;
        // pack stagger: never wind up while a packmate is already telegraphing,
        // so consecutive rams arrive while the player is still mid-dodge
        const packWinding = game.enemies.some((o) =>
          o !== this && !o.dead && (o.type === "rammer" || o.type === "shielded") && o.state === "telegraph");
        if (d < range && Math.abs(aim) < aimGate && !packWinding) {
          this.setState("telegraph");
          game.audio.playRev();
        }
        break;
      }
      case "telegraph": // the warning flash before the charge
        steer = clamp(aim * 1.6, -1, 1);
        throttle = -0.25;
        if (this.stateT >= (this.named ? 0.4 : heavy ? 0.65 : 0.55)) {
          this.setState("ram");
          this.boost = heavy ? 2.0 : 2.2;
        }
        break;
      case "ram": // full send; weak tracking so the player can dodge
        steer = clamp(aim * 0.7, -1, 1);
        throttle = 1;
        if (this.stateT >= (this.named ? 1.15 : 0.95)) {
          this.boost = 1;
          this.setState("recover");
        }
        break;
      case "recover": // handbrake-whip the nose back around instead of coasting
        steer = clamp(aim * 2, -1, 1);
        throttle = 0.5;
        hb = Math.abs(aim) > 1;
        if (this.stateT >= (this.named ? 0.5 : 0.9)) this.setState("chase");
        break;
    }
    this.telegraph = this.state === "telegraph" ? 1 : 0;
    return [throttle, steer, hb];
  }

  // which side of the player's car is most broken? Returns the side's angle
  // relative to the player's heading, or null when nothing is damaged.
  weakestPlayerSide(p) {
    const sides = [
      { off: 0, k: "frontBumper" },
      { off: Math.PI, k: "rearBumper" },
      { off: -Math.PI / 2, k: "leftWheels" },
      { off: Math.PI / 2, k: "rightWheels" },
    ];
    let best = null, bestR = 0.999;
    for (const s of sides) {
      const r = p.compRatio(s.k);
      if (r < bestR) { bestR = r; best = s.off; }
    }
    return best;
  }

  aiCircle(dt, game, p, d, aim, toP) {
    let throttle = 0, steer = 0;
    if (this.state === "flee") {
      steer = clamp(angleDiff(toP + Math.PI, this.heading) * 2.2, -1, 1);
      throttle = 1;
      if (this.stateT > 1.3 || d > 320) this.setState("orbit");
    } else {
      // steer toward a point a little ahead of us on a ring around the player,
      // clamped into the arena so wall-side orbits don't aim into the wall
      const ring = 270;
      const cur = Math.atan2(this.y - p.y, this.x - p.x);
      const tang = cur + this.orbitDir * 0.55;
      const m = WORLD.wall + 70;
      const tx = clamp(p.x + Math.cos(tang) * ring, m, WORLD.w - m);
      const ty = clamp(p.y + Math.sin(tang) * ring, m, WORLD.h - m);
      steer = clamp(angleDiff(Math.atan2(ty - this.y, tx - this.x), this.heading) * 2.4, -1, 1);
      throttle = 0.75;

      // break off on projected collision course (time-to-contact), not a fixed
      // radius — bolts early from a fast approach, holds ground against a slow
      // one. The crowding timer breaks stable shadow-orbits: a player parked
      // 150px away in a matched circle has zero closing speed but must not be
      // tolerated forever.
      this.crowdT = d < 190 ? this.crowdT + dt : Math.max(0, this.crowdT - dt * 2);
      const dirx = (this.x - p.x) / d, diry = (this.y - p.y) / d;
      const closing = (p.vx - this.vx) * dirx + (p.vy - this.vy) * diry;
      if (d < 90 || (closing > 40 && d / closing < 0.9) || this.crowdT > 1.2) {
        this.setState("flee");
        this.orbitDir *= -1;
        this.crowdT = 0;
      }

      // periodic projectile — fast shells, fired with real lead
      this.fireTimer -= dt;
      if (game.playerRepairing) this.fireTimer = Math.min(this.fireTimer, 0.25); // punish parked repairs
      if (this.fireTimer <= 0 && d > 170 && d < 520) {
        // don't waste shots on a target crossing fast at long range
        const perpSpeed = Math.abs(p.vx * diry - p.vy * dirx);
        if (d > 420 && perpSpeed > 380) {
          this.fireTimer = 0.25; // re-check shortly instead of firing a guaranteed miss
        } else {
          this.fireTimer = this.fireInterval * rand(0.85, 1.15);
          const bulletSpeed = 500; // near player-shell speed: react, don't outrun
          // denial shot: if the player is clearly driving at a scrap pile,
          // put the shell on the pile they're about to repair at
          let tx2 = null, ty2 = null;
          const ps = p.speed;
          if (ps > 120) {
            const nvx = p.vx / ps, nvy = p.vy / ps;
            for (const sc of game.scrap) {
              if (sc.dead) continue;
              const dx = sc.x - p.x, dy = sc.y - p.y;
              const pd = Math.hypot(dx, dy);
              if (pd < 40 || pd > 350) continue;
              if ((dx / pd) * nvx + (dy / pd) * nvy > 0.92) { tx2 = sc.x; ty2 = sc.y; break; }
            }
          }
          if (tx2 === null) {
            // acceleration-aware lead. Only the ALONG-TRACK component of the
            // player's smoothed acceleration is used — speed changes (braking,
            // throttle) are bounded and predictable: speed can't drop below 0
            // or exceed max, so a hard brake predicts a shot landing exactly
            // where the slide dies. Perpendicular acceleration (turning) is a
            // coin flip over a 1-2s shell flight, so it's ignored entirely.
            // The speed trend is trusted for `tau`s, then held; flight time
            // is refined once.
            const tau = 0.5, lead = 0.92;
            let t = d / bulletSpeed;
            const ps = p.speed;
            for (let pass = 0; pass < 2; pass++) {
              if (ps > 20) {
                const dvx = p.vx / ps, dvy = p.vy / ps;
                const aAlong = (p.smoothAx ?? 0) * dvx + (p.smoothAy ?? 0) * dvy;
                const ta = Math.min(t, tau);
                let s1 = ps + aAlong * ta, travelWindow;
                if (s1 <= 0) { // braking to a stop inside the window
                  travelWindow = (ps * ps) / (2 * Math.max(1, -aAlong));
                  s1 = 0;
                } else {
                  if (s1 > p.maxSpeed) s1 = p.maxSpeed;
                  travelWindow = ((ps + s1) / 2) * ta;
                }
                // beyond the window the current maneuver has likely ended:
                // expect speed to regress toward the player's usual pace
                const rest = 0.5 * s1 + 0.5 * (p.smoothSpeed ?? ps);
                const travel = travelWindow + rest * (t - ta);
                tx2 = p.x + dvx * travel * lead;
                ty2 = p.y + dvy * travel * lead;
              } else { // near-stationary: plain lead
                tx2 = p.x + p.vx * t * lead;
                ty2 = p.y + p.vy * t * lead;
              }
              t = dist(this.x, this.y, tx2, ty2) / bulletSpeed;
            }
          }
          const ang = Math.atan2(ty2 - this.y, tx2 - this.x);
          this.gunAngle = ang; // turret barrel visibly tracks the shot
          game.bullets.push(new Bullet(
            this.x + Math.cos(ang) * 24, this.y + Math.sin(ang) * 24,
            ang, bulletSpeed, false, 16 * this.dmgScale * this.bossDmgMul
          ));
          game.audio.playEnemyShoot();
          game.particles.sparks(this.x, this.y, ang, 3, 90);
        }
      }
    }
    return [throttle, steer];
  }

  // scrap thief: drives pile to pile and eats the repair economy;
  // once the arena is picked clean it just runs from you
  aiThief(dt, game, toP) {
    let best = null, bd = 1e9;
    for (const s of game.scrap) {
      if (s.dead) continue;
      const ds = dist(this.x, this.y, s.x, s.y);
      if (ds < bd) { bd = ds; best = s; }
    }
    if (!best) { // nothing left to steal: flee
      this.eating = false;
      return [1, clamp(angleDiff(toP + Math.PI, this.heading) * 2.2, -1, 1)];
    }
    if (bd < best.radius + this.radius * 0.6) { // on the pile: stop and munch
      this.eating = true;
      best.amount -= 25 * dt;
      if (best.amount <= 0) best.dead = true;
      if (Math.random() < dt * 10) game.particles.scrapPuff(best.x, best.y);
      // actively kill momentum so it doesn't coast straight off the pile
      return [this.speed > 40 ? -0.5 : 0, 0];
    }
    this.eating = false;
    const ang = Math.atan2(best.y - this.y, best.x - this.x);
    const aimErr = angleDiff(ang, this.heading);
    // arrival slowdown: at full speed the turn radius is ~4x the pile's
    // capture window, which produced endless figure-eight overshoots
    let thr;
    if (bd < 170) thr = Math.abs(aimErr) > 0.5 ? 0.2 : Math.max(0.3, Math.min(0.75, bd / 220));
    else thr = Math.abs(aimErr) > 1 ? 0.45 : 0.9;
    return [thr, clamp(aimErr * 2.6, -1, 1)];
  }

  // minelayer: hangs back on a wide ring and seeds mines behind itself
  aiMinelayer(dt, game, p, d, toP) {
    let throttle, steer;
    if (d < 240) { // too close: bolt
      steer = clamp(angleDiff(toP + Math.PI, this.heading) * 2.2, -1, 1);
      throttle = 1;
    } else {
      const ring = 340;
      const cur = Math.atan2(this.y - p.y, this.x - p.x);
      const tang = cur + this.orbitDir * 0.5;
      const m = WORLD.wall + 70;
      const tx = clamp(p.x + Math.cos(tang) * ring, m, WORLD.w - m);
      const ty = clamp(p.y + Math.sin(tang) * ring, m, WORLD.h - m);
      steer = clamp(angleDiff(Math.atan2(ty - this.y, tx - this.x), this.heading) * 2.2, -1, 1);
      throttle = 0.7;
    }
    this.mineTimer -= dt;
    const myMines = game.mines.reduce((n, m) => n + (m.owner === this.id ? 1 : 0), 0);
    if (this.mineTimer <= 0 && myMines < 6 && d > 200) {
      this.mineTimer = 4;
      game.mines.push({
        x: this.x, y: this.y, owner: this.id,
        arm: 1.0,                       // grace period before it goes live
        dmg: 30 * this.dmgScale * this.bossDmgMul,
        dead: false,
      });
      game.particles.scrapPuff(this.x, this.y);
    }
    return [throttle, steer];
  }
}
