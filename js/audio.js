// Music is played from files; every sound effect is synthesized at runtime.
//
// The mixer is the one from GAMBIT — a music bus and an SFX bus into a shared
// procedural reverb and a soft bus compressor — but the voices are Ghostwalk's
// own. Cards here are paper and bone rather than lacquered wood, so the flip is
// a filtered noise slap rather than a knock, and the duel stingers are longer
// and colder than a chess capture.

const MUSIC_DIR = 'Music/';
const TRACK = {
  // The path: four wandering overworld pieces, shuffled and walked in order.
  path: [
    'Old RuneScape Soundtrack_ Doorways.mp3',
    'Old RuneScape Soundtrack_ Scape Sad.mp3',
    'Old RuneScape Soundtrack_ Regal.mp3',
    'Old School RuneScape Soundtrack_ Crystal Sword.mp3',
  ],
  // The duel: a battle theme, picked fresh each time so back-to-back duels
  // don't feel like the same fight.
  duel: [
    "Wildfrost OST - Winter's Wrath.mp3",
    'Wildfrost OST - Tundra Heart.mp3',
    'Wildfrost OST - March of the Pengoons.mp3',
    'Wildfrost OST - Luminice Dance.mp3',
  ],
  menu: 'Wildfrost OST - Spirit Call.mp3',
  plan: 'Wildfrost OST - The Wooly Snail.mp3',
  gameover: 'Wildfrost OST - Trapped Spirits.mp3',
};

