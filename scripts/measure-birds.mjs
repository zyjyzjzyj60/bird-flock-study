import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BIRDS_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.BIRDS_HEADED !== '1' });
const report = { url: process.env.BIRDS_PAGE_URL || 'http://127.0.0.1:5173/birds/', headed: process.env.BIRDS_HEADED === '1', measurements: [] };
try {
  for (const deviceScaleFactor of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1360, height: 980 }, deviceScaleFactor });
    const page = await context.newPage();
    await page.goto(report.url);
    await page.waitForLoadState('networkidle');
    await page.locator('.sky-frame').evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + scrollY - 20));
    await page.waitForTimeout(2500);
    const measurement = await page.evaluate(async () => {
      const intervals = [];
      let last = 0, start = 0;
      await new Promise(resolve => {
        function frame(now) {
          if (last) intervals.push(now - last);
          else start = now;
          last = now;
          if (now - start < 6000) requestAnimationFrame(frame);
          else resolve();
        }
        requestAnimationFrame(frame);
      });
      const sorted = [...intervals].sort((a, b) => a - b);
      const frame = document.querySelector('.sky-frame').getBoundingClientRect();
      return {
        fps: 1000 * intervals.length / intervals.reduce((a, b) => a + b, 0),
        medianFrameMs: sorted[Math.floor(sorted.length * 0.5)],
        p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
        displayedFps: document.querySelector('#fps-value')?.textContent ?? null,
        count: document.querySelector('#bird-count').textContent,
        width: frame.width, height: frame.height,
        canvasCount: document.querySelectorAll('.sky-frame canvas').length,
        pixelRatio: document.querySelector('.sky-frame canvas').width / frame.width,
      };
    });
    report.measurements.push({ deviceScaleFactor, ...measurement });
    await context.close();
  }
} finally {
  await browser.close();
  await mkdir('artifacts', { recursive: true });
  const path = resolve('artifacts', process.env.BIRDS_BENCHMARK_FILE || 'birds-performance.json');
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
