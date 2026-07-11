"use strict";
// ---------------------------------------------------------------------------
// Arena PLAYER: one human's game-state, extracted off ArenaGame so the sim can
// carry MULTIPLE humans (multiplayer M0 — see BACKLOG-ARENA "Real multiplayer").
//
// A Player owns a `car` (the physics Car body) plus all the per-human state
// that used to live directly on ArenaGame: progression (level/xp/stats/
// loadout), combat (hp/dead/kills/nemesis), and weapon cooldowns (ram/hook/
// railgun). Bots already carry their own copy of this on the ArenaBot object;
// this brings the human up to the same shape so combat/render can treat every
// car uniformly.
//
// For now ArenaGame exposes back-compat accessors (this.hp → localPlayer.hp,
// this.player → localPlayer.car, ...) so every existing call site + test keeps
// working while the state actually lives here.
// ---------------------------------------------------------------------------

class ArenaPlayer {
  constructor() {
    this.car = null;              // the physics Car body (built by ArenaGame.reset)
    this.name = "YOU";            // leaderboard/killfeed handle (account handle later)
    this.input = null;            // input source; the local player uses the shared Input
    this.isLocal = false;         // the human at THIS client (camera + HUD follow them)
    // per-frame resolved input channels (set by ArenaGame.resolvePlayerInputs)
    this._fireActive = false;
    this._abilityHeld = false;
    // aim: local player uses the cursor; a remote/networked player sets this
    // angle from their input stream (null → fall back to the car heading)
    this.aimAngle = null;
    this.resetState("cannon");
  }

  // (re)initialize a fresh run's progression + combat + weapon state. Mirrors
  // what ArenaGame.reset() used to assign onto `this`.
  resetState(startWeapon) {
    // progression
    this.level = 1;
    this.xp = 0;
    this.statPoints = 0;
    this.stats = { health: 0, speed: 0, reload: 0, regen: 0 };
    this.slots = { armor: false };
    this.loadout = null;          // set by ArenaGame.freshLoadout
    this.startWeapon = startWeapon || "cannon";
    this.baseWeapon = this.startWeapon;
    // combat
    this.maxHp = 100;
    this.hp = 100;
    this.partDmgReduce = 0;
    this.outOfCombat = 0;         // seconds since last damage (regen gate)
    this.dead = false;            // wrecked → death menu
    this.respawnT = 0;            // brief wreck moment before the menu shows
    this.kills = 0;
    this.playerLastHitBy = null;  // who last damaged me (attribution)
    this.nemesis = null;          // the car that last wrecked me (revenge target)
    this.playerStreak = 0;        // consecutive wrecks without dying
    this._godmode = false;        // TEST MODE (dev)
    // weapon state
    this.hookCd = 0;
    this.fireCooldown = 0;
    this.ramCharge = 0;
    this.ramBoostT = 0;
    this.ramLaunchStr = 1;
    this.railCd = 0;
  }
}

// the per-human fields ArenaGame proxies to its localPlayer (same names, so
// existing `this.X` code + tests are untouched). `player` (the car) is mapped
// separately since its field name differs (localPlayer.car).
const PLAYER_PROXY_FIELDS = [
  "level", "xp", "statPoints", "stats", "slots", "loadout", "startWeapon", "baseWeapon",
  "maxHp", "hp", "partDmgReduce", "outOfCombat", "dead", "respawnT", "kills",
  "playerLastHitBy", "nemesis", "playerStreak", "_godmode",
  "hookCd", "fireCooldown", "ramCharge", "ramBoostT", "ramLaunchStr", "railCd",
];

// define the back-compat accessors on an ArenaGame instance (called from its
// constructor, right after localPlayer is created)
function defineLocalPlayerAccessors(game) {
  for (const f of PLAYER_PROXY_FIELDS) {
    Object.defineProperty(game, f, {
      get() { return this.localPlayer[f]; },
      set(v) { this.localPlayer[f] = v; },
      configurable: true,
    });
  }
  Object.defineProperty(game, "player", {
    get() { return this.localPlayer.car; },
    set(v) { this.localPlayer.car = v; },
    configurable: true,
  });
}
