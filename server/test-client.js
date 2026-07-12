"use strict";
// Headless ws CLIENT check: connect, stream drive input, and confirm the
// server's snapshots show OUR car moving + other cars present. Proves the
// transport + authoritative sim + input loop without a browser.
const WebSocket = require("ws");
const url = process.env.URL || "ws://localhost:8090";
const ws = new WebSocket(url);
let selfId = null, snaps = 0, startX = null, startY = null, lastSnap = null;

ws.on("open", () => {
  console.log("connected to", url);
  ws.send(JSON.stringify(process.env.ROOM ? { type: "join", room: process.env.ROOM, name: "TESTER" } : { type: "quickplay", name: "TESTER" }));
  // stream "drive + fire" 30x/sec (server ignores input until we've joined)
  const iv = setInterval(() => {
    if (ws.readyState !== 1) return clearInterval(iv);
    ws.send(JSON.stringify({ type: "input", throttle: 1, steer: 0, fire: true, aim: 0 }));
  }, 33);
});

ws.on("message", (data) => {
  const msg = JSON.parse(data);
  if (msg.type === "welcome") { selfId = msg.id; console.log("welcome: id", selfId, "arena", msg.arena.w + "x" + msg.arena.h); return; }
  if (msg.type === "snap") {
    snaps++; lastSnap = msg;
    const me = msg.cars.find((c) => c.id === selfId);
    if (me && startX === null) { startX = me.x; startY = me.y; }
  }
});

setTimeout(() => {
  const me = lastSnap && lastSnap.cars.find((c) => c.id === selfId);
  const moved = me ? Math.hypot(me.x - startX, me.y - startY) : 0;
  console.log("snapshots received:", snaps);
  console.log("my car in snapshot:", !!me, me ? "moved " + moved.toFixed(0) + "px (heading north from spawn)" : "");
  console.log("total cars in world:", lastSnap ? lastSnap.cars.length : 0,
    "| bullets:", lastSnap ? lastSnap.bullets.length : 0,
    "| boss:", lastSnap && lastSnap.boss ? lastSnap.boss.kind : "none",
    "| scrap:", lastSnap ? lastSnap.scrap.length : 0);
  const ok = snaps > 10 && me && moved > 40;
  console.log(ok ? "CLIENT-OK — server simulates my input + streams snapshots" : "FAIL — no movement/snapshots");
  ws.close();
  process.exit(ok ? 0 : 1);
}, 1500);
