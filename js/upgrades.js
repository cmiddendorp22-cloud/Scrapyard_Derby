"use strict";
// ---------------------------------------------------------------------------
// Upgrade catalog + the intermission shop UI.
// Currency is SALVAGE: earned per kill (elites pay big) and as a round-clear
// bonus. Upgrades last for the current run; a restart wipes them.
//
// Effects live where they act: Game.applyUpgrade handles instant effects,
// everything else reads game.upgrades at the moment it matters (fire rate at
// fire time, spill multiplier at damage time, etc.).
// ---------------------------------------------------------------------------

const UPGRADES = [
  // -- durability --
  { id: "plating",        cat: "Durability", name: "Reinforced Plating", costs: [40, 70, 110],
    desc: "+25% max HP on every component (per tier)" },
  { id: "spikes",         cat: "Durability", name: "Bumper Spikes",      costs: [60],
    desc: "Your collisions deal +50% damage to enemies" },
  { id: "crashFrame",     cat: "Durability", name: "Crash Frame",        costs: [50],
    desc: "Spillover damage past broken parts: 1.5x → 1.1x" },
  { id: "autoWelder",     cat: "Durability", name: "Auto-Welder",        costs: [80],
    desc: "Self-repairs your worst component 3 HP/s during rounds" },
  // -- mobility --
  { id: "rallyTires",     cat: "Mobility",   name: "Rally Tires",        costs: [45],
    desc: "Wheels take 30% less damage; dead-wheel pull halved" },
  { id: "driftMaster",    cat: "Mobility",   name: "Drift Master",       costs: [55],
    desc: "Sharper handbrake turns; drifting leaves a damaging spark trail" },
  // -- weapons --
  { id: "rapidLoader",    cat: "Weapons",    name: "Rapid Loader",       costs: [45, 75],
    desc: "+35% cannon fire rate (per tier)" },
  { id: "heavyRounds",    cat: "Weapons",    name: "Heavy Rounds",       costs: [50, 85],
    desc: "+50% cannon damage (per tier)" },
  { id: "twinCannons",    cat: "Weapons",    name: "Twin Cannons",       costs: [100],
    desc: "Fire two parallel shots" },
  { id: "rearBlaster",    cat: "Weapons",    name: "Rear Blaster",       costs: [70],
    desc: "Every shot also fires backwards" },
  { id: "turret",         cat: "Weapons",    name: "Auto-Turret",        costs: [90],
    desc: "Roof turret slowly fires at the nearest enemy on its own" },
  // -- utility --
  { id: "repairKit",      cat: "Utility",    name: "Repair Kit",         costs: [10], repeat: true,
    desc: "Heal 25/50/100% of missing HP — short on salvage buys a partial fix" },
  { id: "scrapMagnet",    cat: "Utility",    name: "Scrap Magnet",       costs: [40],
    desc: "Repair from piles 2x faster; piles hold +50% more" },
  { id: "salvageRig",     cat: "Utility",    name: "Salvage Rig",        costs: [65],
    desc: "+50% salvage from kills" },
  { id: "emergencyPatch", cat: "Utility",    name: "Emergency Patch",    costs: [60],
    desc: "Once per round, a part survives fatal damage at 25% HP" },
  { id: "armoredScrap",   cat: "Utility",    name: "Armored Scrap",      costs: [35],
    desc: "Scrap piles can't be shot to pieces (they block bullets)" },
];

