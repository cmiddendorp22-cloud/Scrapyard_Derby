"use strict";
// ---------------------------------------------------------------------------
// Scrapyard Arena renderer. Unlike the Gauntlet renderer (static full-arena
// camera), this follows the player across a huge world: a scrolling tiled
// floor, a world-space entity pass under a camera transform (viewport-culled),
// then screen-space HUD + minimap. `ARENA` lives in arena.js.
// ---------------------------------------------------------------------------

class ArenaRenderer {
  constructor(canvas, arena) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.arena = arena;
    this.tile = this.makeTile();
    this.pattern = null; // built lazily from a live ctx
    this.skids = [];     // {x1,y1,x2,y2,age} rubber segments (same system as Gauntlet)
  }

  resetMarks() { this.skids = []; }

  // -- skid marks (ported from the Gauntlet renderer; SKID_LIFE/SKID_FADE shared) --
  updateSkids(dt) {
    for (const s of this.skids) s.age += dt;
    let cut = 0; // oldest are always at the front
    while (cut < this.skids.length && this.skids[cut].age >= SKID_LIFE) cut++;
    if (cut) this.skids.splice(0, cut);
  }

  // lay rubber segments when a car slides sideways hard (player OR bot)
  recordSkids(car) {
    if (car.lateralSpeed > 120 && car.speed > 60) {
      const fwd = car.forward;
      const right = { x: -fwd.y, y: fwd.x };
      for (const s of [-1, 1]) {
        const wx = car.x + right.x * s * car.width * 0.4;
        const wy = car.y + right.y * s * car.width * 0.4;
        this.skids.push({ x1: wx - car.vx * 0.02, y1: wy - car.vy * 0.02, x2: wx, y2: wy, age: 0 });
      }
      if (this.skids.length > 4000) this.skids.splice(0, this.skids.length - 4000);
    }
  }

  // batched by fade level (like Gauntlet) + viewport-culled for the big map
  drawSkids(ctx, camL, camT, vw, vh) {
    if (!this.skids.length) return;
    const inView = (s) => s.x1 >= camL - 20 && s.x1 <= camL + vw + 20 && s.y1 >= camT - 20 && s.y1 <= camT + vh + 20;
    ctx.strokeStyle = "#141210";
    ctx.lineWidth = 3;
    const solidEnd = SKID_LIFE - SKID_FADE;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    for (const s of this.skids) {
      if (s.age >= solidEnd || !inView(s)) continue;
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.stroke();
    const buckets = 8;
    for (let b = 0; b < buckets; b++) {
      const from = solidEnd + (b / buckets) * SKID_FADE;
      const to = solidEnd + ((b + 1) / buckets) * SKID_FADE;
      ctx.globalAlpha = 0.25 * (1 - (b + 0.5) / buckets);
      ctx.beginPath();
      let any = false;
      for (const s of this.skids) {
        if (s.age < from || s.age >= to || !inView(s)) continue;
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        any = true;
      }
      if (any) ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // small repeatable dirt tile (cheap infinite scroll vs a huge pre-render)
  makeTile() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    x.fillStyle = "#37322b";
    x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 90; i++) {
      x.fillStyle = fxRand() < 0.5 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.05)";
      x.fillRect(fxRand(0, 128), fxRand(0, 128), fxRand(1, 3), fxRand(1, 3));
    }
    return c;
  }

  draw() {
    const g = this.arena, ctx = this.ctx;
    // map the logical VIEW-sized viewport onto the (hi-dpi) backing store, then
    // draw everything in that area-locked logical space (VIEW matches the canvas
    // aspect, so the context scale stays uniform = no distortion)
    ctx.setTransform(this.canvas.width / VIEW.w, 0, 0, this.canvas.height / VIEW.h, 0, 0);
    const vw = VIEW.w, vh = VIEW.h;
    const camL = g.cam.x - vw / 2, camT = g.cam.y - vh / 2;

    // --- scrolling tiled floor (screen space, offset by camera mod tile) ---
    if (!this.pattern) this.pattern = ctx.createPattern(this.tile, "repeat");
    ctx.save();
    const ox = ((camL % 128) + 128) % 128, oy = ((camT % 128) + 128) % 128;
    ctx.translate(-ox, -oy);
    ctx.fillStyle = this.pattern;
    ctx.fillRect(0, 0, vw + 128, vh + 128);
    ctx.restore();

    // --- world space: walls, scrap, cars ---
    ctx.save();
    ctx.translate(vw / 2 - g.cam.x, vh / 2 - g.cam.y);

    // boundary walls
    ctx.strokeStyle = "#5a5148";
    ctx.lineWidth = ARENA.wall;
    ctx.strokeRect(ARENA.wall / 2, ARENA.wall / 2, ARENA.w - ARENA.wall, ARENA.h - ARENA.wall);
    ctx.strokeStyle = "#c9a227";
    ctx.lineWidth = 4;
    ctx.setLineDash([26, 18]);
    ctx.strokeRect(ARENA.wall, ARENA.wall, ARENA.w - 2 * ARENA.wall, ARENA.h - 2 * ARENA.wall);
    ctx.setLineDash([]);

    const onScreen = (x, y, pad) => x >= camL - pad && x <= camL + vw + pad && y >= camT - pad && y <= camT + vh + pad;

    // rubber on the floor, under everything else
    this.drawSkids(ctx, camL, camT, vw, vh);

    // scrap (viewport-culled)
    for (const s of g.scrap) { if (onScreen(s.x, s.y, 40)) this.drawScrap(s); }
    // loot crates (roaming reward — cracked by bullets or a moving car)
    for (const c of g.crates || []) { if (!c.dead && onScreen(c.x, c.y, 30)) this.drawCrate(c); }
    // dropped parts on the ground (tier-colored; ones in reach glow brighter)
    const reach = new Set(g.collectibleDrops ? g.collectibleDrops() : []);
    for (const d of g.drops || []) { if (onScreen(d.x, d.y, 20)) this.drawPartDrop(d, reach.has(d)); }
    // mines on the ground, then the Titan, then bullets + cars on top
    for (const m of g.mines || []) { if (onScreen(m.x, m.y, 20)) this.drawMine(m); }
    for (const h of g.hooks || []) this.drawHook(h); // grapple tethers
    if (g.boss && !g.boss.dead && onScreen(g.boss.x, g.boss.y, MAGNET_PULL_R + 20)) {
      if (g.boss.kind === "magnet") this.drawMagnet(g.boss); else this.drawBoss(g.boss);
    }
    for (const b of g.bullets || []) { if (onScreen(b.x, b.y, 20)) this.drawBullet(b); }
    for (const bot of g.bots || []) { if (!bot.deadFlag && onScreen(bot.x, bot.y, 60)) this.drawBot(bot); }

    if (!g.dead) {
      this.drawCar(g.player, "#3f88c5"); // hidden while wrecked
      // HP bar above your car, same as the bots' (green = yours)
      const p = g.player, hy = p.y - p.radius - 13, hw = 40;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(p.x - hw / 2, hy, hw, 5);
      ctx.fillStyle = "#5fd35f";
      ctx.fillRect(p.x - hw / 2, hy, hw * clamp(g.hp / g.maxHp, 0, 1), 5);
    }
    if (g.particles) g.particles.draw(ctx); // level-up + combat bursts (world space)
    ctx.restore();

    // --- screen-space HUD ---
    this.drawMinimap();
    this.drawLeaderboard();
    this.drawKillfeed();
    this.drawBossBar();
    this.drawHud();
    this.drawBanners();
    if (g.dead) this.drawDeathOverlay();
  }

  drawDeathOverlay() {
    const g = this.arena, ctx = this.ctx;
    ctx.save();
    ctx.textAlign = "center";
    if (g.spectate) {
      // clean view — just a small "who am I watching" tag under the spectate buttons
      const t = g.spectateTarget();
      const name = !t ? "" : t === g.boss ? "JUNK TITAN" : t.name + "  L" + t.level;
      ctx.fillStyle = "#ffd166";
      ctx.font = "bold 16px 'Segoe UI', sans-serif";
      ctx.fillText("SPECTATING" + (name ? ":  " + name : ""), VIEW.w / 2, 86);
      ctx.restore();
      return;
    }
    // wrecked: dim the world behind the death menu
    ctx.fillStyle = "rgba(10,8,6,0.55)";
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    ctx.restore();
  }

  drawBullet(b) {
    const ctx = this.ctx;
    // From the local player's POV: your own shots are yellow, everyone else's
    // (bots, boss — and other humans once there's netcode) read as red danger.
    const col = b.shooter === this.arena.player ? "#ffe066" : "#ff5c5c";
    ctx.save();
    if (b.railgun) { // piercing slug: a long bright lance with a white-hot core
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * 0.055, b.y - b.vy * 0.055);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * 0.04, b.y - b.vy * 0.04);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
      return;
    }
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

  // a dropped part: a tier-colored chip with a slot glyph + a pulsing ring in
  // the tier color. Parts within reach (collectible) get a brighter halo.
  drawPartDrop(d, inReach) {
    const ctx = this.ctx, p = d.part;
    const col = tierColor(p);
    const glyph = p.slot === "weapon" ? p.type[0].toUpperCase()
      : p.slot === "tires" ? "T" : p.slot === "engine" ? "E" : "A"; // T/E/W/A
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 250 + d.x);
    // despawn blink: in its final ~8s a drop flickers, faster as it nears 0,
    // so players see it's about to vanish (cosmetic — uses the render clock)
    const life = (typeof DROP_DESPAWN !== "undefined" ? DROP_DESPAWN : 30);
    const remain = life - (d.age || 0);
    let blink = 1;
    if (remain < 8) {
      const urgency = Math.max(0, 1 - remain / 8);     // 0 → 1 as it dies
      const freq = 6 + urgency * 26;                   // blink accelerates
      blink = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(performance.now() / 1000 * freq));
    }
    ctx.save();
    ctx.globalAlpha = blink;
    if (inReach) { // halo showing it can be grabbed
      ctx.strokeStyle = col; ctx.globalAlpha = blink * (0.25 + 0.35 * pulse); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(d.x, d.y, 18, 0, TAU); ctx.stroke();
      ctx.globalAlpha = blink;
    }
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(d.x, d.y, 13, 0, TAU); ctx.stroke();
    ctx.fillStyle = col;
    pathRoundRect(ctx, d.x - 8, d.y - 8, 16, 16, 4); ctx.fill();
    ctx.fillStyle = "#14110c";
    ctx.font = "bold 12px 'Segoe UI', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(glyph, d.x, d.y + 1);
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }

  // the minelayer hook: a chain from the owner to the hook head (or the reeled
  // car). Yours reads yellow; everyone else's red (matches bullets/mines).
  drawHook(h) {
    if (h.dead) return;
    const ctx = this.ctx, o = h.owner;
    const yours = o === this.arena.player;
    ctx.save();
    ctx.strokeStyle = yours ? "#ffd166" : "#ff5c5c";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]); // chain look
    ctx.beginPath();
    ctx.moveTo(o.x + Math.cos(h.angle) * o.radius, o.y + Math.sin(h.angle) * o.radius);
    ctx.lineTo(h.hx, h.hy);
    ctx.stroke();
    ctx.setLineDash([]);
    // hook head (a small claw)
    ctx.fillStyle = yours ? "#ffd166" : "#ff5c5c";
    ctx.beginPath(); ctx.arc(h.hx, h.hy, 5, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawMine(m) {
    const ctx = this.ctx;
    // your own mines read yellow/amber; enemy mines are ringed + blink RED
    const yours = m.owner === this.arena.player;
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(m.x, m.y, 7, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = yours ? "#3d3d3d" : "#ff5c5c";
    ctx.lineWidth = 2;
    ctx.stroke();
    const on = Math.sin(performance.now() / 150) > 0; // armed blink
    if (m.arm <= 0) ctx.fillStyle = yours ? (on ? "#ffd166" : "#5c4512") : (on ? "#ff3b30" : "#5c1512");
    else ctx.fillStyle = yours ? "#8a6d1f" : "#a33a33";
    ctx.beginPath();
    ctx.arc(m.x, m.y, 2.5, 0, TAU);
    ctx.fill();
  }

  drawScrap(s) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.seed);
    ctx.scale(s.scale, s.scale);
    ctx.fillStyle = "#6e5f4b";
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 16, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#8a7a5f";
    ctx.fillRect(-12, -9, 12, 7);
    ctx.fillStyle = "#7c8794";
    ctx.fillRect(0, -3, 14, 6);
    ctx.restore();
  }

  // loot crate: a banded wooden box with a gold latch — shoot or smash it open.
  // Damage state shows as splintering (darker + cracked) once it's been shot.
  drawCrate(c) {
    const ctx = this.ctx, r = c.r;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate((c.seed / TAU - 0.5) * 0.26); // slight ±7° seeded tilt so they don't grid up
    const hurt = c.hp < CRATE_HP;
    ctx.fillStyle = hurt ? "#6d5327" : "#8a6a32";        // wood (darker once shot)
    pathRoundRect(ctx, -r, -r, r * 2, r * 2, 3);
    ctx.fill();
    ctx.strokeStyle = "#4c3a1c";                          // plank seams
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r, -r * 0.33); ctx.lineTo(r, -r * 0.33);
    ctx.moveTo(-r, r * 0.33); ctx.lineTo(r, r * 0.33);
    ctx.stroke();
    ctx.strokeStyle = "#3d2f17";                          // metal edge band
    ctx.lineWidth = 2.5;
    pathRoundRect(ctx, -r, -r, r * 2, r * 2, 3);
    ctx.stroke();
    ctx.fillStyle = "#ffd166";                            // gold latch = "loot!"
    ctx.fillRect(-3, -3, 6, 6);
    if (hurt) {                                           // splinter cracks
      ctx.strokeStyle = "#2e2312";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.7); ctx.lineTo(-r * 0.1, -r * 0.1);
      ctx.moveTo(r * 0.7, r * 0.2); ctx.lineTo(r * 0.15, r * 0.75);
      ctx.stroke();
    }
    ctx.restore();
  }

  // simple chassis + 4 wheels + the chosen weapon (modular part rendering later)
  drawCar(car, color, weapon) {
    const ctx = this.ctx;
    const L = car.length, W = car.width;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading);
    // wheels — PER-WHEEL damage cues (dismemberment): a freshly-chipped wheel
    // FLASHES, a broken wheel hangs askew + rusty, a mending wheel pulses green
    // (out-of-combat auto-repair). Local frame: front = +x, car's LEFT = -y.
    const comps = car.components || {};
    const flash = car.compFlash || {};
    const now = performance.now();
    for (const key of ["wheelFL", "wheelFR", "wheelRL", "wheelRR"]) {
      const c = comps[key];
      const sx = (key[5] === "F" ? 1 : -1) * L * 0.32;
      const ly = (key[6] === "L" ? -W / 2 : W / 2) - 3;
      const broken = c && c.hp <= 0;
      ctx.fillStyle = flash[key] > 0 ? "#ffd9c9"                 // just chipped: flash
        : broken ? "#4a2b20"                                     // broken: rusty
        : c && c.hp / c.max < 0.5 ? "#33231d"                    // hurting: browned
        : "#1d1d1f";
      if (broken) { // hangs askew off the axle
        ctx.save();
        ctx.translate(sx, ly + 3 + (key[6] === "L" ? -2 : 2));
        ctx.rotate(sx < 0 ? 0.5 : -0.5);
        ctx.fillRect(-5, -3, 10, 6);
        ctx.restore();
      } else {
        ctx.fillRect(sx - 5, ly, 10, 6);
      }
      if (car.wheelMending && c && c.hp < c.max) { // pulsing green = repairing
        ctx.fillStyle = "rgba(95,211,95," + (0.35 + 0.3 * Math.sin(now / 130)) + ")";
        ctx.fillRect(sx - 6, ly - 1, 12, 8);
      }
    }
    // body
    ctx.fillStyle = color;
    pathRoundRect(ctx, -L / 2, -W / 2, L, W, 6);
    ctx.fill();
    // windshield
    ctx.fillStyle = "rgba(200,230,255,0.75)";
    ctx.fillRect(L * 0.08, -W * 0.3, L * 0.2, W * 0.6);
    // railgun state → on-car visuals (charging glow / reload bar), player + bots
    const wid = weapon || this.arena.startWeapon;
    this._railState = null;
    if (wid === "railgun") {
      const g = this.arena;
      if (car === g.player) {
        this._railState = { reload: g.railCd > 0 ? clamp(g.railCd / RAIL_CD, 0, 1) : 0 };
      } else if (car.fireTimer !== undefined) {
        this._railState = { reload: car.fireTimer > 0 ? clamp(car.fireTimer / 2.6, 0, 1) : 0 };
      }
    }
    this.drawWeaponGear(ctx, wid, L, W);
    this._railState = null;
    ctx.restore();
  }

  // the central Junk Titan: a big armored hull of 4 rim plates around a glowing
  // core. Plates flash when hit and vanish when torn off (exposing the core);
  // a red ring telegraphs the ground-slam wind-up.
  drawBoss(boss) {
    const ctx = this.ctx, R = boss.radius;
    // ground-slam telegraph ring (grows over the wind-up)
    if (boss.slamWind > 0) {
      const t = 1 - boss.slamWind / 0.9;
      ctx.save();
      ctx.strokeStyle = "rgba(231,76,60," + (0.25 + 0.45 * (1 - t)) + ")";
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(boss.x, boss.y, BOSS_SLAM_R * t, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    // shrapnel-ring telegraph: a tightening orange band hugging the hull
    if (boss.ringWind > 0) {
      const rt = 1 - boss.ringWind / 0.6;
      ctx.save();
      ctx.strokeStyle = "rgba(255,150,40," + (0.3 + 0.5 * rt) + ")";
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(boss.x, boss.y, R + 14 - 8 * rt, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(boss.x, boss.y);
    // base hull + core (core glows redder as its HP drops)
    ctx.fillStyle = boss.hitFlash > 0 ? "#efe7d0" : "#4a4038";
    ctx.beginPath(); ctx.arc(0, 0, R * 0.72, 0, TAU); ctx.fill();
    const coreFrac = clamp(boss.coreHp / boss.coreMax, 0, 1);
    ctx.fillStyle = "rgb(" + Math.round(120 + (1 - coreFrac) * 135) + ",40,30)";
    ctx.beginPath(); ctx.arc(0, 0, R * 0.4, 0, TAU); ctx.fill();
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
    ctx.fillStyle = "rgba(255,80,50," + (0.25 + 0.3 * pulse) + ")";
    ctx.beginPath(); ctx.arc(0, 0, R * 0.24, 0, TAU); ctx.fill();
    // armor plates around the rim (local frame — rotate with the hull)
    ctx.rotate(boss.heading);
    for (const pl of boss.plates) {
      if (pl.dead) continue;
      ctx.save();
      ctx.rotate(pl.ang);
      ctx.fillStyle = pl.hit > 0 ? "#ffffff" : "#6e5a3c";
      ctx.strokeStyle = "#2a231b"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, R, -0.6, 0.6);
      ctx.arc(0, 0, R * 0.6, 0.6, -0.6, true);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0," + (0.45 * (1 - clamp(pl.hp / pl.max, 0, 1))) + ")";
      ctx.fill(); // scorch/cracks as the plate weakens
      ctx.restore();
    }
    ctx.restore();
    // name + toughness bar above
    const y = boss.y - R - 18, w = 96;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(boss.x - w / 2, y, w, 6);
    ctx.fillStyle = "#e67e22";
    ctx.fillRect(boss.x - w / 2, y, w * boss.hpFrac(), 6);
    ctx.font = "bold 13px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd166";
    ctx.fillText("JUNK TITAN", boss.x, y - 5);
    ctx.restore();
  }

  // THE MAGNET: a roaming gravity well. A faint pull-field ring marks the
  // danger zone; a bright ring COLLAPSES inward during the mega-pull telegraph;
  // the core is dark + armored normally and glows bright cyan while OVERLOADED
  // (its only vulnerable window). Red/blue poles read it as a magnet.
  drawMagnet(boss) {
    const ctx = this.ctx, R = boss.radius, now = performance.now();
    const vul = boss.isVulnerable && boss.isVulnerable();
    // pull-field ring + inward streaks (the zone everything is dragged into)
    ctx.save();
    const fp = 0.5 + 0.5 * Math.sin(now / 400);
    ctx.strokeStyle = "rgba(150,120,255," + (0.07 + 0.06 * fp) + ")";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(boss.x, boss.y, MAGNET_PULL_R, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "rgba(150,120,255,0.10)";
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + now / 4000;
      const span = MAGNET_PULL_R - R - 20;
      const r0 = R + 20 + ((now / 5 + i * 71) % span);
      ctx.beginPath();
      ctx.moveTo(boss.x + Math.cos(a) * r0, boss.y + Math.sin(a) * r0);
      ctx.lineTo(boss.x + Math.cos(a) * (r0 + 26), boss.y + Math.sin(a) * (r0 + 26));
      ctx.stroke();
    }
    ctx.restore();
    // mega-pull telegraph: a bright ring collapsing toward the core
    if (boss.megaWind > 0) {
      const t = boss.megaWind / MAGNET_MEGA_WIND; // 1 → 0
      ctx.save();
      ctx.strokeStyle = "rgba(190,90,255," + (0.3 + 0.5 * (1 - t)) + ")";
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(boss.x, boss.y, R + (MAGNET_PULL_R - R) * t, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    // body: dark metal disc + red/blue magnet poles (rotate with heading)
    ctx.save();
    ctx.translate(boss.x, boss.y);
    ctx.rotate(boss.heading);
    ctx.fillStyle = boss.hitFlash > 0 ? "#efe7d0" : "#3a3a42";
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.lineWidth = R * 0.34;
    ctx.strokeStyle = "#c0392b";
    ctx.beginPath(); ctx.arc(0, 0, R * 0.66, -1.25, -0.15); ctx.stroke(); // N pole
    ctx.strokeStyle = "#2c6fb0";
    ctx.beginPath(); ctx.arc(0, 0, R * 0.66, 0.15, 1.25); ctx.stroke();   // S pole
    ctx.restore();
    // core: dark/armored normally, BRIGHT cyan + pulsing while overloaded
    ctx.save();
    ctx.translate(boss.x, boss.y);
    const pulse = 0.5 + 0.5 * Math.sin(now / (vul ? 90 : 220));
    if (vul) {
      ctx.fillStyle = "rgba(120,240,255," + (0.5 + 0.4 * pulse) + ")";
      ctx.beginPath(); ctx.arc(0, 0, R * 0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = "#eaffff";
      ctx.beginPath(); ctx.arc(0, 0, R * 0.26, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = "#1c1c22";
      ctx.beginPath(); ctx.arc(0, 0, R * 0.32, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(150,120,255," + (0.2 + 0.25 * pulse) + ")";
      ctx.beginPath(); ctx.arc(0, 0, R * 0.18, 0, TAU); ctx.fill();
    }
    ctx.restore();
    // name + state + toughness bar above
    const y = boss.y - R - 20, w = 96;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(boss.x - w / 2, y, w, 6);
    ctx.fillStyle = vul ? "#4ad9e6" : "#8a6dff";
    ctx.fillRect(boss.x - w / 2, y, w * boss.hpFrac(), 6);
    ctx.font = "bold 13px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = vul ? "#8ff5ff" : "#b9a9ff";
    ctx.fillText("THE MAGNET", boss.x, y - 5);
    if (vul) { ctx.fillStyle = "#8ff5ff"; ctx.font = "bold 10px 'Segoe UI', sans-serif"; ctx.fillText("OVERLOADED", boss.x, y - 18); }
    else if (boss.megaWind > 0) { ctx.fillStyle = "#e59bff"; ctx.font = "bold 10px 'Segoe UI', sans-serif"; ctx.fillText("CHARGING!", boss.x, y - 18); }
    ctx.restore();
  }

  // a bot: car body + hp bar + name tag; flashes white when hit
  drawBot(bot) {
    const ctx = this.ctx;
    this.drawCar(bot, bot.hitFlash > 0 ? "#ffffff" : "#c0503a", bot.weapon);
    // looting: gold progress ring while it channels a part pickup (drive in
    // close to contest it — proximity aborts the claim)
    if (bot.lootChannel > 0) {
      ctx.save();
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(bot.x, bot.y, bot.radius + 7, -Math.PI / 2,
        -Math.PI / 2 + TAU * clamp(bot.lootChannel / BOT_LOOT_CHANNEL, 0, 1));
      ctx.stroke();
      ctx.restore();
    }
    const y = bot.y - bot.radius - 13, w = 40;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(bot.x - w / 2, y, w, 5);
    ctx.fillStyle = "#e74c3c";
    ctx.fillRect(bot.x - w / 2, y, w * clamp(bot.hp / bot.maxHp, 0, 1), 5);
    ctx.font = "bold 11px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    const isNemesis = this.arena.nemesis === bot;
    ctx.fillStyle = isNemesis ? "#ff5b4d" : "#e8e2d6";
    ctx.fillText(bot.name + " L" + bot.level, bot.x, y - 4);
    if (isNemesis) {
      ctx.fillStyle = "#ff5b4d";
      ctx.font = "bold 10px 'Segoe UI', sans-serif";
      ctx.fillText("NEMESIS", bot.x, y - 16);
    }
  }

  // weapon-specific gear in the car's local frame (+x forward). Shared by the
  // in-game car and the weapon-select portraits so they always match.
  drawWeaponGear(ctx, weaponId, L, W) {
    if (weaponId === "minelayer") {
      ctx.fillStyle = "#22355e"; // rear deploy hatch
      ctx.fillRect(-L / 2 + 3, -W * 0.3, 8, W * 0.6);
      ctx.fillStyle = "#1d1d1f"; // mine discs on the deck
      ctx.beginPath(); ctx.arc(-L * 0.16, -W * 0.18, 3.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(-L * 0.16, W * 0.18, 3.5, 0, TAU); ctx.fill();
    } else if (weaponId === "ram") {
      ctx.fillStyle = "#7f8c8d"; // front plow blade
      ctx.beginPath();
      ctx.moveTo(L / 2, -W / 2 - 2);
      ctx.lineTo(L / 2 + 9, 0);
      ctx.lineTo(L / 2, W / 2 + 2);
      ctx.closePath();
      ctx.fill();
    } else if (weaponId === "shotgun") {
      ctx.fillStyle = "#333b41"; // twin stubby barrels (side-by-side)
      ctx.fillRect(L * 0.1, -W * 0.24 - 2.5, L / 2 - 4, 5);
      ctx.fillRect(L * 0.1, W * 0.24 - 2.5, L / 2 - 4, 5);
      ctx.fillStyle = "#5a4633"; // wooden stock hint at the breech
      ctx.fillRect(L * 0.02, -W * 0.24 - 3.5, 6, W * 0.48 + 7);
    } else if (weaponId === "railgun") {
      // rail state (player + bots): bright coils when READY, coils DIM RED
      // while RELOADING with a thin refill bar tracking along the barrel
      const st = this._railState; // set by drawCar just before the call (null = idle/portrait)
      const reloading = st ? st.reload : 0;
      ctx.fillStyle = "#2b3a4d"; // extra-long thin rail barrel
      ctx.fillRect(-L * 0.1, -1.8, L + 4, 3.6);
      ctx.fillStyle = reloading > 0 ? "#7a3a30" : "#57b8ff"; // spent red vs ready cyan
      ctx.fillRect(L * 0.18, -3, 3, 6);
      ctx.fillRect(L * 0.42, -3, 3, 6);
      ctx.fillStyle = "#1d1d1f"; // muzzle brake
      ctx.fillRect(L / 2 + 2, -3, 4, 6);
      if (reloading > 0) { // thin reload bar refilling along the barrel
        ctx.fillStyle = "rgba(255,120,90,0.8)";
        ctx.fillRect(-L * 0.1, 4, (L + 4) * (1 - reloading), 2);
      }
    } else {
      ctx.fillStyle = "#333b41"; // cannon barrel
      ctx.fillRect(0, -2.5, L / 2 + 9, 5);
    }
  }

  // draw a car with `weaponId` nose-up, centered on a small selection-card canvas
  renderWeaponPortrait(weaponId, cv) {
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save();
    ctx.translate(cv.width / 2, cv.height / 2 + 4);
    ctx.rotate(-Math.PI / 2); // +x forward → up
    const L = 46, W = 28;
    ctx.fillStyle = "#1d1d1f";
    for (const sx of [-L * 0.32, L * 0.32]) {
      ctx.fillRect(sx - 5, -W / 2 - 3, 10, 6);
      ctx.fillRect(sx - 5, W / 2 - 3, 10, 6);
    }
    ctx.fillStyle = "#3f88c5"; // player blue — matches the car you'll drive
    pathRoundRect(ctx, -L / 2, -W / 2, L, W, 6);
    ctx.fill();
    ctx.fillStyle = "rgba(200,230,255,0.75)";
    ctx.fillRect(L * 0.08, -W * 0.3, L * 0.2, W * 0.6);
    this.drawWeaponGear(ctx, weaponId, L, W);
    ctx.restore();
  }

  drawMinimap() {
    const ctx = this.ctx;
    const S = 150, PAD = 14;
    // Touch mode: the DOM pause button owns the extreme top-right corner and
    // overlaps the canvas on near-16:9 phones — drop the map below it. The
    // button is 44 CSS px + 10 top offset, and the canvas can be scaled down
    // to ~0.54 on the 390px-tall design floor, so clear ~100 canvas px.
    const x0 = VIEW.w - S - PAD, y0 = this.arena.touchMode ? PAD + 90 : PAD;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    pathRoundRect(ctx, x0, y0, S, S, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(201,162,39,0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();
    const sx = S / ARENA.w, sy = S / ARENA.h;
    const p = this.arena.player;
    // viewport rectangle
    const vw = VIEW.w, vh = VIEW.h;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.strokeRect(x0 + (this.arena.cam.x - vw / 2) * sx, y0 + (this.arena.cam.y - vh / 2) * sy, vw * sx, vh * sy);
    // bounty sector: highlight the leader's coarse grid cell (pressure, not a pin)
    const leader = this.arena.leaderCar;
    if (leader) {
      const cw = ARENA.w / LB_SECTORS, ch = ARENA.h / LB_SECTORS;
      const cx = Math.floor(clamp(leader.x, 0, ARENA.w - 1) / cw), cy = Math.floor(clamp(leader.y, 0, ARENA.h - 1) / ch);
      ctx.fillStyle = "rgba(255,209,102,0.16)";
      ctx.fillRect(x0 + cx * cw * sx, y0 + cy * ch * sy, cw * sx, ch * sy);
      ctx.strokeStyle = "rgba(255,209,102,0.5)"; ctx.lineWidth = 1;
      ctx.strokeRect(x0 + cx * cw * sx, y0 + cy * ch * sy, cw * sx, ch * sy);
    }
    // bot dots (red)
    ctx.fillStyle = "#e74c3c";
    for (const bot of this.arena.bots || []) {
      if (bot.deadFlag) continue;
      ctx.beginPath();
      ctx.arc(x0 + bot.x * sx, y0 + bot.y * sy, 2.5, 0, TAU);
      ctx.fill();
    }
    // nemesis marker (red diamond, white outline — the bot that last wrecked you)
    const nem = this.arena.nemesis;
    if (nem && !nem.deadFlag) {
      const mx = x0 + nem.x * sx, my = y0 + nem.y * sy;
      ctx.fillStyle = "#ff3b30"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx, my - 5); ctx.lineTo(mx + 5, my); ctx.lineTo(mx, my + 5); ctx.lineTo(mx - 5, my);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // boss marker (diamond) — gold Titan / purple Magnet
    const boss = this.arena.boss;
    if (boss && !boss.dead) {
      const bx = x0 + boss.x * sx, by = y0 + boss.y * sy;
      ctx.fillStyle = boss.kind === "magnet" ? "#a98bff" : "#ffd166";
      ctx.beginPath();
      ctx.moveTo(bx, by - 5); ctx.lineTo(bx + 5, by); ctx.lineTo(bx, by + 5); ctx.lineTo(bx - 5, by);
      ctx.closePath(); ctx.fill();
    }
    // player dot
    ctx.fillStyle = "#3f88c5";
    ctx.beginPath();
    ctx.arc(x0 + p.x * sx, y0 + p.y * sy, 3.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // slim JUNK TITAN healthbar pinned to the top-center whenever it's alive
  // (the transient DOM panels overlay it briefly — they own the top layer)
  drawBossBar() {
    const g = this.arena, boss = g.boss, ctx = this.ctx;
    if (!boss || boss.dead) return;
    // fight UI, not world-status UI: only while the VIEW is approaching the
    // Titan (~1200px, camera-based so it also works while spectating)
    if (dist(g.cam.x, g.cam.y, boss.x, boss.y) > 1200) return;
    // drops below the spectate button row when it's up
    const w = 320, h = 9, x = (VIEW.w - w) / 2, y = g.spectate ? 64 : 16;
    const magnet = boss.kind === "magnet", vul = magnet && boss.isVulnerable && boss.isVulnerable();
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = magnet ? (vul ? "#8ff5ff" : "#b9a9ff") : "#ffd166";
    ctx.font = "bold 11px 'Segoe UI', sans-serif";
    let label = boss.name;
    if (vul) label += "  —  OVERLOADED";
    else if (magnet && boss.megaWind > 0) label += "  —  CHARGING!";
    ctx.fillText(label, VIEW.w / 2, y - 4);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    pathRoundRect(ctx, x - 2, y - 2, w + 4, h + 4, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = magnet ? (vul ? "#4ad9e6" : "#8a6dff") : "#e67e22";
    ctx.fillRect(x, y, w * boss.hpFrac(), h);
    ctx.restore();
  }

  // live standings under the minimap: rank · name · level. The #1 (bounty
  // target) row is gold-highlighted and matches the gold minimap sector.
  drawLeaderboard() {
    const g = this.arena, ctx = this.ctx;
    const lb = g.leaderboard;
    if (!lb || !lb.length) return;
    const S = 150, PAD = 14;
    const x0 = VIEW.w - S - PAD;
    const top = (g.touchMode ? PAD + 90 : PAD) + S + 8; // just below the minimap
    const rows = Math.min(g.touchMode ? 3 : 5, lb.length);
    const headH = 16, rowH = 15, h = headH + rows * rowH + 4;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    pathRoundRect(ctx, x0, top, S, h, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(201,162,39,0.5)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffd166";
    ctx.font = "bold 10px 'Segoe UI', sans-serif";
    ctx.fillText("LEADERBOARD", x0 + 8, top + 12);
    ctx.font = "11px 'Segoe UI', sans-serif";
    for (let i = 0; i < rows; i++) {
      const e = lb[i], ry = top + headH + i * rowH, isLeader = e.car === g.leaderCar;
      if (isLeader) { ctx.fillStyle = "rgba(255,209,102,0.18)"; ctx.fillRect(x0 + 3, ry, S - 6, rowH); }
      const y = ry + 11;
      ctx.fillStyle = isLeader ? "#ffd166" : (e.isPlayer ? "#7bd3ff" : "#d8cfc0");
      ctx.textAlign = "left";
      const nm = e.name.length > 12 ? e.name.slice(0, 11) + "…" : e.name;
      ctx.fillText((isLeader ? "★ " : (i + 1) + ". ") + nm, x0 + 8, y);
      ctx.textAlign = "right";
      ctx.fillText("L" + e.level, x0 + S - 8, y);
    }
    ctx.restore();
  }

  // scrolling killfeed of recent wrecks, right-aligned just LEFT of the minimap.
  // No panel box — text with a drop shadow so it reads over the world. Newest on
  // top; player-involved lines blue, RAMPAGE lines gold.
  drawKillfeed() {
    const g = this.arena, fk = g.killfeed, ctx = this.ctx;
    if (!fk || !fk.length) return;
    // (the SPEND POINTS panel now docks to the BOTTOM, so the feed no longer
    // needs to hide while points are pending)
    const compact = g.touchMode;                        // smaller + fewer lines on phones
    const S = 150, PAD = 14;
    const rightX = (VIEW.w - S - PAD) - 12;            // gap to the minimap's left edge
    const topY = (g.touchMode ? PAD + 90 : PAD) + 12;   // aligned with the minimap top
    const rows = Math.min(compact ? 3 : 6, fk.length);
    const fs = compact ? 10 : 12, lh = compact ? 14 : 16;
    ctx.save();
    ctx.textAlign = "right";
    ctx.font = fs + "px 'Segoe UI', sans-serif";
    for (let i = 0; i < rows; i++) {
      const e = fk[i];
      ctx.globalAlpha = e.age > 4.5 ? clamp((5 - e.age) / 0.5, 0, 1) : 1; // fade the last 0.5s
      const y = topY + i * lh;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(e.text, rightX + 1, y + 1);          // shadow
      ctx.fillStyle = e.streak ? "#ffd166" : (e.you ? "#7bd3ff" : "#d8cfc0");
      ctx.fillText(e.text, rightX, y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // top-left progression HUD: level, XP bar, and the current stat build.
  // Stat POINT SPENDING is DOM buttons (#arena-stats) so it's tappable; this
  // is the always-on readout.
  drawHud() {
    const g = this.arena, ctx = this.ctx;
    // while SPECTATING a bot, the top-left panel shows THAT bot's level + build
    // (user request); otherwise it's your own. Spectating the boss/nothing → no panel.
    const watched = (g.dead && g.spectate) ? g.spectateTarget() : null;
    const bot = watched && watched !== g.boss && watched.stats ? watched : null;
    if (g.dead && g.spectate && !bot) return; // boss / nobody to show a build for
    const level = bot ? bot.level : g.level;
    const hp = bot ? bot.hp : g.hp, maxHp = bot ? bot.maxHp : g.maxHp;
    const s = bot ? bot.stats : g.stats;
    const statPoints = bot ? (bot.statPoints || 0) : g.statPoints;
    const maxed = level >= LEVEL_CAP;
    const xpFrac = maxed ? 1 : (bot ? clamp(bot.xp / arenaXpToNext(bot.level), 0, 1) : clamp(g.xp / g.xpToNext(), 0, 1));
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    pathRoundRect(ctx, 16, 14, 210, 94, 8);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.fillStyle = bot ? "#ff8b7a" : "#ffd166"; // reddish tint when watching a bot (name is in the top-center SPECTATING label)
    ctx.font = "bold 18px 'Segoe UI', sans-serif";
    ctx.fillText("LVL " + level + (maxed ? " (MAX)" : ""), 28, 38);
    // hp bar (red)
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(28, 46, 186, 9);
    ctx.fillStyle = "#e74c3c";
    ctx.fillRect(28, 46, 186 * clamp(hp / maxHp, 0, 1), 9);
    // xp bar (green)
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(28, 58, 186, 7);
    ctx.fillStyle = "#7bed9f";
    ctx.fillRect(28, 58, 186 * xpFrac, 7);
    // WHEEL health mini-diagram (dismemberment readout — user): a nose-up car
    // chip in the panel's top-right, one pip per wheel colored by its health
    // (green → red, dark = broken, bright green pulse = mending)
    const wcar = bot || g.player;
    if (wcar.components && wcar.components.wheelFL) {
      const bx = 198, by = 20;
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      pathRoundRect(ctx, bx, by, 13, 23, 3);
      ctx.fill();
      const pips = { wheelFL: [bx - 5, by + 2], wheelFR: [bx + 12, by + 2], wheelRL: [bx - 5, by + 14], wheelRR: [bx + 12, by + 14] };
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 130);
      for (const k of ["wheelFL", "wheelFR", "wheelRL", "wheelRR"]) {
        const c = wcar.components[k], r = clamp(c.hp / c.max, 0, 1);
        if (wcar.wheelMending && c.hp < c.max) {
          ctx.fillStyle = "rgba(95,211,95," + pulse.toFixed(2) + ")"; // mending
        } else if (c.hp <= 0) {
          ctx.fillStyle = "#3a2a24"; // broken
        } else {
          ctx.fillStyle = "rgb(" + Math.round(90 + (1 - r) * 145) + "," + Math.round(40 + 185 * r) + ",55)";
        }
        ctx.fillRect(pips[k][0], pips[k][1], 6, 8);
      }
    }
    // stat build readout (bots have no regen stat)
    ctx.font = "10px Consolas, monospace";
    ctx.fillStyle = "#c0b7a8";
    let line = "HP " + s.health + "   SPD " + s.speed + "   RLD " + s.reload;
    if (s.regen !== undefined) line += "   RGN " + s.regen;
    ctx.fillText(line, 28, 84);
    if (statPoints > 0) {
      ctx.fillStyle = "#ffd166";
      ctx.fillText("+" + statPoints + " point" + (statPoints > 1 ? "s" : "") + " to spend", 28, 100);
    }
    ctx.restore();

    // RAILGUN: RELOAD gauge — fills back up after a shot; READY when full
    if (!g.dead && g.hasRailgun()) {
      const ready = g.railCd <= 0;
      const val = ready ? 1 : 1 - clamp(g.railCd / RAIL_CD, 0, 1);
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      pathRoundRect(ctx, 16, 114, 210, 26, 8);
      ctx.fill();
      ctx.fillStyle = ready ? "#57b8ff" : "#c0b7a8";
      ctx.font = "bold 11px 'Segoe UI', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(ready ? "READY" : "RELOAD", 28, 131);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(84, 123, 130, 9);
      ctx.fillStyle = ready ? "#57b8ff" : "#5a6672";
      ctx.fillRect(84, 123, 130 * val, 9);
      ctx.restore();
    }

    // RAM: charge gauge (hold FIRE to wind up, release to launch) — alive player only
    if (!g.dead && g.hasRam()) {
      const boosting = g.ramBoostT > 0;
      const val = boosting ? 1 : clamp(g.ramCharge, 0, 1);
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      pathRoundRect(ctx, 16, 114, 210, 26, 8);
      ctx.fill();
      ctx.fillStyle = boosting ? "#e74c3c" : "#c0b7a8";
      ctx.font = "bold 11px 'Segoe UI', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(boosting ? "CHARGE!" : "CHARGE", 28, 131);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(84, 123, 130, 9);
      ctx.fillStyle = boosting ? "#e74c3c" : (g.ramCharge >= 1 ? "#e67e22" : "#c9a227");
      ctx.fillRect(84, 123, 130 * val, 9);
      ctx.restore();
    }
  }

  drawBanners() {
    const g = this.arena, ctx = this.ctx;
    if (!g.banners || !g.banners.length) return;
    ctx.save();
    ctx.textAlign = "center";
    g.banners.forEach((b, i) => {
      const a = b.age < 0.25 ? b.age / 0.25 : b.age > b.dur - 0.4 ? (b.dur - b.age) / 0.4 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = "#ffd166";
      ctx.font = "bold 30px 'Segoe UI', sans-serif";
      ctx.fillText(b.text, VIEW.w / 2, 130 + i * 54);
      if (b.sub) {
        ctx.fillStyle = "#e8e2d6";
        ctx.font = "14px 'Segoe UI', sans-serif";
        ctx.fillText(b.sub, VIEW.w / 2, 152 + i * 54);
      }
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
