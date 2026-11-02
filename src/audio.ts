export type SoundName =
  | 'click'
  | 'place'
  | 'water'
  | 'jump'
  | 'capture'
  | 'trap'
  | 'drum'
  | 'den'
  | 'victory';

export const AUDIO_STORAGE_KEY = 'shan-hai-shou-yi-audio';

export type AudioSettings = {
  muted: boolean;
  volume: number;
};

export function loadAudioSettings(): AudioSettings {
  const fallback = { muted: false, volume: 0.55 };
  try {
    const raw = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      muted: Boolean(parsed.muted),
      volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : fallback.volume,
    };
  } catch {
    return fallback;
  }
}

export function saveAudioSettings(settings: AudioSettings) {
  try {
    localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage failure
  }
}

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private settings: AudioSettings = loadAudioSettings();
  private unlocked = false;

  get muted() {
    return this.settings.muted;
  }

  get volume() {
    return this.settings.volume;
  }

  setMuted(muted: boolean) {
    this.settings.muted = muted;
    saveAudioSettings(this.settings);
    if (!muted) this.unlock();
  }

  /** 首次交互前就把默认值落盘，保证刷新后音量与静音状态不丢。 */
  persist() {
    saveAudioSettings(this.settings);
  }

  setVolume(volume: number) {
    this.settings.volume = Math.min(1, Math.max(0, volume));
    saveAudioSettings(this.settings);
    if (this.settings.volume > 0 && this.settings.muted) this.setMuted(false);
  }

  unlock() {
    if (this.unlocked) return;
    try {
      const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = this.settings.muted ? 0 : this.settings.volume;
      this.master.connect(this.context.destination);
      void this.context.resume();
      this.unlocked = true;
    } catch {
      // audio unavailable
    }
  }

  updateGain() {
    if (!this.master || !this.context) return;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.volume, this.context.currentTime, 0.02);
  }

  play(name: SoundName) {
    if (this.settings.muted) return;
    this.unlock();
    if (!this.context || !this.master) return;
    this.updateGain();
    const now = this.context.currentTime;
    switch (name) {
      case 'click':
        this.tone(520, 0.05, 0.08, 'triangle', now);
        break;
      case 'place':
        this.tone(220, 0.12, 0.22, 'sine', now);
        this.noise(0.08, 0.18, now, 1200);
        break;
      case 'water':
        this.noise(0.35, 0.2, now, 700);
        this.tone(320, 0.22, 0.1, 'sine', now);
        break;
      case 'jump':
        this.tone(440, 0.18, 0.16, 'square', now);
        this.tone(660, 0.14, 0.1, 'triangle', now + 0.08);
        break;
      case 'capture':
        this.noise(0.2, 0.32, now, 900);
        this.tone(150, 0.22, 0.28, 'sawtooth', now);
        break;
      case 'trap':
        this.tone(180, 0.24, 0.22, 'square', now);
        this.tone(90, 0.3, 0.2, 'sawtooth', now + 0.05);
        break;
      case 'drum':
        this.tone(100, 0.28, 0.42, 'sine', now);
        this.noise(0.12, 0.2, now, 300);
        break;
      case 'den':
        this.tone(392, 0.35, 0.3, 'triangle', now);
        this.tone(523, 0.4, 0.28, 'triangle', now + 0.12);
        this.tone(659, 0.5, 0.24, 'triangle', now + 0.24);
        break;
      case 'victory':
        this.tone(523, 0.5, 0.28, 'triangle', now);
        this.tone(659, 0.55, 0.26, 'triangle', now + 0.16);
        this.tone(784, 0.7, 0.24, 'triangle', now + 0.32);
        this.noise(0.5, 0.12, now + 0.32, 5000);
        break;
    }
  }

  private tone(frequency: number, duration: number, gain: number, type: OscillatorType, start: number) {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.72), start + duration);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(gain, start + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(duration: number, gain: number, start: number, cutoff: number) {
    if (!this.context || !this.master) return;
    const length = Math.max(1, Math.floor(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / length);
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    source.start(start);
  }
}