const trackUrl = (file) => MUSIC_DIR + encodeURIComponent(file);
const mtof = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = { music: false, sfx: false };
    this.musicVolume = 0.32;
    this.sfxVolume = 0.55;
    this.stems = new Map();
    this.style = null;
    this.preloadStarted = false;
  }

  ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;

    // A gentle bus compressor so a stinger over a loud bar never clips.
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 24;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.22;

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.1, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.22;

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.sfxVolume;

    this.musicGain.connect(this.comp);
    this.sfxGain.connect(this.comp);
    this.sfxGain.connect(this.reverbGain);
    this.reverbGain.connect(this.reverb);
    this.reverb.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(ctx.destination);
    return ctx;
  }

  /** A noise burst with an exponential tail — cheap, decent-sounding hall. */
  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  async resume() {
    this.ensureContext();
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  toggleMusic(on) {
    this.muted.music = !on;
    if (on) this.setStyle(this.style, true);
    else this.stopAllStems(0.3);
  }

  toggleSfx(on) {
    this.muted.sfx = !on;
  }

  /** Duck the music so a stinger cuts through it. */
  duck(amount = 0.4, seconds = 1.2) {
    if (!this.musicGain) return;
    const t = this.ctx.currentTime;
    const g = this.musicGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.musicVolume * amount, t + 0.05);
    g.linearRampToValueAtTime(this.musicVolume, t + seconds);
  }

  // ---- music beds -------------------------------------------------------

  preload() {
    if (this.preloadStarted || !this.ctx) return;
    this.preloadStarted = true;
    TRACK.path.forEach((f, i) => this.stem(`path-${i}`, f, false));
    TRACK.duel.forEach((f, i) => this.stem(`duel-${i}`, f, true));
    this.stem('menu', TRACK.menu, true);
    this.stem('plan', TRACK.plan, true);
    this.stem('gameover', TRACK.gameover, true);
  }

  stem(id, file, loop) {
    if (this.stems.has(id)) return this.stems.get(id);
    if (!this.ensureContext()) return null;
    const el = new Audio();
    el.src = trackUrl(file);
    el.loop = Boolean(loop);
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0001;
    const src = this.ctx.createMediaElementSource(el);
    src.connect(gain).connect(this.musicGain);
    const node = { id, el, gain, src, gen: 0 };
    this.stems.set(id, node);
    return node;
  }

  fadeStem(id, to, seconds = 1.0) {
    const node = this.stems.get(id);
    if (!node || !this.ctx) return;
    const t = this.ctx.currentTime;
    const g = node.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(Math.max(0.0001, to), t + seconds);
  }

  async startStem(id, { volume = 1, fade = 0.9, reset = true } = {}) {
    const node = this.stems.get(id);
    if (!node) return;
    node.gen++;
    if (reset) {
      try { node.el.currentTime = 0; } catch { /* refused before metadata on some browsers */ }
    }
    this.fadeStem(id, volume, fade);
    try { await node.el.play(); } catch { /* autoplay gate — resume() runs on first tap */ }
  }

  stopStem(id, fade = 0.7) {
    const node = this.stems.get(id);
    if (!node) return;
    node.gen++;
    const gen = node.gen;
    this.fadeStem(id, 0.0001, fade);
    setTimeout(() => {
      if (this.stems.get(id) !== node || node.gen !== gen) return;
      try { node.el.pause(); } catch { /* already stopped */ }
    }, fade * 1000 + 80);
  }

  stopAllStems(fade = 0.6) {
    for (const id of this.stems.keys()) this.stopStem(id, fade);
  }

  /**
   * Crossfade to the bed for a screen.
   * @param {'menu'|'plan'|'path'|'duel'|'gameover'|null} style
   */
  setStyle(style, force = false) {
    if (!style) return;
    // A new duel always re-picks a theme; everything else is a no-op if it's
    // already playing, so walking back and forth between screens doesn't
    // restart the track underneath.
    if (this.style === style && style !== 'duel' && !force) return;
    this.style = style;
    if (typeof document !== 'undefined') document.documentElement.dataset.music = style;
    if (this.muted.music) return;
    if (!this.ensureContext()) return;
    this.preload();
    this.stopAllStems(0.5);

    if (style === 'path') {
      this.pathOrder = TRACK.path.map((_, i) => i).sort(() => Math.random() - 0.5);
      this.pathIndex = 0;
      this.playPathTrack(0, 0.8);
    } else if (style === 'duel') {
      const i = Math.floor(Math.random() * TRACK.duel.length);
      this.startStem(`duel-${i}`, { volume: 0.95, fade: 0.5 });
    } else if (style === 'menu') {
      this.startStem('menu', { volume: 0.85, fade: 1.2 });
    } else if (style === 'plan') {
      this.startStem('plan', { volume: 0.85, fade: 0.9 });
    } else if (style === 'gameover') {
      this.startStem('gameover', { volume: 0.95, fade: 1.2 });
    }
  }

  /** The path beds play through rather than loop, then hand off to the next. */
  playPathTrack(index, fade = 0.8) {
    if (this.style !== 'path') return;
    const order = this.pathOrder || [];
    if (!order.length) return;
    const which = order[index % order.length];
    const node = this.stems.get(`path-${which}`);
    if (node) {
      node.el.loop = false;
      node.el.onended = () => {
        if (this.style !== 'path') return;
        this.pathIndex = (this.pathIndex + 1) % order.length;
        this.playPathTrack(this.pathIndex, 0.5);
      };
    }
    this.startStem(`path-${which}`, { volume: 0.9, fade });
  }

  // ---- SFX --------------------------------------------------------------

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** One-shot oscillator with an exponential decay. The workhorse. */
  tone(freq, { at = 0, dur = 0.2, type = 'sine', gain = 0.3, to = null, filter = null } = {}) {
    if (!this.ctx || this.muted.sfx) return;
    const ctx = this.ctx;
    const t = (at || ctx.currentTime);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let tail = g;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.value = filter.freq || 2000;
      f.Q.value = filter.q || 1;
      g.connect(f);
      tail = f;
    }
    osc.connect(g);
    tail.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Filtered noise burst — paper, dust, blades, breath. */
  noise(dur = 0.12, { at = 0, gain = 0.25, freq = 1800, q = 0.8, type = 'bandpass', sweep = null } = {}) {
    if (!this.ctx || this.muted.sfx) return;
    const ctx = this.ctx;
    const t = at || ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweep), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxGain);
    src.start(t);
  }

  // Named sounds. Everything the UI calls goes through one of these so the
  // palette stays consistent — no ad-hoc tones scattered through ui.js.

  /** Picking a card up off the table. */
  lift() {
    this.noise(0.07, { gain: 0.16, freq: 2600, sweep: 3400, q: 0.7 });
  }

  /** Dropping a card into a path slot. */
  place() {
    this.noise(0.09, { gain: 0.22, freq: 1500, sweep: 700, q: 0.9 });
    this.tone(180, { dur: 0.08, type: 'sine', gain: 0.12, to: 120 });
  }

  /** Taking a card back out of a slot. */
  lift2() {
    this.noise(0.08, { gain: 0.14, freq: 1200, sweep: 2400, q: 0.7 });
  }

  /** A path slot flipping face-up during resolution. */
  flip() {
    this.noise(0.11, { gain: 0.2, freq: 2200, sweep: 900, q: 0.6 });
  }

  /** A blow landing. `heavy` scales with how much of the bar it took. */
  hit(heavy = 0.5) {
    const g = 0.18 + heavy * 0.22;
    this.noise(0.09 + heavy * 0.06, { gain: g, freq: 900 - heavy * 400, sweep: 180, q: 1.1 });
    this.tone(110 - heavy * 30, { dur: 0.14, type: 'triangle', gain: g * 0.7, to: 55 });
  }

  /** Poison tick — a thin, sour little sound that ignores the drums. */
  poison() {
    this.tone(880, { dur: 0.16, type: 'sawtooth', gain: 0.07, to: 1320, filter: { type: 'bandpass', freq: 1400, q: 6 } });
  }

  /** Thorns answering back. */
  thorns() {
    this.tone(1500, { dur: 0.1, type: 'square', gain: 0.07, to: 500, filter: { type: 'highpass', freq: 700 } });
  }

  /** Rally — a rising horn figure. */
  rally() {
    const t = this.now();
    [0, 0.07, 0.14].forEach((d, i) => {
      this.tone(mtof(55 + i * 4), { at: t + d, dur: 0.22, type: 'sawtooth', gain: 0.09, filter: { type: 'lowpass', freq: 1400 } });
    });
  }

  /** First Strike — a fast metallic zip before the exchange. */
  firstStrike() {
    this.noise(0.13, { gain: 0.24, freq: 5200, sweep: 1200, q: 1.6, type: 'bandpass' });
  }

  /** Coins. */
  coin(n = 1) {
    const t = this.now();
    for (let i = 0; i < Math.min(4, n); i++) {
      this.tone(1180 + i * 190, { at: t + i * 0.045, dur: 0.14, type: 'triangle', gain: 0.09 });
    }
  }

  /** Healing. */
  heal() {
    const t = this.now();
    [60, 64, 67, 72].forEach((m, i) => {
      this.tone(mtof(m + 12), { at: t + i * 0.05, dur: 0.5, type: 'sine', gain: 0.08 });
    });
  }

  /** A card that couldn't be paid for. Deliberately dull and a bit deflating. */
  fizzle() {
    this.tone(300, { dur: 0.3, type: 'sawtooth', gain: 0.1, to: 90, filter: { type: 'lowpass', freq: 700 } });
  }

  /** Monster defeated on the path. */
  kill() {
    this.tone(220, { dur: 0.28, type: 'square', gain: 0.12, to: 70, filter: { type: 'lowpass', freq: 1200 } });
    this.noise(0.22, { gain: 0.14, freq: 700, sweep: 160 });
  }

  /** The ghost fading in at the start of a duel. */
  ghostRise() {
    this.duck(0.5, 1.6);
    const t = this.now();
    [45, 52, 57, 64].forEach((m, i) => {
      this.tone(mtof(m), { at: t + i * 0.09, dur: 1.5, type: 'sine', gain: 0.09, filter: { type: 'lowpass', freq: 900 } });
    });
    this.noise(1.2, { at: t, gain: 0.05, freq: 400, sweep: 2600, q: 0.4 });
  }

  /** Duel won. */
  victory() {
    this.duck(0.35, 2.2);
    const t = this.now();
    [60, 64, 67, 72, 76].forEach((m, i) => {
      this.tone(mtof(m), { at: t + i * 0.09, dur: 0.9, type: 'triangle', gain: 0.14 });
      this.tone(mtof(m - 12), { at: t + i * 0.09, dur: 0.9, type: 'sine', gain: 0.08 });
    });
  }

  /** Duel lost — a heart gone. */
  defeat() {
    this.duck(0.35, 2.2);
    const t = this.now();
    [64, 60, 56, 51].forEach((m, i) => {
      this.tone(mtof(m), { at: t + i * 0.16, dur: 1.1, type: 'sawtooth', gain: 0.1, filter: { type: 'lowpass', freq: 800 } });
    });
  }

  /** Plain UI tap. */
  click() {
    this.tone(600, { dur: 0.05, type: 'square', gain: 0.06, to: 420 });
  }
}
