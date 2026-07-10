"use strict";
// ---------------------------------------------------------------------------
// Scrapyard Arena central boss: the JUNK TITAN (BACKLOG-ARENA item 6). A huge,
// slow tank parked on the map's central scrap cluster — the "gravity well" that
// pulls everyone toward the middle. It's the showcase of the mode's signature
// pillar: you don't chip one HP bar, you TEAR OFF its armor plates (each drops
// a lootable weapon and exposes the core beneath). Break a plate, shoot through
// the gap to the core; kill the core for a big XP payout + a scrap piñata.
//
// Damage RESOLUTION + rewards live on ArenaGame (hurtBoss/killBoss) so the boss
// can reuse the FFA loot/attribution plumbing; this file owns geometry + AI.
// ---------------------------------------------------------------------------

const BOSS_RESPAWN = 22;          // seconds before a wrecked Titan returns
const BOSS_SLAM_R = 330;          // ground-slam shockwave radius
const BOSS_ENGAGE = 300;          // starts slamming when a car is this close

class ArenaBoss {
  constructor(x, y) {
    this.kind = "titan";          // boss dispatch tag (vs the roaming "magnet")
    this.name = "JUNK TITAN";
    this.tagline = "tear off its plates";
    this.killXp = 400;            // XP paid to whoever lands the core kill
    this.x = x;
    this.y = y;
    this.heading = rand(0, TAU);
    this.vx = 0;
    this.vy = 0;
    this.radius = 74;             // big — a landmark you can see coming
    this.maxSpeed = 70;           // a menacing crawl
    this.accel = 260;
    this.dead = false;
    this.hitFlash = 0;
    this.fireTimer = 2.4;
    this.slamTimer = 4;           // cooldown to the next slam attempt
    this.slamWind = 0;            // >0 during the wind-up telegraph
    this.ringTimer = rand(6, 10); // cooldown to the next SHRAPNEL RING (user: more attacks)
    this.ringWind = 0;            // >0 during the ring spin-up telegraph
    this.lastHitBy = null;        // kill attribution (who lands the core kill)
    // 4 armor plates around a core. Plate angles are LOCAL (relative to
    // heading); break the one facing you to shoot the core through the gap.
    this.plates = [
      { key: "front", ang: 0,            hp: 350, max: 350, dead: false, hit: 0 },
      { key: "right", ang: Math.PI / 2,  hp: 350, max: 350, dead: false, hit: 0 },
      { key: "back",  ang: Math.PI,      hp: 350, max: 350, dead: false, hit: 0 },
      { key: "left",  ang: -Math.PI / 2, hp: 350, max: 350, dead: false, hit: 0 },
    ];
    this.coreHp = 700;
    this.coreMax = 700;
  }

  // total remaining toughness (for the HP ring the renderer draws)
  hpFrac() {
    let hp = this.coreHp, max = this.coreMax;
    for (const p of this.plates) { hp += Math.max(0, p.hp); max += p.max; }
    return clamp(hp / max, 0, 1);
  }

