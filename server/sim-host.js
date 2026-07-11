"use strict";
// ---------------------------------------------------------------------------
// Headless SIM HOST — loads the game's SAME simulation code the browser runs,
// inside a Node vm context with stubbed browser globals + a no-op renderer, so
// the authoritative multiplayer server can run one `ArenaGame` and tick it.
//
// This mirrors the test harness's headless bootstrap (the tests already prove
// ArenaGame.update() runs in Node with no canvas). We load every game script
// EXCEPT main.js (the browser entry point / boot IIFE), then bridge the classes
// we need out of the vm context.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

// --- stubbed browser globals (a canvas that yields no-op 2D contexts, a DOM
//     that returns inert elements, storage/raf/perf shims) ---
const noopCtx = {
  get(t, p) { if (p === "canvas") return t.canvas; if (typeof p === "string" && !(p in t)) return () => undefined; return t[p]; },
  set(t, p, v) { t[p] = v; return true; },
};
function makeCanvas() {
  const c = { width: 1280, height: 720, style: {}, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
  c.getContext = () => new Proxy({ canvas: c }, noopCtx);
  return c;
}
function el() {
  const cls = new Set();
  const node = {
    innerHTML: "", textContent: "", className: "", disabled: false, style: {}, value: "50", width: 110, height: 84,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: () => {}, contains: (c) => cls.has(c) },
    addEventListener() {}, appendChild() {}, append() {},
    getContext: () => new Proxy({ canvas: node }, noopCtx),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  };
  return node;
}
const doc = {
  getElementById: () => el(),
  createElement: (tag) => (tag === "canvas" ? makeCanvas() : el()),
  querySelector: () => el(),
  body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  documentElement: { style: { setProperty() {} } },
  addEventListener() {},
};
const mq = { matches: false, addEventListener() {}, addListener() {} };
const sandbox = {
  console, Math, Object, Array, Map, Set, Number, String, isFinite, parseInt, parseFloat,
  JSON, Date, Symbol, URLSearchParams,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  setTimeout: () => 0, clearTimeout: () => 0,
  localStorage: { getItem: () => null, setItem() {} },
  location: { search: "" },
  window: { addEventListener() {}, innerWidth: 1280, innerHeight: 720, matchMedia: () => mq },
  document: doc,
};
sandbox.window.document = doc;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// --- load every game script (in index.html order) EXCEPT main.js ---
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
for (const m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
  const src = m[1];
  if (src.endsWith("main.js")) continue; // the browser entry point / boot IIFE
  vm.runInContext(fs.readFileSync(path.join(ROOT, src), "utf8"), sandbox, { filename: src });
}

// --- bridge the symbols the server needs out of the context's lexical scope ---
vm.runInContext(
  "globalThis.__sim = { ArenaGame, ArenaPlayer, Car, ARENA, VIEW, RNG, setSimRandom, readDrive };",
  sandbox, { filename: "sim-bridge" }
);
const sim = sandbox.__sim;

// a no-op audio stub (the sim calls audio.playX / setEngine in the update path)
function makeStubAudio() {
  const noop = () => {};
  return { playShoot: noop, playRev: noop, playExplosion: noop, playEnemyShoot: noop,
    playImpact: noop, playClank: noop, playRoundClear: noop, playGameOver: noop,
    playRepair: noop, setEngine: noop, setScreech: noop };
}

// Build one AUTHORITATIVE world. The server has NO local human, so we mark the
// constructor's localPlayer dead + detached (players[] is filled by connecting
// clients). Returns { world, sim } — the server drives world.update(dt).
function createWorld(seed) {
  const canvas = makeCanvas();
  const input = { throttle: 0, steer: 0, handbrake: false, touch: { active: false },
    fire: false, mouseDown: false, hookHeld: false, touchAbility1: false,
    autoFire: false, touchFire: false, layoutEdit: false };
  const world = new sim.ArenaGame(canvas, input, makeStubAudio());
  if (seed !== undefined) { world.seed = seed; world.rng = new sim.RNG(seed); }
  world.touchMode = false;
  world.begin();
  // no player sits at the server itself
  world.localPlayer.dead = true;
  world.players.length = 0;
  return world;
}

module.exports = { sim, createWorld, makeStubAudio };
