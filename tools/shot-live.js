"use strict";
// REAL-TIME headless screenshot (unlike shot.js, which uses --virtual-time-budget
// and so can't wait for realtime WebSocket/multiplayer streams). Drives Edge over
// the DevTools protocol: navigate, wait real wall-clock ms, then capture.
//
// Usage:  node tools/shot-live.js <url> <outPath> [width] [height] [waitMs]
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const WebSocket = require(path.join(__dirname, "..", "server", "node_modules", "ws"));

const [, , url, out, w = "1280", h = "720", waitMs = "4000"] = process.argv;
if (!url || !out) { console.error("usage: node tools/shot-live.js <url> <outPath> [w] [h] [waitMs]"); process.exit(1); }

const edge = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));
if (!edge) { console.error("msedge.exe not found"); process.exit(1); }

const PORT = 9333 + Math.floor(Math.random() * 400);
const userDir = path.join(require("os").tmpdir(), "sd-shot-" + PORT);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

const proc = spawn(edge, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  `--window-size=${w},${h}`, "about:blank",
], { stdio: "ignore" });

const getJSON = (u) => new Promise((res, rej) => {
  http.get(u, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on("error", rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let target = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try { const list = await getJSON(`http://localhost:${PORT}/json`); target = list.find((t) => t.webSocketDebuggerUrl && t.type === "page"); if (target) break; } catch (_) {}
  }
  if (!target) { console.error("could not reach Edge DevTools"); proc.kill(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  ws.on("message", (data) => { const m = JSON.parse(data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
  await new Promise((r) => ws.on("open", r));

  await send("Page.enable");
  await send("Page.navigate", { url });
  await sleep(parseInt(waitMs, 10));
  const shot = await send("Page.captureScreenshot", { format: "png" });
  if (shot && shot.data) { fs.writeFileSync(out, Buffer.from(shot.data, "base64")); console.log(`live shot saved: ${out} (${w}x${h})`); }
  else console.error("captureScreenshot returned no data");
  ws.close(); proc.kill();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  process.exit(shot && shot.data ? 0 : 1);
})().catch((e) => { console.error(e); proc.kill(); process.exit(1); });
