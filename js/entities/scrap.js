"use strict";
// ---------------------------------------------------------------------------
// Scrap piles: the finite repair economy. Scattered at run start, consumed
// by driving over them, NEVER replenished. They can also be destroyed by
// stray gunfire, so wild shooting wastes your own lifeline.
// ---------------------------------------------------------------------------

class ScrapPile {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.amount = 55;      // total component HP this pile can restore
    this.maxAmount = 55;
    this.radius = 26;
    this.dead = false;
    this.seed = fxRand(0, TAU); // varies each pile's look (cosmetic rotation)
  }

  // piles visibly shrink as they're consumed
  get scale() { return 0.45 + 0.55 * (this.amount / this.maxAmount); }
}
