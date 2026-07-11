# Scrapyard Arena — multiplayer server

Authoritative game server for Scrapyard Arena (multiplayer M1). Runs the **same
simulation the browser runs** (`js/arena/*`), headless, in Node — one
`ArenaGame` ticked at a fixed timestep. Each WebSocket client is an
`ArenaPlayer`: the client streams its INPUT, the server simulates, and
broadcasts world SNAPSHOTS back. Bots fill the rest of the world.

This folder is **isolated from the game's static client** on purpose: the
client root has no `package.json`, so Netlify keeps serving it as pure static
files. Only the server needs a dependency (`ws`).

## Run

```
cd server
npm install        # first time only (installs ws)
npm start          # or: node server.js   → listens on 0.0.0.0:8090
PORT=1234 npm start
```

Health check: open `http://localhost:8090/` (plain-text status).

## Verify (no browser needed)

```
node test-sim.js     # headless world ticks; two players join, drive, fire
node test-client.js  # one ws client drives + receives snapshots
node test-two.js     # two clients see each other's cars (start the server first)
```

## Hosting (later)

The **client** stays on Netlify (static). This **server** needs an always-on
Node host (Fly.io / Render / Railway free tiers, or a small VPS). Point the
client at `wss://<your-server>` once it's behind TLS. Local dev / LAN play uses
`ws://localhost:8090` or `ws://<lan-ip>:8090`.

## Protocol (M1, JSON — will get compact/binary in M2)

- Client → server: `{type:"input", throttle, steer, handbrake, fire, mouseDown,
  hookHeld, ability, autoFire, aim}` (per frame), `{type:"name", name}`,
  `{type:"respawn", weapon}`.
- Server → client: `{type:"welcome", id, arena, view}` once, then
  `{type:"snap", self, cars, bullets, mines, boss, scrap, crates, drops}` ~20 Hz.
