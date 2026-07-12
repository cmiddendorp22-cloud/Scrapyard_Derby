"use strict";
// ---------------------------------------------------------------------------
// Authoritative Scrapyard Arena SERVER — MULTI-ROOM (agar/diep-style).
// Runs MANY headless `ArenaGame` worlds (one per room) in a single Node process,
// each ticked at a fixed timestep. A WebSocket client seats into a room three
// ways:
//   {type:"quickplay", name}          → matchmake into a public room (or make one)
//   {type:"create",    name, maxPlayers} → open a PRIVATE room, get an invite code
//   {type:"join",      room, name}     → join an existing room by code
// The client streams INPUT; the server simulates its room and broadcasts that
// room's SNAPSHOTS back. Bots fill each world.
//
//   node server.js                 → listens on 0.0.0.0:$PORT (default 8090)
//   ROOM_CODE=TEST node server.js  → also opens a permanent public room "TEST"
//   SERVER_PASSWORD=x node ...      → lock the whole server (every seat needs pass)
//
// The client is served separately (Netlify / serve.js); it connects here over
// ws:// (or wss:// behind TLS at the host's edge).
// ---------------------------------------------------------------------------

const http = require("http");
const { WebSocketServer } = require("ws");
const { sim, createWorld } = require("./sim-host");

const PORT = parseInt(process.env.PORT, 10) || 8090;
const TICK_HZ = 60;                 // sim steps per second (fixed timestep)
const SNAPSHOT_EVERY = 3;           // broadcast a snapshot every N ticks (~20 Hz)
const STEP = 1 / TICK_HZ;

function clampInt(v, def, min, max) { v = parseInt(v, 10); if (!Number.isFinite(v)) v = def; return Math.max(min, Math.min(max, v)); }

// --- input validation at the trust boundary. Every field off the wire is
//     untrusted: names are BROADCAST to (and drawn by) other clients, and
//     stat/weapon strings index into game state, so both are sanitized here. ---
const MAX_NAME = 10;                 // display-name cap (user: 10 chars)
// strip C0/C1 controls, zero-width, and bidi-override formatting chars (spoof /
// HUD-corruption vectors), collapse whitespace, clamp, never empty.
function sanitizeName(raw) {
  let s = String(raw == null ? "" : raw);
  s = s.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "");
  s = s.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return s.length ? s : "PLAYER";
}
const STAT_KEYS = ["health", "speed", "reload", "regen"];              // spendStat allowlist
const WEAPON_TYPES = ["cannon", "shotgun", "minelayer", "ram", "railgun"]; // respawn allowlist

// --- SAFEGUARDS / capacity ---
const MAX_PLAYERS_PER_ROOM = clampInt(process.env.MAX_PLAYERS, 12, 2, 24); // humans per room (bots fill the rest)
const MAX_ROOMS = clampInt(process.env.MAX_ROOMS, 200, 1, 5000);          // total rooms cap (memory/DoS)
const MAX_PER_IP = clampInt(process.env.MAX_PER_IP, 3, 1, 32);            // concurrent conns from one address
const ROOM_CREATE_PER_MIN = clampInt(process.env.ROOM_CREATE_PER_MIN, 6, 1, 120); // per-IP room-creation rate
const ROOM_EMPTY_TTL_MS = 30000;    // destroy a non-permanent room after this long empty
const JOIN_TIMEOUT_MS = 5000;       // close a connection that never seats
const MSG_PER_SEC = 240;            // per-connection message-rate ceiling (drops floods)
const SERVER_PASSWORD = String(process.env.SERVER_PASSWORD || ""); // if set, every seat must present it
const DEFAULT_ROOM = process.env.ROOM_CODE ? String(process.env.ROOM_CODE).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) : "";

// behind a bigger provider's load balancer the socket IP is the proxy's, so the
// per-IP cap needs the real client IP from X-Forwarded-For — opt in with TRUST_PROXY=1
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || "");
function clientIp(req) {
  if (TRUST_PROXY) { const xf = req.headers["x-forwarded-for"]; if (xf) return String(xf).split(",")[0].trim(); }
  return String(req.socket.remoteAddress || "?").replace(/^::ffff:/, "");
}

