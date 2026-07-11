"use strict";
// ---------------------------------------------------------------------------
// Authoritative Scrapyard Arena SERVER (multiplayer M1). Runs ONE headless
// `ArenaGame` (the same sim the browser uses, via sim-host) at a fixed
// timestep. Each WebSocket client is an ArenaPlayer: the client streams its
// INPUT, the server simulates, and broadcasts world SNAPSHOTS back. Bots fill
// the rest of the world.
//
//   node server.js            → listens on 0.0.0.0:8090
//   PORT=1234 node server.js  → custom port
//
// The client is served separately (Netlify / serve.js). It connects here via
// ws://<host>:8090 (wss:// once the server is behind TLS).
// ---------------------------------------------------------------------------

const http = require("http");
const { WebSocketServer } = require("ws");
const { sim, createWorld } = require("./sim-host");

const PORT = parseInt(process.env.PORT, 10) || 8090;
const TICK_HZ = 60;                 // sim steps per second (fixed timestep)
const SNAPSHOT_EVERY = 3;           // broadcast a snapshot every N ticks (~20 Hz)
const STEP = 1 / TICK_HZ;

const world = createWorld();
let nextId = 1;
const clients = new Map();          // ws → { id, player }

// an idle input object the client's messages fill in
function freshInput() {
  return { throttle: 0, steer: 0, handbrake: false, touch: { active: false },
    fire: false, mouseDown: false, hookHeld: false, touchAbility1: false,
    autoFire: false, touchFire: false, layoutEdit: false };
}

function addPlayer(name) {
  const p = new sim.ArenaPlayer();
  p.name = (name || "PLAYER").slice(0, 14);
  p.input = freshInput();
  p.aimAngle = 0;
  const sp = world.playerSpawn();
  p.car = new sim.Car(sp.x, sp.y, -Math.PI / 2, { accel: 680, maxSpeed: 400, turnRate: 2.9, grip: 7, drag: 0.6 });
  p.loadout = world.freshLoadout("cannon");
  world.applyStats(p);
  p.hp = p.maxHp;
  p.netId = nextId++;
  world.players.push(p);
  return p;
}

function removePlayer(p) {
  const i = world.players.indexOf(p);
  if (i >= 0) world.players.splice(i, 1);
}

// -- snapshot: a compact JSON view of the authoritative world. `selfId` tells
//    the receiving client which car is theirs. Kept intentionally simple for
//    M1 (readable JSON); binary/delta compression is an M2 optimization. ------
function snapshot(selfId) {
  const cars = [];
  for (const pl of world.players) {
    if (!pl.car) continue;
    const w = pl.loadout && pl.loadout.weapon1 ? pl.loadout.weapon1.type : "cannon";
    cars.push({ id: pl.netId, k: "p", x: r(pl.car.x), y: r(pl.car.y), h: r3(pl.car.heading),
      hp: r(pl.hp), mhp: r(pl.maxHp), n: pl.name, lv: pl.level, w, dead: !!pl.dead });
  }
  for (const b of world.bots) {
    if (b.deadFlag) continue;
    cars.push({ id: "b" + b.id, k: "b", x: r(b.x), y: r(b.y), h: r3(b.heading),
      hp: r(b.hp), mhp: r(b.maxHp), n: b.name, lv: b.level, w: b.weapon, dead: false });
  }
  const bullets = world.bullets.map((b) => ({ x: r(b.x), y: r(b.y), vx: r(b.vx), vy: r(b.vy),
    rail: !!b.railgun, sid: b.shooter === carOfId(selfId) ? 1 : 0 }));
  const mines = world.mines.filter((m) => !m.dead).map((m) => ({ x: r(m.x), y: r(m.y), arm: m.arm > 0 ? 1 : 0 }));
  const boss = world.boss && !world.boss.dead ? { kind: world.boss.kind, x: r(world.boss.x), y: r(world.boss.y),
    h: r3(world.boss.heading), hf: r3(world.boss.hpFrac ? world.boss.hpFrac() : 1),
    vul: world.boss.isVulnerable ? !!world.boss.isVulnerable() : false } : null;
  const scrap = world.scrap.filter((s) => !s.dead).map((s) => ({ x: r(s.x), y: r(s.y), a: r(s.amount) }));
  const crates = (world.crates || []).filter((c) => !c.dead).map((c) => ({ x: r(c.x), y: r(c.y) }));
  const drops = world.drops.filter((d) => !d.dead).map((d) => ({ x: r(d.x), y: r(d.y),
    slot: d.part.slot, type: d.part.type, tier: d.part.tier }));
  return JSON.stringify({ type: "snap", self: selfId, cars, bullets, mines, boss, scrap, crates, drops });
}
const r = (v) => Math.round(v);
const r3 = (v) => Math.round(v * 1000) / 1000;
function carOfId(id) { const p = world.players.find((pl) => pl.netId === id); return p && p.car; }

// -- HTTP server (health check) + WebSocket upgrade ---
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Scrapyard Arena server OK — players: " + world.players.length + " / bots: " + world.bots.length);
});
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  const player = addPlayer("PLAYER");
  clients.set(ws, { id: player.netId, player });
  ws.send(JSON.stringify({ type: "welcome", id: player.netId,
    arena: { w: sim.ARENA.w, h: sim.ARENA.h, wall: sim.ARENA.wall }, view: { w: sim.VIEW.w, h: sim.VIEW.h } }));
  console.log("+ player", player.netId, "(", world.players.length, "online )");

  ws.on("message", (data) => {
    let msg; try { msg = JSON.parse(data); } catch (_) { return; }
    if (msg.type === "input") {
      const inp = player.input;
      inp.throttle = clampNum(msg.throttle); inp.steer = clampNum(msg.steer);
      inp.handbrake = !!msg.handbrake; inp.fire = !!msg.fire;
      inp.mouseDown = !!msg.mouseDown; inp.hookHeld = !!msg.hookHeld;
      inp.touchAbility1 = !!msg.ability; inp.autoFire = !!msg.autoFire;
      if (typeof msg.aim === "number") player.aimAngle = msg.aim;
    } else if (msg.type === "name" && typeof msg.name === "string") {
      player.name = msg.name.slice(0, 14);
    } else if (msg.type === "respawn") {
      if (player.dead) world.respawnPlayer(msg.weapon, player);
    }
  });

  ws.on("close", () => {
    removePlayer(player);
    clients.delete(ws);
    console.log("- player", player.netId, "(", world.players.length, "online )");
  });
  ws.on("error", () => {});
});
function clampNum(v) { v = +v; return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0; }

// -- fixed-timestep authoritative loop + throttled snapshot broadcast ---
let tick = 0, last = Date.now(), acc = 0;
setInterval(() => {
  const now = Date.now();
  acc += (now - last) / 1000; last = now;
  if (acc > 0.25) acc = 0.25; // after a stall, skip rather than spiral
  while (acc >= STEP) { world.update(STEP); acc -= STEP; tick++; }
  if (tick % SNAPSHOT_EVERY === 0) {
    for (const [ws, c] of clients) {
      if (ws.readyState === 1) ws.send(snapshot(c.id));
    }
  }
}, 1000 / TICK_HZ);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("Scrapyard Arena server on 0.0.0.0:" + PORT + " (tick " + TICK_HZ + "Hz, snapshot ~" + Math.round(TICK_HZ / SNAPSHOT_EVERY) + "Hz)");
});
