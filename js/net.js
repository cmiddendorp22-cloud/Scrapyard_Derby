"use strict";
// ---------------------------------------------------------------------------
// NetClient — the browser's connection to the authoritative game server
// (multiplayer M1). Opens a WebSocket, JOINs a room, streams local INPUT up,
// and stashes the latest world SNAPSHOT for the render loop to draw.
//
// The client stops simulating while online: it's a window into the server's
// world (main.js applies `net.snap` to the renderer each frame).
// ---------------------------------------------------------------------------

class NetClient {
  constructor() {
    this.ws = null;
    this.state = "idle";     // idle | connecting | joined | rejected | error | closed
    this.reason = "";
    this.selfId = null;
    this.arena = null;       // {w,h,wall} from welcome
    this.view = null;        // {w,h}
    this.snap = null;        // latest {type:"snap", ...}
    this.onState = null;     // callback(state, reason) for the UI
    this._carCache = new Map(); // netId → Car (reused across snapshots)
    this._buf = [];          // recent {t, m} snapshots for interpolation (M2)
    this.lastSnapAt = 0;     // client clock time the latest snapshot arrived
    this.inputSeq = 0;       // monotonic input id (M3 prediction/reconciliation)
    this.pending = [];       // unacked local inputs {seq, throttle, steer, handbrake, dt}
  }

  // seatMsg is the seat request: {type:"quickplay"|"create"|"join", name, room?, maxPlayers?}
  connect(url, seatMsg) {
    this.close();
    this.selfId = null; this.snap = null; this._carCache.clear(); this._buf.length = 0; this.lastSnapAt = 0;
    this.inputSeq = 0; this.pending.length = 0; this.roomCode = null; this.roomPublic = null;
    this._set("connecting", "");
    if (typeof WebSocket === "undefined") { this._set("error", "no WebSocket in this browser"); return; }
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this._set("error", String((e && e.message) || e)); return; }
    this.ws = ws;
    ws.onopen = () => { try { ws.send(JSON.stringify(seatMsg)); } catch (_) {} };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.type === "welcome") { this.selfId = m.id; this.arena = m.arena; this.view = m.view; this.roomCode = m.room || null; this.roomPublic = !!m.pub; this._set("joined", ""); }
      else if (m.type === "reject") { this.reason = m.reason || "rejected"; this._set("rejected", this.reason); }
      else if (m.type === "snap") {
        this.snap = m;
        this.lastSnapAt = _now();
        this._buf.push({ t: this.lastSnapAt, m });
        if (this._buf.length > 12) this._buf.shift();
      }
    };
    ws.onerror = () => { if (this.state === "connecting") this._set("error", "could not reach the server"); };
    ws.onclose = () => { if (this.state !== "rejected" && this.state !== "error") this._set("closed", "connection closed"); };
  }

  // per-frame local input → server
  sendInput(obj) {
    if (this.ws && this.ws.readyState === 1) {
      obj.type = "input";
      try { this.ws.send(JSON.stringify(obj)); } catch (_) {}
    }
  }
  send(obj) { if (this.ws && this.ws.readyState === 1) { try { this.ws.send(JSON.stringify(obj)); } catch (_) {} } }

  close() {
    if (this.ws) { try { this.ws.onclose = null; this.ws.onerror = null; this.ws.close(); } catch (_) {} this.ws = null; }
  }
  get online() { return this.state === "joined"; }
  _set(state, reason) { this.state = state; this.reason = reason || ""; if (this.onState) this.onState(state, this.reason); }

  // -- M2 interpolation: sample every car + the boss at render time `rt` (a
  // point ~100ms in the past), lerping between the two snapshots that bracket
  // it. Turns the ~20Hz snapshot stream into smooth 60fps motion for remote
  // entities. Returns null before the first snapshot. --------------------------
  interpPositions(rt) {
    const buf = this._buf;
    if (buf.length === 0) return null;
    let a = buf[buf.length - 1], b = a; // default: newest (buffer starved)
    if (rt <= buf[0].t) { a = b = buf[0]; }
    else if (rt < buf[buf.length - 1].t) {
      for (let i = 1; i < buf.length; i++) {
        if (buf[i].t >= rt) { a = buf[i - 1]; b = buf[i]; break; }
      }
    }
    const span = b.t - a.t;
    const f = span > 0 ? (rt - a.t) / span : 0;
    const amap = new Map();
    for (const c of a.m.cars) amap.set(c.id, c);
    const cars = new Map();
    for (const c of b.m.cars) {
      const ac = amap.get(c.id);
      if (ac) cars.set(c.id, { x: _lerp(ac.x, c.x, f), y: _lerp(ac.y, c.y, f), h: _lerpAng(ac.h, c.h, f) });
      else cars.set(c.id, { x: c.x, y: c.y, h: c.h }); // just appeared
    }
    let boss = null;
    if (b.m.boss) {
      const bb = b.m.boss, ab = a.m.boss;
      boss = ab ? { x: _lerp(ab.x, bb.x, f), y: _lerp(ab.y, bb.y, f), h: _lerpAng(ab.h, bb.h, f) } : { x: bb.x, y: bb.y, h: bb.h };
    }
    return { cars, boss };
  }
}

function _now() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
function _lerp(a, b, f) { return a + (b - a) * f; }
function _lerpAng(a, b, f) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * f; }
