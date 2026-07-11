"use strict";
// Two clients connect to the same server; each should see BOTH human cars in
// its snapshots — the multiplayer proof.
const WebSocket = require("ws");
let done = 0;
function client(name, steer, cb) {
  const ws = new WebSocket("ws://localhost:8090");
  let id = null, last = null;
  ws.on("open", () => {
    ws.send(JSON.stringify({ type: "join", room: process.env.ROOM || "TEST", name }));
    setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: "input", throttle: 1, steer, fire: false })), 33);
  });
  ws.on("message", (d) => { const m = JSON.parse(d); if (m.type === "welcome") id = m.id; if (m.type === "snap") last = m; });
  setTimeout(() => cb(name, id, last, ws), 1600);
}
function report(name, id, last, ws) {
  const players = last.cars.filter((c) => c.k === "p");
  console.log(name + ": id=" + id + " | sees " + players.length + " human cars [" +
    players.map((p) => p.n + "#" + p.id).join(", ") + "] | total cars " + last.cars.length);
  ws.close();
  if (++done === 2) process.exit(0);
}
client("ALICE", 0, report);
setTimeout(() => client("BOB", 0.5, report), 200);
