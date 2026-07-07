"use strict";
// ---------------------------------------------------------------------------
// Bullets. Player rounds are fast and short-lived; Circler rounds are the
// slow, dodgeable kind the design calls for.
// ---------------------------------------------------------------------------

class Bullet {
  constructor(x, y, angle, speed, fromPlayer, damage) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.fromPlayer = fromPlayer;
    this.damage = damage;
    this.radius = fromPlayer ? 4 : 6;
    this.life = fromPlayer ? 1.4 : 7; // slow enemy shots need time to cross the arena
    this.strength = 1; // hidden clash strength (Arena bullet-vs-bullet blocking)
    this.dead = false;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
}
