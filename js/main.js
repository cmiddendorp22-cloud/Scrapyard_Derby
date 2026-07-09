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

  // Letterbox the canvas to the window (fixed 16:9 via CSS size), and size its
  // BACKING STORE to real device pixels so it renders crisp on hi-dpi / large
  // screens instead of upscaling a 1280x720 image. The renderers keep drawing
  // in logical 1280x720 space and scale their context by the backing ratio.
  // DPR is capped (low-end phones don't render a 3x buffer), but the display-
  // fill factor is uncapped, so a 1440p window always gets a full 2560x1440
  // backing store.
  const DPR_CAP = 2;
  function fit() {
    const displayScale = Math.min(window.innerWidth / WORLD.w, window.innerHeight / WORLD.h);
    canvas.style.width = WORLD.w * displayScale + "px";
    canvas.style.height = WORLD.h * displayScale + "px";
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    canvas.width = Math.max(WORLD.w, Math.round(WORLD.w * displayScale * dpr));
    canvas.height = Math.max(WORLD.h, Math.round(WORLD.h * displayScale * dpr));
    positionArenaDom();
  }
  // Anchor the fixed-position Arena loadout panel + toggle to the canvas so they
  // line up with the canvas HUD at any display scale / letterbox.
  function positionArenaDom() {
    if (!canvas.getBoundingClientRect) return; // headless/no-DOM guard
    const r = canvas.getBoundingClientRect();
    const s = r.width / WORLD.w;
    const lo = document.getElementById("arena-loadout");
    const tog = document.getElementById("loadout-toggle");
    if (lo) { lo.style.left = (r.left + 16 * s) + "px"; lo.style.top = (r.top + 150 * s) + "px"; }
    if (tog) { tog.style.left = (r.left + 16 * s) + "px"; tog.style.top = (r.top + r.height * 0.60) + "px"; }
  }
  window.addEventListener("resize", fit);
  fit();

  function startGauntlet() {
    game.audio.unlock(); // must happen inside a user gesture
    document.getElementById("start-screen").classList.add("hidden");
    active = game;
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
    const spawnSet = (tier) => { // a full ring of parts (every slot + weapon) at one tier
      const p = arena.player, R = 95;
      const kinds = [["tires", "tires"], ["engine", "engine"], ["armor", "armor"],
        ["weapon", "cannon"], ["weapon", "shotgun"], ["weapon", "ram"], ["weapon", "minelayer"]];
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
    row(null, "5 SLOTS", "Tires (grip / turn / handbrake), Engine (speed + accel), two Weapon slots (both fire together), Armor (max HP + damage reduction). Loot better parts off wrecks to fill and upgrade each slot.");
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
    row(null, "THE MAGNET", "A roaming gravity well — it drags you inward (fight it with throttle) and periodically MEGA-PULLS for heavy damage. Armored EXCEPT during the OVERLOAD window right after a mega-pull. Lure MINES into it (they bypass its armor); keep scrap away (scrap heals it).");
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
    if (stat === "health") return "HEALTH " + lvl + " → " + to + ":  +25 max HP  (" + Math.round(arena.maxHp) + " → " + Math.round(arena.maxHp + 25) + ")";
    if (stat === "speed") return "SPEED " + lvl + " → " + to + ":  +5% top speed & accel  (+" + (lvl * 5) + "% → +" + (to * 5) + "%)";
    if (stat === "reload") return "RELOAD " + lvl + " → " + to + ":  +8% fire rate  (+" + (lvl * 8) + "% → +" + (to * 8) + "%);  hook cooldown " + arena.hookCooldown(lvl).toFixed(1) + "s → " + arena.hookCooldown(to).toFixed(1) + "s";
    if (stat === "regen") return "REGEN " + lvl + " → " + to + ":  heal " + (2 + lvl * 0.5).toFixed(1) + "%/s → " + (2 + to * 0.5).toFixed(1) + "%/s of max HP  (after 5s out of combat)";
    return "";
  }
  for (const s in STAT_LABELS) {
    const btn = document.getElementById("stat-" + s);
    btn.addEventListener("click", () => {
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
    document.getElementById("stat-prompt-txt").textContent = "SPEND POINTS — " + arena.statPoints;
    for (const s in STAT_LABELS) {
      const btn = document.getElementById("stat-" + s);
      const lvl = arena.stats[s];
      btn.textContent = STAT_LABELS[s] + " " + lvl;
      btn.disabled = lvl >= 10;
    }
  }

  // -- Arena death menu + spectate: on wreck, pick RESPAWN / SPECTATE / MAIN
  // MENU (no auto-respawn). Spectate follows living bots; NEXT (or N) cycles.
  document.getElementById("death-respawn-btn").addEventListener("click", openRespawnWeaponSelect);
  document.getElementById("death-spectate-btn").addEventListener("click", () => { if (active === arena && arena.dead) { arena.spectate = true; arena.spectateCar = null; } });
  document.getElementById("death-mainmenu-btn").addEventListener("click", quitToMenu);
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
  document.getElementById("spectate-respawn-btn").addEventListener("click", openRespawnWeaponSelect);
  document.getElementById("spectate-menu-btn").addEventListener("click", quitToMenu);
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

  // touch ABILITY buttons: one per equipped ability (primary=ability1,
  // secondary=ability2), labelled HOOK/CHARGE per the loadout; hidden when the
  // slot has no ability. Only relevant on touch (buttons live in #touch-controls).
  let abilitySig = "";
  function updateAbilityButtons() {
    if (active !== arena || !arena.loadout) return;
    const L = arena.loadout;
    const a1 = arena.weaponAbility(L.weapon1 && L.weapon1.type);
    const a2 = arena.weaponAbility(L.weapon2 && L.weapon2.type);
    const sig = (a1 ? a1.name : "-") + "|" + (a2 ? a2.name : "-") + "|" + (arena.dead ? "d" : "a");
    if (sig === abilitySig) return; // only touch the DOM when it changes
    abilitySig = sig;
    const b1 = document.getElementById("touch-ability1"), b2 = document.getElementById("touch-ability2");
    const show = !arena.dead;
    b1.textContent = a1 ? a1.name : ""; b1.classList.toggle("hidden", !a1 || !show);
    b2.textContent = a2 ? a2.name : ""; b2.classList.toggle("hidden", !a2 || !show);
  }

  // -- Arena loadout / equip panel: shows your 5 slots + nearby collectible
  // parts; tap a nearby part to equip it. Auto-shows when parts are in reach,
  // or toggled with the PARTS button / L key. -------------------------------
  let loadoutOpen = false;
  const SLOT_ROWS = [["TIRES", "tires"], ["ENGINE", "engine"], ["WPN1", "weapon1"], ["WPN2", "weapon2"], ["ARMOR", "armor"]];
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
    // dedicated ⇄ control (only when both weapon slots are filled) — swaps which
    // weapon is primary vs secondary. Full-width so long names never crowd it.
    if (arena.loadout.weapon1 && arena.loadout.weapon2) {
      const sw = document.createElement("button");
      sw.className = "lo-swaprow"; sw.textContent = "⇄ SWAP PRIMARY / SECONDARY";
      sw.addEventListener("click", () => { arena.swapWeapons(); lastLoadoutSig = ""; updateLoadoutPanel(); });
      slotsEl.appendChild(sw);
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

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      // ESC backs out of the top-most overlay, then unpauses the active mode
      const vis = (id) => !document.getElementById(id).classList.contains("hidden");
      if (vis("weapon-select")) backToStart();
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
    else if (active === arena && STAT_KEYS[e.code]) { arena.spendStat(STAT_KEYS[e.code]); updateArenaStatsUI(); }
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
      if (w) { arena.startWeapon = w; active = arena; arena.begin(); loadoutOpen = true; lastLoadoutSig = ""; } // ...straight to play
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
      if (params.has("magnet") && active === arena) { // preview the roaming Magnet boss
        arena.boss = arena.spawnCentralBoss("magnet");
        arena.boss.x = arena.player.x + 40; arena.boss.y = arena.player.y - 240;
        arena.boss.overload = params.has("overload") ? 5 : 0; // &overload shows the vulnerable window
      }
      if (params.has("loadout") && active === arena && arena.loadout) { // preview mixed-tier parts
        arena.loadout.tires = makePart("tires", "tires", 2);
        arena.loadout.engine = makePart("engine", "engine", 4);
        arena.loadout.weapon1 = makePart("weapon", "cannon", 1);
        arena.loadout.weapon2 = makePart("weapon", "minelayer", 3);
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
  let last = performance.now();
  let acc = 0;
  function loop(now) {
    let frame = (now - last) / 1000;
    last = now;
    if (frame > 0.25) frame = 0.25; // after a stall, skip time rather than spiral
    if (active) {
      acc += frame;
      while (acc >= STEP) { active.update(STEP); acc -= STEP; }
      active.renderer.draw();
      if (active === arena) { updateArenaStatsUI(); updateLoadoutPanel(); updateDeathUI(); updateAbilityButtons(); } // level-ups / loot / death / ability buttons
    } else {
      acc = 0; // on the menu nothing simulates; don't bank time to burst later
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
