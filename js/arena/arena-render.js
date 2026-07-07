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
    // map logical WORLD-sized viewport onto the (hi-dpi) backing store, then
    // draw everything in that fixed 1280x720 logical space
    ctx.setTransform(this.canvas.width / WORLD.w, 0, 0, this.canvas.height / WORLD.h, 0, 0);
    const vw = WORLD.w, vh = WORLD.h;
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
    // dropped parts on the ground (tier-colored; ones in reach glow brighter)
    const reach = new Set(g.collectibleDrops ? g.collectibleDrops() : []);
    for (const d of g.drops || []) { if (onScreen(d.x, d.y, 20)) this.drawPartDrop(d, reach.has(d)); }
    // mines on the ground, then the Titan, then bullets + cars on top
    for (const m of g.mines || []) { if (onScreen(m.x, m.y, 20)) this.drawMine(m); }
    if (g.boss && !g.boss.dead && onScreen(g.boss.x, g.boss.y, 140)) this.drawBoss(g.boss);
    for (const b of g.bullets || []) { if (onScreen(b.x, b.y, 20)) this.drawBullet(b); }
    for (const bot of g.bots || []) { if (!bot.deadFlag && onScreen(bot.x, bot.y, 60)) this.drawBot(bot); }

    if (!g.dead) this.drawCar(g.player, "#3f88c5"); // hidden while wrecked
    if (g.particles) g.particles.draw(ctx); // level-up + combat bursts (world space)
    ctx.restore();

    // --- screen-space HUD ---
    this.drawMinimap();
    this.drawLeaderboard();
    this.drawKillfeed();
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
      ctx.fillText("SPECTATING" + (name ? ":  " + name : ""), WORLD.w / 2, 86);
      ctx.restore();
      return;
    }
    // wrecked: dim the world behind the death menu
    ctx.fillStyle = "rgba(10,8,6,0.55)";
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    ctx.restore();
  }

  drawBullet(b) {
    const ctx = this.ctx;
    // From the local player's POV: your own shots are yellow, everyone else's
    // (bots, boss — and other humans once there's netcode) read as red danger.
    const col = b.shooter === this.arena.player ? "#ffe066" : "#ff5c5c";
    ctx.save();
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
    ctx.save();
    if (inReach) { // halo showing it can be grabbed
      ctx.strokeStyle = col; ctx.globalAlpha = 0.25 + 0.35 * pulse; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(d.x, d.y, 18, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
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

  // simple chassis + 4 wheels + the chosen weapon (modular part rendering later)
  drawCar(car, color, weapon) {
    const ctx = this.ctx;
    const L = car.length, W = car.width;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading);
    // wheels
    ctx.fillStyle = "#1d1d1f";
    for (const sx of [-L * 0.32, L * 0.32]) {
      ctx.fillRect(sx - 5, -W / 2 - 3, 10, 6);
      ctx.fillRect(sx - 5, W / 2 - 3, 10, 6);
    }
    // body
    ctx.fillStyle = color;
    pathRoundRect(ctx, -L / 2, -W / 2, L, W, 6);
    ctx.fill();
    // windshield
    ctx.fillStyle = "rgba(200,230,255,0.75)";
    ctx.fillRect(L * 0.08, -W * 0.3, L * 0.2, W * 0.6);
    this.drawWeaponGear(ctx, weapon || this.arena.startWeapon, L, W);
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
    const x0 = WORLD.w - S - PAD, y0 = this.arena.touchMode ? PAD + 90 : PAD;
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
    const vw = WORLD.w, vh = WORLD.h;
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
    // Titan marker (gold diamond — the central gravity well)
    const boss = this.arena.boss;
    if (boss && !boss.dead) {
      const bx = x0 + boss.x * sx, by = y0 + boss.y * sy;
      ctx.fillStyle = "#ffd166";
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

  // live standings under the minimap: rank · name · level. The #1 (bounty
  // target) row is gold-highlighted and matches the gold minimap sector.
  drawLeaderboard() {
    const g = this.arena, ctx = this.ctx;
    const lb = g.leaderboard;
    if (!lb || !lb.length) return;
    const S = 150, PAD = 14;
    const x0 = WORLD.w - S - PAD;
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
    // on touch, the SPEND POINTS panel (shown exactly when statPoints>0) shares
    // the top band — hide the feed while it's up so they don't crowd
    if (g.touchMode && g.statPoints > 0) return;
    const compact = g.touchMode;                        // smaller + fewer lines on phones
    const S = 150, PAD = 14;
    const rightX = (WORLD.w - S - PAD) - 12;            // gap to the minimap's left edge
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
    const maxed = g.level >= LEVEL_CAP;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    pathRoundRect(ctx, 16, 14, 210, 94, 8);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffd166";
    ctx.font = "bold 18px 'Segoe UI', sans-serif";
    ctx.fillText("LVL " + g.level + (maxed ? " (MAX)" : ""), 28, 38);
    // hp bar (red)
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(28, 46, 186, 9);
    ctx.fillStyle = "#e74c3c";
    ctx.fillRect(28, 46, 186 * clamp(g.hp / g.maxHp, 0, 1), 9);
    // xp bar (green)
    const frac = maxed ? 1 : clamp(g.xp / g.xpToNext(), 0, 1);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(28, 58, 186, 7);
    ctx.fillStyle = "#7bed9f";
    ctx.fillRect(28, 58, 186 * frac, 7);
    // stat build readout
    ctx.font = "10px Consolas, monospace";
    ctx.fillStyle = "#c0b7a8";
    const s = g.stats;
    ctx.fillText("HP " + s.health + "  SPD " + s.speed + "  RLD " + s.reload + "  DUR " + s.durability + "  RGN " + s.regen, 28, 84);
    if (g.statPoints > 0) {
      ctx.fillStyle = "#ffd166";
      ctx.fillText("+" + g.statPoints + " point" + (g.statPoints > 1 ? "s" : "") + " to spend", 28, 100);
    }
    ctx.restore();

    // RAM: charge gauge (hold FIRE to wind up, release to launch)
    if (g.hasRam()) {
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
      ctx.fillText(b.text, WORLD.w / 2, 130 + i * 54);
      if (b.sub) {
        ctx.fillStyle = "#e8e2d6";
        ctx.font = "14px 'Segoe UI', sans-serif";
        ctx.fillText(b.sub, WORLD.w / 2, 152 + i * 54);
      }
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
