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

// --- SAFEGUARDS (a public tunnel URL is unguessable, but "anyone with the
//     link" shouldn't be a free-for-all): a ROOM CODE gates joins, plus caps
//     on total players, connections per IP, and message rate. ---
function genRoomCode() { const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
const ROOM_CODE = String(process.env.ROOM_CODE || genRoomCode()).toUpperCase();
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS, 10) || 12; // human cap (bots fill the rest)
const MAX_PER_IP = parseInt(process.env.MAX_PER_IP, 10) || 3;    // concurrent conns from one address
const JOIN_TIMEOUT_MS = 5000;       // close a connection that never sends a valid join
const MSG_PER_SEC = 240;            // per-connection message-rate ceiling (drops floods)
// behind a bigger provider's load balancer the socket IP is the proxy's, so the
// per-IP cap needs the real client IP from X-Forwarded-For — opt in with TRUST_PROXY=1
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || "");
function clientIp(req) {
  if (TRUST_PROXY) { const xf = req.headers["x-forwarded-for"]; if (xf) return String(xf).split(",")[0].trim(); }
  return String(req.socket.remoteAddress || "?").replace(/^::ffff:/, "");
}

const world = createWorld();
let nextId = 1;
const clients = new Map();          // ws → { id, player }  (JOINED players only)
const ipCount = new Map();          // ip → concurrent connection count
function safeSend(ws, obj) { try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (_) {} }

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
    const c = { id: pl.netId, k: "p", x: r(pl.car.x), y: r(pl.car.y), h: r3(pl.car.heading),
      hp: r(pl.hp), mhp: r(pl.maxHp), n: pl.name, lv: pl.level, w, dead: !!pl.dead };
    if (pl.netId === selfId) { // the receiving client's own HUD detail
      c.xp = r(pl.xp); c.sp = pl.statPoints; c.st = pl.stats; c.slots = pl.slots;
      // M3 client prediction/reconciliation: echo the last input seq we applied
      // + the car's velocity and drive-physics params (which change with
      // stats/parts) so the client predicts this car with matching physics.
      c.ack = pl._lastSeq || 0; c.vx = r(pl.car.vx); c.vy = r(pl.car.vy);
      c.ms = r(pl.car.maxSpeed); c.ac = r(pl.car.engineAccel); c.tr = r3(pl.car.turnRate);
      c.gr = r3(pl.car.grip); c.dg = r3(pl.car.drag); c.hb = r3(pl.car.handbrakeBoost);
    }
    cars.push(c);
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
    h: r3(world.boss.heading), rad: r(world.boss.radius), hf: r3(world.boss.hpFrac ? world.boss.hpFrac() : 1),
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

wss.on("connection", (ws, req) => {
  const ip = clientIp(req);
  ipCount.set(ip, (ipCount.get(ip) || 0) + 1);
  let joined = false, player = null, msgCount = 0;
  const rateReset = setInterval(() => { msgCount = 0; }, 1000);
  const cleanup = () => {
    clearInterval(rateReset); clearTimeout(joinTimer);
    const c = (ipCount.get(ip) || 1) - 1; if (c <= 0) ipCount.delete(ip); else ipCount.set(ip, c);
    clients.delete(ws);
    if (player) { removePlayer(player); console.log("- player", player.netId, "(", world.players.length, "online )"); }
  };

  // too many connections from one address → refuse before anything else
  if ((ipCount.get(ip) || 0) > MAX_PER_IP) {
    safeSend(ws, { type: "reject", reason: "too many connections from your network" });
    ws.close(); cleanup(); return;
  }
  // must present a valid join (room code) quickly, or we drop the socket
  const joinTimer = setTimeout(() => { if (!joined) { safeSend(ws, { type: "reject", reason: "join timed out" }); ws.close(); } }, JOIN_TIMEOUT_MS);

  ws.on("message", (data) => {
    if (++msgCount > MSG_PER_SEC) return; // flood guard: drop excess this second
    let msg; try { msg = JSON.parse(data); } catch (_) { return; }

    if (!joined) { // the ONLY thing an unauthenticated socket may do is join
      if (msg.type !== "join") return;
      if (String(msg.room || "").toUpperCase() !== ROOM_CODE) {
        safeSend(ws, { type: "reject", reason: "wrong room code" }); ws.close(); return;
      }
      if (world.players.length >= MAX_PLAYERS) {
        safeSend(ws, { type: "reject", reason: "server full" }); ws.close(); return;
      }
      joined = true; clearTimeout(joinTimer);
      player = addPlayer(msg.name);
      clients.set(ws, { id: player.netId, player });
      safeSend(ws, { type: "welcome", id: player.netId,
        arena: { w: sim.ARENA.w, h: sim.ARENA.h, wall: sim.ARENA.wall }, view: { w: sim.VIEW.w, h: sim.VIEW.h } });
      console.log("+ player", player.netId, "\"" + player.name + "\" (", world.players.length, "online )");
      return;
    }

    if (msg.type === "input") {
      const inp = player.input;
      if (typeof msg.seq === "number") player._lastSeq = msg.seq; // for client reconciliation
      inp.throttle = clampNum(msg.throttle); inp.steer = clampNum(msg.steer);
      inp.handbrake = !!msg.handbrake; inp.fire = !!msg.fire;
      inp.mouseDown = !!msg.mouseDown; inp.hookHeld = !!msg.hookHeld;
      inp.touchAbility1 = !!msg.ability; inp.autoFire = !!msg.autoFire;
      if (typeof msg.aim === "number") player.aimAngle = msg.aim;
    } else if (msg.type === "name" && typeof msg.name === "string") {
      player.name = msg.name.slice(0, 14);
    } else if (msg.type === "spendStat" && typeof msg.name === "string") {
      world.spendStat(msg.name, player);
    } else if (msg.type === "respawn") {
      if (player.dead) world.respawnPlayer(msg.weapon, player);
    }
  });

  ws.on("close", cleanup);
  ws.on("error", () => {});
});
function clampNum(v) { v = +v; return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0; }

// -- fixed-timestep authoritative loop + throttled snapshot broadcast ---
let tick = 0, last = Date.now(), acc = 0;
const tickHandle = setInterval(() => {
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
  console.log("┌─────────────────────────────────────────────┐");
  console.log("│  ROOM CODE:  " + ROOM_CODE + "  (players need this to join) │");
  console.log("└─────────────────────────────────────────────┘");
  console.log("  caps: " + MAX_PLAYERS + " players, " + MAX_PER_IP + " conns/IP. Set ROOM_CODE=... to pin the code.");
});

// graceful shutdown: bigger hosts send SIGTERM on deploy/scale/restart — close
// sockets + the listener cleanly instead of dropping the process mid-tick
let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return; shuttingDown = true;
  console.log("shutting down (" + sig + ")…");
  clearInterval(tickHandle);
  for (const ws of wss.clients) { try { ws.close(1001, "server shutting down"); } catch (_) {} }
  wss.close(() => httpServer.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref(); // hard cap if a socket hangs
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
