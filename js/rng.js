"use strict";
// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32). Every bit of SIMULATION randomness flows
// through one seeded RNG so a given seed + input sequence reproduces a run
// exactly — the foundation for daily challenges, ghost replays, and
// server-side score validation. Purely COSMETIC randomness (particles, screen
// shake, floor texture, audio) uses fxRand/fxPick in utils.js and must never
// touch this stream, so visual tweaks can't shift the deterministic sequence.
// ---------------------------------------------------------------------------

class RNG {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  // reset back to the original seed (replay the exact same stream)
  reset() { this.state = this.seed; }

  // next float in [0, 1)
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  static randomSeed() { return (Math.random() * 0xffffffff) >>> 0; }
}
