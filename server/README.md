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

Friends open the game (your Netlify URL), click **PLAY ONLINE**, and enter
`wss://<random>.trycloudflare.com` + the ROOM CODE + a name.

Notes:
- Only that one game port is exposed, over TLS, at an unguessable URL — not your
  machine. Closing cloudflared (Ctrl+C) kills the URL.
- The URL changes each time you restart the quick tunnel. A free Cloudflare
  account (still no card) can give a **stable named tunnel** if you want one.
- Your PC must stay on while friends play (it's the host).

## Test it right now (Windows PowerShell)

Copy-paste, no friend needed. `$env:VAR="x"; cmd` is PowerShell's env-var syntax.

### Option A — local, two browser tabs (fastest)

PowerShell window 1 (game server):
```powershell
cd C:\Users\cmidd\Scrapyard_Derby\server
$env:ROOM_CODE="TEST"; node server.js
```

PowerShell window 2 (serve the client):
```powershell
cd C:\Users\cmidd\Scrapyard_Derby
node serve.js
```

Open **http://localhost:8080** in **two** tabs. In each: **PLAY ONLINE** →
server `ws://localhost:8090`, room `TEST`, a different name in each. Each tab
sees the other as a teal named car.

### Option B — play with a friend over the internet

PowerShell window 1 — same server command as above. PowerShell window 2:
```powershell
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8090
```
It prints `https://<random>.trycloudflare.com`. **Change `https://` to `wss://`**
— that's the server address you + your friend paste into **PLAY ONLINE** on the
Netlify site, with room code `TEST`.

Stop everything with **Ctrl+C** in each window. Closing the server window ends
the game for everyone; closing the tunnel just kills the public URL.

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

## Hosting on a real always-on host (bigger provider)

The Dockerfile at the repo root builds a host-agnostic server image (Railway /
Render / Fly / a VPS) — non-root, with a `/` health check, and it listens on the
host-injected `$PORT`. The client stays on Netlify (static); point it at
`wss://<your-server>` once it's behind TLS. Most of these providers terminate TLS
at their edge, so your server speaks plain `ws` internally and clients still use
`wss://` — that just works.

### Environment variables

| var | default | notes |
|-----|---------|-------|
| `PORT` | `8090` | host-injected on most providers — don't hardcode |
| `ROOM_CODE` | random 5-char | pin it so friends have a stable code |
| `MAX_PLAYERS` | `12` | human cap per world (bots fill the rest) |
| `MAX_PER_IP` | `3` | concurrent connections per address |
| `TRUST_PROXY` | off | set `1` behind a load balancer so the per-IP cap reads the real client IP from `X-Forwarded-For` |

The server handles `SIGTERM`/`SIGINT` (graceful shutdown: closes sockets + the
listener), so rolling deploys / autoscaling restarts don't drop it mid-tick.

### Scaling boundary (read before you scale)

One process runs **one authoritative world** (a single shared arena). That's the
right model for a friends game and is CPU-cheap. To host *more* concurrent games,
run **more instances** (each its own world + room code) behind the provider — the
sim has no shared global state between processes, so instances are independent.
A single-process **multi-room** manager (many worlds in one server, matchmaking)
is a future step if you want lobby-style scaling; nothing here blocks it.

## Protocol (M1, JSON — compact/binary in M2)

- Client → server: `{type:"join", room, name}` FIRST (required), then
  `{type:"input", seq, throttle, steer, handbrake, fire, mouseDown, hookHeld,
  ability, autoFire, aim}` per frame (`seq` is a monotonic input id for
  prediction/reconciliation), plus `{type:"spendStat", name}`,
  `{type:"respawn", weapon}`, and `{type:"name", name}`.
- Server → client: `{type:"welcome", id, arena, view}` on join (or
  `{type:"reject", reason}` + close), then `{type:"snap", self, cars, bullets,
  mines, boss, scrap, crates, drops}` ~20 Hz. Each car has id/x/y/heading/hp/
  name/level/weapon; the receiving client's OWN car also carries
  xp/statPoints/stats/slots, plus `ack` (last input seq applied), its velocity
  `vx/vy`, and drive-physics params `ms/ac/tr/gr/dg/hb` (so the client predicts
  it with matching physics); `boss` includes its radius.

The browser client for all this is `js/net.js` (`NetClient`) + the online-mode
glue in `js/main.js` (`applyOnlineSnapshot`/`onlineFrame`). Dev hook:
`?connect=ws://host&room=CODE&name=X` auto-joins on load (`&drive=t,s` feeds a
constant throttle/steer for screenshots).
