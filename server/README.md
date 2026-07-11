# Scrapyard Arena — multiplayer server

Authoritative game server for Scrapyard Arena (multiplayer M1). Runs the **same
simulation the browser runs** (`js/arena/*`), headless, in Node — one
`ArenaGame` ticked at a fixed timestep. Each WebSocket client is an
`ArenaPlayer`: the client streams its INPUT, the server simulates, and
broadcasts world SNAPSHOTS back. Bots fill the rest of the world.

This folder is **isolated from the game's static client** on purpose: the
client root has no `package.json`, so Netlify keeps serving it as pure static
files. Only the server needs a dependency (`ws`).

## Run locally

```
cd server
npm install        # first time only (installs ws)
npm start          # → listens on 0.0.0.0:8090, prints a ROOM CODE
PORT=1234 ROOM_CODE=MYGAME npm start   # pin the port + room code
```

On startup it prints a **ROOM CODE** — players need it to join (the URL alone
isn't enough). Health check: `http://localhost:8090/`.

## Play with friends NOW — free, no credit card

A reliable always-on cloud host without a card basically doesn't exist anymore,
so for now the host is **your own PC + a free Cloudflare tunnel** that gives a
public `wss://` URL. No account, no card.

```
# 1) start the server (note the ROOM CODE it prints)
cd server && npm start

# 2) in a SECOND terminal, expose it publicly (installs once via:
#    winget install Cloudflare.cloudflared)
cloudflared tunnel --url http://localhost:8090
#    → prints  https://<random>.trycloudflare.com
```

Friends open the game (your Netlify URL), choose ONLINE, and enter
`wss://<random>.trycloudflare.com` + the ROOM CODE. (The client "online" mode is
the next build — M1 client.)

Notes:
- Only that one game port is exposed, over TLS, at an unguessable URL — not your
  machine. Closing cloudflared (Ctrl+C) kills the URL.
- The URL changes each time you restart the quick tunnel. A free Cloudflare
  account (still no card) can give a **stable named tunnel** if you want one.
- Your PC must stay on while friends play (it's the host).

## Safeguards

- **Room code** gates joins (`ROOM_CODE` env, else a random 5-char code printed
  at startup). A client must send `{type:"join", room, name}` with the right
  code or it's rejected + disconnected.
- **Caps:** `MAX_PLAYERS` (default 12 humans; bots fill the rest),
  `MAX_PER_IP` (default 3 concurrent connections per address).
- **Join timeout** (5s) drops sockets that never authenticate; a per-connection
  **message-rate ceiling** drops floods.

## Verify (no browser needed)

```
node test-sim.js                 # headless world ticks; two players join, drive, fire
ROOM_CODE=TEST node server.js &  # then, in the same folder:
ROOM=TEST node test-client.js    # one ws client joins + drives + gets snapshots
ROOM=TEST node test-two.js       # two clients see each other's cars
```

## Hosting on a real always-on host (later, needs a card)

The Dockerfile at the repo root builds a host-agnostic server image (Railway /
Render / Fly / a VPS). The client stays on Netlify (static); point it at
`wss://<your-server>` once it's behind TLS.

## Protocol (M1, JSON — compact/binary in M2)

- Client → server: `{type:"join", room, name}` FIRST (required), then
  `{type:"input", throttle, steer, handbrake, fire, mouseDown, hookHeld,
  ability, autoFire, aim}` per frame, and `{type:"respawn", weapon}`.
- Server → client: `{type:"welcome", id, arena, view}` on join (or
  `{type:"reject", reason}` + close), then `{type:"snap", self, cars, bullets,
  mines, boss, scrap, crates, drops}` ~20 Hz.
