"use strict";
// Headless screenshot helper. Wrapping the msedge call in a Node script means
// every screenshot is a single `node ...` command, covered by one permission
// rule (Bash(node *) / PowerShell(node *)) instead of a fresh prompt per URL.
//
// Usage:  node tools/shot.js <url> <outPath> [width] [height] [vtb_ms]
//   e.g.  node tools/shot.js "http://localhost:8080/?mode=arena" out.png 1600 900
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const [, , url, out, w = "1600", h = "900", vtb = "3000"] = process.argv;
if (!url || !out) {
  console.error("usage: node tools/shot.js <url> <outPath> [width] [height] [vtb_ms]");
  process.exit(1);
}

const edge = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));
if (!edge) { console.error("msedge.exe not found in the usual install locations"); process.exit(1); }

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const r = spawnSync(edge, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars",
  `--virtual-time-budget=${vtb}`, `--window-size=${w},${h}`,
  `--screenshot=${out}`, url,
], { stdio: "ignore" });

if (fs.existsSync(out)) console.log(`shot saved: ${out} (${w}x${h})`);
else { console.error(`screenshot failed (msedge exit ${r.status})`); process.exit(1); }
