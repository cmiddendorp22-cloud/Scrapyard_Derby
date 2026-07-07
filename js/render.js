"use strict";
// ---------------------------------------------------------------------------
// All canvas drawing. Game state in, pixels out.
// Layers: a pre-rendered floor, aged skid-mark segments (fade out and vanish
// after SKID_LIFE seconds), then live entities/particles on top.
// Screen shake is a translate applied to everything except the HUD.
// ---------------------------------------------------------------------------

const SKID_LIFE = 20;  // seconds a tire mark stays on the ground
const SKID_FADE = 5;   // fade-out window at the end of that life

class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.game = game;
    this.floor = this.makeFloor();
    this.skids = []; // {x1,y1,x2,y2,age} rubber segments
  }

  resetMarks() { this.skids = []; }

  updateSkids(dt) {
    for (const s of this.skids) s.age += dt;
    // oldest are always at the front, so trim from the head
    let cut = 0;
    while (cut < this.skids.length && this.skids[cut].age >= SKID_LIFE) cut++;
    if (cut) this.skids.splice(0, cut);
  }

  // dirt floor with oil stains, gravel speckle, walls, hazard stripe
  makeFloor() {
    const c = document.createElement("canvas");
    c.width = WORLD.w; c.height = WORLD.h;
    const x = c.getContext("2d");
    x.fillStyle = "#3b362e";
    x.fillRect(0, 0, WORLD.w, WORLD.h);
    for (let i = 0; i < 90; i++) {
      x.fillStyle = `rgba(0,0,0,${fxRand(0.03, 0.1)})`;
      x.beginPath();
      x.ellipse(fxRand(0, WORLD.w), fxRand(0, WORLD.h), fxRand(8, 42), fxRand(6, 30), fxRand(0, TAU), 0, TAU);
      x.fill();
    }
    for (let i = 0; i < 1500; i++) {
      x.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)";
      x.fillRect(fxRand(0, WORLD.w), fxRand(0, WORLD.h), fxRand(1, 3), fxRand(1, 3));
    }
    x.fillStyle = "#5a5148";
    x.fillRect(0, 0, WORLD.w, WORLD.wall);
    x.fillRect(0, WORLD.h - WORLD.wall, WORLD.w, WORLD.wall);
    x.fillRect(0, 0, WORLD.wall, WORLD.h);
    x.fillRect(WORLD.w - WORLD.wall, 0, WORLD.wall, WORLD.h);
    x.strokeStyle = "#c9a227";
    x.lineWidth = 2;
    x.setLineDash([14, 10]);
    x.strokeRect(WORLD.wall + 1, WORLD.wall + 1, WORLD.w - 2 * WORLD.wall - 2, WORLD.h - 2 * WORLD.wall - 2);
    x.setLineDash([]);
    return c;
  }

  // lay rubber segments when a car slides sideways hard
  recordSkids(car) {
    if (car.lateralSpeed > 120 && car.speed > 60) {
      const fwd = car.forward;
      const right = { x: -fwd.y, y: fwd.x };
      for (const s of [-1, 1]) {
        const wx = car.x + right.x * s * car.width * 0.4;
        const wy = car.y + right.y * s * car.width * 0.4;
        this.skids.push({
          x1: wx - car.vx * 0.02, y1: wy - car.vy * 0.02,
          x2: wx, y2: wy,
          age: 0,
        });
      }
      if (this.skids.length > 4000) this.skids.splice(0, this.skids.length - 4000);
    }
  }

  // batched by fade level so a full arena of rubber is still a handful of strokes
  drawSkids(ctx) {
    if (!this.skids.length) return;
    ctx.strokeStyle = "#141210";
    ctx.lineWidth = 3;
    const solidEnd = SKID_LIFE - SKID_FADE;
    // fresh marks: one path at full strength
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    for (const s of this.skids) {
      if (s.age >= solidEnd) continue;
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.stroke();
    // fading marks: bucketed into steps of the fade window
    const buckets = 8;
    for (let b = 0; b < buckets; b++) {
      const from = solidEnd + (b / buckets) * SKID_FADE;
      const to = solidEnd + ((b + 1) / buckets) * SKID_FADE;
      ctx.globalAlpha = 0.25 * (1 - (b + 0.5) / buckets);
      ctx.beginPath();
      let any = false;
      for (const s of this.skids) {
        if (s.age < from || s.age >= to) continue;
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        any = true;
      }
      if (any) ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  draw() {
    const g = this.game, ctx = this.ctx;
    // map logical 1280x720 world coords onto the (hi-dpi) backing store
    ctx.setTransform(this.canvas.width / WORLD.w, 0, 0, this.canvas.height / WORLD.h, 0, 0);
    ctx.save();
    ctx.translate(g.shakeX, g.shakeY); // screen shake

    ctx.drawImage(this.floor, 0, 0);
    this.drawSkids(ctx);
    // Drift Master's burning spark trail
    for (const z of g.driftZones) {
      ctx.globalAlpha = clamp(z.life / 1.1, 0, 1) * 0.7;
      ctx.fillStyle = "#ff9f43";
      ctx.beginPath();
      ctx.arc(z.x, z.y, 5, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    g.debris.draw(ctx);
    for (const s of g.scrap) this.drawScrap(s);
    for (const m of g.mines) this.drawMine(m);
    for (const b of g.bullets) this.drawBullet(b);
    for (const e of g.enemies) this.drawCar(e);
    this.drawCar(g.player, g.over); // charred husk after game over
    g.particles.draw(ctx);
    for (const e of g.enemies) this.drawEnemyOverhead(e);

    ctx.restore();
    g.ui.draw(ctx, g); // HUD is never shaken
  }

  drawScrap(s) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.seed);
    ctx.scale(s.scale, s.scale); // shrinks as it's consumed
    ctx.fillStyle = "#6e5f4b";
    ctx.beginPath();
    ctx.ellipse(0, 0, 24, 18, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#8a7a5f";
    ctx.fillRect(-14, -10, 13, 8);
    ctx.fillStyle = "#7c8794";
    ctx.fillRect(0, -4, 16, 7);
    ctx.fillStyle = "#4c443a";
    ctx.fillRect(-6, 4, 10, 6);
    // pulsing glint so it reads as a pickup
    const glint = 0.4 + 0.3 * Math.sin(performance.now() / 300 + s.seed * 7);
    ctx.fillStyle = `rgba(255,240,180,${glint})`;
    ctx.fillRect(4, -9, 3, 3);
    ctx.restore();
  }

  drawMine(m) {
    const ctx = this.ctx;
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(m.x, m.y, 7, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#3d3d3d";
    ctx.lineWidth = 2;
    ctx.stroke();
    // armed mines blink red; arming ones glow a steady dim amber
    if (m.arm <= 0) {
      const blink = Math.sin(performance.now() / 150) > 0;
      ctx.fillStyle = blink ? "#ff3b30" : "#5c1512";
    } else {
      ctx.fillStyle = "#8a6d1f";
    }
    ctx.beginPath();
    ctx.arc(m.x, m.y, 2.5, 0, TAU);
    ctx.fill();
  }

  drawBullet(b) {
    const ctx = this.ctx;
    ctx.save();
    const col = b.fromPlayer ? "#ffe066" : "#ff5c5c";
    // motion trail
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = b.radius;
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * 0.03, b.y - b.vy * 0.03);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // Each archetype gets its own chassis geometry, so silhouettes differ in
  // SHAPE, not just color: rammer = tapered muscle car, bulldozer = brutal
  // box, gunner = oval, thief = forward dart, minelayer = chamfered flatbed,
  // hauler = narrow cab + wide trailer, swarmer = arrow dart.
  carBodyPath(ctx, car, isPlayer) {
    const L = car.length, W = car.width;
    if (isPlayer) { pathRoundRect(ctx, -L / 2, -W / 2, L, W, 6); return; }
    switch (car.type) {
      case "rammer": // muscle car: broad haunches, tapered nose
        ctx.beginPath();
        ctx.moveTo(-L / 2, -W / 2);
        ctx.lineTo(L * 0.2, -W / 2);
        ctx.lineTo(L / 2, -W * 0.32);
        ctx.lineTo(L / 2, W * 0.32);
        ctx.lineTo(L * 0.2, W / 2);
        ctx.lineTo(-L / 2, W / 2);
        ctx.closePath();
        break;
      case "shielded": // bulldozer: uncompromising box
        ctx.beginPath();
        ctx.rect(-L / 2, -W / 2, L, W);
        break;
      case "circler": // gunner: rounded oval hull
        ctx.beginPath();
        ctx.ellipse(0, 0, L / 2, W / 2, 0, 0, TAU);
        break;
      case "thief": // low forward dart, built to dive between piles
        ctx.beginPath();
        ctx.moveTo(L / 2, 0);
        ctx.lineTo(L * 0.05, -W / 2);
        ctx.lineTo(-L / 2, -W * 0.35);
        ctx.lineTo(-L / 2, W * 0.35);
        ctx.lineTo(L * 0.05, W / 2);
        ctx.closePath();
        break;
      case "minelayer": // long flatbed with chamfered rear corners
        ctx.beginPath();
        ctx.moveTo(L / 2, -W / 2);
        ctx.lineTo(-L / 2 + 7, -W / 2);
        ctx.lineTo(-L / 2, -W / 2 + 7);
        ctx.lineTo(-L / 2, W / 2 - 7);
        ctx.lineTo(-L / 2 + 7, W / 2);
        ctx.lineTo(L / 2, W / 2);
        ctx.closePath();
        break;
      case "splitter": // hauler: narrow cab up front, wide trailer behind
        ctx.beginPath();
        ctx.moveTo(L / 2, -W * 0.3);
        ctx.lineTo(L * 0.12, -W * 0.3);
        ctx.lineTo(L * 0.12, -W / 2);
        ctx.lineTo(-L / 2, -W / 2);
        ctx.lineTo(-L / 2, W / 2);
        ctx.lineTo(L * 0.12, W / 2);
        ctx.lineTo(L * 0.12, W * 0.3);
        ctx.lineTo(L / 2, W * 0.3);
        ctx.closePath();
        break;
      case "bike": // swarmer: arrow dart with a notched tail
        ctx.beginPath();
        ctx.moveTo(L / 2, 0);
        ctx.lineTo(-L / 2, -W / 2);
        ctx.lineTo(-L * 0.28, 0);
        ctx.lineTo(-L / 2, W / 2);
        ctx.closePath();
        break;
      default:
        pathRoundRect(ctx, -L / 2, -W / 2, L, W, 6);
    }
  }

  // draw one enemy type, nose up, centered on a small canvas (field guide)
  renderEnemyPortrait(type, canvas) {
    // the throwaway Enemy pulls seeded RNG draws in its constructor; route
    // those to Math.random so opening the field guide never advances (and
    // thus never desyncs) the deterministic sim stream
    setSimRandom(Math.random);
    const dummy = new Enemy(canvas.width / 2, canvas.height / 2, type, {});
    if (this.game) setSimRandom(() => this.game.rng.next());
    dummy.heading = -Math.PI / 2;
    dummy.gunAngle = dummy.heading;
    const saved = this.ctx;
    this.ctx = canvas.getContext("2d");
    this.drawCar(dummy);
    this.ctx = saved;
  }

  drawCar(car, charred = false) {
    const ctx = this.ctx;
    const L = car.length, W = car.width;
    const isPlayer = car instanceof Player;
    ctx.save();
    // hauler shudders when it's about to break apart — the pre-split warning
    let jx = 0, jy = 0;
    if (!isPlayer && car.type === "splitter" && car.hull < car.maxHull * 0.25) {
      jx = fxRand(-1.5, 1.5);
      jy = fxRand(-1.5, 1.5);
    }
    ctx.translate(car.x + jx, car.y + jy);
    ctx.rotate(car.heading); // local frame: +x forward, +y driver's right

    // wheels — destroyed sides have visibly lost theirs (they're on the floor)
    ctx.fillStyle = "#1d1d1f";
    const hasL = !car.components.leftWheels || car.compAlive("leftWheels");
    const hasR = !car.components.rightWheels || car.compAlive("rightWheels");
    if (hasL) { ctx.fillRect(-L * 0.32 - 5, -W / 2 - 3, 10, 6); ctx.fillRect(L * 0.32 - 5, -W / 2 - 3, 10, 6); }
    if (hasR) { ctx.fillRect(-L * 0.32 - 5, W / 2 - 3, 10, 6); ctx.fillRect(L * 0.32 - 5, W / 2 - 3, 10, 6); }

    // body — threat-grammar colors from ENEMY_INFO (red/orange = contact,
    // blue/purple = ranged, gold = economy)
    let bodyColor = isPlayer ? "#3f88c5" : (ENEMY_INFO[car.type]?.color || "#c0392b");
    if (car.named) bodyColor = car.type === "rammer" ? "#e74c3c" : car.type === "circler" ? "#a55eea" : "#e0952f";
    if (charred) bodyColor = "#2b2b2b";
    ctx.fillStyle = bodyColor;
    this.carBodyPath(ctx, car, isPlayer);
    ctx.fill();

    // battle-damage grime darkens the body as health drops
    let hurt;
    if (isPlayer) {
      let sum = 0, n = 0;
      for (const k in car.components) { sum += car.compRatio(k); n++; }
      hurt = 1 - sum / n;
    } else {
      hurt = 1 - Math.max(0, car.hull) / car.maxHull;
    }
    if (hurt > 0.25) {
      ctx.fillStyle = `rgba(30,25,20,${(hurt - 0.25) * 0.6})`;
      this.carBodyPath(ctx, car, isPlayer);
      ctx.fill();
    }

    // windshield (swarmers are too small to have one — helps the silhouette)
    if (isPlayer || car.type !== "bike") {
      ctx.fillStyle = charred ? "#1a1a1a" : "rgba(200,230,255,0.75)";
      ctx.fillRect(L * 0.08, -W * 0.3, L * 0.2, W * 0.6);
    }

    // bumpers: player-only (enemies wear their own archetype gear instead,
    // and bumper bars fight the new non-rectangular hull shapes)
    const up = isPlayer ? this.game.upgrades : null;
    if (isPlayer && car.compAlive("frontBumper")) {
      ctx.fillStyle = "#9aa7b0";
      ctx.fillRect(L / 2 - 2, -W / 2, 5, W);
      if (up && up.spikes) { // Bumper Spikes
        ctx.fillStyle = "#c8d1d8";
        for (const sy of [-W * 0.32, 0, W * 0.32]) {
          ctx.beginPath();
          ctx.moveTo(L / 2 + 3, sy - 3);
          ctx.lineTo(L / 2 + 9, sy);
          ctx.lineTo(L / 2 + 3, sy + 3);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    if (isPlayer && car.compAlive("rearBumper")) {
      ctx.fillStyle = "#9aa7b0";
      ctx.fillRect(-L / 2 - 3, -W / 2, 5, W);
      if (up && up.spikes) {
        ctx.fillStyle = "#c8d1d8";
        for (const sy of [-W * 0.32, 0, W * 0.32]) {
          ctx.beginPath();
          ctx.moveTo(-L / 2 - 4, sy - 3);
          ctx.lineTo(-L / 2 - 10, sy);
          ctx.lineTo(-L / 2 - 4, sy + 3);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // player cannon (gone when the weapon mount is destroyed)
    if (isPlayer && car.compAlive("weapon") && !charred) {
      ctx.fillStyle = "#333b41";
      if (up && up.twinCannons) { // two barrels
        ctx.fillRect(0, -7.5, L / 2 + 8, 4);
        ctx.fillRect(0, 3.5, L / 2 + 8, 4);
      } else {
        ctx.fillRect(0, -2.5, L / 2 + 8, 5);
      }
      ctx.fillRect(-4, -5, 10, 10);
      if (up && up.rearBlaster) { // stubby tail gun
        ctx.fillRect(-L / 2 - 7, -2, 10, 4);
      }
    }

    // auto-turret: dome on the rear deck, barrel tracks its last target
    if (isPlayer && up && up.turret && !charred) {
      ctx.save();
      ctx.translate(-L * 0.18, 0);
      ctx.rotate((car.turretAngle ?? car.heading) - car.heading);
      ctx.fillStyle = "#30363b";
      ctx.fillRect(0, -1.8, 13, 3.6);
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // per-archetype gear: each type owns a unique layout so silhouettes stay
    // readable even within the same threat-color family
    if (!isPlayer && (car.type === "rammer" || car.type === "splitter")) {
      // plow blade
      ctx.fillStyle = "#7f8c8d";
      ctx.beginPath();
      ctx.moveTo(L / 2, -W / 2 - 2);
      ctx.lineTo(L / 2 + 9, 0);
      ctx.lineTo(L / 2, W / 2 + 2);
      ctx.closePath();
      ctx.fill();
    }
    if (!isPlayer && car.type === "splitter") {
      // cargo box with hazard stripes — it's a HAULER, and it's carrying something
      ctx.fillStyle = "#4a3826";
      ctx.fillRect(-L / 2 + 5, -W / 2 + 4, L * 0.5, W - 8);
      ctx.fillStyle = "#c9a227";
      ctx.fillRect(-L / 2 + 5, -W / 2 + 4, 3, W - 8);
      ctx.fillRect(-L / 2 + 5 + L * 0.5 - 3, -W / 2 + 4, 3, W - 8);
    }
    if (!isPlayer && car.type === "shielded") {
      // full-face bullet-proof shield — visibly wider than the car,
      // and it flashes white when it deflects a shot
      ctx.fillStyle = "#aab7bd";
      ctx.fillRect(L / 2, -W / 2 - 4, 6, W + 8);
      ctx.fillStyle = "#7f8c8d";
      ctx.fillRect(L / 2 + 6, -W / 2 - 4, 2, W + 8);
      if (car.shieldFlash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${(car.shieldFlash / 0.15) * 0.85})`;
        ctx.fillRect(L / 2, -W / 2 - 4, 8, W + 8);
      }
    }
    if (!isPlayer && car.type === "thief") {
      // grabber prongs — glow while it's eating a pile
      const munching = car.eating && !charred;
      ctx.fillStyle = munching
        ? `rgba(255,209,102,${0.7 + 0.3 * Math.sin(performance.now() / 90)})`
        : "#c9a227";
      ctx.fillRect(L / 2, -W * 0.38, 9, 3);
      ctx.fillRect(L / 2, W * 0.38 - 3, 9, 3);
    }
    if (!isPlayer && car.type === "minelayer") {
      // long flatbed: visible mine discs riding on the back, and the rear
      // hatch blinks amber right before a drop
      ctx.fillStyle = "#1d1d1f";
      ctx.beginPath(); ctx.arc(-L * 0.18, -W * 0.18, 3.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(-L * 0.18, W * 0.18, 3.5, 0, TAU); ctx.fill();
      const arming = car.mineTimer < 0.8;
      ctx.fillStyle = arming
        ? `rgba(255,190,60,${0.5 + 0.5 * Math.abs(Math.sin(performance.now() / 90))})`
        : "#22355e";
      ctx.fillRect(-L / 2 + 3, -W * 0.3, 8, W * 0.6);
    }
    if (!isPlayer && car.type === "circler") {
      // gunner turret: dome + barrel that visibly tracks its last shot
      ctx.save();
      ctx.rotate((car.gunAngle ?? car.heading) - car.heading);
      ctx.fillStyle = "#5b3a70";
      ctx.fillRect(0, -2, 16, 4);
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    if (!isPlayer && car.type === "bike") {
      // single racing stripe — tiny, loud, disposable
      ctx.fillStyle = "rgba(255,240,200,0.7)";
      ctx.fillRect(-L / 2 + 2, -1.2, L - 4, 2.4);
    }

    // named elite roof marker
    if (car.named) {
      ctx.fillStyle = "#ffd166";
      ctx.fillRect(-L * 0.18, -3, L * 0.14, 6);
    }

    // hauler about to split: red warning pulse on top of the shudder
    if (!isPlayer && car.type === "splitter" && car.hull < car.maxHull * 0.25) {
      const fl = 0.3 + 0.7 * Math.abs(Math.sin(performance.now() / 110));
      ctx.fillStyle = `rgba(255,80,60,${0.25 * fl})`;
      pathRoundRect(ctx, -L / 2 - 4, -W / 2 - 4, L + 8, W + 8, 8);
      ctx.fill();
    }

    // telegraph: rapid red flash around the whole car during the wind-up
    if (car.telegraph > 0) {
      const fl = 0.35 + 0.65 * Math.abs(Math.sin(performance.now() / 45));
      ctx.fillStyle = `rgba(255,80,60,${0.35 * fl})`;
      pathRoundRect(ctx, -L / 2 - 5, -W / 2 - 5, L + 10, W + 10, 8);
      ctx.fill();
    }

    ctx.restore();
  }

  // hull bars + elite names, drawn unrotated above each enemy
  drawEnemyOverhead(e) {
    if (e.dead) return;
    const ctx = this.ctx;
    const y = e.y - e.radius - 12;
    if (e.hull < e.maxHull || e.named) {
      const w = e.named ? 60 : 34;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(e.x - w / 2, y, w, 5);
      ctx.fillStyle = e.named ? "#ffd166" : "#7bed9f";
      ctx.fillRect(e.x - w / 2, y, w * clamp(e.hull / e.maxHull, 0, 1), 5);
    }
    if (e.named) {
      ctx.font = "bold 13px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd166";
      ctx.fillText(e.name, e.x, y - 5);
    }
  }
}
