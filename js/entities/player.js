"use strict";
// ---------------------------------------------------------------------------
// The player's car: all six destructible components + a forward cannon.
// ---------------------------------------------------------------------------

// Single source of truth for the player's component set (UI reads this too).
const PLAYER_COMPONENTS = {
  frontBumper: { label: "Front Bumper", short: "FB", max: 90 },
  rearBumper:  { label: "Rear Bumper",  short: "RB", max: 90 },
  leftWheels:  { label: "Left Wheels",  short: "LW", max: 80 },
  rightWheels: { label: "Right Wheels", short: "RW", max: 80 },
  engine:      { label: "Engine",       short: "EN", max: 110 },
  weapon:      { label: "Weapon Mount", short: "WP", max: 70 },
};

class Player extends Car {
  constructor(x, y) {
    super(x, y, -Math.PI / 2, { accel: 680, maxSpeed: 400, turnRate: 2.9, grip: 7, drag: 0.6 });
    const defs = {};
    for (const k in PLAYER_COMPONENTS) defs[k] = PLAYER_COMPONENTS[k].max;
    this.defineComponents(defs);
    this.fireCooldown = 0;
    // upgrade state
    this.patchCharge = false;    // Emergency Patch: one save per round
    this.turretCooldown = 0;     // Auto-Turret
    this.turretAngle = this.heading;
    // smoothed acceleration + typical-speed estimates — enemy gunners read
    // these to lead shots through drifts and braking (see circler aim)
    this.smoothAx = 0;
    this.smoothAy = 0;
    this.smoothSpeed = 0; // long-window average speed ("how fast do they usually go")
    this._prevVx = 0;
    this._prevVy = 0;
  }

  // Reinforced Plating: raise every component's ceiling, keeping current damage
  applyPlating(tier) {
    for (const k in PLAYER_COMPONENTS) {
      const c = this.components[k];
      const newMax = Math.round(PLAYER_COMPONENTS[k].max * (1 + 0.25 * tier));
      c.hp = Math.min(newMax, c.hp + Math.max(0, newMax - c.max));
      c.max = newMax;
    }
  }

  // "Car is dead" condition: every single component wrecked.
  get destroyed() {
    for (const k in this.components) if (this.components[k].hp > 0) return false;
    return true;
  }

  // Damage routing:
  //   front hit -> front bumper; once it's gone, spills into the ENGINE at 1.5x
  //   rear hit  -> rear bumper;  once it's gone, spills into the WEAPON at 1.5x
  //   side hit  -> that side's wheels; once gone, spills into the engine
  //   spill target already dead -> random surviving component,
  //   so the car can always (eventually) be killed.
  applyDamage(side, amount, game) {
    amount *= 1.5; // glass-cannon tuning: every hit on the player matters
    const routes = {
      front: ["frontBumper", "engine"],
      rear:  ["rearBumper", "weapon"],
      left:  ["leftWheels", "engine"],
      right: ["rightWheels", "engine"],
    };
    const up = (game && game.upgrades) || {};
    const [primary, secondary] = routes[side];

    // Bumper bleed-through (gradual): a damaged-but-alive front/rear bumper
    // lets a growing fraction of the hit pass through to the inner part
    // (engine/weapon), scaling up to the full spill when it finally breaks.
    if ((side === "front" || side === "rear") && this.compAlive(primary)) {
      const bleed = this.damageFactor(primary); // 0 at ≥50% bumper health → ~1 near broken
      if (bleed > 0 && this.compAlive(secondary)) {
        this.damageComponent(secondary, amount * bleed * (up.crashFrame ? 1.1 : 1.5));
        amount *= (1 - bleed); // the rest still soaks into the bumper
      }
    }

    let target = primary, amt = amount;
    if (!this.compAlive(primary)) { // nothing left on that side to absorb the hit
      target = secondary;
      amt = amount * (up.crashFrame ? 1.1 : 1.5);
    }
    if (!this.compAlive(target)) {
      const alive = Object.keys(this.components).filter((k) => this.compAlive(k));
      if (!alive.length) return; // already fully wrecked
      target = pick(alive);
    }
    // Rally Tires: wheels shrug off part of the hit
    if (up.rallyTires && (target === "leftWheels" || target === "rightWheels")) amt *= 0.7;
    // Emergency Patch: once per round, a fatal hit leaves the part at 25%
    const c = this.components[target];
    if (this.patchCharge && c.hp > 0 && c.hp - amt <= 0) {
      this.patchCharge = false;
      c.hp = c.max * 0.25;
      this.compFlash[target] = 0.5;
      if (game) {
        game.ui.addBanner("EMERGENCY PATCH!", PLAYER_COMPONENTS[target].label + " saved at 25%");
        game.audio.playRepair();
      }
      return;
    }
    this.damageComponent(target, amt);
  }

