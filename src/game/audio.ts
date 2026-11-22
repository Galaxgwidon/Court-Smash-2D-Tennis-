import type { CourtSurface } from './types';

class TennisAudio {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.25);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private ready(): AudioContext | null {
    if (this.muted) return null;
    this.unlock();
    if (!this.ctx || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  public playRacketHit(intensity: number, isPerfect: boolean): void {
    const ctx = this.ready();
    if (!ctx || !this.noiseBuffer) return;

    const now = ctx.currentTime;
    const clamped = Math.max(0.35, Math.min(1.25, intensity));

    // String pop (bandpass noise burst)
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(isPerfect ? 1350 : 980, now);
    filter.Q.setValueAtTime(isPerfect ? 2.4 : 1.7, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.linearRampToValueAtTime(0.32 * clamped, now + 0.004);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + (isPerfect ? 0.095 : 0.07));

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.11);

    // Racket frame body thwock (pitch-dropping sine/triangle)
    const osc = ctx.createOscillator();
    osc.type = isPerfect ? 'triangle' : 'sine';
    const baseFreq = isPerfect ? 245 : 195;
    osc.frequency.setValueAtTime(baseFreq * (0.95 + Math.random() * 0.1), now);
    osc.frequency.exponentialRampToValueAtTime(68, now + 0.075);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.34 * clamped, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

    osc.connect(bodyGain);
    bodyGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.095);

    // Crisp harmonic ping on Perfect hit
    if (isPerfect) {
      const ping = ctx.createOscillator();
      ping.type = 'sine';
      ping.frequency.setValueAtTime(660, now);
      ping.frequency.exponentialRampToValueAtTime(880, now + 0.09);

      const pingGain = ctx.createGain();
      pingGain.gain.setValueAtTime(0.11, now);
      pingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

      ping.connect(pingGain);
      pingGain.connect(ctx.destination);
      ping.start(now);
      ping.stop(now + 0.14);
    }
  }

  public playBounce(surface: CourtSurface, impactVel: number): void {
    const ctx = this.ready();
    if (!ctx) return;

    const now = ctx.currentTime;
    const strength = Math.max(0.15, Math.min(1, Math.abs(impactVel) / 420));

    const freqMap: Record<CourtSurface, number> = {
      clay: 135,
      grass: 112,
      hard: 175,
    };

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const startFreq = freqMap[surface] * (0.94 + Math.random() * 0.12);
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.06);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.24 * strength, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.075);
  }

  public playNetClip(): void {
    const ctx = this.ready();
    if (!ctx || !this.noiseBuffer) return;

    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1600, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.13);

    const cord = ctx.createOscillator();
    cord.type = 'triangle';
    cord.frequency.setValueAtTime(320, now);
    cord.frequency.exponentialRampToValueAtTime(120, now + 0.09);

    const cordGain = ctx.createGain();
    cordGain.gain.setValueAtTime(0.14, now);
    cordGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    cord.connect(cordGain);
    cordGain.connect(ctx.destination);
    cord.start(now);
    cord.stop(now + 0.11);
  }

  public playMachineLaunch(): void {
    const ctx = this.ready();
    if (!ctx || !this.noiseBuffer) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.11);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(520, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  public playTargetHit(): void {
    const ctx = this.ready();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [587.33, 880, 1174.66];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const t = now + idx * 0.045;
      osc.frequency.setValueAtTime(freq, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.13, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }

  public playPointResult(won: boolean): void {
    const ctx = this.ready();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = won ? [440, 554.37, 659.25] : [330, 277.18];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const t = now + idx * 0.075;
      osc.frequency.setValueAtTime(freq, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.26);
    });
  }

  public playMatchEnd(won: boolean): void {
    const ctx = this.ready();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = won
      ? [523.25, 659.25, 783.99, 1046.5]
      : [392, 349.23, 311.13, 261.63];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const t = now + idx * 0.1;
      osc.frequency.setValueAtTime(freq, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.14, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.36);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.38);
    });
  }
}

export const tennisAudio = new TennisAudio();
