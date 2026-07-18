"use strict";
// ---------------------------------------------------------------------------
// Boot: wire up the DOM, scale the canvas to the window, run the loop.
// ---------------------------------------------------------------------------

(function () {
  const canvas = document.getElementById("game");
  const game = new Game(canvas);
  // Arena mode shares the Gauntlet's input + audio so only one set of DOM
  // listeners exists; only one mode runs at a time.
  const arena = new ArenaGame(canvas, game.input, game.audio);

  // which controller the loop drives: null (menu) | game | arena
  let active = null;
  // MULTIPLAYER (M1): when online, the client stops simulating — it streams
  // input to the authoritative server and RENDERS the server's snapshots.
  const net = new NetClient();
  let onlineActive = false;

  // Letterbox the canvas to the window (fixed 16:9 via CSS size), and size its
  // BACKING STORE to real device pixels so it renders crisp on hi-dpi / large
  // screens instead of upscaling a 1280x720 image. The renderers keep drawing
  // in logical 1280x720 space and scale their context by the backing ratio.
  // DPR is capped (low-end phones don't render a 3x buffer), but the display-
  // fill factor is uncapped, so a 1440p window always gets a full 2560x1440
  // backing store.
  const DPR_CAP = 2;
  function fit() {
    // Gauntlet is a FIXED 1280x720 arena (static camera, walls at the edges) so
    // it must letterbox. Arena (and the start screen) AREA-LOCK the viewport to
    // the window aspect ratio: fills the screen with no bars, same visible area
    // on every monitor (fair). setView() clamps extreme aspects (they letterbox).
    const gauntlet = active === game;
    setView(window.innerWidth / window.innerHeight, gauntlet);
    // Uniform CSS scale that fits VIEW inside the window. When VIEW already
    // matches the window aspect (the common case) this fills edge-to-edge; when
    // clamped (or fixed Gauntlet) it letterboxes the leftover strip.
    const displayScale = Math.min(window.innerWidth / VIEW.w, window.innerHeight / VIEW.h);
    canvas.style.width = VIEW.w * displayScale + "px";
    canvas.style.height = VIEW.h * displayScale + "px";
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    canvas.width = Math.max(1, Math.round(VIEW.w * displayScale * dpr));
    canvas.height = Math.max(1, Math.round(VIEW.h * displayScale * dpr));
    positionArenaDom();
    if (typeof applyTouchControlLayout === "function") applyTouchControlLayout(); // moved touch controls track resizes
  }
  // Anchor the fixed-position Arena loadout panel + toggle to the canvas so they
  // line up with the canvas HUD at any display scale / letterbox.
  function positionArenaDom() {
    if (!canvas.getBoundingClientRect) return; // headless/no-DOM guard
    const r = canvas.getBoundingClientRect();
    const s = r.width / VIEW.w;
    // the DOM column FOLLOWS the canvas "hud" layout group (move it, they move);
    // offsets scale with the layout's UI SCALE so the column stays stacked
    const lay = (arena.renderer && arena.renderer.layout) || { scale: 1, pos: {} };
    const sc = lay.scale || 1;
    const hudA = arena.renderer && arena.renderer.layoutAnchor ? arena.renderer.layoutAnchor("hud", 16, 14) : { x: 16, y: 14 };
    const leftPx = r.left + hudA.x * s;
    const stats = document.getElementById("arena-stats");
    const lo = document.getElementById("arena-loadout");
    const tog = document.getElementById("loadout-toggle");
    // SPEND POINTS panel: top-left, under the LVL/HP HUD block (user)
    let loTopPx = r.top + (hudA.y + 136 * sc) * s;
    if (stats) {
      stats.style.left = leftPx + "px";
      stats.style.top = (r.top + (hudA.y + 132 * sc) * s) + "px";
      if (!stats.classList.contains("hidden")) { // push the loadout below it
        loTopPx = r.top + (hudA.y + 132 * sc) * s + stats.getBoundingClientRect().height + 8;
      }
    }
    // PARTS toggle: stack it below the loadout panel (if shown) else below the
    // stat panel, so it never overlaps them on short (mobile) viewports.
    let togTopPx = r.top + (hudA.y + 136 * sc) * s;
    if (lo) {
      lo.style.left = leftPx + "px"; lo.style.top = loTopPx + "px";
      if (!lo.classList.contains("hidden")) {
        togTopPx = loTopPx + lo.getBoundingClientRect().height + 8;
      } else {
        togTopPx = loTopPx;
      }
    }
    if (tog) { tog.style.left = leftPx + "px"; tog.style.top = togTopPx + "px"; }
  }
  window.addEventListener("resize", fit);
  fit();

  function startGauntlet() {
    game.audio.unlock(); // must happen inside a user gesture
    document.getElementById("start-screen").classList.add("hidden");
    active = game;
    fit(); // Gauntlet pins the viewport to a fixed 1280x720 (letterboxed)
    game.begin();
  }
  // picking Arena opens the starting-weapon screen; choosing a weapon spawns you
  function startArena() {
    game.audio.unlock();
    weaponRespawn = false; // fresh run, not a respawn re-pick
    document.getElementById("start-screen").classList.add("hidden");
    buildWeaponSelect();
    document.getElementById("weapon-select").classList.remove("hidden");
  }

  // ===========================================================================
  // TEST MODE — dev-only sandbox. DELETE THIS FUNCTION + its call, the
  // #test-panel/#test-mode-btn HTML, and the TEST MODE CSS block when done.
  // ===========================================================================
  function initTestPanel() {
    const panel = document.getElementById("test-panel");
    document.getElementById("test-mode-btn").addEventListener("click", () => {
      game.audio.unlock();
      weaponRespawn = false;
      document.getElementById("start-screen").classList.add("hidden");
      arena.startWeapon = "cannon";
      active = arena;
      arena.begin();
      setGod(false);
      loadoutOpen = true; lastLoadoutSig = ""; // open the PARTS panel on entry
      panel.classList.remove("hidden");
    });
    const spawnSet = (tier) => { // a full ring of parts (every slot + ALL weapon types) at one tier
      const p = arena.player, R = 95;
      const kinds = [["tires", "tires"], ["engine", "engine"], ["armor", "armor"],
        ["weapon", "cannon"], ["weapon", "shotgun"], ["weapon", "ram"], ["weapon", "minelayer"],
        ["weapon", "railgun"]];
      kinds.forEach(([slot, type], i) => {
        const ang = (i / kinds.length) * Math.PI * 2;
        arena.dropPart(p.x + Math.cos(ang) * R, p.y + Math.sin(ang) * R, makePart(slot, type, tier));
      });
    };
    const addLevels = (n) => { for (let i = 0; i < n && arena.level < 30; i++) arena.addXp(Math.max(1, arena.xpToNext() - arena.xp)); };
    const setGod = (on) => {
      arena._godmode = on;
      const b = document.getElementById("test-god");
      b.textContent = "GODMODE: " + (on ? "ON" : "OFF");
      b.classList.toggle("on", on);
    };
    const spawnBotAt = (level) => { // a bot at a chosen level, dropped near the player
      const p = arena.player, a = Math.random() * Math.PI * 2, W = ["cannon", "shotgun", "ram", "minelayer"];
      const bot = new ArenaBot(p.x + Math.cos(a) * 350, p.y + Math.sin(a) * 350,
        W[Math.floor(Math.random() * W.length)], Math.max(1, Math.min(30, level)), arena.uniqueBotName());
      arena.bots.push(bot);
    };
    panel.addEventListener("click", (e) => {
      const btn = e.target.closest("button"); if (!btn) return;
      const cmd = btn.dataset.test;
      if (cmd === "close") { panel.classList.add("hidden"); return; }
      if (active !== arena || !arena.started) return;
      if (cmd === "lvl1") addLevels(1);
      else if (cmd === "lvl5") addLevels(5);
      else if (cmd === "lvl10") addLevels(10);
      else if (cmd === "heal") { arena.hp = arena.maxHp; arena.outOfCombat = 0; }
      else if (/^t[0-4]$/.test(cmd)) spawnSet(parseInt(cmd.slice(1), 10));
      else if (cmd === "god") setGod(!arena._godmode);
      else if (cmd === "killme") { setGod(false); arena.damagePlayer(arena.maxHp * 2 + 1000); } // full death→respawn flow
      else if (cmd === "spawnbot") spawnBotAt(parseInt(document.getElementById("test-bot-lvl").value, 10) || 10);
      else if (cmd === "titan" || cmd === "magnet") {
        arena.boss = arena.spawnCentralBoss(cmd); arena.bossRespawnT = 0;
        arena.boss.x = arena.player.x; arena.boss.y = arena.player.y - 320;
      } else if (cmd === "overload") { if (arena.boss && arena.boss.kind === "magnet") arena.boss.overload = 4; }
      else if (cmd === "killbots") { for (const b of arena.bots) if (!b.deadFlag) { b.hp = 0; b.deadFlag = true; b.lastHitBy = arena.player; } }
    });
  }
  // ===== end TEST MODE =====
  // the weapon picker is reused for two flows: the INITIAL spawn (begin a run)
  // and a RESPAWN re-pick (user request — choose your weapon again on death)
  let weaponRespawn = false;
  function openRespawnWeaponSelect() {
    if (active !== arena || !arena.dead) return;
    weaponRespawn = true;
    document.getElementById("death-menu").classList.add("hidden");
    document.getElementById("spectate-ui").classList.add("hidden");
    buildWeaponSelect();
    document.getElementById("weapon-select").classList.remove("hidden");
  }
  function buildWeaponSelect() {
    const grid = document.getElementById("weapon-grid");
    grid.innerHTML = "";
    for (const w of ARENA_WEAPONS) {
      const card = document.createElement("div");
      card.className = "weapon-card";
      const cv = document.createElement("canvas");
      cv.width = 110; cv.height = 84; cv.className = "weapon-portrait";
      arena.renderer.renderWeaponPortrait(w.id, cv);
      const name = document.createElement("div");
      name.className = "weapon-name";
      name.textContent = w.name;
      const desc = document.createElement("div");
      desc.className = "weapon-desc";
      desc.textContent = w.desc;
      card.appendChild(cv);
      card.appendChild(name);
      card.appendChild(desc);
      card.addEventListener("click", () => chooseWeapon(w.id));
      grid.appendChild(card);
    }
  }
  function chooseWeapon(id) {
    document.getElementById("weapon-select").classList.add("hidden");
    if (weaponRespawn) { // RESPAWN flow: re-spawn with the newly chosen weapon
      weaponRespawn = false;
      arena.respawnPlayer(id);
      return;
    }
    arena.startWeapon = id; // INITIAL flow: begin a fresh run
    active = arena;
    fit(); // Arena area-locks the viewport to the window aspect (fills the screen)
    arena.begin();
    loadoutOpen = true; lastLoadoutSig = ""; // open the PARTS panel on entering the game (user)
  }
  function backToStart() {
    document.getElementById("weapon-select").classList.add("hidden");
    if (weaponRespawn) { // cancel a respawn re-pick → back to the death/spectate UI
      weaponRespawn = false;
      return; // updateDeathUI re-shows the death menu (or spectate) next frame
    }
    document.getElementById("start-screen").classList.remove("hidden");
  }
  // options is mode-agnostic (just the volume slider on shared audio); handled
  // here rather than per-mode so it works in Gauntlet AND Arena.
  function openOptions() {
    document.getElementById("pause-screen").classList.add("hidden");
    document.getElementById("options-screen").classList.remove("hidden");
  }
  function closeOptions() {
    document.getElementById("options-screen").classList.add("hidden");
    document.getElementById("pause-screen").classList.remove("hidden");
  }
  // Arena FIELD GUIDE: a pause-screen reference for weapons, part slots/tiers,
  // stats, and the two bosses. Content is built from the live data catalogs
  // (ARENA_WEAPONS / ARENA_TIERS) so it can't drift from the game.
  function buildArenaGuide() {
    const grid = document.getElementById("arena-guide-grid");
    grid.innerHTML = "";
    const section = (title) => {
      const h = document.createElement("div"); h.className = "ag-section"; h.textContent = title; grid.appendChild(h);
    };
    const row = (chip, name, desc) => {
      const r = document.createElement("div"); r.className = "ag-row";
      if (chip) r.appendChild(chip);
      const t = document.createElement("div");
      const n = document.createElement("div"); n.className = "ag-name"; n.textContent = name;
      const d = document.createElement("div"); d.className = "ag-desc"; d.textContent = desc;
      t.appendChild(n); t.appendChild(d); r.appendChild(t); grid.appendChild(r);
    };
    // WEAPONS — a live-rendered portrait per weapon (fire both slots at once)
    section("WEAPONS");
    for (const w of ARENA_WEAPONS) {
      const cv = document.createElement("canvas");
      cv.width = 60; cv.height = 44; cv.className = "guide-portrait";
      arena.renderer.renderWeaponPortrait(w.id, cv);
      row(cv, w.name, w.desc);
    }
    // PART SLOTS + TIERS
    section("PART SLOTS");
    row(null, "4 SLOTS", "Tires (grip / turn / handbrake), Engine (speed + accel), one Weapon slot, Armor (max HP + damage reduction). Loot better parts off wrecks and crates to fill and upgrade each slot.");
    const tierWrap = document.createElement("div"); tierWrap.className = "ag-tiers";
    for (const t of ARENA_TIERS) {
      const c = document.createElement("span"); c.className = "ag-tier"; c.style.background = t.color; c.textContent = t.name;
      tierWrap.appendChild(c);
    }
    grid.appendChild(tierWrap);
    // STATS
    section("STATS · spend level-up points");
    row(null, "HEALTH", "Raises your maximum HP.");
    row(null, "SPEED", "Faster top speed and acceleration.");
    row(null, "RELOAD", "Shortens your weapon cooldowns.");
    row(null, "REGEN", "Passively heal, but only after 5s without taking damage.");
    // BOSSES
    section("CENTRAL BOSSES · alternate on respawn");
    row(null, "JUNK TITAN", "A huge stationary tank: 4 armor plates around a core. Tear off the plate facing you, then shoot the exposed core through the gap. Drops a rare+ part.");
    row(null, "THE MAGNET", "A roaming gravity well — it drags you inward (fight it with throttle) and periodically MEGA-PULLS for heavy damage. Armored EXCEPT during the OVERLOAD window right after a mega-pull; the only thing that pierces the armor is a HOOK detonation. Keep scrap away (scrap heals it).");
  }
  function openArenaGuide() {
    buildArenaGuide();
    document.getElementById("pause-screen").classList.add("hidden");
    document.getElementById("arena-guide-screen").classList.remove("hidden");
  }
  function closeArenaGuide() {
    document.getElementById("arena-guide-screen").classList.add("hidden");
    document.getElementById("pause-screen").classList.remove("hidden");
  }
  // MAIN MENU: quit the current run back to the mode-select start screen.
  // Works for both modes; resets the active controller so re-entry is fresh.
  function quitToMenu() {
    for (const id of ["pause-screen", "guide-screen", "arena-guide-screen", "options-screen", "gameover-screen",
                      "weapon-select", "intermission", "arena-stats", "arena-loadout",
                      "death-menu", "spectate-ui"]) {
      document.getElementById(id).classList.add("hidden");
    }
    document.getElementById("shop-toggle").classList.add("hidden");
    document.getElementById("loadout-toggle").classList.add("hidden");
    document.getElementById("touch-ability1").classList.add("hidden");
    document.getElementById("touch-ability2").classList.add("hidden");
    document.getElementById("test-panel").classList.add("hidden"); // TEST MODE (dev) — remove later
    document.getElementById("layout-done-btn").classList.add("hidden");
    touchLayoutEdit = false; layoutDrag = null; game.input.layoutEdit = false; // exit any HUD-layout editing
    if (arena) arena._godmode = false;
    loadoutOpen = false; abilitySig = ""; // refresh ability buttons on the next run
    if (active) {
      if (active.audio && active.audio.ctx) active.audio.ctx.resume(); // undo pause suspend
      if (active.audio && active.audio.engineOff) active.audio.engineOff();
      active.paused = false;
      active.started = false;
      active.reset();
    }
    active = null;
    fit(); // back to the dynamic (Arena-style) viewport for the menu
    document.getElementById("start-screen").classList.remove("hidden");
  }
  function nextRound() {
    if (active === game && game.started && !game.over && !game.paused) game.rounds.requestNext(game);
  }
  document.getElementById("start-gauntlet-btn").addEventListener("click", startGauntlet);
  document.getElementById("start-arena-btn").addEventListener("click", startArena);
  initTestPanel(); // TEST MODE (dev-only) — remove this call + initTestPanel later
  document.getElementById("weapon-back-btn").addEventListener("click", backToStart);
  document.getElementById("next-round-btn").addEventListener("click", nextRound);
  document.getElementById("restart-btn").addEventListener("click", () => game.restart());
  document.getElementById("shop-toggle").addEventListener("click", () => game.toggleShop());
  document.getElementById("open-shop-btn").addEventListener("click", () => game.toggleShop());
  document.getElementById("resume-btn").addEventListener("click", () => active && active.togglePause());
  document.getElementById("guide-btn").addEventListener("click", () => { if (active === game) game.openGuide(); });
  document.getElementById("guide-back-btn").addEventListener("click", () => game.closeGuide());
  document.getElementById("arena-guide-btn").addEventListener("click", () => { if (active === arena) openArenaGuide(); });
  document.getElementById("arena-guide-back-btn").addEventListener("click", closeArenaGuide);
  document.getElementById("options-btn").addEventListener("click", openOptions);
  document.getElementById("options-back-btn").addEventListener("click", closeOptions);
  document.getElementById("main-menu-btn").addEventListener("click", quitToMenu);

  // Arena stat allocation: tappable buttons + desktop number keys 1-5.
  const STAT_LABELS = { health: "HEALTH", speed: "SPEED", reload: "RELOAD", regen: "REGEN" };
  const STAT_KEYS = { Digit1: "health", Digit2: "speed", Digit3: "reload", Digit4: "regen" };
  // hover tooltip: what the NEXT point in a stat changes (current → next values)
  const statTip = document.getElementById("stat-tooltip");
  function statEffectText(stat) {
    const lvl = arena.stats[stat];
    if (lvl >= 10) return STAT_LABELS[stat] + " is MAXED (10)";
    const to = lvl + 1;
    if (stat === "health") return "HEALTH " + lvl + " → " + to + ":  +12.5 max HP  (" + Math.round(arena.maxHp) + " → " + Math.round(arena.maxHp + 12.5) + ")";
    if (stat === "speed") return "SPEED " + lvl + " → " + to + ":  +5% top speed & accel  (+" + (lvl * 5) + "% → +" + (to * 5) + "%)";
    if (stat === "reload") {
      let txt = "RELOAD " + lvl + " → " + to + ":  +8% fire rate  (+" + (lvl * 8) + "% → +" + (to * 8) + "%)";
      // hook details only make sense while the HOOK weapon is equipped (user)
      if (arena.hasMinelayer()) txt += ";  hook cooldown " + arena.hookCooldown(lvl).toFixed(1) + "s → " + arena.hookCooldown(to).toFixed(1) + "s";
      return txt;
    }
    if (stat === "regen") return "REGEN " + lvl + " → " + to + ":  heal " + (2 + lvl * 0.5).toFixed(1) + "%/s → " + (2 + to * 0.5).toFixed(1) + "%/s of max HP  (after 5s out of combat)";
    return "";
  }
  for (const s in STAT_LABELS) {
    const btn = document.getElementById("stat-" + s);
    btn.addEventListener("click", () => {
      if (onlineActive) { net.send({ type: "spendStat", name: s }); return; } // server is authoritative
      if (active === arena) { arena.spendStat(s); updateArenaStatsUI(); if (!statTip.classList.contains("hidden")) showStatTip(btn, s); }
    });
    btn.addEventListener("mouseenter", () => showStatTip(btn, s));
    btn.addEventListener("mouseleave", () => statTip.classList.add("hidden"));
  }
  function showStatTip(btn, s) {
    if (active !== arena) return;
    statTip.textContent = statEffectText(s);
    statTip.classList.remove("hidden");
    const r = btn.getBoundingClientRect(), t = statTip.getBoundingClientRect();
    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - t.width - 6));
    statTip.style.left = left + "px";
    statTip.style.top = Math.max(6, r.top - t.height - 8) + "px";
  }
  function updateArenaStatsUI() {
    const el = document.getElementById("arena-stats");
    if (active !== arena || arena.statPoints <= 0 || arena.dead) { el.classList.add("hidden"); statTip.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    document.getElementById("stat-prompt-txt").textContent = "SPEND POINTS: " + arena.statPoints;
    for (const s in STAT_LABELS) {
      const btn = document.getElementById("stat-" + s);
      const lvl = arena.stats[s];
      btn.textContent = STAT_LABELS[s] + " " + lvl;
      btn.disabled = lvl >= 10;
    }
  }

  // -- Arena death menu + spectate: on wreck, pick RESPAWN / SPECTATE / MAIN
  // MENU (no auto-respawn). Spectate follows living bots; NEXT (or N) cycles.
  // online: the server owns respawn/loadout, so skip the weapon-picker and ask
  // it to respawn; offline keeps the local re-pick flow
  const doRespawn = () => { if (onlineActive) { net.send({ type: "respawn" }); return; } openRespawnWeaponSelect(); };
  const doMainMenu = () => { if (onlineActive) leaveOnline(); else quitToMenu(); };
  document.getElementById("death-respawn-btn").addEventListener("click", doRespawn);
  document.getElementById("death-spectate-btn").addEventListener("click", () => { if (active === arena && arena.dead && !onlineActive) { arena.spectate = true; arena.spectateCar = null; } });
  document.getElementById("death-mainmenu-btn").addEventListener("click", doMainMenu);
  // spectate NEXT is debounced 150ms so holding N (key-repeat) doesn't swap
  // through every bot in a blink
  let lastSpectateSwap = 0;
  function trySpectateNext() {
    if (active !== arena) return;
    const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    if (now - lastSpectateSwap < 150) return;
    lastSpectateSwap = now;
    arena.nextSpectate();
  }
  document.getElementById("spectate-next-btn").addEventListener("click", trySpectateNext);
  document.getElementById("spectate-respawn-btn").addEventListener("click", doRespawn);
  document.getElementById("spectate-menu-btn").addEventListener("click", doMainMenu);
  function updateDeathUI() {
    const menu = document.getElementById("death-menu");
    const spec = document.getElementById("spectate-ui");
    // while the RESPAWN weapon-picker is open the player is still `dead`, so
    // suppress both death overlays or they re-show on top of the picker
    const base = active === arena && arena.started && arena.dead && !weaponRespawn;
    const showMenu = base && !arena.spectate && arena.respawnT <= 0;
    const showSpec = base && arena.spectate;
    menu.classList.toggle("hidden", !showMenu);
    spec.classList.toggle("hidden", !showSpec);
  }

  // touch ABILITY button: labelled HOOK/CHARGE/SNIPE per the equipped weapon;
  // hidden when the weapon has no ability. One weapon slot = one button
  // (#touch-ability2 is dormant, kept for a future dual-slot revival). Only
  // relevant on touch (buttons live in #touch-controls).
  let abilitySig = "";
  function updateAbilityButtons() {
    if (active !== arena || !arena.loadout) return;
    const L = arena.loadout;
    const a1 = arena.weaponAbility(L.weapon1 && L.weapon1.type);
    const sig = (a1 ? a1.name : "-") + "|" + (arena.dead ? "d" : "a");
    if (sig === abilitySig) return; // only touch the DOM when it changes
    abilitySig = sig;
    const b1 = document.getElementById("touch-ability1"), b2 = document.getElementById("touch-ability2");
    const show = !arena.dead;
    b1.textContent = a1 ? a1.name : ""; b1.classList.toggle("hidden", !a1 || !show);
    b2.classList.add("hidden"); // dormant while there's a single weapon slot
  }

  // -- Arena loadout / equip panel: shows your 5 slots + nearby collectible
  // parts; tap a nearby part to equip it. Auto-shows when parts are in reach,
  // or toggled with the PARTS button / L key. -------------------------------
  let loadoutOpen = false;
  const SLOT_ROWS = [["TIRES", "tires"], ["ENGINE", "engine"], ["WEAPON", "weapon1"], ["ARMOR", "armor"]];
  let lastLoadoutSig = "";
  document.getElementById("loadout-toggle").addEventListener("click", () => { loadoutOpen = !loadoutOpen; lastLoadoutSig = ""; updateLoadoutPanel(); });

  function updateLoadoutPanel() {
    const panel = document.getElementById("arena-loadout");
    const toggle = document.getElementById("loadout-toggle");
    if (active !== arena || !arena.started) { panel.classList.add("hidden"); toggle.classList.add("hidden"); return; }
    if (arena.dead) {
      // SPECTATE: the panel shows the WATCHED bot's parts, read-only
      toggle.classList.add("hidden");
      const t = arena.spectate ? arena.spectateTarget() : null;
      if (!t || !t.loadout) { panel.classList.add("hidden"); lastLoadoutSig = ""; return; }
      const sig = "spec:" + t.name + t.level + ["tires", "engine", "weapon", "armor"]
        .map((k) => { const p = t.loadout[k]; return p ? p.type + p.tier : "-"; }).join("|");
      if (sig !== lastLoadoutSig) { lastLoadoutSig = sig; buildSpectatePanel(t); }
      panel.classList.remove("hidden");
      positionArenaDom();
      return;
    }
    toggle.classList.remove("hidden");
    positionArenaDom();
    const near = arena.collectibleDrops();
    if (!(loadoutOpen || near.length)) { panel.classList.add("hidden"); return; }
    const L = arena.loadout;
    // rebuild only when the loadout or the nearby set actually changed
    const sig = SLOT_ROWS.map(([, k]) => { const p = L[k]; return p ? p.slot + p.type + p.tier : "-"; }).join("|") +
      "##" + near.map((d) => d.part.slot + d.part.type + d.part.tier + Math.round(d.x) + Math.round(d.y)).join("|");
    if (sig !== lastLoadoutSig) { lastLoadoutSig = sig; buildLoadoutPanel(near); }
    panel.classList.remove("hidden");
    positionArenaDom();
  }
  // read-only panel for SPECTATE: the watched bot's four part slots
  function buildSpectatePanel(bot) {
    document.querySelector("#arena-loadout .lo-title").textContent = bot.name + " — PARTS";
    const slotsEl = document.getElementById("lo-slots");
    slotsEl.innerHTML = "";
    for (const [label, key] of [["TIRES", "tires"], ["ENGINE", "engine"], ["WEAPON", "weapon"], ["ARMOR", "armor"]]) {
      const part = bot.loadout[key];
      const row = document.createElement("div"); row.className = "lo-row";
      const l = document.createElement("span"); l.className = "lo-label"; l.textContent = label;
      const v = document.createElement("span");
      if (part) { v.className = "lo-part"; v.textContent = partName(part); v.style.color = tierColor(part); }
      else { v.className = "lo-empty"; v.textContent = "— empty —"; }
      row.appendChild(l); row.appendChild(v); slotsEl.appendChild(row);
    }
    document.getElementById("lo-nearby").innerHTML = ""; // read-only: no pickups, no swap
  }

  function buildLoadoutPanel(near) {
    document.querySelector("#arena-loadout .lo-title").textContent = "LOADOUT"; // undo any spectate title
    const slotsEl = document.getElementById("lo-slots");
    slotsEl.innerHTML = "";
    for (const [label, key] of SLOT_ROWS) {
      const part = arena.loadout[key];
      const row = document.createElement("div"); row.className = "lo-row";
      const l = document.createElement("span"); l.className = "lo-label"; l.textContent = label;
      const v = document.createElement("span");
      if (part) { v.className = "lo-part"; v.textContent = partName(part); v.style.color = tierColor(part); }
      else { v.className = "lo-empty"; v.textContent = "— empty —"; }
      row.appendChild(l); row.appendChild(v); slotsEl.appendChild(row);
    }
    const nearEl = document.getElementById("lo-nearby");
    nearEl.innerHTML = "";
    if (!near.length) return;
    const sub = document.createElement("div"); sub.className = "lo-sub"; sub.textContent = "NEARBY PARTS"; nearEl.appendChild(sub);
    for (const d of near) {
      const cmp = arena.slotCompare(d.part); // 1 up / 0 same / -1 down
      const btn = document.createElement("button");
      btn.className = "lo-pick " + (cmp > 0 ? "up" : cmp < 0 ? "down" : "same");
      const nm = document.createElement("span"); nm.textContent = partName(d.part); nm.style.color = tierColor(d.part);
      const ar = document.createElement("span"); ar.className = "lo-arrow"; ar.textContent = cmp > 0 ? "↑" : cmp < 0 ? "↓" : "→";
      btn.appendChild(nm); btn.appendChild(ar);
      btn.addEventListener("click", () => { arena.equipPart(d); lastLoadoutSig = ""; updateLoadoutPanel(); });
      nearEl.appendChild(btn);
    }
  }

  // volume slider: applies live, persists across sessions
  const slider = document.getElementById("volume-slider");
  const volLabel = document.getElementById("volume-value");
  try {
    const saved = localStorage.getItem("sd_volume");
    if (saved !== null) {
      slider.value = saved;
      volLabel.textContent = saved + "%";
      game.audio.setVolume(saved / 100);
    }
  } catch (_) { /* storage unavailable (headless/sandbox) — default volume */ }
  slider.addEventListener("input", () => {
    volLabel.textContent = slider.value + "%";
    game.audio.setVolume(slider.value / 100);
    try { localStorage.setItem("sd_volume", slider.value); } catch (_) {}
  });

  // fullscreen toggle: uses the Fullscreen API on the whole page. The browser
  // requires a user gesture to ENTER, so we can't auto-apply a saved preference
  // on load — we just remember it + reflect the live state. `fit()` reflows the
  // canvas on the resulting resize automatically (fullscreenchange also fires a
  // resize). Not all browsers/headless support it — all calls are guarded.
  const fsBtn = document.getElementById("fullscreen-btn");
  function isFullscreen() { return !!document.fullscreenElement; }
  function reflectFullscreen() {
    if (!fsBtn) return;
    const on = isFullscreen();
    fsBtn.textContent = on ? "ON" : "OFF";
    if (fsBtn.classList && fsBtn.classList.toggle) fsBtn.classList.toggle("on", on);
  }
  if (fsBtn) {
    fsBtn.addEventListener("click", () => {
      try {
        if (!isFullscreen()) {
          const el = document.documentElement;
          if (el.requestFullscreen) el.requestFullscreen();
        } else if (document.exitFullscreen) {
          document.exitFullscreen();
        }
        try { localStorage.setItem("sd_fullscreen", isFullscreen() ? "0" : "1"); } catch (_) {}
      } catch (_) { /* fullscreen unsupported/blocked */ }
    });
    if (document.addEventListener) document.addEventListener("fullscreenchange", () => { reflectFullscreen(); fit(); });
    reflectFullscreen();
  }

  // -- CROSSHAIR options (user): style chips (incl. OFF) + size slider + RGB
  // color sliders, persisted. The renderer reads arena.renderer.xhair each
  // frame; changes apply live. ------------------------------------------------
  const XHAIR_STYLES = ["cross", "dot", "ring", "chev", "off"];
  (function initCrosshairOptions() {
    const chips = document.getElementById("xhair-chips");
    const slider = document.getElementById("xhair-size");
    const sizeLabel = document.getElementById("xhair-size-value");
    if (!chips || !slider) return; // stub DOM (headless tests)
    const xh = arena.renderer.xhair;
    try {
      const st = localStorage.getItem("sd_xhair_style");
      if (st && XHAIR_STYLES.includes(st)) xh.style = st;
      const sz = parseInt(localStorage.getItem("sd_xhair_size"), 10);
      if (Number.isFinite(sz) && sz >= 60 && sz <= 180) { xh.size = sz / 100; slider.value = sz; }
      const colStr = localStorage.getItem("sd_xhair_color");
      if (colStr) {
        const [r, g, b] = colStr.split(",").map((v) => clamp(parseInt(v, 10) || 0, 0, 255));
        xh.color = { r, g, b };
      }
    } catch (_) { /* storage unavailable */ }
    if (sizeLabel) sizeLabel.textContent = slider.value + "%";
    const chipEls = [], chipCtxs = [];
    const chipColor = (style) => style === "off" ? THEME.dangerBright // OFF chip: always bright red (user)
      : "rgb(" + xh.color.r + "," + xh.color.g + "," + xh.color.b + ")";
    const redrawChips = () => {
      for (let i = 0; i < chipCtxs.length; i++) {
        const cctx = chipCtxs[i];
        if (!cctx) continue;
        cctx.clearRect(0, 0, 44, 44);
        drawCrosshairShape(cctx, 22, 22, XHAIR_STYLES[i], 1.15, chipColor(XHAIR_STYLES[i]));
      }
    };
    for (const style of XHAIR_STYLES) {
      const cv = document.createElement("canvas");
      if (!cv) continue; // stub DOM (headless tests)
      cv.width = 44; cv.height = 44;
      cv.className = "xhair-chip" + (style === xh.style ? " active" : "");
      const cctx = cv.getContext && cv.getContext("2d");
      chipCtxs.push(cctx || null);
      if (cctx) drawCrosshairShape(cctx, 22, 22, style, 1.15, chipColor(style));
      if (cv.addEventListener) cv.addEventListener("click", () => {
        xh.style = style;
        try { localStorage.setItem("sd_xhair_style", style); } catch (_) {}
        for (const el of chipEls) if (el.classList && el.classList.toggle) el.classList.toggle("active", el === cv);
      });
      if (chips.appendChild) chips.appendChild(cv);
      chipEls.push(cv);
    }
    if (slider.addEventListener) slider.addEventListener("input", () => {
      if (sizeLabel) sizeLabel.textContent = slider.value + "%";
      xh.size = slider.value / 100;
      try { localStorage.setItem("sd_xhair_size", slider.value); } catch (_) {}
    });
    // RGB color sliders + live swatch; the chips redraw in the chosen color
    const rEl = document.getElementById("xhair-r"), gEl = document.getElementById("xhair-g"), bEl = document.getElementById("xhair-b");
    const swatch = document.getElementById("xhair-swatch");
    if (rEl && gEl && bEl) {
      rEl.value = xh.color.r; gEl.value = xh.color.g; bEl.value = xh.color.b;
      const applyColor = () => {
        xh.color = { r: parseInt(rEl.value, 10), g: parseInt(gEl.value, 10), b: parseInt(bEl.value, 10) };
        if (swatch && swatch.style) swatch.style.background = chipColor();
        redrawChips();
        try { localStorage.setItem("sd_xhair_color", xh.color.r + "," + xh.color.g + "," + xh.color.b); } catch (_) {}
      };
      for (const el of [rEl, gEl, bEl]) if (el.addEventListener) el.addEventListener("input", applyColor);
      if (swatch && swatch.style) swatch.style.background = chipColor();
    }
    // RELOAD INDICATOR toggle: shows/hides the crosshair's cooldown arc
    const arcBtn = document.getElementById("xhair-arc-btn");
    if (arcBtn) {
      try { xh.arc = localStorage.getItem("sd_xhair_arc") !== "0"; } catch (_) {}
      const reflectArc = () => {
        arcBtn.textContent = xh.arc ? "ON" : "OFF";
        if (arcBtn.classList && arcBtn.classList.toggle) arcBtn.classList.toggle("on", xh.arc);
      };
      if (arcBtn.addEventListener) arcBtn.addEventListener("click", () => {
        xh.arc = !xh.arc;
        try { localStorage.setItem("sd_xhair_arc", xh.arc ? "1" : "0"); } catch (_) {}
        reflectArc();
      });
      reflectArc();
    }
  })();

  // hide the OS cursor over the canvas while actually PLAYING Arena (the
  // custom crosshair replaces it); menus/death/pause — or crosshair OFF —
  // get the cursor back
  let cursorHidden = false;
  function updateCursor() {
    const hide = active === arena && arena.started && !arena.dead && !arena.paused &&
      arena.renderer.xhair.style !== "off" && !layoutEditActive();
    if (hide !== cursorHidden) {
      cursorHidden = hide;
      canvas.style.cursor = hide ? "none" : "";
    }
  }

  // ===== HUD LAYOUT: global UI SCALE + drag-to-move groups (user) ============
  // Canvas groups (hud/minimap/killfeed/bossbar) live in renderer.layout as
  // viewport FRACTIONS; touch controls store window fractions under "dom:<id>".
  // Persisted per DEVICE TYPE — and this {scale, pos} blob is exactly what a
  // website account profile would sync per-user later.
  const LAYOUT_SCALE_MIN = 0.7, LAYOUT_SCALE_MAX = 1.4;
  const TOUCH_LAYOUT_IDS = ["joystick-zone", "touch-fire", "touch-drift", "touch-ability1", "touch-pause"];
  let layoutDrag = null;       // active drag: {kind:"canvas",key,offX,offY} | {kind:"dom",id,offX,offY}
  let touchLayoutEdit = false; // pause-screen EDIT HUD LAYOUT mode (drag without holding H)
  function layoutEditActive() { return game.input.layoutEdit || touchLayoutEdit; }
  function layoutStoreKey() { return "sd_layout_" + (document.body.classList && document.body.classList.contains("touch-mode") ? "touch" : "desktop"); }
  function loadLayout() {
    let l = { scale: 1, pos: {} };
    try {
      const raw = localStorage.getItem(layoutStoreKey());
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p === "object") l = { scale: clamp(p.scale || 1, LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX), pos: p.pos || {} };
      }
    } catch (_) { /* storage unavailable */ }
    arena.renderer.layout = l;
    applyUiScaleCss();
    applyTouchControlLayout();
    reflectUiScaleUi();
  }
  function saveLayout() { try { localStorage.setItem(layoutStoreKey(), JSON.stringify(arena.renderer.layout)); } catch (_) {} }
  function applyUiScaleCss() {
    const st = document.documentElement && document.documentElement.style;
    if (st && st.setProperty) st.setProperty("--ui-scale", arena.renderer.layout.scale);
  }
  function applyTouchControlLayout() { // moved touch controls: window-fraction left/top overrides
    // (list inlined, not the shared const: fit() calls this hoisted fn at boot
    // BEFORE the module's consts initialize — a TDZ trap)
    for (const id of ["joystick-zone", "touch-fire", "touch-drift", "touch-ability1", "touch-pause"]) {
      const el = document.getElementById(id);
      if (!el || !el.style) continue;
      const o = arena.renderer.layout.pos["dom:" + id];
      if (o) {
        el.style.left = Math.round(o.fx * window.innerWidth) + "px";
        el.style.top = Math.round(o.fy * window.innerHeight) + "px";
        el.style.right = "auto";
        el.style.bottom = "auto";
      } else {
        el.style.left = ""; el.style.top = ""; el.style.right = ""; el.style.bottom = "";
      }
    }
  }
  const uiScaleEl = document.getElementById("ui-scale");
  const uiScaleVal = document.getElementById("ui-scale-value");
  function reflectUiScaleUi() {
    if (!uiScaleEl) return;
    uiScaleEl.value = Math.round((arena.renderer.layout.scale || 1) * 100);
    if (uiScaleVal) uiScaleVal.textContent = uiScaleEl.value + "%";
  }
  if (uiScaleEl && uiScaleEl.addEventListener) uiScaleEl.addEventListener("input", () => {
    arena.renderer.layout.scale = clamp(uiScaleEl.value / 100, LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX);
    if (uiScaleVal) uiScaleVal.textContent = uiScaleEl.value + "%";
    applyUiScaleCss();
    saveLayout();
  });
  const layoutResetBtn = document.getElementById("layout-reset-btn");
  if (layoutResetBtn && layoutResetBtn.addEventListener) layoutResetBtn.addEventListener("click", () => {
    arena.renderer.layout = { scale: 1, pos: {} };
    applyUiScaleCss();
    applyTouchControlLayout();
    reflectUiScaleUi();
    saveLayout();
  });
  // client coords → logical viewport coords (same mapping the renderer uses)
  function clientToLogical(cx, cy) {
    if (!canvas.getBoundingClientRect) return null;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: ((cx - r.left) / r.width) * VIEW.w, y: ((cy - r.top) / r.height) * VIEW.h };
  }
  function layoutHitCanvas(lx, ly) { // which canvas group is under the cursor?
    const groups = arena.renderer.layoutGroups();
    const s = arena.renderer.layout.scale || 1;
    for (const key of Object.keys(groups)) {
      const d = groups[key];
      const a = arena.renderer.layoutAnchor(key, d.defX, d.defY);
      if (lx >= a.x - 8 && lx <= a.x + d.w * s + 8 && ly >= a.y - 8 && ly <= a.y + d.h * s + 8) {
        return { kind: "canvas", key, offX: lx - a.x, offY: ly - a.y };
      }
    }
    return null;
  }
  function layoutDragMove(cx, cy) {
    if (!layoutDrag) return;
    if (layoutDrag.kind === "canvas") {
      const l = clientToLogical(cx, cy);
      if (!l) return;
      const groups = arena.renderer.layoutGroups();
      const d = groups[layoutDrag.key];
      const s = arena.renderer.layout.scale || 1;
      const ax = clamp(l.x - layoutDrag.offX, 4, VIEW.w - d.w * s - 4);
      const ay = clamp(l.y - layoutDrag.offY, 4, VIEW.h - d.h * s - 4);
      arena.renderer.layout.pos[layoutDrag.key] = { fx: ax / VIEW.w, fy: ay / VIEW.h };
    } else { // dom touch control
      const el = document.getElementById(layoutDrag.id);
      const w = el && el.offsetWidth || 60, h = el && el.offsetHeight || 60;
      const x = clamp(cx - layoutDrag.offX, 2, window.innerWidth - w - 2);
      const y = clamp(cy - layoutDrag.offY, 2, window.innerHeight - h - 2);
      arena.renderer.layout.pos["dom:" + layoutDrag.id] = { fx: x / window.innerWidth, fy: y / window.innerHeight };
      applyTouchControlLayout();
    }
  }
  function layoutDragEnd() {
    if (!layoutDrag) return;
    layoutDrag = null;
    saveLayout();
  }
  // desktop: hold H, drag panels (mouse); H also suppresses firing (arena reads input.layoutEdit)
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyH" && !e.repeat && active === arena) game.input.layoutEdit = true;
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyH") { game.input.layoutEdit = false; layoutDragEnd(); }
  });
  canvas.addEventListener && canvas.addEventListener("mousedown", (e) => {
    if (active !== arena || !layoutEditActive()) return;
    const l = clientToLogical(e.clientX, e.clientY);
    if (!l) return;
    const hit = layoutHitCanvas(l.x, l.y);
    if (hit) { layoutDrag = hit; e.preventDefault(); e.stopPropagation(); }
  }, true); // capture: beat the fire handler to the click while editing
  window.addEventListener("mousemove", (e) => { if (layoutDrag) layoutDragMove(e.clientX, e.clientY); });
  window.addEventListener("mouseup", layoutDragEnd);
  // full edit mode: enter from Options (EDIT button) or the TAB key — the
  // overlays step aside and you drag canvas groups AND touch controls without
  // holding anything; DONE (or TAB again) exits back to wherever you came from.
  const layoutEditBtn = document.getElementById("layout-edit-btn");
  const layoutDoneBtn = document.getElementById("layout-done-btn");
  let layoutEditReturn = "pause"; // where DONE goes back to: "options" | "pause" | "resume"
  function setTouchLayoutEdit(on) {
    touchLayoutEdit = on;
    if (layoutDoneBtn) layoutDoneBtn.classList.toggle("hidden", !on);
    document.getElementById("pause-screen").classList.toggle("hidden", on || !arena.paused);
  }
  function enterLayoutEdit(returnTo) {
    layoutEditReturn = returnTo;
    document.getElementById("options-screen").classList.add("hidden");
    if (!arena.paused) arena.togglePause(); // edit over a frozen world (no firing/dying mid-drag)
    setTouchLayoutEdit(true);
  }
  function exitLayoutEdit() {
    setTouchLayoutEdit(false); // re-shows the pause overlay (arena is paused)
    if (layoutEditReturn === "options") openOptions();
    else if (layoutEditReturn === "resume" && arena.paused) arena.togglePause(); // TAB from live play → straight back in
    layoutEditReturn = "pause";
  }
  if (layoutEditBtn && layoutEditBtn.addEventListener) layoutEditBtn.addEventListener("click", () => {
    if (active === arena && arena.started) enterLayoutEdit("options");
  });
  if (layoutDoneBtn && layoutDoneBtn.addEventListener) layoutDoneBtn.addEventListener("click", exitLayoutEdit);
  // TAB toggles the editor from anywhere in an Arena run (PC)
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Tab" || active !== arena || !arena.started || arena.dead) return;
    e.preventDefault(); // keep the browser's focus-cycling out of the game
    if (touchLayoutEdit) { exitLayoutEdit(); return; }
    const fromOptions = !document.getElementById("options-screen").classList.contains("hidden");
    enterLayoutEdit(fromOptions ? "options" : arena.paused ? "pause" : "resume");
  });
  canvas.addEventListener && canvas.addEventListener("touchstart", (e) => {
    if (active !== arena || !touchLayoutEdit || !e.touches.length) return;
    const t = e.touches[0];
    const l = clientToLogical(t.clientX, t.clientY);
    if (!l) return;
    const hit = layoutHitCanvas(l.x, l.y);
    if (hit) { layoutDrag = hit; e.preventDefault(); e.stopPropagation(); }
  }, { capture: true, passive: false });
  for (const id of TOUCH_LAYOUT_IDS) { // touch controls drag as themselves in edit mode
    const el = document.getElementById(id);
    if (!el || !el.addEventListener) continue;
    el.addEventListener("touchstart", (e) => {
      if (!touchLayoutEdit || !e.touches.length) return;
      const t = e.touches[0], r = el.getBoundingClientRect();
      layoutDrag = { kind: "dom", id, offX: t.clientX - r.left, offY: t.clientY - r.top };
      e.preventDefault(); e.stopPropagation();
    }, { capture: true, passive: false });
  }
  window.addEventListener("touchmove", (e) => {
    if (layoutDrag && e.touches.length) { layoutDragMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
  }, { passive: false });
  window.addEventListener("touchend", layoutDragEnd);
  loadLayout();
  // ===== end HUD LAYOUT =====

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      // ESC backs out of the top-most overlay, then unpauses the active mode
      const vis = (id) => !document.getElementById(id).classList.contains("hidden");
      if (touchLayoutEdit) exitLayoutEdit(); // the HUD editor owns the screen
      else if (vis("weapon-select")) backToStart();
      else if (vis("options-screen")) closeOptions();
      else if (vis("guide-screen")) game.closeGuide();
      else if (vis("arena-guide-screen")) closeArenaGuide();
      else if (active === arena && arena.spectate) arena.spectate = false; // back to the death menu
      else if (active === arena && arena.dead) { /* the death menu owns the screen */ }
      else if (active) active.togglePause();
    }
    else if (e.code === "KeyN" || e.code === "Enter") {
      if (active === arena && arena.spectate) trySpectateNext(); // cycle (debounced vs key-repeat)
      else nextRound();
    }
    else if (e.code === "KeyB") { if (active === game) game.toggleShop(); }
    else if (e.code === "KeyL" && active === arena) { loadoutOpen = !loadoutOpen; lastLoadoutSig = ""; updateLoadoutPanel(); }
    else if (active === arena && STAT_KEYS[e.code]) { if (onlineActive) net.send({ type: "spendStat", name: STAT_KEYS[e.code] }); else { arena.spendStat(STAT_KEYS[e.code]); updateArenaStatsUI(); } }
  });

  // show virtual controls on touch devices (coarse pointer, or first touch)
  function enableTouch() {
    document.body.classList.add("touch-mode");
    game.touchMode = true; // canvas HUD relocates around the virtual controls
    arena.touchMode = true;
  }
  if (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) {
    enableTouch();
  }
  window.addEventListener("touchstart", enableTouch, { once: true });
  document.getElementById("touch-pause").addEventListener("click", () => active && active.togglePause());

  // rotating a phone to portrait auto-pauses the active mode (no-op on
  // desktop / non-touch); returning to landscape leaves the pause screen up
  if (typeof window.matchMedia === "function") {
    const portraitMQ = window.matchMedia("(orientation: portrait)");
    const onOrient = (e) => active && active.handleOrientation(e.matches);
    if (portraitMQ.addEventListener) portraitMQ.addEventListener("change", onOrient);
    else if (portraitMQ.addListener) portraitMQ.addListener(onOrient); // older Safari
  }

  // dev preview hooks: ?touch forces touch-mode; ?screen=pause|intermission|
  // shop|guide|options jumps straight to that menu (for layout screenshots);
  // ?seed=<hex|int> locks the run's RNG for a reproducible layout
  if (typeof location !== "undefined" && location.search) {
    const params = new URLSearchParams(location.search);
    if (params.has("touch")) enableTouch();
    const seedParam = params.get("seed");
    if (seedParam !== null) {
      const s = /^[0-9a-f]+$/i.test(seedParam) && seedParam.length <= 8
        ? parseInt(seedParam, 16) : parseInt(seedParam, 10);
      if (Number.isFinite(s)) game.setSeed(s);
    }
    if (params.get("mode") === "arena") { // preview Arena: weapon picker, or
      document.getElementById("start-screen").classList.add("hidden");
      const w = params.get("weapon");
      if (w) { arena.startWeapon = w; active = arena; fit(); arena.begin(); loadoutOpen = true; lastLoadoutSig = ""; } // ...straight to play
      else { buildWeaponSelect(); document.getElementById("weapon-select").classList.remove("hidden"); }
      const xp = parseInt(params.get("xp"), 10);
      if (active === arena && Number.isFinite(xp)) arena.addXp(xp); // preview leveled state
      if (params.has("nearbot") && active === arena && arena.bots.length) { // pull a bot into view
        const bot = arena.bots[0];
        bot.x = arena.player.x + 120; bot.y = arena.player.y - 40;
      }
      if (params.has("loot") && active === arena) { // drop collectible parts to preview the panel
        const pp = arena.player;
        arena.dropPart(pp.x - 90, pp.y - 20, makePart("engine", "engine", 4));   // legendary upgrade
        arena.dropPart(pp.x - 30, pp.y + 70, makePart("weapon", "ram", 3));       // epic weapon (empty W2)
        arena.dropPart(pp.x + 80, pp.y + 40, makePart("tires", "tires", 0));      // common downgrade
        arena.dropPart(pp.x + 60, pp.y - 60, makePart("armor", "armor", 2));      // rare upgrade
      }
      if (params.has("boss") && active === arena && arena.boss) { // pull the Titan into view
        arena.boss.x = arena.player.x + 40; arena.boss.y = arena.player.y - 190;
      }
      if (params.has("railgun") && active === arena) { // preview the loot-only railgun equipped
        arena.loadout.weapon1 = makePart("weapon", "railgun", 2);
        arena.startWeapon = "railgun";
        arena.applyStats();
        if (params.has("reloading")) arena.railCd = 1.9; // show the on-car reload state (mid-refill) for screenshots
      }
      if (params.has("layout") && active === arena) { // preview a moved+scaled HUD layout
        arena.renderer.layout = { scale: 1.2, pos: {
          minimap: { fx: 0.015, fy: 0.42 },   // minimap+leaderboard to the left-middle
          killfeed: { fx: 0.55, fy: 0.04 },   // killfeed near the top-center
        } };
        applyUiScaleCss();
        if (params.has("edit")) touchLayoutEdit = true; // show the drag outlines
      }
      if (params.has("xhair") && active === arena) { // preview the crosshair (fake a cursor position)
        arena.input.hasMouse = true;
        arena.input.mouseX = Math.round(window.innerWidth * 0.60);
        arena.input.mouseY = Math.round(window.innerHeight * 0.38);
      }
      if (params.has("crate") && active === arena && arena.crates.length) { // pull a crate into view
        const c = arena.crates[0];
        c.dead = false; c.hp = CRATE_HP;
        c.x = arena.player.x + 110; c.y = arena.player.y - 50;
      }
      if (params.has("wheels") && active === arena) { // preview wheel damage states
        const pp = arena.player;
        pp.components.wheelFL.hp = 0;                                   // broken front-left (askew)
        pp.components.wheelRL.hp = pp.components.wheelRL.max * 0.3;     // hurting rear-left
        syncWheelSides(pp);
        if (arena.bots.length) { // a nearby bot mid-mend (green pulse)
          const bot = arena.bots[0];
          bot.x = pp.x + 140; bot.y = pp.y - 30;
          bot.components.wheelFR.hp = bot.components.wheelFR.max * 0.4;
          syncWheelSides(bot);
          bot.sinceHit = 99; bot.wheelMending = true;
        }
      }
      if (params.has("magnet") && active === arena) { // preview the roaming Magnet boss
        arena.boss = arena.spawnCentralBoss("magnet");
        arena.boss.x = arena.player.x + 40; arena.boss.y = arena.player.y - 240;
        arena.boss.overload = params.has("overload") ? 5 : 0; // &overload shows the vulnerable window
      }
      if (params.has("loadout") && active === arena && arena.loadout) { // preview mixed-tier parts
        arena.loadout.tires = makePart("tires", "tires", 2);
        arena.loadout.engine = makePart("engine", "engine", 4);
        arena.loadout.weapon1 = makePart("weapon", "cannon", 1);
        arena.loadout.armor = makePart("armor", "armor", 2);
        arena.startWeapon = "cannon";
        arena.applyStats();
      }
      if (params.has("social") && active === arena && arena.bots.length) { // seed killfeed + nemesis
        const b = arena.bots[0];
        arena.nemesis = b; b.x = arena.player.x + 130; b.y = arena.player.y - 60;
        arena.feedWreck(arena.bots[1], arena.bots[2]);
        arena.feedWreck(arena.player, arena.bots[3]);
        arena.feedWreck(b, arena.player);
        arena.killfeed.unshift({ text: arena.bots[1].name + ": 5-WRECK RAMPAGE", you: false, streak: true, age: 0 });
      }
      if (params.has("fire") && active === arena) { // preview shots/mines on screen
        const pp = arena.player, ff = pp.forward;
        // YOUR shots + mine (render yellow — owned by the local player)
        for (let i = 1; i <= 4; i++) { const b = new Bullet(pp.x + ff.x * i * 85, pp.y + ff.y * i * 85, pp.heading, 560, true, 26); b.shooter = pp; arena.bullets.push(b); }
        arena.mines.push({ x: pp.x - ff.x * 46, y: pp.y - ff.y * 46 + 30, owner: pp, arm: 0, dmg: 30, dead: false });
        // INCOMING enemy fire + mine (render red — owned by a bot)
        const foe = arena.bots[0];
        for (let i = 1; i <= 3; i++) { const b = new Bullet(pp.x + 150 + i * 70, pp.y - 120, pp.heading + Math.PI, 460, false, 12); b.shooter = foe; arena.bullets.push(b); }
        arena.mines.push({ x: pp.x + 150, y: pp.y + 95, owner: foe, arm: 0, dmg: 20, dead: false });
      }
      if (params.has("dead") && active === arena) { arena.damagePlayer(99999); arena.respawnT = 0; } // preview death menu
      if (params.has("respawnpick") && active === arena) { arena.damagePlayer(99999); arena.respawnT = 0; openRespawnWeaponSelect(); } // preview the respawn weapon-picker
      if (params.has("spectate") && active === arena) { arena.damagePlayer(99999); arena.respawnT = 0; arena.spectate = true; } // preview spectate
      if (params.has("hook") && active === arena) { // preview the minelayer hook mid-reel
        arena.loadout.weapon1 = makePart("weapon", "minelayer", 0); arena.startWeapon = "minelayer"; arena.applyStats();
        const pp = arena.player, foe = arena.bots[0];
        if (foe) { foe.x = pp.x + 320; foe.y = pp.y - 30; arena.fireHook(pp, Math.atan2(foe.y - pp.y, foe.x - pp.x)); for (let i = 0; i < 6; i++) arena.updateHooks(1 / 60); }
      }
      if (params.has("pause") && active === arena) arena.togglePause(); // preview arena pause menu
      if (params.has("guide") && active === arena) { arena.togglePause(); openArenaGuide(); } // preview arena field guide
    }
    const screen = params.get("screen");
    if (screen) {
      document.getElementById("start-screen").classList.add("hidden");
      active = game;
      fit();
      game.started = true;
      game.rounds.round = 3;
      game.rounds.state = "intermission";
      game.salvage = 55;
      if (screen === "pause") game.togglePause();
      else if (screen === "intermission") game.showIntermission();
      else if (screen === "shop") { game.showIntermission(); game.toggleShop(); }
      else if (screen === "guide") {
        game.togglePause();
        for (const t of ["rammer", "circler", "shielded", "thief"]) game.seenTypes.add(t);
        game.openGuide();
      }
      else if (screen === "options") { game.togglePause(); game.openOptions(); }
      else if (screen === "hud") { // live in-round view for HUD layout checks
        game.rounds.state = "active";
        game.rounds.round = 3;
        game.kills = 7;
        for (let i = 0; i < 3; i++) game.rounds.spawnOne(game, { type: "circler" });
        for (const k in game.player.components) game.player.components[k].hp *= 0.55;
      }
      else if (screen === "gameover") game.gameOver();
    }
  }

  // Fixed-timestep simulation: physics + RNG always advance in identical
  // STEP-sized ticks regardless of display refresh rate, so a given seed +
  // input sequence reproduces a run exactly (required for replays/validation).
  // Rendering still happens once per animation frame.
  const STEP = 1 / 60;

  // ===== PLAY ONLINE (multiplayer M1) =======================================
  // Enter online mode: the loop stops simulating and instead streams input +
  // renders server snapshots (applyOnlineSnapshot rebuilds the arena's entities
  // from net.snap each frame, so the EXISTING renderer + HUD draw the server's
  // world).
  function enterOnline() {
    onlineActive = true;
    active = arena;                 // so `active === arena` HUD/cursor checks pass
    arena.started = true; arena.paused = false;
    arena.spectate = false;
    document.getElementById("start-screen").classList.add("hidden");
    document.getElementById("online-screen").classList.add("hidden");
    document.getElementById("weapon-select").classList.add("hidden");
    document.getElementById("arena-loadout").classList.add("hidden"); // online loot is server-side (M1)
    document.getElementById("loadout-toggle").classList.add("hidden");
    document.getElementById("arena-guide-btn").classList.remove("hidden");
    net._carCache.clear();
    fit();
  }
  function leaveOnline(msg) {
    onlineActive = false;
    net.close();
    quitToMenu();
    const s = document.getElementById("online-status");
    if (msg && s) { document.getElementById("start-screen").classList.add("hidden"); document.getElementById("online-screen").classList.remove("hidden"); s.textContent = msg; s.className = "err"; }
  }

  // build the arena's entities from the latest server snapshot (reuses Car for
  // shape/forward; humans → players[], bots → bots[], everything else plain)
  function makeNetScrap(x, y, a) {
    return { x, y, amount: a, maxAmount: 55, dead: false, seed: (x * 13 + y * 7) % 6.283,
      get scale() { return 0.45 + 0.55 * clamp(this.amount / this.maxAmount, 0, 1); } };
  }
  function makeNetBoss(b) {
    return { kind: b.kind, x: b.x, y: b.y, heading: b.h, radius: b.rad || 72, dead: false,
      plates: [], coreHp: b.hf, coreMax: 1, hitFlash: 0, slamWind: 0, ringWind: 0, megaWind: 0,
      overload: b.vul ? 1 : 0, prey: null,
      hpFrac: () => b.hf, isVulnerable: () => !!b.vul,
      name: b.kind === "magnet" ? "THE MAGNET" : "JUNK TITAN", tagline: "" };
  }
  const INTERP_DELAY = 100;   // ms behind live: render remote entities interpolated in the past
  const RECON_SNAP = 250;     // px error above which reconciliation hard-snaps (respawn/teleport)
  const RECON_SMOOTH = 0.35;  // else ease the self car toward the reconciled pos (hides pops)
  function lerpAngleM(a, b, f) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * f; }
  function applySelfPhysics(car, c) { // keep the predicted car's drive params matched to the server's
    if (!c || !c.ms) return;
    car.maxSpeed = c.ms; car.engineAccel = c.ac; car.turnRate = c.tr;
    car.grip = c.gr; car.drag = c.dg; car.handbrakeBoost = c.hb;
  }
  function applyOnlineSnapshot() {
    const snap = net.snap; if (!snap) return;
    const nowMs = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const interp = net.interpPositions(nowMs - INTERP_DELAY);
    const cache = net._carCache, seen = new Set();
    const players = [], bots = [];
    let selfCar = null, selfWrap = null;
    for (const c of snap.cars) {
      seen.add(c.id);
      let car = cache.get(c.id);
      const fresh = !car;
      if (!car) { car = new Car(c.x, c.y, c.h); cache.set(c.id, car); }
      const isSelf = c.k === "p" && c.id === net.selfId;
      if (isSelf) {
        // the self car's position is owned by client prediction + reconciliation
        // (predictDrive / reconcileSelf); only seed it on first sight
        if (fresh) { car.x = c.x; car.y = c.y; car.heading = c.h; car.vx = c.vx || 0; car.vy = c.vy || 0; applySelfPhysics(car, c); }
      } else if (interp && interp.cars.has(c.id)) {
        const p = interp.cars.get(c.id); car.x = p.x; car.y = p.y; car.heading = p.h;
      } else { car.x = c.x; car.y = c.y; car.heading = c.h; }
      car.hp = c.hp; car.maxHp = c.mhp;
      if (c.k === "p") {
        const isLocal = c.id === net.selfId;
        const wrap = { car, name: c.n, level: c.lv, hp: c.hp, maxHp: c.mhp, isLocal, dead: !!c.dead,
          loadout: { weapon1: { type: c.w, tier: 0 }, weapon2: null } };
        if (isLocal) {
          wrap.xp = c.xp || 0; wrap.statPoints = c.sp || 0;
          wrap.stats = c.st || { health: 0, speed: 0, reload: 0, regen: 0 };
          wrap.slots = c.slots || { armor: false };
          wrap.railCd = 0; wrap.ramCharge = 0; wrap.ramBoostT = 0; wrap.hookCd = 0;
          wrap.partDmgReduce = 0; wrap.outOfCombat = 0; wrap.startWeapon = c.w; wrap.baseWeapon = c.w;
          selfCar = car; selfWrap = wrap;
        }
        players.push(wrap);
      } else {
        car.name = c.n; car.level = c.lv; car.weapon = c.w; car.deadFlag = false;
        if (car.hitFlash === undefined) car.hitFlash = 0;
        bots.push(car);
      }
    }
    for (const id of Array.from(cache.keys())) if (!seen.has(id)) cache.delete(id);
    arena.players = players;
    arena.bots = bots;
    if (selfWrap) arena.localPlayer = selfWrap;
    // bullets move straight, so extrapolate each along its velocity to the same
    // render time as the interpolated cars (elapsed is ~negative = render in the
    // recent past), keeping shots visually consistent with the cars that fired them
    const elapsed = Math.max(-0.15, Math.min(0.02, (nowMs - INTERP_DELAY - net.lastSnapAt) / 1000));
    arena.bullets = snap.bullets.map((b) => ({ x: b.x + b.vx * elapsed, y: b.y + b.vy * elapsed, vx: b.vx, vy: b.vy, radius: b.rail ? 5 : 4, railgun: !!b.rail, shooter: b.sid ? selfCar : null }));
    arena.mines = snap.mines.map((m) => ({ x: m.x, y: m.y, arm: m.arm ? 1 : 0, dead: false, hp: 3, age: 0, owner: null }));
    arena.scrap = snap.scrap.map((s) => makeNetScrap(s.x, s.y, s.a));
    arena.crates = snap.crates.map((c) => ({ x: c.x, y: c.y, r: 16, hp: 2, dead: false, seed: (c.x * 13 + c.y * 7) % 6.283 }));
    arena.drops = snap.drops.map((d) => ({ x: d.x, y: d.y, dead: false, age: 0, part: { slot: d.slot, type: d.type, tier: d.tier } }));
    arena.hooks = [];
    arena.boss = snap.boss ? makeNetBoss(snap.boss) : null;
    if (arena.boss && interp && interp.boss) { arena.boss.x = interp.boss.x; arena.boss.y = interp.boss.y; arena.boss.heading = interp.boss.h; }
    const lb = snap.cars.map((c) => ({ car: cache.get(c.id), name: c.n, level: c.lv, xp: c.xp || 0, isPlayer: c.id === net.selfId, dead: !!c.dead }));
    lb.sort((a, b) => (b.level - a.level) || (b.xp - a.xp));
    arena.leaderboard = lb;
    const lead = lb.find((e) => !e.dead);
    arena.leaderCar = lead ? lead.car : null;
    if (selfCar) {
      arena.cam.x = clamp(selfCar.x, VIEW.w / 2, ARENA.w - VIEW.w / 2);
      arena.cam.y = clamp(selfCar.y, VIEW.h / 2, ARENA.h - VIEW.h / 2);
    }
  }
  // -- M3 client-side prediction: drive the LOCAL car immediately on input (no
  // round-trip lag), then reconcile against the server each snapshot by
  // replaying still-unacked inputs from the authoritative state. Matches the
  // server's drive + wall-clamp exactly (physics params come down per snapshot).
  function predictDrive(car, d, dt) {
    car.integrate(dt, d.throttle, d.steer, !!d.handbrake);
    const m = ARENA.wall + car.radius;
    if (car.x < m) { car.x = m; if (car.vx < 0) car.vx *= -0.4; }
    else if (car.x > ARENA.w - m) { car.x = ARENA.w - m; if (car.vx > 0) car.vx *= -0.4; }
    if (car.y < m) { car.y = m; if (car.vy < 0) car.vy *= -0.4; }
    else if (car.y > ARENA.h - m) { car.y = ARENA.h - m; if (car.vy > 0) car.vy *= -0.4; }
  }
  const reconScratch = new Car(0, 0, 0);
  function reconcileSelf() {
    const snap = net.snap; if (!snap || net.selfId == null) return;
    const s = snap.cars.find((c) => c.id === net.selfId);
    const car = net._carCache.get(net.selfId);
    if (!s || !car) return;
    applySelfPhysics(car, s);
    const ack = s.ack || 0;
    while (net.pending.length && net.pending[0].seq <= ack) net.pending.shift();
    // replay the unacked inputs from the authoritative state on a scratch car
    const sc = reconScratch;
    sc.x = s.x; sc.y = s.y; sc.heading = s.h; sc.vx = s.vx || 0; sc.vy = s.vy || 0; sc.boost = 1;
    sc.maxSpeed = car.maxSpeed; sc.engineAccel = car.engineAccel; sc.turnRate = car.turnRate;
    sc.grip = car.grip; sc.drag = car.drag; sc.handbrakeBoost = car.handbrakeBoost; sc.radius = car.radius;
    for (const pinp of net.pending) predictDrive(sc, pinp, pinp.dt);
    const err = Math.hypot(sc.x - car.x, sc.y - car.y);
    const dead = arena.localPlayer && arena.localPlayer.dead;
    if (err > RECON_SNAP || dead) { car.x = sc.x; car.y = sc.y; car.heading = sc.heading; car.vx = sc.vx; car.vy = sc.vy; }
    else {
      car.x += (sc.x - car.x) * RECON_SMOOTH; car.y += (sc.y - car.y) * RECON_SMOOTH;
      car.heading = lerpAngleM(car.heading, sc.heading, RECON_SMOOTH);
      car.vx = sc.vx; car.vy = sc.vy;
    }
  }
  let lastOnlineMs = 0, lastReconSnap = null;
  function onlineFrame() {
    const nowMs = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    let dt = lastOnlineMs ? (nowMs - lastOnlineMs) / 1000 : STEP;
    dt = Math.max(0.001, Math.min(0.05, dt));
    lastOnlineMs = nowMs;
    const inp = arena.input;
    const selfCar = net.selfId != null ? net._carCache.get(net.selfId) : null;
    const dead = arena.localPlayer && arena.localPlayer.dead;
    const d = readDrive(inp, selfCar ? selfCar.heading : 0);
    const aim = arena.mouseWorldAngle();
    if (window.__autodrive) { d.throttle = window.__autodrive.t; d.steer = window.__autodrive.s; } // DEV-ONLY separation hook
    const seq = ++net.inputSeq;
    net.sendInput({ seq, throttle: d.throttle, steer: d.steer, handbrake: !!d.handbrake,
      fire: !!inp.fire, mouseDown: !!inp.mouseDown, hookHeld: !!inp.hookHeld,
      ability: !!inp.touchAbility1, autoFire: !!inp.autoFire,
      aim: (aim === null || aim === undefined) ? undefined : aim });
    net.pending.push({ seq, throttle: d.throttle, steer: d.steer, handbrake: !!d.handbrake, dt });
    if (net.pending.length > 180) net.pending.shift();
    const newSnap = net.snap && net.snap !== lastReconSnap;
    if (newSnap) { lastReconSnap = net.snap; reconcileSelf(); } // correct against authority
    else if (selfCar && !dead) predictDrive(selfCar, d, dt); // predict forward between snapshots
    applyOnlineSnapshot();
    arena.renderer.draw();
    updateArenaStatsUI();
    updateDeathUI();
    updateAbilityButtons();
    arena.layoutEditing = false;
    updateCursor();
  }

  // join-form wiring
  (function initOnlineUI() {
    const scr = document.getElementById("online-screen");
    const urlEl = document.getElementById("online-url");
    const roomEl = document.getElementById("online-room");
    const nameEl = document.getElementById("online-name");
    const statusEl = document.getElementById("online-status");
    if (!scr || !urlEl) return; // headless/no-DOM guard
    // once the server is deployed, set this to its wss:// URL — then PLAY needs
    // no typing (the field prefills it and the SERVER row can be hidden).
    const DEFAULT_SERVER = "";
    const params = (typeof URLSearchParams !== "undefined")
      ? new URLSearchParams((typeof location !== "undefined" && location.search) || "")
      : { get: () => null };
    try {
      urlEl.value = params.get("server") || localStorage.getItem("sd_srv") || DEFAULT_SERVER || "";
      if (DEFAULT_SERVER) urlEl.closest(".options-row").style.display = "none"; // hide the server row once baked
      roomEl.value = params.get("room") || localStorage.getItem("sd_room") || "";
      nameEl.value = localStorage.getItem("sd_name") || "";
    } catch (_) {}
    const setStatus = (t, cls) => { if (statusEl) { statusEl.textContent = t || ""; statusEl.className = cls || ""; } };
    const openOnline = () => { document.getElementById("start-screen").classList.add("hidden"); scr.classList.remove("hidden"); setStatus("", ""); };
    // client-side input sanitizing (defense-in-depth; the server re-validates
    // everything authoritatively). Mirrors the server's rules so the UI shows
    // the same name the server will.
    const cleanName = (s) => String(s || "").replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "").replace(/\s+/g, " ").trim().slice(0, 10);
    const cleanRoom = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    // only ws:// or wss:// may reach the WebSocket ctor; map http(s) for
    // convenience and reject anything exotic (javascript:, data:, file:, …)
    const normalizeUrl = (raw) => {
      let u = String(raw || "").trim().slice(0, 200);
      if (!u) return { err: "enter a server address" };
      if (/^https:\/\//i.test(u)) u = "wss://" + u.slice(8);
      else if (/^http:\/\//i.test(u)) u = "ws://" + u.slice(7);
      else if (!/^wss?:\/\//i.test(u)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return { err: "use a ws:// or wss:// address" }; // some other scheme
        u = "wss://" + u; // bare host → wss
      }
      if (typeof location !== "undefined" && location.protocol === "https:" && /^ws:\/\//i.test(u)) {
        return { err: "this page is https, so it needs a wss:// server" }; // mixed content would be blocked
      }
      return { url: u };
    };
    const inviteEl = document.getElementById("online-invite");
    let pendingCreate = false;
    // resolve URL + name, persist, then connect with the given seat message.
    // `build(name)` returns the seat message, or null after setting its own error.
    const connectWith = (build) => {
      const parsed = normalizeUrl(urlEl.value);
      if (parsed.err) return setStatus(parsed.err, "err");
      const url = parsed.url;
      const name = cleanName(nameEl.value) || "PLAYER";
      urlEl.value = url; nameEl.value = name;
      try { localStorage.setItem("sd_srv", url); localStorage.setItem("sd_name", name); } catch (_) {}
      arena.playerName = name;
      const seat = build(name);
      if (!seat) return;
      if (inviteEl) inviteEl.classList.add("hidden");
      setStatus("connecting…", "");
      net.connect(url, seat);
    };
    const doPlay = () => { pendingCreate = false; connectWith((name) => ({ type: "quickplay", name })); };
    const doCreate = () => { pendingCreate = true; connectWith((name) => ({ type: "create", name, maxPlayers: 12 })); };
    const doJoin = () => { pendingCreate = false; connectWith((name) => {
      const room = cleanRoom(roomEl.value); roomEl.value = room;
      if (room.length < 4) { setStatus("enter a valid join code", "err"); return null; }
      try { localStorage.setItem("sd_room", room); } catch (_) {}
      return { type: "join", room, name };
    }); };
    // when you CREATE a private room, show the invite code + a START button so
    // the host can share it before dropping in (code is server-generated + safe;
    // rendered via textContent, never innerHTML)
    const showInvite = (code) => {
      if (!inviteEl) { enterOnline(); return; }
      document.getElementById("start-screen").classList.add("hidden"); scr.classList.remove("hidden"); // ensure the code is visible
      inviteEl.textContent = "";
      const lbl = document.createElement("div"); lbl.className = "invite-code"; lbl.textContent = "INVITE CODE:  " + code;
      const sub = document.createElement("div"); sub.className = "invite-sub"; sub.textContent = "share it with friends, then start";
      const go = document.createElement("button"); go.textContent = "START GAME";
      go.addEventListener("click", () => { inviteEl.classList.add("hidden"); enterOnline(); });
      inviteEl.appendChild(lbl); inviteEl.appendChild(sub); inviteEl.appendChild(go);
      inviteEl.classList.remove("hidden");
      setStatus("", "");
    };
    net.onState = (state, reason) => {
      if (state === "connecting") setStatus("connecting…", "");
      else if (state === "joined") { if (pendingCreate && net.roomCode) { pendingCreate = false; showInvite(net.roomCode); } else enterOnline(); }
      else if (state === "rejected") setStatus("rejected: " + reason, "err");
      else if (state === "error") setStatus(reason || "connection failed", "err");
      else if (state === "closed" && onlineActive) leaveOnline("connection lost");
      else if (state === "closed") setStatus("connection closed", "err");
    };
    const onlineBtn = document.getElementById("start-online-btn");
    if (onlineBtn) onlineBtn.addEventListener("click", () => { game.audio.unlock(); openOnline(); });
    const bind = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener("click", fn); };
    bind("online-play-btn", doPlay);
    bind("online-create-btn", doCreate);
    bind("online-join-btn", doJoin);
    if (roomEl) roomEl.addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });
    const backBtn = document.getElementById("online-back-btn");
    if (backBtn) backBtn.addEventListener("click", () => { net.close(); if (inviteEl) inviteEl.classList.add("hidden"); scr.classList.add("hidden"); document.getElementById("start-screen").classList.remove("hidden"); });
    // dev/preview: ?connect=ws://host[&room=CODE][&name=X] → auto-seat on load
    // (room present → join that code; absent → quick match)
    const auto = params.get("connect");
    if (auto) {
      urlEl.value = auto; roomEl.value = params.get("room") || ""; nameEl.value = params.get("name") || "PLAYER";
      const dv = params.get("drive"); // DEV-ONLY: "t,s" constant throttle,steer for screenshots
      if (dv) { const p = dv.split(",").map(Number); window.__autodrive = { t: p[0] || 0, s: p[1] || 0 }; }
      const seatFn = params.get("create") ? doCreate : (params.get("room") ? doJoin : doPlay);
      setTimeout(seatFn, 60);
    } else if (params.get("online")) { openOnline(); } // preview the join screen
  })();
  // ===== end PLAY ONLINE ====================================================

  let last = performance.now();
  let acc = 0;
  function loop(now) {
    let frame = (now - last) / 1000;
    last = now;
    if (frame > 0.25) frame = 0.25; // after a stall, skip time rather than spiral
    if (onlineActive) {
      acc = 0;
      onlineFrame(); // stream input + render server snapshots (no local sim)
    } else if (active) {
      acc += frame;
      while (acc >= STEP) { active.update(STEP); acc -= STEP; }
      active.renderer.draw();
      if (active === arena) { updateArenaStatsUI(); updateLoadoutPanel(); updateDeathUI(); updateAbilityButtons(); } // level-ups / loot / death / ability buttons
      arena.layoutEditing = active === arena && layoutEditActive(); // renderer draws drag outlines
      updateCursor(); // OS cursor hidden only while actually playing Arena
    } else {
      acc = 0; // on the menu nothing simulates; don't bank time to burst later
      updateCursor();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
