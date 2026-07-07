"use strict";
// ---------------------------------------------------------------------------
// Keyboard state. Exposes analog-style getters the physics reads each frame.
// ---------------------------------------------------------------------------

class Input {
  constructor() {
    this.keys = new Set();
    this.mouseDown = false;
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      // stop arrows/space from scrolling the page
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => { this.keys.clear(); this.mouseDown = false; });
    // fire on left click — listen on the canvas so UI buttons don't trigger shots
    const canvas = document.getElementById("game");
    canvas.addEventListener("mousedown", (e) => { if (e.button === 0) this.mouseDown = true; });
    window.addEventListener("mouseup", (e) => { if (e.button === 0) this.mouseDown = false; });

    // ---- virtual touch controls ----
    // joystick reports a desired WORLD direction + magnitude; Player.update
    // translates that into car-like throttle/steer
    this.touch = { active: false, x: 0, y: 0, mag: 0 };
    this.touchFire = false;
    this.touchHandbrake = false;
    this.wireJoystick();
    this.wireHoldButton("touch-fire", (v) => { this.touchFire = v; });
    this.wireHoldButton("touch-drift", (v) => { this.touchHandbrake = v; });
  }

  wireJoystick() {
    const zone = document.getElementById("joystick-zone");
    const stick = document.getElementById("joystick-stick");
    if (!zone) return;
    const MAX = 55; // px of stick travel = full throttle
    let pointerId = null, baseX = 0, baseY = 0;
    const move = (e) => {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - baseX, dy = e.clientY - baseY;
      const d = Math.hypot(dx, dy);
      if (d > 6) {
        this.touch.x = dx / d;
        this.touch.y = dy / d;
        this.touch.mag = Math.min(d, MAX) / MAX;
        this.touch.active = true;
      } else {
        this.touch.mag = 0;
      }
      if (stick) {
        const c = Math.min(d, MAX);
        stick.style.transform = d > 0 ? `translate(${(dx / d) * c}px, ${(dy / d) * c}px)` : "";
      }
    };
    const end = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      this.touch.active = false;
      this.touch.mag = 0;
      if (stick) stick.style.transform = "";
    };
    zone.addEventListener("pointerdown", (e) => {
      pointerId = e.pointerId;
      const r = zone.getBoundingClientRect();
      baseX = r.left + r.width / 2;
      baseY = r.top + r.height / 2;
      if (zone.setPointerCapture) zone.setPointerCapture(e.pointerId);
      move(e);
    });
    zone.addEventListener("pointermove", move);
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
  }

  wireHoldButton(id, set) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("pointerdown", (e) => { set(true); e.preventDefault(); });
    el.addEventListener("pointerup", () => set(false));
    el.addEventListener("pointercancel", () => set(false));
    el.addEventListener("pointerleave", () => set(false));
  }

  down(code) { return this.keys.has(code); }

  // -1 (reverse) .. 1 (forward)
  get throttle() {
    return (this.down("KeyW") || this.down("ArrowUp") ? 1 : 0) +
           (this.down("KeyS") || this.down("ArrowDown") ? -1 : 0);
  }

  // -1 (left) .. 1 (right)
  get steer() {
    return (this.down("KeyD") || this.down("ArrowRight") ? 1 : 0) +
           (this.down("KeyA") || this.down("ArrowLeft") ? -1 : 0);
  }

  get fire() { return this.mouseDown || this.down("KeyF") || this.touchFire; }
  // hold SPACE (or the DRIFT button) to yank the handbrake for a rapid turn
  get handbrake() { return this.down("Space") || this.touchHandbrake; }
  get restart() { return this.down("KeyR"); }
}

// Convert raw input into car controls for a car at `heading`. Keyboard is
// direct throttle/steer; the touch joystick gives a desired WORLD direction
// that's turned into car-like drive (brake-to-turn, opposite-pull reverse).
// Shared by the player car in both game modes.
function readDrive(input, heading) {
  let throttle = input.throttle, steer = input.steer;
  const handbrake = input.handbrake;
  if (input.touch && input.touch.active && input.touch.mag > 0.05) {
    const want = Math.atan2(input.touch.y, input.touch.x);
    const diff = angleDiff(want, heading);
    if (Math.abs(diff) > 2.7) { // stick pulled nearly opposite → reverse out
      throttle = -input.touch.mag;
      steer = 0;
    } else {
      steer = clamp(diff * 3, -1, 1);
      throttle = input.touch.mag * (Math.abs(diff) > 1.2 ? 0.45 : 1);
    }
  }
  return { throttle, steer, handbrake };
}
