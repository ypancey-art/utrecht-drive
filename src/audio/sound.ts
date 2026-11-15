// All game audio is synthesised with Web Audio: no sound files, no licences needed.
// The music is an original tune written for this game (not a cover of an existing song).

type Note = number | null; // MIDI note number or rest

const KEY = 'utrecht-drive-sound';
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private engine?: { osc: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode };
  private siren?: { osc: OscillatorNode; gain: GainNode };
  sfxOn = true;
  musicOn = true;
  private step = 0;
  private nextTime = 0;
  private timer = 0;

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      if (typeof s.sfx === 'boolean') this.sfxOn = s.sfx;
      if (typeof s.music === 'boolean') this.musicOn = s.music;
    } catch { /* defaults */ }
    // Browsers only allow audio after a click or key press.
    const unlock = () => {
      this.start();
      if (this.ctx?.state === 'running') {
        removeEventListener('pointerdown', unlock);
        removeEventListener('keydown', unlock);
      }
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ sfx: this.sfxOn, music: this.musicOn }));
    } catch { /* private mode */ }
  }

  start() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.gain.value = this.sfxOn ? 1 : 0;
      this.sfx.connect(this.master);
      this.music = ctx.createGain();
      this.music.gain.value = this.musicOn ? 0.32 : 0;
      this.music.connect(this.master);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.nextTime = ctx.currentTime + 0.1;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleSfx() {
    this.sfxOn = !this.sfxOn;
    if (this.ctx) this.sfx.gain.setTargetAtTime(this.sfxOn ? 1 : 0, this.ctx.currentTime, 0.05);
    this.save();
    return this.sfxOn;
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.ctx) this.music.gain.setTargetAtTime(this.musicOn ? 0.32 : 0, this.ctx.currentTime, 0.1);
    this.save();
    return this.musicOn;
  }

  // ------------------------------------------------------------------ engine
  /** speed01: 0..1 of top speed; throttle: -1..1; on: false while a menu is open. */
  updateEngine(speed01: number, throttle: number, on = true) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.engine) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const osc = ['sawtooth', 'square'].map((type, i) => {
        const o = ctx.createOscillator();
        o.type = type as OscillatorType;
        o.frequency.value = 40;
        const g = ctx.createGain();
        g.gain.value = i ? 0.35 : 0.6;
        o.connect(g).connect(filter);
        o.start();
        return o;
      });
      filter.connect(gain).connect(this.sfx);
      this.engine = { osc, filter, gain };
    }
    // Five "gears": the pitch rises within a gear and drops when shifting up.
    const s = Math.min(1, Math.abs(speed01));
    const gear = Math.min(4, Math.floor(s * 5));
    const inGear = s * 5 - gear;
    const rpm = 0.18 + 0.82 * (gear === 0 ? s * 5 : 0.35 + 0.65 * inGear);
    const f = 38 + rpm * 95;
    const t = ctx.currentTime;
    this.engine.osc[0].frequency.setTargetAtTime(f, t, 0.05);
    this.engine.osc[1].frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engine.filter.frequency.setTargetAtTime(350 + rpm * 900 + Math.max(0, throttle) * 500, t, 0.08);
    this.engine.gain.gain.setTargetAtTime(on ? 0.05 + 0.06 * Math.abs(throttle) + 0.04 * s : 0, t, 0.1);
  }

  // ------------------------------------------------------------------ siren
  /** distance to the nearest police car, or Infinity for none. */
  updateSiren(dist: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (!this.siren && dist < 300) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(this.sfx);
      osc.start();
      this.siren = { osc, gain };
    }
    if (!this.siren) return;
    // Two-tone siren: switches tone every half second.
    this.siren.osc.frequency.setValueAtTime(Math.floor(t * 2) % 2 ? 784 : 587, t);
    const vol = dist < 300 ? 0.09 * Math.max(0.08, 1 - dist / 300) : 0;
    this.siren.gain.gain.setTargetAtTime(vol, t, 0.15);
  }

  // ------------------------------------------------------------------ one-shots
  private burst(dur: number, vol: number, type: BiquadFilterType, from: number, to: number, when = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', when = 0, dest?: AudioNode) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** strength 0..1 */
  crash(strength: number) {
    const s = Math.max(0.15, Math.min(1, strength));
    this.burst(0.35 + s * 0.3, 0.5 * s, 'lowpass', 1800, 120);
    this.tone(70, 0.25, 0.4 * s, 'sine');
    if (s > 0.4) this.burst(0.5, 0.15 * s, 'highpass', 3000, 6000, 0.03); // glass
  }

  splash() {
    this.burst(1.2, 0.5, 'bandpass', 1500, 200);
    this.burst(0.6, 0.25, 'lowpass', 600, 80, 0.15);
  }

  coin() {
    this.tone(988, 0.12, 0.2, 'square');
    this.tone(1319, 0.35, 0.2, 'square', 0.08);
  }

  correct() {
    [72, 76, 79].forEach((n, i) => this.tone(midi(n), 0.25, 0.18, 'triangle', i * 0.07));
  }

  wrong() {
    this.tone(160, 0.3, 0.2, 'sawtooth');
    this.tone(120, 0.35, 0.2, 'sawtooth', 0.12);
  }

  horn() {
    this.tone(415, 0.5, 0.12, 'square');
    this.tone(523, 0.5, 0.1, 'square');
  }

  // ------------------------------------------------------------------ music
  // "Overvecht Groove" — an original 16-bar loop, 112 BPM, eighth-note steps.
  private static BPM = 112;
  // Chords per bar (root MIDI note + minor/major).
  private static CHORDS: [number, 'm' | 'M'][] = [
    [57, 'm'], [53, 'M'], [48, 'M'], [55, 'M'], [57, 'm'], [53, 'M'], [48, 'M'], [55, 'M'],
    [50, 'm'], [53, 'M'], [55, 'M'], [52, 'm'], [50, 'm'], [53, 'M'], [55, 'M'], [55, 'M'],
  ];
  // Lead melody, 8 steps per bar (null = rest).
  private static LEAD: Note[][] = [
    [76, null, 76, 74, 72, null, 69, null], [72, null, 74, null, 76, 77, 76, null],
    [79, null, 76, null, 74, 72, 74, null], [74, null, null, 71, 74, null, 76, null],
    [76, null, 76, 74, 72, null, 69, 72], [77, null, 76, null, 74, null, 72, null],
    [72, 74, 76, 79, 81, null, 79, null], [76, null, 74, null, 71, null, null, null],
    [74, null, 77, null, 81, null, 77, 76], [77, null, 76, null, 72, null, 69, null],
    [71, null, 74, null, 79, null, 78, 79], [76, null, null, null, 71, 72, 74, 76],
    [77, null, 77, 76, 74, null, 72, null], [72, null, 74, 76, 77, null, 81, null],
    [79, null, 77, null, 76, null, 74, null], [74, 76, 74, 71, 74, null, null, null],
  ];

  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    const stepDur = 60 / Sound.BPM / 2;
    // Don't build up a backlog after the tab was hidden.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.12) {
      if (this.musicOn) this.playStep(this.step, this.nextTime - ctx.currentTime, stepDur);
      this.step = (this.step + 1) % (16 * 8);
      this.nextTime += stepDur;
    }
  }

  private playStep(step: number, when: number, dur: number) {
    const bar = Math.floor(step / 8), s = step % 8;
    const [root, q] = Sound.CHORDS[bar];
    const third = q === 'm' ? 3 : 4;
    const out = this.music;
    // Drums: kick on 1 and 3 (plus a push), snare on 2 and 4, hats on every eighth.
    if (s === 0 || s === 4 || (s === 7 && bar % 2)) this.kick(when, out);
    if (s === 2 || s === 6) this.snare(when, out);
    this.hat(when, s % 2 ? 0.05 : 0.08, out);
    // Bass: syncopated root / octave line.
    const bassPat: Note[] = [0, null, 12, 0, null, 0, 12, 7];
    const b = bassPat[s];
    if (b !== null) this.tone(midi(root - 12 + b), dur * 0.9, 0.35, 'triangle', when, out);
    // Chord stabs on the off-beats.
    if (s === 1 || s === 5)
      for (const iv of [0, third, 7]) this.tone(midi(root + 12 + iv), dur * 0.8, 0.07, 'square', when, out);
    // Lead melody.
    const n = Sound.LEAD[bar][s];
    if (n !== null) this.tone(midi(n), dur * 1.6, 0.13, 'triangle', when, out);
  }

  private kick(when: number, out: AudioNode) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.3);
  }

  private snare(when: number, out: AudioNode) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5, 0.2);
  }

  private hat(when: number, vol: number, out: AudioNode) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5, 0.06);
  }

  dispose() {
    clearInterval(this.timer);
  }
}

export const sound = new Sound();
