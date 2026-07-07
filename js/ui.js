"use strict";
// ---------------------------------------------------------------------------
// HUD: run stats, wave countdown, scrap counter, wave banners, and the
// color-coded component status panel (green/yellow/red, X = destroyed).
// ---------------------------------------------------------------------------

class UI {
  constructor() { this.banners = []; }

  reset() { this.banners = []; }

  addBanner(text, sub) {
    this.banners.push({ text, sub, t: 0, dur: 3 });
    if (this.banners.length > 3) this.banners.shift();
  }

  update(dt) {
    for (const b of this.banners) b.t += dt;
    this.banners = this.banners.filter((b) => b.t < b.dur);
  }

  draw(ctx, game) {
    if (!game.started) return;
    ctx.save();
    ctx.textBaseline = "alphabetic";

    // --- top-left: run stats ---
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    pathRoundRect(ctx, 16, 14, 180, 86, 8);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffd166";
    ctx.font = "bold 22px 'Segoe UI', sans-serif";
    ctx.fillText("ROUND " + Math.max(1, game.rounds.round), 28, 42);
    ctx.font = "14px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#e8e2d6";
    ctx.fillText("Wrecked: " + game.kills, 28, 64);
    ctx.fillText("Time: " + fmtTime(game.time), 28, 84);

    // --- top-right: pressure readouts + wallet ---
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    pathRoundRect(ctx, WORLD.w - 206, 14, 190, 90, 8);
    ctx.fill();
    ctx.textAlign = "right";
    ctx.font = "14px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#e8e2d6";
    const rs = game.rounds;
    const status =
      rs.state === "active" ? "Enemies left: " + (game.enemies.length + rs.enemiesIncoming) :
      rs.state === "countdown" ? "Round starts in " + Math.max(1, Math.ceil(rs.countdown)) + "s" :
      "Round clear!";
    ctx.fillText(status, WORLD.w - 28, 42);
    const sc = game.scrap.length;
    ctx.fillStyle = sc > 4 ? "#7bed9f" : sc > 0 ? "#f1c40f" : "#e74c3c";
    ctx.fillText("Scrap piles left: " + sc, WORLD.w - 28, 66);
    ctx.font = "bold 14px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#ffd166";
    ctx.fillText("SALVAGE: " + game.salvage, WORLD.w - 28, 90);

    // --- floating salvage popups (world coords; static camera) ---
    ctx.textAlign = "center";
    ctx.font = "bold 14px 'Segoe UI', sans-serif";
    for (const t of game.floatTexts) {
      ctx.globalAlpha = clamp(1 - t.age / t.life, 0, 1);
      ctx.fillStyle = "#ffd166";
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    // --- center: big pre-round countdown ---
    if (rs.state === "countdown") {
      ctx.textAlign = "center";
      ctx.font = "bold 84px 'Segoe UI', sans-serif";
      ctx.fillStyle = "rgba(255,209,102,0.9)";
      ctx.fillText(String(Math.max(1, Math.ceil(rs.countdown))), WORLD.w / 2, WORLD.h / 2 - 60);
    }

    // --- center: round / event banners ---
    ctx.textAlign = "center";
    this.banners.forEach((b, i) => {
      const a = b.t < 0.3 ? b.t / 0.3 : b.t > b.dur - 0.5 ? (b.dur - b.t) / 0.5 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.font = "bold 34px 'Segoe UI', sans-serif";
      ctx.fillStyle = "#ffd166";
      ctx.fillText(b.text, WORLD.w / 2, 150 + i * 64);
      if (b.sub) {
        ctx.font = "15px 'Segoe UI', sans-serif";
        ctx.fillStyle = "#e8e2d6";
        ctx.fillText(b.sub, WORLD.w / 2, 174 + i * 64);
      }
      ctx.globalAlpha = 1;
    });

    this._game = game;
    this.drawComponents(ctx, game.player);
    ctx.restore();
  }

  // bottom-left panel: top-down car schematic (nose up) with one color-coded
  // block per component, plus a row per part with an HP bar and live hp/max
  // numbers — so upgrades like Reinforced Plating are visible immediately
  drawComponents(ctx, p) {
    const game = p ? this._game : null; // set in draw()
    // touch mode: the joystick owns the bottom-left corner, so the panel
    // moves up under the round stats instead
    const X = 16, Y = game && game.touchMode ? 112 : WORLD.h - 206, W = 268, H = 190;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    pathRoundRect(ctx, X, Y, W, H, 8);
    ctx.fill();

    ctx.font = "bold 12px 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "#c0b7a8";
    ctx.fillText("COMPONENTS", X + 12, Y + 20);

    // schematic, nose up
    const cx = X + 52, cy = Y + 112;
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 2;
    pathRoundRect(ctx, cx - 20, cy - 42, 40, 84, 9);
    ctx.stroke();

    const slots = [
      { k: "frontBumper", x: cx,      y: cy - 48, w: 36, h: 7 },
      { k: "rearBumper",  x: cx,      y: cy + 48, w: 36, h: 7 },
      { k: "leftWheels",  x: cx - 27, y: cy,      w: 8,  h: 34 },
      { k: "rightWheels", x: cx + 27, y: cy,      w: 8,  h: 34 },
      { k: "engine",      x: cx,      y: cy - 18, w: 22, h: 20 },
      { k: "weapon",      x: cx,      y: cy + 16, w: 14, h: 18 },
    ];
    for (const s of slots) {
      ctx.fillStyle = this.compColor(p, s.k);
      ctx.fillRect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h);
      if (!p.compAlive(s.k)) {
        ctx.strokeStyle = "#e74c3c";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x - 5, s.y - 5); ctx.lineTo(s.x + 5, s.y + 5);
        ctx.moveTo(s.x + 5, s.y - 5); ctx.lineTo(s.x - 5, s.y + 5);
        ctx.stroke();
      }
    }
    // auto-turret shows on the schematic once bought (no HP; it can't break)
    if (game && game.upgrades.turret) {
      ctx.fillStyle = "#8899a6";
      ctx.beginPath();
      ctx.arc(cx, cy + 34, 4, 0, TAU);
      ctx.fill();
    }

    // one row per part: label, HP bar, hp/max numbers
    let ly = Y + 46;
    for (const k in PLAYER_COMPONENTS) {
      const c = p.components[k];
      const color = this.compColor(p, k);
      ctx.font = "bold 11px Consolas, monospace";
      ctx.fillStyle = color;
      ctx.fillText(PLAYER_COMPONENTS[k].short, X + 104, ly);
      // bar
      const bx = X + 130, by = ly - 9, bw = 62, bh = 9;
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = color;
      ctx.fillRect(bx, by, bw * clamp(c.hp / c.max, 0, 1), bh);
      // numbers (max moves as plating tiers are bought)
      ctx.font = "10px Consolas, monospace";
      ctx.fillStyle = c.hp <= 0 ? "#e74c3c" : "#c0b7a8";
      ctx.fillText(c.hp <= 0 ? "DEAD" : Math.ceil(c.hp) + "/" + c.max, bx + bw + 8, ly);
      ly += 23;
    }
  }

  compColor(p, k) {
    // white blink right after taking damage
    if (p.compFlash[k] > 0 && Math.floor(p.compFlash[k] * 20) % 2 === 0) return "#ffffff";
    const r = p.compRatio(k);
    if (r <= 0) return "#555";
    if (r > 0.6) return "#2ecc71";
    if (r > 0.25) return "#f1c40f";
    return "#e74c3c";
  }
}
