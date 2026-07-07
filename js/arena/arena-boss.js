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
    this.lastHitBy = null;        // kill attribution (who lands the core kill)
    // 4 armor plates around a core. Plate angles are LOCAL (relative to
    // heading); break the one facing you to shoot the core through the gap.
    this.plates = [
      { key: "front", ang: 0,            hp: 150, max: 150, dead: false, hit: 0 },
      { key: "right", ang: Math.PI / 2,  hp: 150, max: 150, dead: false, hit: 0 },
      { key: "back",  ang: Math.PI,      hp: 150, max: 150, dead: false, hit: 0 },
      { key: "left",  ang: -Math.PI / 2, hp: 150, max: 150, dead: false, hit: 0 },
    ];
    this.coreHp = 260;
    this.coreMax = 260;
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
        this.slamTimer = 5.5;
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

      // cannon: a heavy, slow shell — only while the FRONT plate survives
      this.fireTimer -= dt;
      if (target && bd < 820 && this.fireTimer <= 0 && !this.plates[0].dead) {
        this.fireTimer = 2.4;
        const ang = Math.atan2(target.y - this.y, target.x - this.x);
        const b = new Bullet(this.x + Math.cos(ang) * this.radius, this.y + Math.sin(ang) * this.radius, ang, 300, false, 26);
        b.life = 3.0; b.shooter = this; b.radius = 9;   // big, slow, hard hit
        b.strength = 3; // heavy shell — eats 3 normal bullets before breaking
        game.bullets.push(b);
        if (game.audio.playEnemyShoot) game.audio.playEnemyShoot();
      }
    }
  }
}