let nextId = 1;
const clients = new Map();          // ws → { room, player }  (SEATED players only)
const ipCount = new Map();          // ip → concurrent connection count
const roomCreateLog = new Map();    // ip → [timestamps] of recent room creations
function safeSend(ws, obj) { try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (_) {} }

// -- rooms: each is its own ArenaGame world -------------------------------
const rooms = new Map();            // code → room
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no easily-confused chars
function genCode() { let c; do { c = ""; for (let i = 0; i < 5; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]; } while (rooms.has(c)); return c; }
function makeRoom(isPublic, maxPlayers, fixedCode) {
  const code = fixedCode || genCode();
  const world = createWorld((Math.random() * 0x7fffffff) | 0); // unique seed per room
  const room = { code, isPublic: !!isPublic, permanent: !!fixedCode, maxPlayers, world, clients: new Set(), emptySince: Date.now() };
  room.rand = () => room.world.rng.next(); // the closure we re-point the global sim-RNG to each tick
  rooms.set(code, room);
  return room;
}
function findOrMakePublicRoom() {
  let best = null;
  for (const room of rooms.values()) {
    if (!room.isPublic || room.clients.size >= room.maxPlayers) continue;
    if (!best || room.clients.size > best.clients.size) best = room; // fill fullest-not-full first
  }
  if (best) return best;
  return rooms.size >= MAX_ROOMS ? null : makeRoom(true, MAX_PLAYERS_PER_ROOM);
}
function canCreateRoom(ip) {
  const now = Date.now();
  const log = (roomCreateLog.get(ip) || []).filter((t) => now - t < 60000);
  roomCreateLog.set(ip, log);
  return log.length < ROOM_CREATE_PER_MIN;
}
function noteRoomCreate(ip) { const log = roomCreateLog.get(ip) || []; log.push(Date.now()); roomCreateLog.set(ip, log); }
function reapRooms(now) {
  for (const [code, room] of rooms) {
    if (room.permanent) continue;
    if (room.clients.size > 0) { room.emptySince = 0; continue; }
    if (!room.emptySince) room.emptySince = now;
    else if (now - room.emptySince > ROOM_EMPTY_TTL_MS) rooms.delete(code);
  }
}
function totalPlayers() { let n = 0; for (const r of rooms.values()) n += r.clients.size; return n; }

// an idle input object the client's messages fill in
function freshInput() {
  return { throttle: 0, steer: 0, handbrake: false, touch: { active: false },
    fire: false, mouseDown: false, hookHeld: false, touchAbility1: false,
    autoFire: false, touchFire: false, layoutEdit: false };
}

function addPlayerToWorld(world, name) {
  const p = new sim.ArenaPlayer();
  p.name = sanitizeName(name);
  p.input = freshInput();
  p.aimAngle = 0;
  const sp = world.playerSpawn();
  p.car = new sim.Car(sp.x, sp.y, -Math.PI / 2, { accel: 680, maxSpeed: 400, turnRate: 2.9, grip: 7, drag: 0.6 });
  p.loadout = world.freshLoadout("cannon");
  world.applyStats(p);
  p.hp = p.maxHp;
  p.netId = nextId++; // globally unique across rooms
  world.players.push(p);
  return p;
}
function removePlayer(world, p) { const i = world.players.indexOf(p); if (i >= 0) world.players.splice(i, 1); }

