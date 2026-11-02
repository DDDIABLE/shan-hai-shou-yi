/**
 * 把原始录屏与背景音乐合成为 30 秒 1080p 宣传视频。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const qaDir = resolve(root, 'qa');
const rawPath = resolve(qaDir, 'promo-raw.webm');
const musicPath = resolve(qaDir, 'promo-music.wav');
const outputPath = resolve(qaDir, 'shan-hai-shou-yi-promo-30s.mp4');

if (!existsSync(rawPath)) {
  console.error('缺少原始录屏:', rawPath);
  process.exit(1);
}
if (!existsSync(musicPath)) {
  console.error('缺少背景音乐:', musicPath);
  process.exit(1);
}

execFileSync('ffmpeg', [
  '-y',
  '-i', rawPath,
  '-i', musicPath,
  '-filter_complex', '[1:a]atrim=0:30,afade=t=in:st=0:d=1.2,afade=t=out:st=28.6:d=1.4[a]',
  '-map', '0:v',
  '-map', '[a]',
  '-c:v', 'libx264',
  '-preset', 'slow',
  '-crf', '19',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-b:a', '160k',
  '-t', '30',
  '-vf', 'fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
  outputPath,
], { stdio: 'inherit' });

console.log('宣传视频已生成:', outputPath);
