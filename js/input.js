"use strict";
// ---------------------------------------------------------------------------
// Keyboard state. Exposes analog-style getters the physics reads each frame.
// ---------------------------------------------------------------------------

class Input {
  constructor() {
    this.keys = new Set();
    this.mouseDown = false;
    this.autoFire = false; // F toggles continuous fire (press once → keeps firing)
    window.addEventListener("keydown", (e) => {
      // F is an AUTO-FIRE toggle (not hold-to-fire) — flip once per press,
      // ignoring OS key-repeat while held
      if (e.code === "KeyF" && !e.repeat) this.autoFire = !this.autoFire;
      this.keys.add(e.code);
      // stop arrows/space from scrolling the page
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => { this.keys.clear(); this.mouseDown = false; this.hookHeld = false; this.touchAbility1 = false; this.touchAbility2 = false; });
    // fire on left click, HOOK on right click — listen on the canvas so UI
    // buttons don't trigger shots
    const canvas = document.getElementById("game");
    this.hookHeld = false; // right mouse → fire the minelayer hook (toward the cursor)
    canvas.addEventListener("mousedown", (e) => { if (e.button === 0) this.mouseDown = true; else if (e.button === 2) this.hookHeld = true; });
    window.addEventListener("mouseup", (e) => { if (e.button === 0) this.mouseDown = false; else if (e.button === 2) this.hookHeld = false; });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault()); // no menu on right-click aim
    // mouse position (client coords) for aim — the Arena maps this to a world
    // direction so shots fire toward the cursor (within a forward cone)
    this.mouseX = 0; this.mouseY = 0; this.hasMouse = false;
    window.addEventListener("mousemove", (e) => { this.mouseX = e.clientX; this.mouseY = e.clientY; this.hasMouse = true; });

    // ---- virtual touch controls ----
    // joystick reports a desired WORLD direction + magnitude; Player.update
    // translates that into car-like throttle/steer
    this.touch = { active: false, x: 0, y: 0, mag: 0 };
    this.touchFire = false;
    this.touchHandbrake = false;
    this.touchAbility1 = false; // primary-slot ability button (HOOK/CHARGE, per loadout)
    this.touchAbility2 = false; // secondary-slot ability button
    this.wireJoystick();
    this.wireHoldButton("touch-fire", (v) => { this.touchFire = v; });
    this.wireHoldButton("touch-drift", (v) => { this.touchHandbrake = v; });
    this.wireHoldButton("touch-ability1", (v) => { this.touchAbility1 = v; });
    this.wireHoldButton("touch-ability2", (v) => { this.touchAbility2 = v; });
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

  // fire = holding left-click, the touch FIRE button, or F auto-fire toggled on.
  // The Gauntlet uses this directly (single weapon); the Arena resolves finer
  // primary/secondary + ability channels in ArenaGame from the raw signals
  // (mouseDown, hookHeld, autoFire, touchFire, touchAbility1/2).
  get fire() { return this.mouseDown || this.autoFire || this.touchFire; }
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
