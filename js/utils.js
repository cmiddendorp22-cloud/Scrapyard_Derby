"use strict";
// ---------------------------------------------------------------------------
// Shared math helpers + world constants. Loaded first; everything uses these.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

// Static camera: the world IS the canvas. `wall` is the arena wall thickness.
const WORLD = { w: 1280, h: 720, wall: 18 };

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

// --- SIMULATION randomness: routed through the active seeded RNG so runs are
// reproducible. Game.reset() points _simRandom at its RNG. Any randomness that
// affects game state MUST use rand/randInt/pick (never Math.random directly).
let _simRandom = Math.random;               // replaced by setSimRandom()
function setSimRandom(fn) { _simRandom = fn; }
// rand(x) -> [0,x), rand(a,b) -> [a,b)
function rand(a = 1, b) { return b === undefined ? _simRandom() * a : a + _simRandom() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function pick(arr) { return arr[Math.floor(_simRandom() * arr.length)]; }

// --- COSMETIC randomness: particles, screen shake, floor texture, debris
// tumble, etc. Never affects game state and must stay OFF the deterministic
// stream, so visual code can change freely without shifting the sim sequence.
function fxRand(a = 1, b) { return b === undefined ? Math.random() * a : a + Math.random() * (b - a); }
function fxPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }

// Smallest signed difference between two angles, result in (-PI, PI].
function angleDiff(target, current) {
  let d = (target - current) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ":" + String(s).padStart(2, "0");
}

// Rounded-rect path helper (works everywhere, unlike ctx.roundRect).
function pathRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
