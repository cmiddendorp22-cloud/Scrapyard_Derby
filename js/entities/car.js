"use strict";
// ---------------------------------------------------------------------------
// Base Car: drift-momentum physics + the destructible-component model shared
// by the player and enemies.
//
// Physics model: velocity is split into forward and lateral parts each frame.
// Lateral velocity is damped hard by `grip`, forward velocity only by `drag`.
// That asymmetry is what makes the car slide through turns instead of
// pivoting like a twin-stick ship. Lose wheels -> lose grip -> more slide,
// plus a constant steering pull toward the dead side.
// ---------------------------------------------------------------------------

class Car {
  constructor(x, y, heading, opts = {}) {
    this.id = Car._nextId++;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.heading = heading;

    // collision + drawing dimensions
    this.radius = opts.radius ?? 21;
    this.length = opts.length ?? 44;
    this.width = opts.width ?? 26;

    // physics tuning (px, seconds, radians)
    this.engineAccel = opts.accel ?? 640;
    this.maxSpeed = opts.maxSpeed ?? 380;
    this.turnRate = opts.turnRate ?? 2.6;
    this.grip = opts.grip ?? 7.5;   // lateral friction; lower = driftier
    this.drag = opts.drag ?? 0.55;  // rolling resistance
    this.boost = 1;                 // temporary accel/speed multiplier (rammer charge)
    this.wheelPullMul = 1;          // dead-wheel pull strength (Rally Tires halves it)
    this.handbrakeBoost = 1.3;      // handbrake steering multiplier (Drift Master raises it)

    // component damage model — subclasses call defineComponents()
    this.components = {};
    this.compFlash = {};            // key -> seconds left of UI damage-blink
    this.onComponentDestroyed = null; // (car, key) hook, wired up by Game

    // engine-failure stalls (active once the engine component hits 0)
    this.stalled = false;
    this.stallTimer = 0;
    this.nextStallIn = rand(3, 6);

    this.telegraph = 0;      // >0 while an enemy is winding up (drawn as a flash)
    this.lateralSpeed = 0;   // |sideways velocity|, used for skid marks
    this.limpPhase = 0;      // fishtail phase when ALL wheels are gone
    this.dead = false;
  }

  // -- component helpers ------------------------------------------------------

  defineComponents(defs) { // defs: { key: maxHp }
    for (const k in defs) this.components[k] = { hp: defs[k], max: defs[k] };
  }

  compAlive(k) { const c = this.components[k]; return !!c && c.hp > 0; }
  compRatio(k) { const c = this.components[k]; return c ? c.hp / c.max : 0; }

  // Gradual-damage effect factor for a part: 0 while it still has ≥50% health,
  // then eases in (t^2, so mild at first and steepening as it nears failure)
  // to 1 when broken. Every per-part penalty (wheel veer, engine sputter,
  // weapon slow-fire, bumper bleed-through) scales by this, landing exactly on
  // the old fully-broken value at hp 0 — no discontinuous jump.
  damageFactor(k) {
    const c = this.components[k];
    if (!c) return 0;
    const t = clamp((0.5 - c.hp / c.max) / 0.5, 0, 1);
    return t * t;
  }

  damageComponent(k, amt) {
    const c = this.components[k];
    if (!c || c.hp <= 0) return false;
    c.hp = Math.max(0, c.hp - amt);
    this.compFlash[k] = 0.35;
    if (c.hp <= 0) {
      if (this.onComponentDestroyed) this.onComponentDestroyed(this, k);
      return true; // destroyed just now
    }
    return false;
  }

  repairComponent(k, amt) {
    const c = this.components[k];
    if (!c) return 0;
    const before = c.hp;
    c.hp = Math.min(c.max, c.hp + amt);
    return c.hp - before;
  }

  // Which side of the car does a world-space contact point hit?
  impactSide(px, py) {
    const a = angleDiff(Math.atan2(py - this.y, px - this.x), this.heading);
    if (Math.abs(a) < Math.PI / 4) return "front";
    if (Math.abs(a) > (3 * Math.PI) / 4) return "rear";
    return a < 0 ? "left" : "right";
  }

  // Subclasses decide how side-damage maps onto their components.
  applyDamage(side, amount, game) {}

  get speed() { return Math.hypot(this.vx, this.vy); }
  get forward() { return { x: Math.cos(this.heading), y: Math.sin(this.heading) }; }

  // -- core physics step. throttle/steer in [-1, 1]. --------------------------

