"use strict";
// ---------------------------------------------------------------------------
// Procedural sound via Web Audio — no audio assets needed.
// A continuous engine drone (pitch follows speed) plus one-shot synth SFX.
// unlock() must be called from a user gesture (browser autoplay policy).
// ---------------------------------------------------------------------------

class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.screechGain = null;
    this.screechFilter = null;
    this.noiseBuf = null;
    this.enabled = false;
    this.volume = 0.5; // master volume, settable before/after unlock()
  }

  setVolume(v) { // 0..1
    this.volume = clamp(v, 0, 1);
    if (this.master) this.master.gain.value = this.volume;
  }

  unlock() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return; // no audio support; game still runs silently
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    // pre-render 1s of white noise, reused by every impact/explosion
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // continuous engine hum: sawtooth through a lowpass
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 55;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(filter);
    filter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();

    // continuous tire screech: looped noise, silent until the car slides
    const screechSrc = this.ctx.createBufferSource();
    screechSrc.buffer = this.noiseBuf;
    screechSrc.loop = true;
    this.screechFilter = this.ctx.createBiquadFilter();
    this.screechFilter.type = "bandpass";
    this.screechFilter.frequency.value = 900;
    this.screechFilter.Q.value = 1.5;
    this.screechGain = this.ctx.createGain();
    this.screechGain.gain.value = 0;
    screechSrc.connect(this.screechFilter);
    this.screechFilter.connect(this.screechGain);
    this.screechGain.connect(this.master);
    screechSrc.start();

    this.enabled = true;
  }

  // Called every frame: r is 0..1 drift intensity.
  setScreech(r) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.screechGain.gain.setTargetAtTime(r * 0.05, t, 0.06);
    this.screechFilter.frequency.setTargetAtTime(700 + r * 500, t, 0.1);
  }

  // Called every frame: pitch tracks speed, sputters while stalled.
  setEngine(speedRatio, stalled) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const freq = stalled ? 38 : 52 + speedRatio * 130;
    const gain = stalled ? 0.012 + Math.random() * 0.012 : 0.018 + speedRatio * 0.03;
    this.engineOsc.frequency.setTargetAtTime(freq, t, 0.05);
    this.engineGain.gain.setTargetAtTime(gain, t, 0.08);
  }

  engineOff() {
    if (!this.enabled) return;
    this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    this.screechGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }

  // -- internal one-shot builders --------------------------------------------

  _noise(dur, freq, q, vol) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  _tone(type, f0, f1, dur, vol) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // -- game SFX ---------------------------------------------------------------

  playShoot()      { this._tone("square", 620, 160, 0.12, 0.15); }
  playEnemyShoot() { this._tone("square", 300, 90, 0.18, 0.12); }

  playImpact(strength) { // strength 0..1 scales grit and volume
    this._noise(0.15 + strength * 0.2, 250 + strength * 300, 1.2, 0.12 + strength * 0.3);
    this._tone("triangle", 90, 40, 0.2, 0.12 + strength * 0.2);
  }

  playPartBreak() { // metallic shriek when a component dies
    this._noise(0.35, 1800, 2, 0.3);
    this._tone("sawtooth", 220, 40, 0.3, 0.2);
  }

  playExplosion() {
    this._noise(0.8, 120, 0.7, 0.5);
    this._tone("sine", 110, 30, 0.7, 0.35);
  }

  playRepair() { this._tone("sine", 500, 880, 0.1, 0.06); }

  playClank() { // bullet pinging off armor
    this._noise(0.08, 2600, 4, 0.18);
    this._tone("triangle", 1400, 700, 0.07, 0.1);
  }
  playTurret() { this._tone("square", 480, 220, 0.08, 0.07); }

  playBuy() { // cash-register chirp
    this._tone("sine", 700, 1050, 0.12, 0.1);
    setTimeout(() => this._tone("sine", 900, 1400, 0.15, 0.1), 90);
  }
  playRev()    { this._tone("sawtooth", 70, 260, 0.5, 0.14); } // rammer telegraph

  playWave() {
    this._tone("square", 200, 200, 0.09, 0.1);
    setTimeout(() => this._tone("square", 300, 300, 0.12, 0.1), 110);
  }

  playRoundClear() { // rising victory jingle
    this._tone("square", 330, 330, 0.1, 0.1);
    setTimeout(() => this._tone("square", 440, 440, 0.1, 0.1), 120);
    setTimeout(() => this._tone("square", 550, 660, 0.25, 0.12), 240);
  }

  playGameOver() {
    this._tone("sawtooth", 180, 35, 1.4, 0.3);
    this._noise(1.2, 150, 0.8, 0.4);
  }
}
