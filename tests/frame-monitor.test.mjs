import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameMonitor } from '../src/birds/frame-monitor.ts';

test('测量高刷新周期，持续掉帧时降低像素密度，恢复后逐步提高', () => {
  const monitor = new FrameMonitor(2);
  let now = 1;
  const run = (count, interval) => {
    for (let i = 0; i < count; i++) { now += interval; monitor.sample(now); }
  };
  run(26, 1000 / 240);
  assert.ok(Math.abs(monitor.refreshRate - 240) < 0.001);
  run(70, 1000 / 60);
  assert.equal(monitor.pixelRatio, 0.75);
  run(240 * 9, 1000 / 240);
  assert.ok(monitor.pixelRatio > 0.75 && monitor.pixelRatio <= 2);
  assert.ok(monitor.fps > 230);
  monitor.reset();
  now += 30000;
  monitor.sample(now);
  assert.equal(monitor.fps, 0);
  assert.ok(monitor.refreshRate > 230);
});

test('低刷新设备以实际刷新周期为基准，质量不超过设备像素密度', () => {
  const monitor = new FrameMonitor(1);
  for (let i = 1; i <= 1000; i++) monitor.sample(i * 1000 / 60);
  assert.ok(Math.abs(monitor.refreshRate - 60) < 0.001);
  assert.equal(monitor.pixelRatio, 1);
});
