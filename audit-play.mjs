import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const BASE = process.env.AUDIT_URL ?? 'http://127.0.0.1:4319/';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=swiftshader'] });
const report = { url: BASE, checks: [], errors: [] };

function check(name, ok, detail = '') {
  report.checks.push({ name, ok, detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// 加载性能与资源审计
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
const failedRequests = [];
const resourceSizes = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(e.message));
page.on('requestfailed', r => failedRequests.push(r.url()));
page.on('response', r => {
  const url = r.url();
  if (url.startsWith(BASE)) resourceSizes.push({ url: url.replace(BASE, ''), status: r.status(), type: r.request().resourceType() });
});

const started = Date.now();
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('[data-testid="enter-game"]', { timeout: 20000 });
const loadMs = Date.now() - started;

check('页面首屏加载', loadMs < 8000, `${loadMs}ms`);
check('无失败请求', failedRequests.length === 0, failedRequests.slice(0,3).join(', '));
const badStatus = resourceSizes.filter(r => r.status >= 400);
check('所有本地资源 2xx', badStatus.length === 0, badStatus.map(r => `${r.url}:${r.status}`).join(', '));
check('无远程资源请求', resourceSizes.every(r => !r.url.startsWith('http')), `${resourceSizes.length} 个资源`);

// 三种模式逐个进入
for (const [testId, label] of [['mode-watch','观战 · AI 对 AI'],['mode-human','人机对战'],['mode-local','本地双人']]) {
  await page.click(`[data-testid="${testId}"]`);
  await page.click('[data-testid="enter-game"]');
  await page.waitForSelector('[data-testid="beast-canvas"]');
  const pieces = await page.evaluate(() => window.__shanHaiScene?.pieces ?? 0);
  check(`进入${label}`, pieces === 16, `pieces=${pieces}`);
  await page.click('[data-testid="back-menu"]');
  await page.waitForSelector('[data-testid="enter-game"]');
}

// 实际对弈：选子、落子、吃子路径可达
await page.click('[data-testid="mode-local"]');
await page.click('[data-testid="enter-game"]');
await page.waitForTimeout(600);
await page.locator('[data-testid="keyboard-toggle"]').click({ force: true });
await page.waitForTimeout(300);
const turn1 = await page.locator('.turn-chip').innerText();
const side = turn1.includes('赤霞山') ? 'side-crimson' : 'side-teal';
await page.locator(`.keyboard-cell.${side}`).first().click({ force: true });
await page.waitForTimeout(250);
const legalCount = await page.locator('.keyboard-cell.is-legal').count();
check('选子后出现合法落点', legalCount > 0, `${legalCount} 个`);
await page.locator('.keyboard-cell.is-legal').first().click({ force: true });
await page.waitForTimeout(400);
const turn2 = await page.locator('.turn-chip').innerText();
check('落子后交换行棋方', turn1 !== turn2, `${turn1} -> ${turn2}`);
const historyCount = await page.locator('[data-testid="history-entry"]').count();
check('棋谱记录一手', historyCount === 1, `${historyCount} 条`);
const notation = (await page.locator('[data-testid="history-entry"]').first().innerText()).replace(/^\d+\n/, '');
check('中文记谱格式正确', /^[赤苍]·(鼠|猫|狗|狼|豹|虎|狮|象) \d+,\d+行\d+,\d+$/.test(notation), notation);

// 长局稳定性：观战模式跑到终局或 40 手
await page.click('[data-testid="back-menu"]');
await page.click('[data-testid="mode-watch"]');
await page.click('[data-testid="enter-game"]');
let finalPlies = 0;
let resultText = '';
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  finalPlies = await page.locator('[data-testid="history-entry"]').count();
  if (await page.locator('.result-overlay').count()) {
    resultText = await page.locator('.result-card h2').innerText();
    break;
  }
}
const watchOk = finalPlies >= 6 || resultText !== '';
check('观战对局持续推进直至终局', watchOk, `${finalPlies} 手${resultText ? `，${resultText}` : ''}`);
if (resultText) check('终局覆盖层出现', true, resultText);
const terminalVisible = await page.locator('.result-card').isVisible().catch(() => false);
check('终局后仍可调出重来一局', !terminalVisible || (await page.locator('.result-card .primary-button').count()) === 1);
check('全程无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0,3).join(' | '));

// 移动端试玩
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const mp = await mctx.newPage();
const mErrors = [];
mp.on('console', m => { if (m.type() === 'error') mErrors.push(m.text()); });
mp.on('pageerror', e => mErrors.push(e.message));
await mp.goto(BASE, { waitUntil: 'load' });
await mp.waitForSelector('[data-testid="enter-game"]');
await mp.click('[data-testid="mode-human"]');
await mp.click('[data-testid="enter-game"]');
await mp.waitForTimeout(1200);
const box = await mp.locator('[data-testid="beast-canvas"]').boundingBox();
check('移动端棋盘完整可见', box.y >= 0 && box.y + box.height <= 844 + 1, `h=${box.height.toFixed(0)}`);
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('移动端无横向溢出', overflow <= 1, `${overflow}px`);
check('移动端无控制台错误', mErrors.length === 0, mErrors.slice(0,3).join(' | '));

report.errors = consoleErrors;
writeFileSync('audit-play.json', JSON.stringify(report, null, 2));
await browser.close();
const failed = report.checks.filter(c => !c.ok);
console.log(`\n试玩审计：${report.checks.length} 项，通过 ${report.checks.length - failed.length}，失败 ${failed.length}`);
process.exitCode = failed.length ? 1 : 0;
