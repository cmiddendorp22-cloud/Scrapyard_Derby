"use strict";
// ---------------------------------------------------------------------------
// Round manager (replaces the old timed wave spawner). A round spawns its
// enemies with staggered arrivals and ends when the last one dies. Between
// rounds: free full repair, partial scrap respawn, and a Next Round button —
// the player decides when to dive back in. Every 5th round leads with a
// named elite.
// ---------------------------------------------------------------------------

class RoundManager {
  constructor() {
    this.round = 0;
    this.state = "intermission"; // intermission -> countdown -> active
    this.countdown = 0;
    this.spawnQueue = [];        // enemy specs waiting to drive in
    this.spawnTimer = 0;
  }

  get enemiesIncoming() { return this.spawnQueue.length; }

  // called by the Next Round button / N key (and once at game start)
  requestNext(game) {
    if (this.state !== "intermission") return;
    this.round++;
    this.state = "countdown";
    this.countdown = 3;
    game.hideIntermission();
    game.audio.playWave();
  }

  update(dt, game) {
    if (this.state === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = "active";
        this.buildQueue();
        this.spawnTimer = 0; // first enemy arrives immediately
        // Emergency Patch recharges at the top of every round
        game.player.patchCharge = !!game.upgrades.emergencyPatch;
        const n = this.spawnQueue.length;
        game.ui.addBanner(
          this.round % 5 === 0 ? "ROUND " + this.round + " — BOSS ROUND" : "ROUND " + this.round,
          this.round % 5 === 0 ? "Fewer enemies. Much worse." : n > 1 ? n + " hostiles" : "Hostile incoming"
        );
      }
    } else if (this.state === "active") {
      if (this.spawnQueue.length) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnTimer = 1.1; // stagger arrivals so they don't stack
          this.spawnOne(game, this.spawnQueue.shift());
        }
      } else if (game.enemies.length === 0) {
        this.state = "intermission";
        game.onRoundCleared(this.round);
      }
    }
  }

  // headcount grows every other round (capped); every 5th is a BOSS round:
  // half the usual enemies, led by a 4x-health / 4x-damage boss
  buildQueue() {
    const r = this.round;
    let count = Math.min(1 + Math.floor((r - 1) / 2), 5);
    const elite = r % 5 === 0;
    if (elite) count = Math.max(1, Math.ceil(count / 2));
    this.spawnQueue = [];
    for (let i = 0; i < count; i++) {
      let type;
      if (elite && i === 0) {
        const elitePool = ["rammer", "circler"];
        if (r >= 6) elitePool.push("shielded");
        type = pick(elitePool);
      }
      else if (r === 1) type = "rammer";       // round 1 teaches the rammer,
      else if (r === 2) type = "circler";      // round 2 the circler
      else type = this.pickType(r);
      this.spawnQueue.push({ type, named: elite && i === 0 });
    }
  }

  // the threat pool widens as rounds progress
  pickType(r) {
    const pool = ["rammer", "rammer", "circler", "circler"];
    if (r >= 3) pool.push("thief");
    if (r >= 4) pool.push("minelayer");
    if (r >= 5) pool.push("splitter");
    if (r >= 6) pool.push("shielded");
    return pick(pool);
  }

  spawnOne(game, spec) {
    const { x, y } = this.spawnPoint(game);
    const r = this.round;
    const e = new Enemy(x, y, spec.type, {
      named: spec.named,
      // scaling with teeth: HP, speed, AND damage all creep up per round
      hpScale: 1 + (r - 1) * 0.06,
      speedScale: Math.min(1 + (r - 1) * 0.02, 1.35),
      dmgScale: Math.min(1 + (r - 1) * 0.04, 1.8),
    });
    e.heading = Math.atan2(game.player.y - y, game.player.x - x);
    e.onComponentDestroyed = game.handleComponentDestroyed;
    // orbiters alternate direction so one turn can't kite the whole pack
    if (spec.type === "circler" || spec.type === "minelayer") {
      this._orbitToggle = -(this._orbitToggle || 1);
      e.orbitDir = this._orbitToggle;
    }
    game.enemies.push(e);
    game.particles.sparks(x, y, rand(0, TAU), 12, 180); // spawn-in flash
    game.noteEnemySeen(spec.type);
    if (e.named) {
      game.ui.addBanner("BOSS: " + e.name, ENEMY_INFO[e.type].name + " — 4x health, 4x damage");
    }
  }

  // random point along the arena walls, kept away from the player
  spawnPoint(game) {
    let x = WORLD.w / 2, y = WORLD.h / 2;
    for (let tries = 0; tries < 20; tries++) {
      const side = randInt(0, 3);
      const m = WORLD.wall + 40;
      if (side === 0)      { x = rand(m, WORLD.w - m); y = m; }
      else if (side === 1) { x = WORLD.w - m; y = rand(m, WORLD.h - m); }
      else if (side === 2) { x = rand(m, WORLD.w - m); y = WORLD.h - m; }
      else                 { x = m; y = rand(m, WORLD.h - m); }
      if (dist(x, y, game.player.x, game.player.y) > 330) break;
    }
    return { x, y };
  }
}
