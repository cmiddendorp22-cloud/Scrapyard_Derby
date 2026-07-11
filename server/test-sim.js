"use strict";
// quick check: the headless authoritative world ticks, a player can join, drive
// from an input object, and fire — no browser, no ws yet.
const { sim, createWorld } = require("./sim-host");

const world = createWorld(12345);
console.log("world built. bots:", world.bots.length, "boss:", world.boss && world.boss.kind, "players:", world.players.length);

// a joining client = a new ArenaPlayer with its own plain input object
function addPlayer(name, x, y) {
  const input = { throttle: 0, steer: 0, handbrake: false, touch: { active: false },
    fire: false, mouseDown: false, hookHeld: false, touchAbility1: false,
    autoFire: false, touchFire: false, layoutEdit: false };
  const p = new sim.ArenaPlayer();
  p.name = name; p.input = input; p.aimAngle = 0;
  p.car = new sim.Car(x, y, 0, { accel: 680, maxSpeed: 400, turnRate: 2.9, grip: 7, drag: 0.6 });
  p.loadout = world.freshLoadout("cannon");
  world.applyStats(p);
  p.hp = p.maxHp;
  world.players.push(p);
  return p;
}

const a = addPlayer("ALICE", 900, 900);
const b = addPlayer("BOB", 1200, 900);
a.input.throttle = 1; a.input.fire = true;   // ALICE drives east + fires
b.input.throttle = 1; b.input.steer = 0.5;   // BOB drives + turns

const ax0 = a.car.x, bx0 = b.car.x;
const STEP = 1 / 60;
for (let i = 0; i < 120; i++) world.update(STEP);

console.log("ALICE x moved:", (a.car.x - ax0).toFixed(0), "| BOB x moved:", (b.car.x - bx0).toFixed(0), "| ALICE hp:", a.hp.toFixed(0));
console.log("bullets in world:", world.bullets.length, "| ALICE fired:", world.bullets.some((bl) => bl.shooter === a.car));
console.log("cars() count:", world.cars().length, "(2 players +", world.bots.length, "bots)");
console.log("players finite:", world.players.every((p) => Number.isFinite(p.car.x) && Number.isFinite(p.hp)));
console.log("TICK-OK — authoritative headless world runs with joined players");