// -- snapshot: a compact JSON view of ONE room's world. `selfId` tells the
//    receiving client which car is theirs (and gets extra HUD + prediction
//    detail). Kept simple JSON for now; binary/delta is a later optimization. --
function snapshot(world, selfId) {
  const cars = [];
  for (const pl of world.players) {
    if (!pl.car) continue;
    const w = pl.loadout && pl.loadout.weapon1 ? pl.loadout.weapon1.type : "cannon";
    const c = { id: pl.netId, k: "p", x: r(pl.car.x), y: r(pl.car.y), h: r3(pl.car.heading),
      hp: r(pl.hp), mhp: r(pl.maxHp), n: pl.name, lv: pl.level, w, dead: !!pl.dead };
    if (pl.netId === selfId) { // the receiving client's own HUD detail
      c.xp = r(pl.xp); c.sp = pl.statPoints; c.st = pl.stats; c.slots = pl.slots;
      // M3 prediction/reconciliation: echo last-applied input seq + velocity +
      // drive-physics params (which change with stats/parts) for matched prediction.
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
  const selfCar = carOfId(world, selfId);
  const bullets = world.bullets.map((b) => ({ x: r(b.x), y: r(b.y), vx: r(b.vx), vy: r(b.vy),
    rail: !!b.railgun, sid: b.shooter === selfCar ? 1 : 0 }));
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
function carOfId(world, id) { const p = world.players.find((pl) => pl.netId === id); return p && p.car; }

// -- HTTP server (health check) + WebSocket upgrade ---
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Scrapyard Arena server OK — rooms: " + rooms.size + " / players: " + totalPlayers());
});
// maxPayload caps a single message (inputs are tiny — 4KB is generous); stops a
// client from forcing huge allocations. Origin allowlist is opt-in for a public
// deploy (ALLOW_ORIGINS="https://your.site,https://other"); off = accept any.
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: 4096,
  verifyClient: ALLOW_ORIGINS.length ? (info) => ALLOW_ORIGINS.includes(info.origin) : undefined,
});

wss.on("connection", (ws, req) => {
  const ip = clientIp(req);
  ipCount.set(ip, (ipCount.get(ip) || 0) + 1);
  let seated = false, player = null, myRoom = null, msgCount = 0, joinTimer = null;
  const rateReset = setInterval(() => { msgCount = 0; }, 1000);
  const cleanup = () => {
    clearInterval(rateReset); clearTimeout(joinTimer);
    const c = (ipCount.get(ip) || 1) - 1; if (c <= 0) ipCount.delete(ip); else ipCount.set(ip, c);
    clients.delete(ws);
    if (player && myRoom) { removePlayer(myRoom.world, player); myRoom.clients.delete(ws); if (myRoom.clients.size === 0) myRoom.emptySince = Date.now();
      console.log("- player", player.netId, "left", myRoom.code, "(", myRoom.clients.size, "in room )"); }
  };

  // too many connections from one address → refuse before anything else
  if ((ipCount.get(ip) || 0) > MAX_PER_IP) {
    safeSend(ws, { type: "reject", reason: "too many connections from your network" });
    ws.close(); cleanup(); return;
  }
  // must seat (quickplay/create/join) quickly, or we drop the socket
  joinTimer = setTimeout(() => { if (!seated) { safeSend(ws, { type: "reject", reason: "join timed out" }); ws.close(); } }, JOIN_TIMEOUT_MS);

  ws.on("message", (data) => {
   try { // one malformed/hostile message must never crash the shared process
    if (++msgCount > MSG_PER_SEC) return; // flood guard: drop excess this second
    let msg; try { msg = JSON.parse(data); } catch (_) { return; }

    if (!seated) { // an unauthenticated socket may only try to seat into a room
      if (SERVER_PASSWORD && String(msg.pass || "") !== SERVER_PASSWORD) {
        safeSend(ws, { type: "reject", reason: "this server is private" }); ws.close(); return;
      }
      let room = null;
      if (msg.type === "quickplay") {
        room = findOrMakePublicRoom();
        if (!room) { safeSend(ws, { type: "reject", reason: "server at capacity" }); ws.close(); return; }
      } else if (msg.type === "create") {
        if (!canCreateRoom(ip)) { safeSend(ws, { type: "reject", reason: "creating rooms too fast" }); ws.close(); return; }
        if (rooms.size >= MAX_ROOMS) { safeSend(ws, { type: "reject", reason: "server at capacity" }); ws.close(); return; }
        room = makeRoom(false, clampInt(msg.maxPlayers, MAX_PLAYERS_PER_ROOM, 2, MAX_PLAYERS_PER_ROOM));
        noteRoomCreate(ip);
      } else if (msg.type === "join") {
        room = rooms.get(String(msg.room || "").toUpperCase());
        if (!room) { safeSend(ws, { type: "reject", reason: "no room with that code" }); ws.close(); return; }
      } else { return; } // ignore anything else until seated

      if (room.clients.size >= room.maxPlayers) { safeSend(ws, { type: "reject", reason: "room is full" }); ws.close(); return; }
      seated = true; clearTimeout(joinTimer);
      player = addPlayerToWorld(room.world, msg.name);
      myRoom = room; room.clients.add(ws); room.emptySince = 0;
      clients.set(ws, { room, player });
      safeSend(ws, { type: "welcome", id: player.netId, room: room.code, pub: room.isPublic, max: room.maxPlayers,
        arena: { w: sim.ARENA.w, h: sim.ARENA.h, wall: sim.ARENA.wall }, view: { w: sim.VIEW.w, h: sim.VIEW.h } });
      console.log("+ player", player.netId, "\"" + player.name + "\"", (msg.type) + " →", room.code, "(", room.clients.size, "in room /", rooms.size, "rooms )");
      return;
    }

    if (msg.type === "input") {
      const inp = player.input;
      if (Number.isFinite(msg.seq)) player._lastSeq = msg.seq; // for client reconciliation
      inp.throttle = clampNum(msg.throttle); inp.steer = clampNum(msg.steer);
      inp.handbrake = !!msg.handbrake; inp.fire = !!msg.fire;
      inp.mouseDown = !!msg.mouseDown; inp.hookHeld = !!msg.hookHeld;
      inp.touchAbility1 = !!msg.ability; inp.autoFire = !!msg.autoFire;
      if (Number.isFinite(msg.aim)) player.aimAngle = msg.aim; // reject NaN/Infinity
    } else if (msg.type === "name") {
      player.name = sanitizeName(msg.name);
    } else if (msg.type === "spendStat") {
      if (STAT_KEYS.includes(msg.name)) myRoom.world.spendStat(msg.name, player); // allowlist only
    } else if (msg.type === "respawn") {
      if (player.dead) myRoom.world.respawnPlayer(WEAPON_TYPES.includes(msg.weapon) ? msg.weapon : undefined, player);
    }
   } catch (e) { console.error("msg handler error:", e && e.message); }
  });

  ws.on("close", cleanup);
  ws.on("error", () => {});
});
function clampNum(v) { v = +v; return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0; }

