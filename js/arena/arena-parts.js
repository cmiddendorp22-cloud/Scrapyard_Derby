"use strict";
// ---------------------------------------------------------------------------
// Scrapyard Arena modular parts — the loot/slot system (BACKLOG-ARENA item 5,
// the mode's signature pillar). A PART fills one SLOT and carries a TIER whose
// index scales its effect. Weapon parts also carry a behavior `type`
// (cannon/minelayer/ram); tires/engine/armor use their slot as the type.
//
// Slots on a car: tires, engine, weapon (x2: primary + secondary), armor.
// Effects are applied in ArenaGame.applyStats (player) and stack on top of the
// spent stat points. This file is pure data/helpers — no game state.
// ---------------------------------------------------------------------------

const ARENA_TIERS = [
  { name: "COMMON",    color: "#b9c2cc" },
  { name: "UNCOMMON",  color: "#5fd35f" },
  { name: "RARE",      color: "#4a9eff" },
  { name: "EPIC",      color: "#b45cff" },
  { name: "LEGENDARY", color: "#ffb020" },
];
const TIER_MAX = ARENA_TIERS.length - 1; // 4 = legendary

const PART_SLOTS = ["tires", "engine", "weapon", "armor"];
// all weapon types that can exist as PARTS (loot/equip/drops). The RAILGUN is
// LOOT-ONLY (user): never on the weapon-select screen or the bot spawn pool —
// found in crates (small chance) and central-boss drops.
const ARENA_WEAPON_TYPES = ["cannon", "minelayer", "ram", "shotgun", "railgun"];
const ARENA_BASIC_WEAPONS = ["cannon", "minelayer", "ram", "shotgun"]; // starting picks / bot spawns

// build a part { slot, type, tier, cd }. `cd` is a per-weapon fire timer.
function makePart(slot, type, tier) {
  return { slot, type: type || slot, tier: clamp(Math.round(tier || 0), 0, TIER_MAX), cd: 0 };
}

// display name, e.g. "RARE CANNON" (weapon) or "EPIC TIRES" (other slots)
function partName(p) {
  const label = p.slot === "weapon" ? p.type.toUpperCase() : p.slot.toUpperCase();
  return ARENA_TIERS[p.tier].name + " " + label;
}
function tierColor(p) { return ARENA_TIERS[p.tier].color; }
function tierName(p) { return ARENA_TIERS[p.tier].name; }

// roll a tier around a source level: +1 tier every ~4 levels, with RNG spread
// (uses the seeded sim `rand` so drops stay deterministic). minTier floors it
// (bosses drop rare+). Returns a 0..TIER_MAX index.
function tierForLevel(level, minTier) {
  const base = Math.min(TIER_MAX, Math.floor((level - 1) / 4));
  const roll = rand(0, 1);
  let t = base;
  if (roll > 0.85) t = base + 1;        // lucky bump
  else if (roll < 0.22) t = base - 1;   // unlucky
  return clamp(Math.max(t, minTier || 0), 0, TIER_MAX);
}
