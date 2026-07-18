# Scrapyard Arena — multiplayer server

Authoritative, **multi-room** game server for Scrapyard Arena (agar/diep-style).
Runs the **same simulation the browser runs** (`js/arena/*`), headless, in Node —
MANY `ArenaGame` worlds (one per room) ticked at a fixed timestep in one process.
Each WebSocket client seats into a room and becomes an `ArenaPlayer`: it streams
its INPUT, the server simulates its room, and broadcasts that room's SNAPSHOTS
back. Bots fill each world.

Seat into a room three ways (the client's PLAY ONLINE screen does these):
- `{type:"quickplay", name}` — **matchmake** into a public room with open slots
  (or spin one up). This is the **PLAY** button.
- `{type:"create", name, maxPlayers}` — open a **private** room; the server
  replies with a short **invite code** to share.
- `{type:"join", room, name}` — join an existing room by its code.

This folder is **isolated from the game's static client** on purpose: the
client root has no `package.json`, so Netlify keeps serving it as pure static
files. Only the server needs a dependency (`ws`).

## Run locally

```
cd server
npm install        # first time only (installs ws)
npm start          # → listens on 0.0.0.0:8090; public quickplay is open
ROOM_CODE=TEST npm start   # ALSO opens a permanent public room "TEST" (handy for dev)
```

Public **quickplay** is open by default (that's the point of the Play button).
Rooms are created on demand and reaped ~30s after they empty; a `ROOM_CODE` env
opens one permanent public room with that code (used by the previews/tests).
Set `SERVER_PASSWORD` to lock the whole server. Health check:
`http://localhost:8090/` (reports live room + player counts).

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

Friends open the game (your Netlify URL), click **PLAY ONLINE**, put in the
`wss://<random>.trycloudflare.com` server address + a name, then either **PLAY**
(quick match into a shared world) or **CREATE PRIVATE GAME** → share the invite
code so friends **JOIN WITH CODE**.

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
server `ws://localhost:8090`, a different name, then **PLAY (QUICK MATCH)** in
both — matchmaking drops them into the same public room and each sees the other
as a teal named car. (Or CREATE in one, share the code, JOIN WITH CODE in the
other for a private room.)

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

- **Private rooms** are gated by their invite code; **quickplay** is public by
  default (`SERVER_PASSWORD` locks the whole server if you want).
- **Caps:** `MAX_PLAYERS` per room (default 12; bots fill the rest), `MAX_ROOMS`
  total (default 200), `MAX_PER_IP` concurrent connections (default 3), and
  per-IP **room-creation rate** (`ROOM_CREATE_PER_MIN`, default 6).
- **Seat timeout** (5s) drops sockets that never seat; a per-connection
  **message-rate ceiling** + a 4KB **payload cap** drop floods/oversized frames.
- **Input validation:** names sanitized + clamped (10 chars); `spendStat`/
  `respawn` allowlisted; numeric fields `Number.isFinite`-guarded.
- **Resilience:** a bad message or a single room's error can't crash the shared
  process (both are caught); empty non-permanent rooms are reaped.

## Verify (no browser needed)

```
node test-sim.js                 # headless world ticks; two players join, drive, fire
ROOM_CODE=TEST node server.js &  # then, in the same folder:
ROOM=TEST node test-client.js    # one ws client joins + drives + gets snapshots
ROOM=TEST node test-two.js       # two clients see each other's cars
```

## Deploy free to Render (Node, no credit card)

The repo has a `render.yaml` blueprint, so this is near one-click:

1. Push the repo to GitHub (already done).
2. Go to **render.com**, sign up (free, no card), **New → Blueprint**, pick this repo.
   Render reads `render.yaml` and creates the web service (rootDir `server`,
   `npm install` + `node server.js`, health check `/`). Deploy.
3. You get a URL like `https://scrapyard-arena-server.onrender.com`. The client
   uses the **`wss://`** form of it (Render terminates TLS at its edge).
4. In the game's **PLAY ONLINE** screen, put `wss://<your-app>.onrender.com` in
   SERVER, then **PLAY**. (Or bake it in: set `DEFAULT_SERVER` in `js/main.js`
   to that URL and the field prefills + hides.)

**Caveat — the free tier sleeps** after ~15 min idle (next connect cold-starts
~30-60s). Keep it warm for free by pinging the health URL every ~10 min from a
free scheduler (e.g. **cron-job.org** → `GET https://<your-app>.onrender.com/`).
That's the trade for $0/no-card on Node; an always-on box (small paid tier, or
Cloudflare Durable Objects) removes it later.

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
| `ROOM_CODE` | none | opens ONE permanent public room with this code (dev/preview) |
| `MAX_PLAYERS` | `12` | human cap **per room** (bots fill the rest) |
| `MAX_ROOMS` | `200` | total room cap (memory/DoS ceiling) |
| `MAX_PER_IP` | `3` | concurrent connections per address |
| `ROOM_CREATE_PER_MIN` | `6` | per-IP private-room creation rate |
| `SERVER_PASSWORD` | none | if set, every seat must present `pass` (locked server) |
| `TRUST_PROXY` | off | set `1` behind a load balancer so caps read the real IP from `X-Forwarded-For` |

The server handles `SIGTERM`/`SIGINT` (graceful shutdown: closes sockets + the
listener), so rolling deploys / autoscaling restarts don't drop it mid-tick.

### Scaling boundary (read before you scale)

One process now hosts **many rooms** (each its own `ArenaGame` world; the sim's
global RNG pointer is re-aimed at each room's stream before that room ticks, so
worlds stay independent + deterministic per seed). CPU is the limit — every room
sims 60 Hz with bots + a boss, so a small instance holds a few dozen busy rooms.
To go beyond one box, run **more instances** behind the provider (rooms have no
cross-process state) and add a thin router that assigns a client to an instance.
Global cross-instance matchmaking / a room directory is the next lift; nothing
here blocks it.

## Protocol (JSON — compact/binary is a later optimization)

- Client → server: a SEAT message FIRST — `{type:"quickplay", name}` /
  `{type:"create", name, maxPlayers}` / `{type:"join", room, name}` (all may
  carry `pass` if the server is locked). Then per frame
  `{type:"input", seq, throttle, steer, handbrake, fire, mouseDown, hookHeld,
  ability, autoFire, aim}` (`seq` is a monotonic input id for
  prediction/reconciliation), plus `{type:"spendStat", name}`,
  `{type:"respawn", weapon}`, and `{type:"name", name}`.
- Server → client: `{type:"welcome", id, room, pub, max, arena, view}` on seat
  (or `{type:"reject", reason}` + close), then `{type:"snap", self, cars,
  bullets, mines, boss, scrap, crates, drops}` ~20 Hz for THAT room. Each car
  has id/x/y/heading/hp/name/level/weapon; the receiving client's OWN car also
  carries xp/statPoints/stats/slots, `ack` (last input seq applied), velocity
  `vx/vy`, and drive-physics params `ms/ac/tr/gr/dg/hb` (matched prediction);
  `boss` includes its radius.

The browser client for all this is `js/net.js` (`NetClient`) + the online-mode
glue in `js/main.js` (`applyOnlineSnapshot`/`onlineFrame`, seat buttons in
`initOnlineUI`). Dev hooks: `?connect=ws://host&name=X` auto-quickplays on load;
add `&room=CODE` to join by code or `&create=1` to open a private room; `&drive=t,s`
feeds a constant throttle/steer for screenshots; `?online=1` just opens the form.
