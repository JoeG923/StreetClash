/*
  RetroAudioEngine builds all music and sound effects in code.
  No audio files are used, it creates tones/noise with the Web Audio API.
*/
const MUSIC_BPM = 132;
const STEPS_PER_BEAT = 2;
const MUSIC_STEP_SECONDS = 60 / MUSIC_BPM / STEPS_PER_BEAT;
const MUSIC_LOOKAHEAD_SECONDS = 0.22;
const MUSIC_SCHEDULER_MS = 60;

const LEAD_PATTERN = [
  69, null, 72, null, 74, 72, 69, null,
  67, null, 69, null, 72, 69, 67, null,
  69, null, 72, null, 76, 74, 72, null,
  71, null, 72, null, 74, 72, 69, null,
];

const BASS_PATTERN = [
  45, null, 45, null, 48, null, 45, null,
  43, null, 43, null, 47, null, 43, null,
  45, null, 45, null, 50, null, 45, null,
  43, null, 43, null, 47, null, 43, null,
];

function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function clampHz(value) {
  return Math.max(20, value);
}

class RetroAudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.noiseBuffer = null;
    this.musicTimer = null;
    this.nextStepTime = 0;
    this.stepIndex = 0;
  }

  unlock() {
    // Browsers block audio until the player interacts once.
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  }

  startMusic() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.unlock();
    if (this.musicTimer) return;
    this.stepIndex = 0;
    this.nextStepTime = ctx.currentTime + 0.05;
    this.musicTimer = window.setInterval(() => {
      this.scheduleMusic();
    }, MUSIC_SCHEDULER_MS);
  }

  stopMusic() {
    if (!this.musicTimer) return;
    window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  playRoundStart() {
    const time = this.now(0.01);
    if (time == null) return;
    this.playTone({
      frequency: midiToHz(76),
      time,
      duration: 0.08,
      type: "square",
      peakGain: 0.12,
      decayGain: 0.06,
      release: 0.08,
      bus: this.sfxBus,
    });
    this.playTone({
      frequency: midiToHz(81),
      time: time + 0.09,
      duration: 0.1,
      type: "square",
      peakGain: 0.11,
      decayGain: 0.05,
      release: 0.08,
      bus: this.sfxBus,
    });
  }

  playJump() {
    const time = this.now(0.005);
    if (time == null) return;
    this.playTone({
      frequency: 280,
      slideTo: 520,
      time,
      duration: 0.12,
      type: "square",
      peakGain: 0.1,
      decayGain: 0.04,
      release: 0.08,
      bus: this.sfxBus,
    });
    this.playNoise({
      time,
      duration: 0.05,
      peakGain: 0.035,
      highpass: 1800,
      bandpass: 2600,
      release: 0.07,
      bus: this.sfxBus,
    });
  }

  playAttack(kind) {
    if (kind === "punch") this.playPunch();
    else if (kind === "kick") this.playKick();
    else if (kind === "jumpKick") this.playJumpKick();
  }

  playPunch() {
    const time = this.now(0.004);
    if (time == null) return;
    this.playNoise({
      time,
      duration: 0.06,
      peakGain: 0.05,
      highpass: 1200,
      bandpass: 1800,
      release: 0.09,
      bus: this.sfxBus,
    });
    this.playTone({
      frequency: 220,
      slideTo: 150,
      time,
      duration: 0.08,
      type: "square",
      peakGain: 0.08,
      decayGain: 0.03,
      release: 0.08,
      bus: this.sfxBus,
    });
  }

  playKick() {
    const time = this.now(0.004);
    if (time == null) return;
    this.playNoise({
      time,
      duration: 0.1,
      peakGain: 0.07,
      highpass: 700,
      bandpass: 1100,
      release: 0.1,
      bus: this.sfxBus,
    });
    this.playTone({
      frequency: 180,
      slideTo: 100,
      time,
      duration: 0.12,
      type: "sawtooth",
      peakGain: 0.07,
      decayGain: 0.03,
      release: 0.1,
      bus: this.sfxBus,
    });
  }

  playJumpKick() {
    const time = this.now(0.004);
    if (time == null) return;
    this.playNoise({
      time,
      duration: 0.13,
      peakGain: 0.08,
      highpass: 900,
      bandpass: 1600,
      release: 0.12,
      bus: this.sfxBus,
    });
    this.playTone({
      frequency: 210,
      slideTo: 120,
      time,
      duration: 0.13,
      type: "sawtooth",
      peakGain: 0.09,
      decayGain: 0.04,
      release: 0.12,
      bus: this.sfxBus,
    });
    this.playTone({
      frequency: 520,
      slideTo: 390,
      time: time + 0.01,
      duration: 0.1,
      type: "square",
      peakGain: 0.04,
      decayGain: 0.02,
      release: 0.08,
      bus: this.sfxBus,
    });
  }

  playHit() {
    const time = this.now(0.003);
    if (time == null) return;
    this.playNoise({
      time,
      duration: 0.08,
      peakGain: 0.08,
      highpass: 500,
      bandpass: 1400,
      release: 0.11,
      bus: this.sfxBus,
    });
    this.playTone({
      frequency: 190,
      slideTo: 95,
      time,
      duration: 0.1,
      type: "triangle",
      peakGain: 0.09,
      decayGain: 0.03,
      release: 0.1,
      bus: this.sfxBus,
    });
  }

  playKo() {
    const time = this.now(0.01);
    if (time == null) return;
    const notes = [72, 76, 79, 84];
    for (let i = 0; i < notes.length; i++) {
      this.playTone({
        frequency: midiToHz(notes[i]),
        time: time + i * 0.08,
        duration: 0.12,
        type: "square",
        peakGain: 0.1,
        decayGain: 0.05,
        release: 0.12,
        bus: this.sfxBus,
      });
    }
  }

  ensureContext() {
    if (this.ctx) return this.ctx;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;

    // Audio graph:
    // oscillators/noise -> musicBus or sfxBus -> master -> speakers
    this.ctx = new AudioContextCtor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.58;
    this.master.connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.32;
    this.musicBus.connect(this.master);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.5;
    this.sfxBus.connect(this.master);

    this.noiseBuffer = this.createNoiseBuffer();
    return this.ctx;
  }

  createNoiseBuffer() {
    if (!this.ctx) return null;
    const size = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  now(offsetSeconds) {
    const ctx = this.ensureContext();
    if (!ctx) return null;
    return ctx.currentTime + offsetSeconds;
  }

  scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || ctx.state !== "running") return;

    const horizon = ctx.currentTime + MUSIC_LOOKAHEAD_SECONDS;
    while (this.nextStepTime < horizon) {
      this.scheduleStep(this.stepIndex, this.nextStepTime);
      this.stepIndex = (this.stepIndex + 1) % LEAD_PATTERN.length;
      this.nextStepTime += MUSIC_STEP_SECONDS;
    }
  }

  scheduleStep(step, time) {
    const lead = LEAD_PATTERN[step];
    if (lead != null) {
      this.playTone({
        frequency: midiToHz(lead),
        time,
        duration: MUSIC_STEP_SECONDS * 0.92,
        type: "square",
        peakGain: 0.095,
        decayGain: 0.045,
        release: 0.07,
        vibratoHz: 6,
        vibratoDepth: 3,
        bus: this.musicBus,
      });
    }

    const bass = BASS_PATTERN[step];
    if (bass != null) {
      this.playTone({
        frequency: midiToHz(bass),
        time,
        duration: MUSIC_STEP_SECONDS * 0.95,
        type: "triangle",
        peakGain: 0.08,
        decayGain: 0.05,
        release: 0.06,
        bus: this.musicBus,
      });
    }

    if (step % 2 === 0) {
      this.playNoise({
        time,
        duration: 0.03,
        peakGain: 0.014,
        highpass: 4200,
        bandpass: 6800,
        release: 0.035,
        bus: this.musicBus,
      });
    }

    if (step % 8 === 4) {
      this.playNoise({
        time,
        duration: 0.06,
        peakGain: 0.02,
        highpass: 900,
        bandpass: 1800,
        release: 0.06,
        bus: this.musicBus,
      });
    }
  }

  playTone({
    frequency,
    time,
    duration,
    type,
    peakGain,
    decayGain,
    release,
    slideTo = null,
    vibratoHz = 0,
    vibratoDepth = 0,
    bus,
  }) {
    // Envelope: quick attack, short decay, fade out release.
    if (!this.ctx || !bus || !Number.isFinite(time)) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(clampHz(frequency), time);
    if (slideTo != null) {
      osc.frequency.exponentialRampToValueAtTime(clampHz(slideTo), time + Math.max(0.02, duration));
    }

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peakGain), time + 0.008);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, decayGain), time + Math.max(0.03, duration * 0.55));
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration + release);

    if (vibratoHz > 0 && vibratoDepth > 0) {
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.setValueAtTime(vibratoHz, time);
      lfoGain.gain.setValueAtTime(vibratoDepth, time);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start(time);
      lfo.stop(time + duration + release + 0.04);
    }

    osc.connect(gain);
    gain.connect(bus);
    osc.start(time);
    osc.stop(time + duration + release + 0.04);
  }

  playNoise({ time, duration, peakGain, highpass, bandpass, release, bus }) {
    // Noise + filters gives "impact" sounds like hit/punch/ko accents.
    if (!this.ctx || !this.noiseBuffer || !bus || !Number.isFinite(time)) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;

    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(highpass, time);

    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(bandpass, time);
    bp.Q.setValueAtTime(0.7, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peakGain), time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration + release);

    source.connect(hp);
    hp.connect(bp);
    bp.connect(gain);
    gain.connect(bus);

    source.start(time);
    source.stop(time + duration + release + 0.04);
  }
}

// Factory used by game.js.
export function createRetroAudioEngine() {
  return new RetroAudioEngine();
}