  update(dt, game) {
    if (this.dead) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    for (const p of this.plates) if (p.hit > 0) p.hit -= dt;

    // nearest living car is the Titan's focus (player or a bot — FFA)
    let target = null, bd = 1e9;
    for (const c of game.cars()) {
      if (game.isDeadCar(c)) continue;
      const d = dist(this.x, this.y, c.x, c.y);
      if (d < bd) { bd = d; target = c; }
    }

    if (this.slamWind > 0) {
      // winding up: freeze and shudder, then unleash the shockwave
      this.slamWind -= dt;
      this.vx *= 0.82; this.vy *= 0.82;
      if (this.slamWind <= 0) game.bossSlam();
    } else {
      this.slamTimer -= dt;
      if (target && bd < BOSS_ENGAGE && this.slamTimer <= 0) {
        this.slamWind = 0.9;      // telegraph window
        this.slamTimer = 5.0;
        if (game.audio.playRev) game.audio.playRev();
      }
      // crawl toward the target (slowly turn + accelerate)
      if (target) {
        const desired = Math.atan2(target.y - this.y, target.x - this.x);
        this.heading += clamp(angleDiff(desired, this.heading), -1, 1) * 1.3 * dt;
        const sp = Math.hypot(this.vx, this.vy);
        if (sp < this.maxSpeed) {
          this.vx += Math.cos(this.heading) * this.accel * dt;
          this.vy += Math.sin(this.heading) * this.accel * dt;
        }
      }
      this.vx *= 0.98; this.vy *= 0.98;
      this.x += this.vx * dt; this.y += this.vy * dt;
      const mm = ARENA.wall + this.radius;
      this.x = clamp(this.x, mm, ARENA.w - mm);
      this.y = clamp(this.y, mm, ARENA.h - mm);
      trackArenaMotion(this, dt); // bots lead their shots at the Titan too

      // cannon: a heavy, slow shell — only while the FRONT plate survives.
      // WEAKER lead (0.5, user pick): threatening vs a straight-line driver,
      // still dodgeable by turning.
      this.fireTimer -= dt;
      if (target && bd < 820 && this.fireTimer <= 0 && !this.plates[0].dead) {
        this.fireTimer = 0.7; // faster cannon (user: more firerate; was 1.0)
        const bap = arenaAimPoint(this, target, 300, 0.5);
        const ang = Math.atan2(bap.y - this.y, bap.x - this.x);
        const b = new Bullet(this.x + Math.cos(ang) * this.radius, this.y + Math.sin(ang) * this.radius, ang, 300, false, 26);
        b.life = 3.0; b.shooter = this; b.radius = 9;   // big, slow, hard hit
        b.strength = 3; // heavy shell — eats 3 normal bullets before breaking
        game.bullets.push(b);
        if (game.audio.playEnemyShoot) game.audio.playEnemyShoot();
      }

      // SHRAPNEL RING (user: more attacks): periodic radial burst — a short
      // spin-up telegraph, then a ring of 12 slugs with gaps to slip between.
      // Fires regardless of surviving plates (the core spits it).
      if (this.ringWind > 0) {
        this.ringWind -= dt;
        if (this.ringWind <= 0) {
          const N = 12, base = rand(0, TAU);
          for (let i = 0; i < N; i++) {
            const a = base + (i / N) * TAU;
            const rb = new Bullet(this.x + Math.cos(a) * (this.radius + 4), this.y + Math.sin(a) * (this.radius + 4), a, 250, false, 16);
            rb.life = 2.4; rb.shooter = this; rb.radius = 5;
            game.bullets.push(rb);
          }
          if (game.audio.playExplosion) game.audio.playExplosion();
        }
      } else {
        this.ringTimer -= dt;
        if (target && bd < 700 && this.ringTimer <= 0) {
          this.ringWind = 0.6;            // telegraph: spin-up flash
          this.ringTimer = rand(8, 13);   // seeded cadence
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// THE MAGNET — the SECOND central boss (alternates with the Titan on respawn).
// A ROAMING gravity well: a constant inward pull that strengthens the closer
// you are (fight it with throttle), and periodically it STOPS, telegraphs, and
// unleashes a hard MEGA-PULL that yanks everyone in for heavy damage — then
// OVERLOADS (its one vulnerable window: normal weapons only bite while it's
// overloaded). It also drags loose SCRAP (which HEALS it) and MINES (which
// HURT it — its weakness — so bait mines into it) toward its core, and CRUSHES
// any car mashed against it. Damage rewards flow through ArenaGame.killBoss.
// ---------------------------------------------------------------------------

const MAGNET_RESPAWN = 22;        // (shares BOSS_RESPAWN cadence; kept for clarity)
const MAGNET_PULL_R = 640;        // gravity-well radius
const MAGNET_PULL = 340;          // base pull accel (scales up hard near the core)
const MAGNET_MEGA_CD = 9;         // seconds between mega-pulls
const MAGNET_MEGA_WIND = 1.1;     // telegraph before the yank
const MAGNET_OVERLOAD = 2.6;      // vulnerable window after a mega-pull
const MAGNET_CRUSH_DPS = 45;      // damage/s to a car mashed against the core

class ArenaMagnet {
  constructor(x, y) {
    this.kind = "magnet";
    this.name = "THE MAGNET";
    this.tagline = "bait it to overload";
    this.killXp = 450;
    this.x = x; this.y = y;
    this.heading = rand(0, TAU);
    this.vx = 0; this.vy = 0;
    this.radius = 58;
    this.maxSpeed = 60;           // hunts at a slow, relentless stalk
    this.accel = 200;
    this.dead = false;
    this.hitFlash = 0;
    this.lastHitBy = null;
    // one big pool (no plates). Deliberately TANKY (user: must be hard to take
    // down, not easily outplayed) — you only bite it during the brief overload
    // window, and mines (its weakness) take a sustained feed. Tuning dial.
    this.coreHp = 1800; this.coreMax = 1800;
    this.megaTimer = MAGNET_MEGA_CD;
    this.megaWind = 0;            // >0 during the mega-pull telegraph
    this.overload = 0;            // >0 = vulnerable (normal weapons bite)
    this.prey = null;             // the car it's currently stalking
  }

  hpFrac() { return clamp(this.coreHp / this.coreMax, 0, 1); }
  isVulnerable() { return this.overload > 0; }

  // radial junk burst fired the instant the overload ends (8 slugs, gaps to dodge)
  debrisFling(game) {
    const N = 8, base = rand(0, TAU);
    for (let i = 0; i < N; i++) {
      const a = base + (i / N) * TAU;
      const b = new Bullet(this.x + Math.cos(a) * (this.radius + 6), this.y + Math.sin(a) * (this.radius + 6), a, 330, false, 20);
      b.life = 1.8; b.shooter = this; b.radius = 6;
      game.bullets.push(b);
    }
    if (game.audio.playExplosion) game.audio.playExplosion();
  }

  update(dt, game) {
    if (this.dead) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.overload > 0) {
      this.overload -= dt;
      // DEBRIS FLING (user: more attacks): the overload window SLAMS SHUT by
      // hurling the junk it gathered outward — a radial burst that punishes
      // cars still hugging it when the vulnerability ends
      if (this.overload <= 0) this.debrisFling(game);
    }

    // CONSTANT gravity well: drag every car in range inward, stronger the
    // closer they are (quadratic ramp — the edge barely tugs, the center hauls)
    for (const c of game.cars()) {
      if (game.isDeadCar(c)) continue;
      const dx = this.x - c.x, dy = this.y - c.y, d = Math.hypot(dx, dy) || 1;
      if (d > MAGNET_PULL_R) continue;
      const closeness = 1 - d / MAGNET_PULL_R;
      const strength = MAGNET_PULL * (0.3 + closeness * closeness * 2.2);
      c.vx += (dx / d) * strength * dt;
      c.vy += (dy / d) * strength * dt;
      // CRUSH: a car mashed against the core takes steady damage (the peril of
      // being reeled all the way in)
      if (d < this.radius + c.radius + 6) game.hurtCar(c, MAGNET_CRUSH_DPS * dt, this, this.x, this.y, "crash");
    }
    // pull loose SCRAP toward the core — reaching it HEALS the Magnet
    for (const s of game.scrap) {
      if (s.dead) continue;
      const dx = this.x - s.x, dy = this.y - s.y, d = Math.hypot(dx, dy) || 1;
      if (d > MAGNET_PULL_R) continue;
      const pull = 130 * (1 - d / MAGNET_PULL_R);
      s.x += (dx / d) * pull * dt; s.y += (dy / d) * pull * dt;
      if (d < this.radius + 12) { this.coreHp = Math.min(this.coreMax, this.coreHp + s.amount * 0.25); s.dead = true; }
    }
    // pull MINES toward the core (metal drags faster) — reaching it HURTS it
    // (its weakness: lure mines in). Credited to the mine's owner.
    for (const m of game.mines) {
      if (m.dead) continue;
      const dx = this.x - m.x, dy = this.y - m.y, d = Math.hypot(dx, dy) || 1;
      if (d > MAGNET_PULL_R) continue;
      const pull = 280 * (1 - d / MAGNET_PULL_R);
      m.x += (dx / d) * pull * dt; m.y += (dy / d) * pull * dt;
      if (d < this.radius + 14) {
        m.dead = true;
        this.coreHp -= m.dmg * 3; // mines bypass its armor — the intended counter
        this.hitFlash = 0.16; this.lastHitBy = m.owner;
        game.particles.explosion(m.x, m.y);
        if (game.audio.playExplosion) game.audio.playExplosion();
        if (this.coreHp <= 0) { this.dead = true; game.killBoss(m.owner); return; }
      }
    }

    // MEGA-PULL cycle: charge (freeze + telegraph) → yank + damage → overload
    if (this.megaWind > 0) {
      this.vx *= 0.7; this.vy *= 0.7;
      this.megaWind -= dt;
      if (this.megaWind <= 0) { game.magnetMegaPull(this); this.overload = MAGNET_OVERLOAD; }
    } else {
      this.megaTimer -= dt;
      if (this.megaTimer <= 0) { this.megaWind = MAGNET_MEGA_WIND; this.megaTimer = MAGNET_MEGA_CD; if (game.audio.playRev) game.audio.playRev(); }
      // HUNT the nearest living car (user pick) — a slow, relentless stalk so
      // the pull field is a MOVING threat you have to keep fleeing, not a fixed
      // zone you can just walk around.
      let prey = null, pd = 1e9;
      for (const c of game.cars()) {
        if (game.isDeadCar(c)) continue;
        const d = dist(this.x, this.y, c.x, c.y);
        if (d < pd) { pd = d; prey = c; }
      }
      this.prey = prey;
      if (prey) {
        const desired = Math.atan2(prey.y - this.y, prey.x - this.x);
        this.heading += clamp(angleDiff(desired, this.heading), -1, 1) * 1.0 * dt;
        const sp = Math.hypot(this.vx, this.vy);
        if (sp < this.maxSpeed) { this.vx += Math.cos(this.heading) * this.accel * dt; this.vy += Math.sin(this.heading) * this.accel * dt; }
      }
    }
    this.vx *= 0.97; this.vy *= 0.97;
    this.x += this.vx * dt; this.y += this.vy * dt;
    const mm = ARENA.wall + this.radius;
    this.x = clamp(this.x, mm, ARENA.w - mm);
    this.y = clamp(this.y, mm, ARENA.h - mm);
    trackArenaMotion(this, dt); // bots lead their shots at it too
  }
}