  integrate(dt, throttle, steer, handbrake = false) {
    const fwd = this.forward;
    const right = { x: -fwd.y, y: fwd.x }; // driver's right in screen space
    const fSpeed = this.vx * fwd.x + this.vy * fwd.y;
    const speedRatio = clamp(Math.abs(fSpeed) / this.maxSpeed, 0, 1);

    // engine damage (gradual): below 50% health the engine SPUTTERS — brief
    // power cutouts that grow more frequent (shorter gaps) and longer as it
    // worsens, becoming the full periodic stalls when the engine is broken.
    if (this.components.engine) {
      const dE = this.damageFactor("engine");
      if (dE > 0) {
        if (this.stalled) {
          this.stallTimer -= dt;
          if (this.stallTimer <= 0) { this.stalled = false; this.nextStallIn = rand(3.5, 6.5) / dE; }
        } else {
          this.nextStallIn -= dt;
          if (this.nextStallIn <= 0) { this.stalled = true; this.stallTimer = rand(0.8, 1.5) * dE; }
        }
      } else {
        this.stalled = false;
      }
    }

    // wheel damage (gradual): each side's penalty eases in from 50% health.
    // Asymmetric damage veers toward the WORSE side (ramps to ±0.55 at broken);
    // grip + accel degrade with the average damage; when BOTH sides are failing
    // a bare-axle fishtail and speed cap fade in (full at both-broken). Equal
    // damage on both sides cancels the veer (just grip loss) — physically fine.
    let steerBias = 0, gripMul = 1, wheelAccelMul = 1, wheelSpeedCap = 1;
    if (this.components.leftWheels) {
      const dL = this.damageFactor("leftWheels");
      const dR = this.damageFactor("rightWheels");
      const avg = (dL + dR) / 2;
      // fishtail reaches FULL once BOTH sides are at/below 20% health (not only
      // when broken at 0%), so both-wheels-badly-hurt is catastrophic before
      // they break outright. Eased (steep near 20%) to match the damage curve.
      const fishL = clamp((0.5 - this.compRatio("leftWheels")) / 0.3, 0, 1);
      const fishR = clamp((0.5 - this.compRatio("rightWheels")) / 0.3, 0, 1);
      const fishRaw = Math.min(fishL, fishR);
      const fish = fishRaw * fishRaw; // both sides must be failing to fishtail
      steerBias = (dR - dL) * 0.55 * this.wheelPullMul; // veer toward the worse side
      if (fish > 0) {
        this.limpPhase += dt * 4.5;
        steerBias += (Math.sin(this.limpPhase) + Math.sin(this.limpPhase * 2.3 + 1) * 0.5)
                     * fish * this.wheelPullMul;
      }
      gripMul = 1 - 0.8 * avg;        // one side broken → 0.6, both → 0.2
      wheelAccelMul = 1 - 0.65 * avg; // one side broken → 0.675, both → 0.35
      wheelSpeedCap = 1 - 0.5 * fish; // both broken → 0.5 (grinds on axles)
    }

    // steering: you need rolling speed to turn, and turning softens at top
    // speed; steering inverts while reversing, like a real car
    const steerInput = clamp(steer + steerBias * clamp(speedRatio * 1.5, 0, 1), -1.5, 1.5);
    let steerPower = clamp(Math.abs(fSpeed) / (this.maxSpeed * 0.28), 0, 1) * (1 - 0.2 * speedRatio);
    if (handbrake) steerPower *= this.handbrakeBoost; // handbrake sharpens rotation so you can whip the nose around
    this.heading += steerInput * this.turnRate * steerPower * (fSpeed < 0 ? -1 : 1) * dt;

    // throttle (reverse is weaker)
    if (!this.stalled && throttle !== 0) {
      const eff = this.engineAccel * this.boost * wheelAccelMul * (throttle > 0 ? throttle : throttle * 0.55);
      this.vx += fwd.x * eff * dt;
      this.vy += fwd.y * eff * dt;
    }

    // asymmetric friction: this is the drift.
    // Grip fades when cornering hard at speed (weight transfer), so committed
    // turns make the back end step out; the handbrake craters grip entirely.
    const nf = this.forward; // heading changed above
    const nr = { x: -nf.y, y: nf.x };
    let f = this.vx * nf.x + this.vy * nf.y;
    let l = this.vx * nr.x + this.vy * nr.y;
    f *= 1 / (1 + this.drag * dt);
    if (handbrake) f *= 1 / (1 + 2.2 * dt); // locked wheels scrub speed
    let cornerGrip = 1 - 0.7 * Math.min(1, Math.abs(steerInput)) * speedRatio;
    if (handbrake) cornerGrip *= 0.25;
    l *= 1 / (1 + this.grip * gripMul * cornerGrip * dt);
    f = clamp(f, -this.maxSpeed * 0.5, this.maxSpeed * this.boost * wheelSpeedCap);
    this.vx = nf.x * f + nr.x * l;
    this.vy = nf.y * f + nr.y * l;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.lateralSpeed = Math.abs(l);

    // tick down UI damage-blink timers
    for (const k in this.compFlash) if (this.compFlash[k] > 0) this.compFlash[k] -= dt;
  }
}

Car._nextId = 1;
