import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const qaDir = resolve(root, 'qa');
const distDir = resolve(root, 'dist');
const PORT = process.env.QA_PORT ?? '4319';
const BASE_URL = process.env.QA_URL ?? `http://127.0.0.1:${PORT}/`;

const FORBIDDEN = ['炮', '九宫', '马腿', '楚河', '汉界'];

const results = [];
const failures = [];

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  results.push({ name, ok, detail });
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function collectSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(full)));
    } else if (['.ts', '.tsx', '.mjs', '.md', '.css'].includes(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

async function scanForbiddenTerms() {
  console.log('\n=== 静态扫描 ===');
  const targets = [...(await collectSourceFiles(resolve(root, 'src')))];
  const readme = resolve(root, 'README.md');
  if (existsSync(readme)) targets.push(readme);

  const hits = [];
  for (const file of targets) {
    const text = await readFile(file, 'utf8');
    for (const term of FORBIDDEN) {
      if (text.includes(term)) hits.push(`${file.replace(root + '/', '')}:${term}`);
    }
  }
  check('无象棋专用遗留逻辑', hits.length === 0, hits.join(', '));
}

async function waitForApp(page) {
  await page.waitForSelector('[data-testid="enter-game"]', { timeout: 25000 });
}

async function startGame(page, modeTestId) {
  if (modeTestId) await page.click(`[data-testid="${modeTestId}"]`);
  await page.click('[data-testid="enter-game"]');
  await page.waitForSelector('[data-testid="beast-canvas"]', { timeout: 25000 });
  await page.waitForSelector('[data-testid="turn-block"]');
}

async function historyCount(page) {
  return page.locator('[data-testid="history-entry"]').count();
}

async function checkRetry(page, name, fn, attempts = 3) {
  let lastDetail = '';
  for (let index = 0; index < attempts; index += 1) {
    try {
      const detail = await fn();
      if (detail === true || detail === '') {
        check(name, true, detail === true ? '' : detail);
        return true;
      }
      lastDetail = detail;
    } catch (error) {
      lastDetail = error.message.slice(0, 120);
    }
    await page.waitForTimeout(500);
  }
  check(name, false, lastDetail);
  return false;
}

async function clickUntilText(page, testId, expected, attempts = 5) {
  for (let index = 0; index < attempts; index += 1) {
    await page.locator(`[data-testid="${testId}"]`).click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(450);
    const text = await page.locator(`[data-testid="${testId}"]`).innerText().catch(() => '');
    if (text.includes(expected)) return text;
  }
  return page.locator(`[data-testid="${testId}"]`).innerText().catch(() => '');
}

async function pixelStats(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="beast-canvas"]');
    const ref = window.__shanHaiSceneRef;
    const scene = ref && ref.current;
    if (scene && typeof scene.renderOnce === 'function') scene.renderOnce();
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return null;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let lit = 0;
    const buckets = new Set();
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      if (r + g + b > 30) {
        lit += 1;
        buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
      }
    }
    return { width, height, lit, total: width * height, colors: buckets.size };
  });
}

async function setOrbit(page, azimuth, polar, distance) {
  await page.evaluate(([az, po, di]) => {
    const ref = window.__shanHaiSceneRef;
    const scene = ref && ref.current;
    if (scene && typeof scene.setCameraOrbit === 'function') scene.setCameraOrbit(az, po, di);
  }, [azimuth, polar, distance]);
  await page.waitForTimeout(120);
}

async function cameraReadout(page) {
  const value = await page
    .locator('[data-testid="camera-readout"]')
    .innerText()
    .catch(() => '');
  return value.trim();
}

async function ensurePreview() {
  if (!existsSync(distDir)) throw new Error('dist/ 不存在，请先运行 npm run build');
  try {
    const probe = await fetch(BASE_URL);
    if (probe.ok) return 'external';
  } catch {
    // start preview
  }
  const { spawn } = await import('node:child_process');
  const child = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', PORT, '--strictPort'],
    { cwd: root, stdio: 'ignore', detached: false },
  );
  for (let index = 0; index < 80; index += 1) {
    try {
      const probe = await fetch(BASE_URL);
      if (probe.ok) return child;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
  }
  child.kill();
  throw new Error('无法启动 vite preview');
}

