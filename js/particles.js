"use strict";
// ---------------------------------------------------------------------------
// Particles (short-lived effects) + GroundDebris (detached car parts that
// fly off and permanently litter the arena floor).
// ---------------------------------------------------------------------------

class Particles {
  constructor() { this.list = []; }

  add(p) {
    if (this.list.length > 600) this.list.shift(); // hard cap
    p.age = 0;
    this.list.push(p);
  }

  // directional metal sparks (collisions, gunfire)
  sparks(x, y, angle, count = 8, speed = 220) {
    for (let i = 0; i < count; i++) {
      const a = angle + fxRand(-0.9, 0.9);
      const s = fxRand(speed * 0.3, speed);
      this.add({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: fxRand(0.15, 0.45), size: fxRand(1.5, 3),
        color: fxPick(["#ffd166", "#ff9f43", "#ffe8a3"]),
        drag: 2.5,
      });
    }
  }

  smoke(x, y, heavy = false) {
    this.add({
      x: x + fxRand(-6, 6), y: y + fxRand(-6, 6),
      vx: fxRand(-15, 15), vy: fxRand(-30, -8),
      life: fxRand(0.6, 1.3), size: fxRand(4, heavy ? 12 : 7),
      color: heavy ? "#2e2e2e" : "#5c5c5c",
      drag: 1, smoke: true,
    });
  }

  // full enemy-death blast: flash + fireball sparks + heavy smoke
  explosion(x, y) {
    this.add({ x, y, vx: 0, vy: 0, life: 0.12, size: 46, color: "#ffffff", smoke: true });
    for (let i = 0; i < 26; i++) {
      const a = fxRand(0, TAU), s = fxRand(80, 380);
      this.add({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: fxRand(0.25, 0.7), size: fxRand(2, 5),
        color: fxPick(["#ffd166", "#ff9f43", "#e74c3c", "#f5f5f5"]),
        drag: 2,
      });
    }
    for (let i = 0; i < 8; i++) this.smoke(x + fxRand(-10, 10), y + fxRand(-10, 10), true);
  }

  // green sparkle while a component is being repaired
  repairGlow(x, y) {
    for (let i = 0; i < 3; i++) {
      this.add({
        x: x + fxRand(-14, 14), y: y + fxRand(-14, 14),
        vx: fxRand(-10, 10), vy: -40,
        life: 0.5, size: 3, color: "#2ecc71", drag: 0.5,
      });
    }
  }

  // brown dust when a scrap pile takes a hit
  scrapPuff(x, y) {
    for (let i = 0; i < 6; i++) {
      const a = fxRand(0, TAU);
      this.add({
        x, y,
        vx: Math.cos(a) * fxRand(30, 90), vy: Math.sin(a) * fxRand(30, 90),
        life: fxRand(0.3, 0.6), size: fxRand(2, 4), color: "#8a7a5f", drag: 2,
      });
    }
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.age >= p.life) { this.list.splice(i, 1); continue; }
      const f = 1 / (1 + (p.drag ?? 1) * dt);
      p.vx *= f; p.vy *= f;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx) {
    ctx.save();
    for (const p of this.list) {
      const t = p.age / p.life;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.fillStyle = p.color;
      if (p.smoke) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + t * 1.5), 0, TAU);
        ctx.fill();
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Detached parts: spawned when a component is destroyed, they tumble across
// the floor with friction, then settle and stay for the rest of the run.
// ---------------------------------------------------------------------------

class GroundDebris {
  constructor() { this.parts = []; }

  // type: "wheel" | "bumper" | "weapon" | "chunk"; angle = fling direction
  addPart(type, x, y, angle) {
    const a = angle + fxRand(-0.6, 0.6);
    const s = fxRand(180, 320);
    this.parts.push({
      type, x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      rot: fxRand(0, TAU), vrot: fxRand(-8, 8),
      settled: false,
    });
    if (this.parts.length > 90) this.parts.shift();
  }

  update(dt) {
    const m = WORLD.wall + 8;
    for (const p of this.parts) {
      if (p.settled) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      const f = 1 / (1 + 3.2 * dt);
      p.vx *= f; p.vy *= f; p.vrot *= f;
      p.x = clamp(p.x, m, WORLD.w - m);
      p.y = clamp(p.y, m, WORLD.h - m);
      if (Math.hypot(p.vx, p.vy) < 12) p.settled = true;
    }
  }

  draw(ctx) {
    for (const p of this.parts) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      switch (p.type) {
        case "wheel":
          ctx.fillStyle = "#1d1d1f";
          ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
          ctx.fillStyle = "#555";
          ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, TAU); ctx.fill();
          break;
        case "bumper":
          ctx.fillStyle = "#8d99ae";
          ctx.fillRect(-12, -3, 24, 6);
          break;
        case "weapon":
          ctx.fillStyle = "#666";
          ctx.fillRect(-9, -2.5, 18, 5);
          break;
        default: // "chunk"
          ctx.fillStyle = "#4a4a4a";
          ctx.fillRect(-5, -4, 10, 8);
      }
      ctx.restore();
    }
  }
}
