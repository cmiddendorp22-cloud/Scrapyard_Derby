"use strict";
// ---------------------------------------------------------------------------
// THEME — the single source of truth for UI + gameplay-identity colors.
// Loaded FIRST (before utils.js). Canvas code reads THEME.* directly;
// the block at the bottom injects every entry as a CSS variable
// (--kebab-case) on :root, so style.css shares the same palette via var().
//
// Change a value here and BOTH the DOM menus and the canvas HUD recolor.
// Sprite/art tones (crate wood, wheel rust, boss hulls, floor) are NOT themed
// on purpose — they're art, not UI (user call, 2026-07-10).
// ---------------------------------------------------------------------------

const THEME = {
  // ---- UI chrome ----
  accent:           "#ffd166", // gold: titles, highlights, active/selected states
  accentDim:        "#c9a227", // secondary gold (keycaps, sub-accents)
  accentDeep:       "#7a5b00", // darkest gold (keycap borders/shadows)
  text:             "#e8e2d6", // primary light text
  textDim:          "#c0b7a8", // secondary text / labels
  textFaint:        "#a89f92", // muted / disabled text
  flash:            "#ffffff", // ready flashes / peak highlights
  panelBorder:      "#5a5148", // panel + card borders
  panelBorderLight: "#6e5f4b", // lighter border accents
  bgDeep:           "#15130f", // darkest backgrounds (chips, wells)
  danger:           "#e74c3c", // HP bars, warnings, hostile UI
  dangerBright:     "#e0301e", // OFF pills / disable states (bright red, user)
  success:          "#3fa34d", // ON pills / confirm green
  heal:             "#5fd35f", // healing / mend green
  warn:             "#e67e22", // charge / urgency orange
  info:             "#57b8ff", // utility cyan-blue (railgun identity, overload)
  infoBright:       "#8ff5ff", // bright cyan highlights
  xp:               "#7bed9f", // XP bar green

  // ---- gameplay identity ----
  player:           "#3f88c5", // your car / minimap dot
  playerBright:     "#7bd3ff", // "YOU" rows in leaderboard/killfeed
  playerShot:       "#ffe066", // your bullets + mines (enemy = THEME.enemy)
  botCar:           "#c0503a", // bot car paint
  enemy:            "#ff5c5c", // enemy shots / hostile markers / nemesis
  enemySoft:        "#ff8b7a", // spectated-bot tint
  boss:             "#8a6dff", // boss purple (Magnet marker/bar)
  bossSoft:         "#b9a9ff", // boss purple, lighter
  overload:         "#4ad9e6", // Magnet OVERLOADED window teal
  tierCommon:       "#b9c2cc", // part rarity colors (ARENA_TIERS reads these)
  tierUncommon:     "#5fd35f",
  tierRare:         "#4a9eff",
  tierEpic:         "#b45cff",
  tierLegendary:    "#ffb020",
};

// "#rrggbb" → {r,g,b} (e.g. the crosshair default color derives from a theme entry)
function themeRGB(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

// inject the palette as CSS variables so style.css can use var(--accent) etc.
// (classic scripts run before first paint, so there's no flash of unthemed UI;
// guarded for the headless test harness's stub DOM)
(function injectThemeVars() {
  if (typeof document === "undefined" || !document.documentElement) return;
  const st = document.documentElement.style;
  if (!st || !st.setProperty) return;
  for (const key in THEME) {
    const kebab = key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    st.setProperty("--" + kebab, THEME[key]);
  }
})();