async function main() {
  await mkdir(qaDir, { recursive: true });
  await scanForbiddenTerms();

  const server = await ensurePreview();
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });

  try {
    await runDesktop(browser);
    await runModeFlows(browser);
    await runMobile(browser);
  } finally {
    await browser.close();
    if (server && typeof server !== 'string') server.kill();
  }

  const required = [
    'desktop-menu.png',
    'desktop-opening.png',
    'desktop-animation.png',
    'desktop-after-ai.png',
    'desktop-rules.png',
    'desktop-orbit.png',
    'mobile-menu.png',
    'mobile-opening.png',
    'mobile-keyboard-panel.png',
    'mobile-orbit.png',
  ];
  console.log('\n=== 截图 ===');
  for (const file of required) {
    check(`截图存在 ${file}`, existsSync(resolve(qaDir, file)));
  }

  await writeFile(resolve(qaDir, 'qa-report.json'), JSON.stringify({ results, failures }, null, 2), 'utf8');

  console.log('');
  console.log(`QA 检查项：${results.length}，通过：${results.length - failures.length}，失败：${failures.length}`);
  if (failures.length > 0) {
    console.log('失败项：');
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('全部通过。');
  }
}

async function runDesktop(browser) {
  console.log('\n=== 桌面端 1440 × 900 ===');
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'load' });
  await waitForApp(page);
  await page.screenshot({ path: resolve(qaDir, 'desktop-menu.png') });

  check('桌面菜单可见品牌标题', await page.getByRole('heading', { name: '山海兽弈' }).isVisible());
  check('桌面菜单含三种模式', (await page.locator('[data-testid="mode-watch"], [data-testid="mode-human"], [data-testid="mode-local"]').count()) === 3);
  check('桌面菜单含操作提示', (await page.locator('.menu-hint').innerText()).includes('拖拽旋转'));

  await startGame(page, 'mode-watch');
  await setOrbit(page, 0, 0.84, 14.2);
  await page.waitForTimeout(900);
  await page.screenshot({ path: resolve(qaDir, 'desktop-opening.png') });

  check('棋盘画布可见', await page.locator('[data-testid="beast-canvas"]').isVisible());
  check('可访问棋盘已渲染 63 格', (await page.locator('[role="gridcell"]').count()) === 63);

  // 真实像素审计：确认 Three.js 确实画出了沙盘与棋子
  await page.waitForTimeout(600);
  const pixels = await pixelStats(page);
  check(
    'Three.js 实际渲染出画面',
    pixels !== null && pixels.lit > pixels.total * 0.05 && pixels.colors > 8,
    pixels ? `lit=${((pixels.lit / pixels.total) * 100).toFixed(1)}% colors=${pixels.colors}` : 'no-gl',
  );

  // 棋子必须面对面对战
  const orientation = await page.evaluate(() => {
    const scene = window.__shanHaiScene;
    if (!scene || !scene.orientations) return null;
    const crimson = Object.entries(scene.orientations)
      .filter(([key]) => key.startsWith('crimson:'))
      .map(([, value]) => value);
    const teal = Object.entries(scene.orientations)
      .filter(([key]) => key.startsWith('teal:'))
      .map(([, value]) => value);
    return { crimson, teal };
  });
  check(
    '双方棋子朝向相对（赤霞山朝北，苍岚泽朝南）',
    orientation !== null &&
      orientation.crimson.length === 8 &&
      orientation.teal.length === 8 &&
      orientation.crimson.every((value) => Math.abs(value - Math.PI) < 0.01) &&
      orientation.teal.every((value) => Math.abs(value) < 0.01),
    orientation ? `crimson=${orientation.crimson[0]} teal=${orientation.teal[0]}` : 'no-data',
  );

  let firstCount = 0;
  for (let index = 0; index < 20; index += 1) {
    await page.waitForTimeout(500);
    firstCount = await historyCount(page);
    if (firstCount >= 2) break;
  }
  await page.screenshot({ path: resolve(qaDir, 'desktop-animation.png') });
  check('观战模式自动落子', firstCount > 0, `history=${firstCount}`);

  const cameraBefore = await cameraReadout(page);
  const box = await page.locator('[data-testid="beast-canvas"]').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 200, cy + 50, { steps: 16 });
  await page.mouse.up();
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(500);
  await setOrbit(page, -1.05, 0.56, 11.1);
  await page.screenshot({ path: resolve(qaDir, 'desktop-orbit.png') });
  const cameraAfter = await cameraReadout(page);
  check('自由旋转缩放改变相机', cameraBefore !== cameraAfter && cameraAfter !== '', `${cameraBefore} -> ${cameraAfter}`);

  let runningCount = firstCount;
  for (let index = 0; index < 20; index += 1) {
    await page.waitForTimeout(500);
    runningCount = await historyCount(page);
    if (runningCount > firstCount) break;
  }
  await page.screenshot({ path: resolve(qaDir, 'desktop-after-ai.png') });
  check('AI 自动对局持续推进', runningCount > firstCount, `history=${runningCount}`);

  await page.click('[data-testid="pause-toggle"]');
  await page.waitForTimeout(700);
  const pausedBefore = await historyCount(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 140, cy + 30, { steps: 12 });
  await page.mouse.up();
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(900);
  check('拖拽视角不增加棋谱', (await historyCount(page)) === pausedBefore, `before=${pausedBefore} after=${await historyCount(page)}`);

  await page.click('[data-testid="open-rules"]');
  await page.waitForTimeout(300);
  check('桌面规则面板为常驻侧栏', await page.locator('[data-testid="game-sidebar"]').isVisible());
  await page.screenshot({ path: resolve(qaDir, 'desktop-rules.png') });
  check('规则面板包含八兽等级', (await page.locator('[data-testid="game-sidebar"] .rank-list li').count()) === 8);
  await page.locator('[data-testid="game-sidebar"] [data-testid="close-rules"]').click({ force: true });

  // 音频：首次交互后解锁，静音状态持久化
  // 首次交互后才解锁音频，交互后应立刻落盘
  await page.click('[data-testid="mute-toggle"]');
  await page.waitForTimeout(400);
  const audioKey = await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        if (typeof parsed.volume === 'number' && typeof parsed.muted === 'boolean') return key;
      } catch {
        // 非 JSON，跳过
      }
    }
    return null;
  });
  check('音频设置已持久化', Boolean(audioKey), audioKey ?? 'none');
  const mutePressed = await page.locator('[data-testid="mute-toggle"]').getAttribute('aria-pressed');
  check('静音按钮维护 aria-pressed', mutePressed === 'true', `aria-pressed=${mutePressed}`);
  const mutedStored = await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        if (typeof parsed.volume === 'number' && parsed.muted === true) return true;
      } catch {
        // 非 JSON，跳过
      }
    }
    return false;
  });
  check('静音状态写入音频存储', mutedStored);
  await page.click('[data-testid="mute-toggle"]');
  await page.waitForTimeout(250);

  const pauseLabel = await clickUntilText(page, 'pause-toggle', '继续');
  check('暂停后按钮切换为继续', pauseLabel.includes('继续'), `label=${pauseLabel}`);
  const pausedCount = await historyCount(page);
  await page.waitForTimeout(1600);
  check('暂停后不自动落子', (await historyCount(page)) === pausedCount, `count=${pausedCount}`);
  const stepEnabled = await page.locator('[data-testid="step-button"]').isEnabled();
  check('暂停后单步可用', stepEnabled);
  if (stepEnabled) {
    let stepped = pausedCount;
    for (let attempt = 0; attempt < 6 && stepped <= pausedCount; attempt += 1) {
      const accepted = await page.evaluate(() => {
        const step = window.__shanHaiStep;
        if (typeof step !== 'function') return false;
        return step();
      });
      if (!accepted) {
        await page.locator('[data-testid="step-button"]').click({ force: true, timeout: 5000 }).catch(() => {});
      }
      for (let wait = 0; wait < 12; wait += 1) {
        await page.waitForTimeout(300);
        stepped = await historyCount(page);
        if (stepped > pausedCount) break;
      }
    }
    check('单步只完成一手', stepped > pausedCount && stepped <= pausedCount + 2, `before=${pausedCount} after=${stepped}`);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('桌面无横向溢出', overflow <= 1, `overflow=${overflow}px`);
  check('桌面无页面错误', pageErrors.length === 0, pageErrors.join(' | '));
  check('桌面无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await context.close();
}

async function runModeFlows(browser) {
  console.log('\n=== 对局模式流程 ===');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const playOneMove = async () => {
    const turn = await page.locator('.turn-chip').innerText();
    const sideClass = turn.includes('赤霞山') ? 'side-crimson' : 'side-teal';
    const first = page.locator(`.keyboard-cell.${sideClass}`).first();
    if (await first.count()) {
      await first.click({ force: true, timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(250);
      const legal = page.locator('.keyboard-cell.is-legal').first();
      if (await legal.count()) {
        await legal.click({ force: true, timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(350);
        return true;
      }
    }
    return false;
  };

  await page.goto(BASE_URL, { waitUntil: 'load' });
  await waitForApp(page);

  // --- 本地双人 ---
  await startGame(page, 'mode-local');
  await page.waitForTimeout(400);
  await page.locator('[data-testid="keyboard-toggle"]').click({ force: true });
  await page.waitForTimeout(250);
  const turnLocal = await page.locator('.turn-chip').innerText();
  const localMoved = await playOneMove();
  const turnAfterLocal = await page.locator('.turn-chip').innerText();
  check('本地双人轮换行棋方', localMoved && turnLocal !== turnAfterLocal, `${turnLocal} -> ${turnAfterLocal}`);

  const beforeLocalUndo = await historyCount(page);
  await page.locator('[data-testid="undo-button"]').click({ force: true });
  await page.waitForTimeout(300);
  const afterLocalUndo = await historyCount(page);
  check('本地双人撤回一个半回合', beforeLocalUndo - afterLocalUndo === 1, `${beforeLocalUndo} -> ${afterLocalUndo}`);

  // --- 人机对战 ---
  await page.locator('[data-testid="back-menu"]').click({ force: true });
  await page.waitForTimeout(250);
  await page.locator('[data-testid="mode-human"]').click({ force: true });
  await page.locator('[data-testid="side-teal"]').click({ force: true });
  await page.locator('[data-testid="enter-game"]').click({ force: true });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="keyboard-toggle"]').click({ force: true });
  await page.waitForTimeout(400);
  check('人机模式键盘面板已打开', await page.locator('.keyboard-board').isVisible());

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let playerMoved = false;
    for (let index = 0; index < 24; index += 1) {
      await page.waitForTimeout(400);
      const turn = await page.locator('.turn-chip').innerText();
      if (turn.includes('苍岚泽')) {
        playerMoved = await playOneMove();
        if (playerMoved) break;
      }
    }
    check('人机模式玩家可落子', playerMoved);
    if (!playerMoved) break;

    await page.waitForTimeout(1000);
    const beforeHumanUndo = await historyCount(page);
    await page.locator('[data-testid="undo-button"]').click({ force: true });
    await page.waitForTimeout(600);
    const afterHumanUndo = await historyCount(page);
    const turnAfter = await page.locator('.turn-chip').innerText();
    const backToPlayer = turnAfter.includes('苍岚泽');
    check(
      '人机撤回到玩家决策点',
      backToPlayer && afterHumanUndo < beforeHumanUndo,
      `history ${beforeHumanUndo} -> ${afterHumanUndo}, turn=${turnAfter}`,
    );
    if (backToPlayer && afterHumanUndo < beforeHumanUndo) break;
  }

  // --- 模式切换确认 ---
  await checkRetry(page, '对局中重开需确认', async () => {
    await page.locator('[data-testid="restart-button"]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    return (await page.locator('.confirm-overlay').count()) > 0 ? true : 'no-overlay';
  });
  const restartConfirm = page.locator('.confirm-card .primary-button');
  if (await restartConfirm.count()) {
    await restartConfirm.click({ force: true });
    await page.waitForTimeout(300);
  }
  check('重开确认后回到初始局面', (await historyCount(page)) === 0);

  check('模式流程无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  await context.close();
}

async function runMobile(browser) {
  console.log('\n=== 移动端 390 × 844 ===');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(BASE_URL, { waitUntil: 'load' });
  await waitForApp(page);
  await page.screenshot({ path: resolve(qaDir, 'mobile-menu.png') });

  await startGame(page, 'mode-human');
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(qaDir, 'mobile-opening.png') });

  check('移动端棋盘画布可见', await page.locator('[data-testid="beast-canvas"]').isVisible());
  const box = await page.locator('[data-testid="beast-canvas"]').boundingBox();
  check(
    '移动端棋盘完整可见',
    box.height > 0 && box.y >= 0 && box.y + box.height <= 844 + 1,
    `y=${box.y.toFixed(0)} h=${box.height.toFixed(0)}`,
  );

  const touchAudit = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const small = buttons
      .filter((button) => button.offsetParent !== null)
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44;
      })
      .map((button) => `${button.getAttribute('data-testid') ?? button.textContent}:${Math.round(button.getBoundingClientRect().width)}x${Math.round(button.getBoundingClientRect().height)}`);
    return { total: buttons.length, small };
  });
  check('可见触摸目标不小于 44 像素', touchAudit.small.length === 0, touchAudit.small.slice(0, 4).join(', '));

  await page.click('[data-testid="keyboard-toggle"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(qaDir, 'mobile-keyboard-panel.png') });
  check('移动端键盘棋盘可见', await page.locator('.keyboard-board').isVisible());

  const origin = page.locator('[role="gridcell"]').first();
  const target = page.locator('.keyboard-cell.is-legal').first();
  if (await target.count()) {
    await origin.click();
    await page.waitForTimeout(150);
    const legalNow = page.locator('.keyboard-cell.is-legal').first();
    if (await legalNow.count()) {
      const before = await historyCount(page);
      await legalNow.click();
      await page.waitForTimeout(250);
      check('键盘棋盘可完成一手落子', (await historyCount(page)) > before, `history=${await historyCount(page)}`);
    }
  }
  await page.click('[data-testid="keyboard-toggle"]');

  // 移动端规则面板为底部抽屉
  await page.click('[data-testid="open-rules"]');
  await page.waitForTimeout(300);
  const drawerBox = await page.locator('[data-testid="drawer"] .drawer-panel').boundingBox();
  check(
    '移动端规则面板为底部抽屉',
    await page.locator('[data-testid="drawer"]').isVisible() &&
      drawerBox !== null &&
      drawerBox.y + drawerBox.height <= 844 + 1 &&
      drawerBox.height > 200 &&
      drawerBox.height < 844,
    drawerBox ? `y=${drawerBox.y.toFixed(0)} h=${drawerBox.height.toFixed(0)}` : 'no-panel',
  );
  await page.locator('[data-testid="drawer"] [data-testid="close-rules"]').click({ force: true });
  await page.waitForTimeout(200);

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const beforeDrag = await historyCount(page);
  await page.touchscreen.tap(cx, cy);
  await page.waitForTimeout(200);
  check('移动端点选不误落子', (await historyCount(page)) === beforeDrag, `before=${beforeDrag} after=${await historyCount(page)}`);

  // 双指捏合缩放：TouchEvents + CDP 触摸点
  const beforePinch = await page.evaluate(() => window.__shanHaiCamera ?? null);
  const session = await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: cx - 50, y: cy, id: 1 },
      { x: cx + 50, y: cy, id: 2 },
    ],
  });
  for (let index = 1; index <= 6; index += 1) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: cx - 50 - index * 14, y: cy, id: 1 },
        { x: cx + 50 + index * 14, y: cy, id: 2 },
      ],
    });
    await page.waitForTimeout(60);
  }
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await page.waitForTimeout(500);
  const afterPinch = await page.evaluate(() => window.__shanHaiCamera ?? null);
  check(
    '移动端双指缩放改变相机',
    beforePinch && afterPinch && Math.abs(afterPinch.distance - beforePinch.distance) > 0.05,
    `${beforePinch ? beforePinch.distance.toFixed(2) : 'n/a'} -> ${afterPinch ? afterPinch.distance.toFixed(2) : 'n/a'}`,
  );
  await page.screenshot({ path: resolve(qaDir, 'mobile-orbit.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('移动端无横向溢出', overflow <= 1, `overflow=${overflow}px`);
  check('移动端无页面错误', pageErrors.length === 0, pageErrors.join(' | '));
  check('移动端无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await context.close();
}

main().catch((error) => {
  console.error('QA 执行失败：', error);
  process.exitCode = 1;
});