// -- fixed-timestep authoritative loop: tick EVERY room, then broadcast each
//    room's snapshot to its own clients. The sim uses a GLOBAL rng pointer, so
//    re-point it at the room's rng before that room updates (worlds stay
//    independent + deterministic per seed). ---
let tick = 0, last = Date.now(), acc = 0;
const tickHandle = setInterval(() => {
  const now = Date.now();
  acc += (now - last) / 1000; last = now;
  if (acc > 0.25) acc = 0.25; // after a stall, skip rather than spiral
  while (acc >= STEP) {
    for (const room of rooms.values()) { sim.setSimRandom(room.rand); try { room.world.update(STEP); } catch (e) { console.error("room", room.code, "tick error:", e && e.message); } }
    acc -= STEP; tick++;
  }
  if (tick % SNAPSHOT_EVERY === 0) {
    for (const room of rooms.values()) {
      for (const ws of room.clients) {
        const c = clients.get(ws);
        if (c && ws.readyState === 1) ws.send(snapshot(room.world, c.player.netId));
      }
    }
  }
  reapRooms(now);
}, 1000 / TICK_HZ);

if (DEFAULT_ROOM) makeRoom(true, MAX_PLAYERS_PER_ROOM, DEFAULT_ROOM); // stable public room for dev/testing

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("Scrapyard Arena MULTI-ROOM server on 0.0.0.0:" + PORT + " (tick " + TICK_HZ + "Hz, snapshot ~" + Math.round(TICK_HZ / SNAPSHOT_EVERY) + "Hz)");
  console.log("  caps: " + MAX_PLAYERS_PER_ROOM + " players/room, " + MAX_ROOMS + " rooms, " + MAX_PER_IP + " conns/IP");
  if (DEFAULT_ROOM) console.log("  permanent public room: " + DEFAULT_ROOM);
  if (SERVER_PASSWORD) console.log("  server is PASSWORD-LOCKED");
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
