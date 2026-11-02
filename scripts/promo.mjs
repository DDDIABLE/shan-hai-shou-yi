/**
 * 录制 30 秒 1080p 宣传视频，走完三种模式与主要交互。
 * 时间轴：
 *  0.0 - 4.0  开局页（换签、三种模式、阵营、棋力、入山海）
 *  4.0 - 8.5  对局页：自由旋转 + 缩放，展示 3D 沙盘
 *  8.5 - 14.0 选子、合法落点、落子动画、规则面板
 * 14.0 - 19.0 设置面板（难度、音量、减少动态、静音）
 * 19.0 - 27.0 观战模式：自动对局、暂停、单步、2x 调速
 * 27.0 - 30.0 终局提示收尾
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const qaDir = resolve(root, 'qa');
const recordDir = resolve(root, 'qa', 'recordings');
mkdirSync(qaDir, { recursive: true });
mkdirSync(recordDir, { recursive: true });

const BASE = process.env.PROMO_URL ?? 'http://127.0.0.1:4319/';
const rawPath = resolve(qaDir, 'promo-raw.webm');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const startAt = Date.now();
async function hold(targetSeconds) {
  const remaining = targetSeconds * 1000 - (Date.now() - startAt);
  if (remaining > 0) await sleep(remaining);
}

const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4319', '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});
await sleep(2500);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: recordDir, size: { width: 1920, height: 1080 } },
});

const page = await context.newPage();
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(error.message));

async function setOrbit(azimuth, polar, distance) {
  await page.evaluate(([az, po, di]) => {
    const ref = window.__shanHaiSceneRef;
    const scene = ref && ref.current;
    if (scene && typeof scene.setCameraOrbit === 'function') scene.setCameraOrbit(az, po, di);
  }, [azimuth, polar, distance]);
}

async function waitRendered(minPieces) {
  await page.waitForFunction(
    (count) => {
      const info = window.__shanHaiScene;
      return info && info.pieces >= count && info.renders > 5;
    },
    minPieces,
    { timeout: 15000 },
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="enter-game"]', { timeout: 25000 });
  await hold(1.4);
  await page.screenshot({ path: resolve(qaDir, 'promo-shot-menu.png') });

  // 0-3.2s 开局页：换签、三种模式各点一次、选人机、选苍岚泽
  await page.click('[data-testid="seed-shuffle"]');
  await page.click('[data-testid="mode-watch"]');
  await page.click('[data-testid="mode-local"]');
  await page.click('[data-testid="mode-human"]');
  await page.click('[data-testid="side-teal"]');
  await page.click('[data-testid="difficulty-hard"]');
  await hold(3.2);

  // 3.2-6.8s 进入对局，旋转 + 缩放
  await page.click('[data-testid="enter-game"]');
  await page.waitForSelector('[data-testid="beast-canvas"]');
  await waitRendered(16);
  await setOrbit(0, 0.84, 14.2);
  await hold(5.2);
  await page.screenshot({ path: resolve(qaDir, 'promo-shot-opening.png') });

  const canvasBox = await page.locator('[data-testid="beast-canvas"]').boundingBox();
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 300, cy - 40, { steps: 20 });
  await page.mouse.up();
  await page.mouse.wheel(0, -500);
  await page.mouse.wheel(0, 300);
  await hold(6.8);
  await page.screenshot({ path: resolve(qaDir, 'promo-shot-orbit.png') });

  // 6.8-11.5s 选子、合法落点、落子
  await setOrbit(0, 0.84, 14.2);
  await page.click('[data-testid="keyboard-toggle"]');
  const turnText = await page.locator('.turn-chip').innerText();
  const side = turnText.includes('赤霞山') ? 'side-crimson' : 'side-teal';
  await page.locator(`.keyboard-cell.${side}`).nth(2).click();
  await hold(7.8);
  await page.screenshot({ path: resolve(qaDir, 'promo-shot-select.png') });

  const legal = page.locator('.keyboard-cell.is-legal').first();
  if (await legal.count()) {
    await legal.click();
  }
  await hold(9.2);
  await page.screenshot({ path: resolve(qaDir, 'promo-shot-move.png') });

  // 11.5-15.5s 规则面板 + 设置面板
  await page.click('[data-testid="keyboard-toggle"]');
  await page.click('[data-testid="open-rules"]');
  await hold(12.4);
  await page.screenshot({ path: resolve(qaDir, 'promo-shot-rules.png') });
  await page.locator('[data-testid="game-sidebar"] [data-testid="close-rules"]').click();

  await page.click('[data-testid="open-settings"]');
  await hold(15.4);
  await page.screenshot({ path: resolve(qaDir, 'promo-shot-settings.png') });
  await page.locator('[data-testid="game-sidebar"] [data-testid="close-settings"]').click();

  // 15.5-27s 观战模式：自动对局 + 暂停 + 单步 + 2x
  await page.click('[data-testid="back-menu"]');
  await page.click('[data-testid="mode-watch"]');
  await page.click('[data-testid="enter-game"]');
  await waitRendered(16);
  await hold(18.2);
  await setOrbit(0.6, 0.72, 13.0);
  await hold(20.6);
  await page.screenshot({ path: resolve(qaDir, 'promo-shot-watch.png') });

  await page.click('[data-testid="pause-toggle"]');
  await page.click('[data-testid="speed-2"]');
  await hold(22.2);
  await page.click('[data-testid="pause-toggle"]');
  await hold(29.2);
  await page.screenshot({ path: resolve(qaDir, 'promo-shot-final.png') });

  await hold(30.0);
  console.log(`实际录制耗时: ${((Date.now() - startAt) / 1000).toFixed(1)}s`);
} catch (error) {
  console.error('录制失败:', error);
  throw error;
} finally {
  await Promise.race([
    context.close().catch(() => undefined),
    sleep(4000).then(() => console.warn('context.close 超时，强制继续')),
  ]);
  preview.kill('SIGTERM');
}

const candidates = readdirSync(recordDir)
  .filter((name) => name.endsWith('.webm'))
  .map((name) => resolve(recordDir, name))
  .filter((path) => {
    try {
      return statSync(path).size > 1_000_000;
    } catch {
      return false;
    }
  });
if (candidates.length > 0) {
  candidates.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  copyFileSync(candidates[0], rawPath);
  console.log('已复制录屏文件:', candidates[0]);
}

console.log('原始录屏:', rawPath, existsSync(rawPath) ? 'OK' : 'MISSING');
if (consoleErrors.length > 0) {
  console.warn('录制期间控制台错误:', consoleErrors.slice(0, 5));
}