// DOM shop panel, shown during intermissions above the Next Round button.
// One tab per category along the top; only the selected category's cards show.
class Shop {
  constructor(game) {
    this.game = game;
    this.grid = document.getElementById("shop-grid");
    this.tabsEl = document.getElementById("shop-tabs");
    this.salvageEl = document.getElementById("salvage-display");
    this.cards = {};
    this.sections = {}; // cat -> { tab, grid }
    // categories in catalog order
    const cats = [];
    for (const u of UPGRADES) if (!cats.includes(u.cat)) cats.push(u.cat);
    for (const cat of cats) {
      const tab = document.createElement("button");
      tab.className = "shop-tab";
      tab.textContent = cat.toUpperCase();
      tab.addEventListener("click", () => this.selectTab(cat));
      this.tabsEl.appendChild(tab);

      const sectionGrid = document.createElement("div");
      sectionGrid.className = "shop-section-grid";
      for (const u of UPGRADES) {
        if (u.cat !== cat) continue;
        const card = document.createElement("div");
        card.className = "shop-card";
        const title = document.createElement("h4");
        title.textContent = u.name + " ";
        const pips = document.createElement("span");
        pips.className = "pips";
        title.appendChild(pips);
        const desc = document.createElement("div");
        desc.className = "desc";
        desc.textContent = u.desc;
        card.appendChild(title);
        card.appendChild(desc);
        if (u.repeat) { // repair kit: 25% / 50% / 100% heal options
          const row = document.createElement("div");
          row.className = "kit-row";
          this.kitButtons = [];
          for (const frac of [0.25, 0.5, 1]) {
            const b = document.createElement("button");
            b.addEventListener("click", () => this.game.buyRepairKit(frac));
            row.appendChild(b);
            this.kitButtons.push({ btn: b, frac });
          }
          card.appendChild(row);
          this.cards[u.id] = { card, pips, def: u, kit: true };
        } else {
          const btn = document.createElement("button");
          btn.addEventListener("click", () => this.game.buyUpgrade(u.id));
          card.appendChild(btn);
          this.cards[u.id] = { card, pips, btn, def: u };
        }
        sectionGrid.appendChild(card);
      }
      this.grid.appendChild(sectionGrid);
      this.sections[cat] = { tab, grid: sectionGrid };
    }
    this.selectTab(cats[0]);
  }

  selectTab(cat) {
    this.activeTab = cat;
    for (const c in this.sections) {
      const s = this.sections[c];
      s.grid.style.display = c === cat ? "grid" : "none";
      s.tab.classList.toggle("active", c === cat);
    }
  }

  // re-sync every card with owned tiers + affordability
  refresh() {
    this.salvageEl.textContent = "SALVAGE: " + this.game.salvage;
    const affordableCats = new Set();
    const playerDamaged = Object.values(this.game.player.components).some((c) => c.hp < c.max);
    for (const id in this.cards) {
      const entry = this.cards[id];
      const { card, pips, def } = entry;
      const tier = this.game.upgrades[id] || 0;

      if (entry.kit) { // repair kit: three heal options, always buyable when hurt
        const usable = playerDamaged && this.game.salvage > 0;
        const fullCost = this.game.repairKitCost();
        pips.textContent = tier > 0 ? "x" + tier : "";
        card.classList.toggle("can-buy", usable);
        card.classList.toggle("cant-buy", !usable);
        card.classList.remove("maxed");
        for (const { btn, frac } of this.kitButtons) {
          const price = Math.ceil(fullCost * frac);
          btn.textContent = Math.round(frac * 100) + "% — " + price;
          btn.disabled = !usable;
          // amber = you can't cover this option; buying spends what you have
          // for a proportional partial heal
          btn.classList.toggle("partial", usable && this.game.salvage < price);
        }
        if (usable) affordableCats.add(def.cat);
        continue;
      }

      const { btn } = entry;
      const maxed = tier >= def.costs.length;
      const cost = def.costs[Math.min(tier, def.costs.length - 1)];
      const affordable = !maxed && this.game.salvage >= cost;
      pips.textContent = def.costs.length > 1
        ? "●".repeat(tier) + "○".repeat(def.costs.length - tier)
        : maxed ? "●" : "";
      // per-card purchasability indicator: green = buyable, dimmed + shortfall
      // callout = can't afford yet, gold = maxed out
      card.classList.toggle("can-buy", affordable);
      card.classList.toggle("cant-buy", !maxed && !affordable);
      card.classList.toggle("maxed", maxed);
      btn.textContent = maxed ? "MAXED ●"
        : affordable ? "BUY — " + cost
        : "NEED " + (cost - this.game.salvage) + " MORE";
      btn.disabled = !affordable;
      if (affordable) affordableCats.add(def.cat);
    }
    // gold dot on tabs that hold something you can afford right now
    for (const c in this.sections) {
      this.sections[c].tab.classList.toggle("notify", affordableCats.has(c));
    }
  }
}
