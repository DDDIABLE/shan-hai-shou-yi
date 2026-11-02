/**
 * 生成一段约 30 秒的东方氛围背景音乐，供宣传视频使用。
 * 只用本地合成，不引入外部音频素材。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'qa');
mkdirSync(outDir, { recursive: true });
const output = resolve(outDir, 'promo-music.wav');
const tmpInput = resolve(outDir, 'promo-music-source.wav');

const sampleRate = 44100;
const duration = 30;
const total = sampleRate * duration;

// 五声音阶（宫调式）
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];

function tone(start, freq, length, gain) {
  const begin = Math.floor(start * sampleRate);
  const count = Math.floor(length * sampleRate);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const t = index / sampleRate;
    const envelope =
      Math.min(1, t / 0.02) *
      Math.exp(-t * 2.4) *
      Math.min(1, Math.max(0, (length - t) / 0.08));
    const attack = Math.sin(2 * Math.PI * freq * t);
    const fifth = Math.sin(2 * Math.PI * freq * 1.5 * t) * 0.22;
    const octave = Math.sin(2 * Math.PI * freq * 2 * t) * 0.12;
    samples[index] = (attack + fifth + octave) * envelope * gain;
  }
  return { begin, samples };
}

function pluck(start, freq, gain) {
  const begin = Math.floor(start * sampleRate);
  const length = 1.1;
  const count = Math.floor(length * sampleRate);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const t = index / sampleRate;
    const envelope = Math.exp(-t * 5.2) * Math.min(1, t / 0.008);
    const body = Math.sin(2 * Math.PI * freq * t) * 0.7 + Math.sin(2 * Math.PI * freq * 2.01 * t) * 0.2;
    samples[index] = body * envelope * gain;
  }
  return { begin, samples };
}

function drum(start, gain) {
  const begin = Math.floor(start * sampleRate);
  const length = 0.4;
  const count = Math.floor(length * sampleRate);
  const samples = new Float32Array(count);
  let seed = 22222;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let index = 0; index < count; index += 1) {
    const t = index / sampleRate;
    const envelope = Math.exp(-t * 18);
    const thump = Math.sin(2 * Math.PI * (90 - t * 60) * t) * 0.85;
    const noise = (random() * 2 - 1) * 0.15 * Math.exp(-t * 40);
    samples[index] = (thump + noise) * envelope * gain;
  }
  return { begin, samples };
}

function mix(voices) {
  const buffer = new Float32Array(total);
  for (const voice of voices) {
    for (let index = 0; index < voice.samples.length; index += 1) {
      const target = voice.begin + index;
      if (target >= 0 && target < total) buffer[target] += voice.samples[index];
    }
  }
  let peak = 0;
  for (const value of buffer) peak = Math.max(peak, Math.abs(value));
  if (peak > 0.94) {
    const scale = 0.94 / peak;
    for (let index = 0; index < buffer.length; index += 1) buffer[index] *= scale;
  }
  return buffer;
}

const voices = [];

[0, 4, 8, 12, 16, 20, 24, 28].forEach((start, index) => {
  const root = SCALE[[0, 3, 4, 2][index % 4]] / 2;
  voices.push(tone(start, root, 3.6, 0.16));
});

const melody = [
  [0.5, 4, 0.6], [1.5, 3, 0.5], [2.5, 2, 0.7], [4.5, 1, 0.5],
  [5.5, 2, 0.6], [6.5, 4, 0.5], [8.5, 5, 0.6], [10.5, 4, 0.5],
  [12.5, 3, 0.7], [14.5, 2, 0.5], [16.5, 1, 0.6], [18.5, 0, 0.7],
  [20.5, 2, 0.6], [22.5, 4, 0.5], [24.5, 3, 0.7], [26.5, 2, 0.6],
];
for (const [start, degree, gain] of melody) {
  voices.push(pluck(start, SCALE[degree], 0.32 * gain));
  voices.push(pluck(start + 0.02, SCALE[degree] * 2, 0.08 * gain));
}

for (let bar = 0; bar < 15; bar += 1) {
  const start = bar * 2;
  voices.push(drum(start, 0.22));
  if (bar >= 10) voices.push(drum(start + 1, 0.16));
}

const mixed = mix(voices);

const fadeIn = Math.floor(sampleRate * 0.6);
const fadeOut = Math.floor(sampleRate * 1.2);
for (let index = 0; index < mixed.length; index += 1) {
  let gain = 1;
  if (index < fadeIn) gain = index / fadeIn;
  if (index > total - fadeOut) gain = Math.min(gain, (total - index) / fadeOut);
  mixed[index] *= gain;
}

const pcm = Buffer.alloc(mixed.length * 2);
for (let index = 0; index < mixed.length; index += 1) {
  const value = Math.max(-1, Math.min(1, mixed[index]));
  pcm.writeInt16LE(Math.round(value * 32767), index * 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

writeFileSync(tmpInput, Buffer.concat([header, pcm]));

execFileSync('ffmpeg', [
  '-y', '-i', tmpInput,
  '-af', 'equalizer=f=240:t=q:w=1.2:g=1.5,acompressor=threshold=0.3:ratio=3:attack=12:release=180',
  '-ar', '44100', '-ac', '1',
  output,
], { stdio: 'inherit' });

console.log('音乐已生成:', output, `${duration}s`);