  update(dt, input, game) {
    // shared keyboard/joystick → car controls (see readDrive in input.js)
    const d = readDrive(input, this.heading);
    this.integrate(dt, d.throttle, d.steer, d.handbrake);

    // exponential smoothing (~0.15s time constant) so one-frame spikes from
    // collisions/knockback don't whip the enemies' aim around
    const blend = Math.min(1, dt / 0.15);
    this.smoothAx += ((this.vx - this._prevVx) / dt - this.smoothAx) * blend;
    this.smoothAy += ((this.vy - this._prevVy) / dt - this.smoothAy) * blend;
    this._prevVx = this.vx;
    this._prevVy = this.vy;
    // slow average (~1.5s) of speed: the gunner's guess for "after this
    // maneuver ends, how fast will they be going"
    this.smoothSpeed += (this.speed - this.smoothSpeed) * Math.min(1, dt / 1.5);

    // cannon: forward-firing, disabled when the weapon mount is destroyed.
    // Gradual damage (below 50% mount health) stretches the reload — the gun
    // jams/cycles slowly, up to ~6.7x at the brink, then can't fire at broken.
    const up = game.upgrades;
    this.fireCooldown -= dt;
    if (input.fire && this.fireCooldown <= 0 && this.compAlive("weapon")) {
      const base = 0.32 / (1 + 0.35 * (up.rapidLoader || 0));
      this.fireCooldown = base / Math.max(0.15, 1 - this.damageFactor("weapon"));
      const dmg = 26 * (1 + 0.5 * (up.heavyRounds || 0));
      const f = this.forward;
      const r = { x: -f.y, y: f.x };
      const nose = this.length / 2 + 6;
      const muzzles = up.twinCannons ? [-6, 6] : [0]; // twin: two parallel barrels
      for (const o of muzzles) {
        const bx = this.x + f.x * nose + r.x * o;
        const by = this.y + f.y * nose + r.y * o;
        game.bullets.push(new Bullet(bx, by, this.heading, 560, true, dmg));
        game.particles.sparks(bx, by, this.heading, 3, 140);
      }
      if (up.rearBlaster) { // tail gun fires the opposite way
        const tx = this.x - f.x * nose, ty = this.y - f.y * nose;
        game.bullets.push(new Bullet(tx, ty, this.heading + Math.PI, 560, true, dmg * 0.7));
        game.particles.sparks(tx, ty, this.heading + Math.PI, 3, 140);
      }
      this.vx -= f.x * 22; // recoil nudge
      this.vy -= f.y * 22;
      game.audio.playShoot();
      game.addTrauma(0.06);
    }

    // Auto-Turret: independent of the main weapon mount, slow but hands-free
    if (up.turret) {
      this.turretCooldown -= dt;
      if (this.turretCooldown <= 0) {
        let best = null, bd = 460;
        for (const e of game.enemies) {
          if (e.dead) continue;
          const d = dist(this.x, this.y, e.x, e.y);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) {
          this.turretCooldown = 1.5;
          const bs = 400, t = bd / bs;
          const ang = Math.atan2(best.y + best.vy * t * 0.5 - this.y, best.x + best.vx * t * 0.5 - this.x);
          this.turretAngle = ang;
          const b = new Bullet(this.x + Math.cos(ang) * 14, this.y + Math.sin(ang) * 14, ang, bs, true, 10);
          b.radius = 3;
          game.bullets.push(b);
          game.audio.playTurret();
        }
      }
    }
  }
}
