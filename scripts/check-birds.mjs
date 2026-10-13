import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BIRDS_PLAYWRIGHT || process.env.GESTURE_TRIGGER_PLAYWRIGHT || 'playwright');
const baseURL = process.env.BIRDS_URL || 'http://127.0.0.1:5173';
const pageURL = process.env.BIRDS_PAGE_URL || `${baseURL}/birds/`;
const standalone = process.env.BIRDS_STANDALONE === '1';
const artifacts = resolve('artifacts');
await mkdir(artifacts, { recursive: true });
const report = { status: 'running', url: pageURL, checks: [], pageErrors: [], externalRequests: [], cameraCalls: 0 };
const browser = await chromium.launch({ channel: 'chrome', headless: true });

function observe(page) {
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.pageErrors.push(message.text()); });
  page.on('request', request => {
    const url = request.url();
    if (/^https?:/.test(url) && new URL(url).origin !== new URL(pageURL).origin) report.externalRequests.push(url);
  });
}
async function prepare(context) {
  await context.addInitScript(() => {
    window.__cameraCalls = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      window.__cameraCalls++;
      throw new Error('鸟群页面不应请求摄像头');
    };
  });
  const page = await context.newPage();
  observe(page);
  await page.goto(pageURL);
  await page.waitForLoadState('networkidle');
  return page;
}
async function check(name, action) {
  await action();
  report.checks.push({ name, status: 'passed' });
  console.log(`PASS ${name}`);
}
const snapshot = (page, tile = 0) => page.locator('.flock-tile').nth(tile).evaluate(canvas => canvas.toDataURL());
async function scrollToTile(page, tile) {
  await page.locator('.flock-tile').nth(tile).evaluate(canvas => window.scrollTo(0, canvas.getBoundingClientRect().top + scrollY - 20));
  await page.waitForTimeout(80);
}
async function redAt(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const canvas = [...document.querySelectorAll('.flock-tile')].find(canvas => {
      const rect = canvas.getBoundingClientRect();
      return y >= rect.top && y < rect.bottom;
    });
    const rect = canvas.getBoundingClientRect();
    const px = (x - rect.left) * canvas.width / rect.width;
    const py = (y - rect.top) * canvas.height / rect.height;
    const data = canvas.getContext('2d').getImageData(Math.round(px) - 3, Math.round(py) - 3, 7, 7).data;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 160 && data[i] > data[i + 1] * 1.5) return true;
    return false;
  }, { x, y });
}
try {
  const desktop = await browser.newContext({ viewport: { width: 1360, height: 980 } });
  const page = await prepare(desktop);
  await check('桌面自动群飞：330 只鸟、四倍高度、实时 FPS', async () => {
    assert.equal(await page.title(), '向风成群 · 鸟群实验');
    assert.match(await page.locator('#bird-count').innerText(), /330 只飞鸟/);
    assert.equal(await page.locator('.flock-tile').count(), 4);
    assert.equal(await page.locator('#flock-stage').evaluate(element => element.getBoundingClientRect().height), 2640);
    await scrollToTile(page, 0);
    await page.waitForFunction(() => /^\d+ FPS$/.test(document.querySelector('#fps-value').textContent));
    const first = await snapshot(page);
    await page.waitForTimeout(160);
    assert.notEqual(await snapshot(page), first);
  });
  await check('画布为纯黑背景和白色飞鸟', async () => {
    const colors = await page.locator('.flock-tile').first().evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let black = 0, white = 0, colored = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0) black++;
        if (pixels[i] === 255 && pixels[i + 1] === 255 && pixels[i + 2] === 255) white++;
        if (pixels[i] !== pixels[i + 1] || pixels[i] !== pixels[i + 2]) colored++;
      }
      return { black, white, colored, total: pixels.length / 4 };
    });
    assert.ok(colors.black / colors.total > 0.9);
    assert.ok(colors.white > 100);
    assert.equal(colors.colored, 0);
  });
  await page.screenshot({ path: resolve(artifacts, 'birds-flight.png') });
  await check('滚动经过四块连续画布，每个区域都持续更新', async () => {
    for (let tile = 0; tile < 4; tile++) {
      await scrollToTile(page, tile);
      const first = await snapshot(page, tile);
      await page.waitForTimeout(120);
      assert.notEqual(await snapshot(page, tile), first);
    }
  });
  await check('鼠标跨画布接缝时危险圈坐标正确，离开后消失', async () => {
    await page.locator('.flock-tile').nth(1).evaluate(canvas => window.scrollTo(0, canvas.getBoundingClientRect().top + scrollY - 400));
    const box = await page.locator('.flock-tile').nth(1).boundingBox();
    const x = box.x + box.width / 2;
    for (const y of [box.y - 15, box.y + 15]) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(60);
      assert.match(await page.locator('#simulation-status').innerText(), /天敌进入/);
      assert.equal(await redAt(page, x, y), true);
    }
    await page.mouse.move(5, 5);
    assert.doesNotMatch(await page.locator('#simulation-status').innerText(), /天敌进入/);
  });
  await check('三项滑杆、暂停、重置和继续播放有效', async () => {
    await page.locator('#separation-range').fill('0');
    await page.locator('#alignment-range').fill('2.5');
    await page.locator('#cohesion-range').fill('0');
    assert.equal(await page.locator('#alignment-value').inputValue(), '2.5');
    await page.locator('#play-button').click();
    await page.mouse.move(5, 5);
    assert.equal(await page.locator('#play-button').innerText(), '播放');
    assert.equal(await page.locator('#fps-value').innerText(), '已暂停');
    const paused = await snapshot(page);
    await page.waitForTimeout(150);
    assert.equal(await snapshot(page), paused);
    await page.locator('#reset-button').click();
    assert.equal(await page.locator('#separation-range').inputValue(), '1.8');
    assert.equal(await page.locator('#alignment-range').inputValue(), '1');
    assert.equal(await page.locator('#cohesion-range').inputValue(), '0.8');
    assert.notEqual(await snapshot(page), paused);
    await page.locator('#play-button').click();
    assert.equal(await page.locator('#play-button').innerText(), '暂停');
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(artifacts, 'birds-desktop.png') });
  report.cameraCalls += await page.evaluate(() => window.__cameraCalls);
  if (!standalone) await check('原首页仍可打开', async () => {
    const home = await desktop.newPage();
    await home.goto(`${baseURL}/`);
    await home.waitForLoadState('networkidle');
    assert.equal(await home.locator('#experience-flow').count(), 1);
    assert.equal(await home.locator('#experience-trigger').count(), 1);
    await home.close();
  });
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const phone = await prepare(mobile);
  await check('手机 210 只鸟、四倍长画布且无横向溢出', async () => {
    assert.match(await phone.locator('#bird-count').innerText(), /210 只飞鸟/);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const height = await phone.locator('#flock-stage').evaluate(element => element.getBoundingClientRect().height);
    assert.ok(Math.abs(height - 844 * 2.32) < 1);
  });
  await phone.screenshot({ path: resolve(artifacts, 'birds-mobile.png') });
  const session = await mobile.newCDPSession(phone);
  await check('触屏拖动下方画布的危险圈，松手和取消都会清除', async () => {
    await scrollToTile(phone, 2);
    const box = await phone.locator('.flock-tile').nth(2).boundingBox();
    const x = box.x + box.width / 2, y = box.y + 200;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 25, y: y + 18, id: 1 }] });
    await phone.waitForTimeout(80);
    assert.match(await phone.locator('#simulation-status').innerText(), /天敌进入/);
    assert.equal(await redAt(phone, x + 25, y + 18), true);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.doesNotMatch(await phone.locator('#simulation-status').innerText(), /天敌进入/);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    assert.doesNotMatch(await phone.locator('#simulation-status').innerText(), /天敌进入/);
  });
  await check('手机从画布两侧留白滑动能浏览长页面', async () => {
    const before = await phone.evaluate(() => scrollY);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 6, y: 650, id: 1 }] });
    for (const y of [570, 480, 390, 300]) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 6, y, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await phone.waitForTimeout(150);
    assert.ok(await phone.evaluate(() => scrollY) > before);
  });
  await session.detach();
  report.cameraCalls += await phone.evaluate(() => window.__cameraCalls);
  await mobile.close();

  const reduced = await browser.newContext({ reducedMotion: 'reduce' });
  const reducedPage = await prepare(reduced);
  await check('减少动态效果初始暂停，可手动播放并响应系统偏好变化', async () => {
    assert.equal(await reducedPage.locator('#play-button').innerText(), '播放');
    assert.match(await reducedPage.locator('#simulation-status').innerText(), /减少动态效果/);
    await reducedPage.locator('#play-button').click();
    assert.equal(await reducedPage.locator('#play-button').innerText(), '暂停');
    await reducedPage.emulateMedia({ reducedMotion: 'no-preference' });
    await reducedPage.waitForTimeout(100);
    await reducedPage.emulateMedia({ reducedMotion: 'reduce' });
    await reducedPage.waitForFunction(() => document.querySelector('#play-button').textContent === '播放');
  });
  report.cameraCalls += await reducedPage.evaluate(() => window.__cameraCalls);
  await reduced.close();
  await check('无摄像头请求、外部依赖请求和控制台错误', async () => {
    assert.equal(report.cameraCalls, 0);
    assert.deepEqual(report.externalRequests, []);
    assert.deepEqual(report.pageErrors, []);
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await browser.close();
  await writeFile(resolve(artifacts, process.env.BIRDS_REPORT_FILE || 'birds-browser-checks.json'), JSON.stringify(report, null, 2), 'utf8');
}
