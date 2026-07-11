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
  }

  connect(url, room, name) {
    this.close();
    this.selfId = null; this.snap = null; this._carCache.clear();
    this._set("connecting", "");
    if (typeof WebSocket === "undefined") { this._set("error", "no WebSocket in this browser"); return; }
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this._set("error", String((e && e.message) || e)); return; }
    this.ws = ws;
    ws.onopen = () => { try { ws.send(JSON.stringify({ type: "join", room, name })); } catch (_) {} };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.type === "welcome") { this.selfId = m.id; this.arena = m.arena; this.view = m.view; this._set("joined", ""); }
      else if (m.type === "reject") { this.reason = m.reason || "rejected"; this._set("rejected", this.reason); }
      else if (m.type === "snap") { this.snap = m; }
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
}
