import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlock, stepFlock } from '../src/birds/flock.ts';

const bounds = { width: 1200, height: 2640 };
const bird = (x, y, vx, vy) => ({ x, y, vx, vy, size: 1, wingPhase: 0, wingRate: 8 });
const settings = (separation = 0, alignment = 0, cohesion = 0) => ({ separation, alignment, cohesion });

test('分离让距离过近的鸟向相反方向避让', () => {
  const birds = [bird(300, 250, 0, 240), bird(315, 250, 0, 240)];
  stepFlock(birds, bounds, settings(1.8), null, 1 / 30);
  assert.ok(birds[0].vx < 0);
  assert.ok(birds[1].vx > 0);
});

test('对齐让邻居的方向与速度相互靠近', () => {
  const turning = [bird(300, 250, 270, 0), bird(345, 250, 0, 270)];
  stepFlock(turning, bounds, settings(0, 2), null, 1 / 30);
  assert.ok(turning[0].vy > 0);
  assert.ok(turning[1].vx > 0);

  const matchingSpeed = [bird(300, 250, 360, 0), bird(345, 250, 180, 0)];
  const before = matchingSpeed[0].vx - matchingSpeed[1].vx;
  stepFlock(matchingSpeed, bounds, settings(0, 2), null, 1 / 30);
  assert.ok(matchingSpeed[0].vx - matchingSpeed[1].vx < before);
  assert.ok(matchingSpeed[0].vx < 360 && matchingSpeed[1].vx > 180);
});

test('聚合让鸟朝附近群体中心转向', () => {
  const birds = [bird(300, 250, 0, 270), bird(350, 250, 0, 270)];
  stepFlock(birds, bounds, settings(0, 0, 0.8), null, 1 / 30);
  assert.ok(birds[0].vx > 0);
  assert.ok(birds[1].vx < 0);
});

test('天敌使作用范围内的鸟逃离，范围外的鸟不受影响', () => {
  const near = bird(300, 250, 0, -270);
  const far = bird(600, 250, 0, -270);
  stepFlock([near, far], bounds, settings(), { x: 315, y: 250, radius: 100 }, 1 / 30);
  assert.ok(near.vx < 0);
  assert.equal(far.vx, 0);
});

test('长期飞行与较长帧间隔仍保持有限数值、速度和画布边界', () => {
  let seed = 17;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
  const birds = createFlock(bounds.width, bounds.height, 330, random);
  for (let frame = 0; frame < 600; frame++) {
    const predator = frame < 300 ? { x: 410, y: 240, radius: 140 } : null;
    stepFlock(birds, bounds, settings(1.8, 1, 0.8), predator, frame % 37 === 0 ? 0.5 : 1 / 60);
  }
  for (const current of birds) {
    assert.ok(Number.isFinite(current.x) && Number.isFinite(current.y));
    assert.ok(Number.isFinite(current.vx) && Number.isFinite(current.vy));
    assert.ok(current.x >= 6 && current.x <= bounds.width - 6);
    assert.ok(current.y >= 6 && current.y <= bounds.height - 6);
    const speed = Math.hypot(current.vx, current.vy);
    assert.ok(speed >= 165 - 1e-8 && speed <= 375 + 1e-8);
  }
});

test('暂停时传入零时间不会移动鸟群', () => {
  const birds = [bird(300, 250, 240, 0)];
  const before = structuredClone(birds);
  stepFlock(birds, bounds, settings(1.8, 1, 0.8), null, 0);
  assert.deepEqual(birds, before);
});

test('跨网格的水平、垂直、对角邻居仍能分离，半径外不受聚合影响', () => {
  for (const [x, y] of [[289, 286], [286, 289], [289, 289]]) {
    const flock = [bird(286, 286, 270, 0), bird(x, y, 270, 0)];
    const previousDistance = Math.hypot(x - 286, y - 286);
    stepFlock(flock, bounds, settings(1.8), null, 1 / 120);
    assert.ok(Math.hypot(flock[0].x - flock[1].x, flock[0].y - flock[1].y) > previousDistance);
  }
  const flock = [bird(300, 400, 0, 270), bird(405, 400, 0, 270)];
  stepFlock(flock, bounds, settings(0, 0, 2), null, 1 / 120);
  assert.equal(flock[0].vx, 0);
  assert.equal(flock[1].vx, 0);
});

test('重叠个体能够分开，高速正向接近边缘时提前转向', () => {
  const overlapping = [bird(600, 900, 270, 0), bird(600, 900, 270, 0)];
  for (let i = 0; i < 30; i++) stepFlock(overlapping, bounds, settings(1.8), null, 1 / 120);
  assert.ok(Math.hypot(overlapping[0].x - overlapping[1].x, overlapping[0].y - overlapping[1].y) > 10);
  const approaching = [bird(170, 900, -375, 0)];
  let smallestX = approaching[0].x;
  for (let i = 0; i < 120; i++) {
    stepFlock(approaching, bounds, settings(), null, 1 / 120);
    smallestX = Math.min(smallestX, approaching[0].x);
  }
  assert.ok(smallestX > 6, `应在夹紧边界前回转，实际 ${smallestX}`);
  assert.ok(approaching[0].vx > 0);
});

test('60 Hz 与 240 Hz 的单位时间飞行距离一致，初始鸟群遍布四倍高度', () => {
  for (const refreshRate of [60, 240]) {
    const flock = [bird(300, 900, 270, 0)];
    for (let i = 0; i < refreshRate; i++) stepFlock(flock, bounds, settings(), null, 1 / refreshRate);
    assert.ok(Math.abs(flock[0].x - 570) < 1e-7);
  }
  let seed = 17;
  const flock = createFlock(1200, 2640, 330, () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000));
  for (let quarter = 0; quarter < 4; quarter++) {
    assert.ok(flock.some(current => Math.floor(current.y / 660) === quarter));
  }
  assert.ok(flock.every(current => Math.hypot(current.vx, current.vy) >= 204 && Math.hypot(current.vx, current.vy) <= 330));
});

test('210 只鸟在窄屏和持续天敌影响下保持数值与速度稳定', () => {
  const mobileBounds = { width: 352, height: 1958 };
  const flock = createFlock(mobileBounds.width, mobileBounds.height, 210);
  for (let i = 0; i < 600; i++) stepFlock(flock, mobileBounds, settings(2.5, 2.5, 2.5), { x: 176, y: 1000, radius: 90 }, 1 / 60);
  for (const current of flock) {
    assert.ok(Number.isFinite(current.x + current.y + current.vx + current.vy));
    assert.ok(current.x >= 6 && current.x <= mobileBounds.width - 6);
    assert.ok(current.y >= 6 && current.y <= mobileBounds.height - 6);
    assert.ok(Math.hypot(current.vx, current.vy) >= 165 - 1e-8 && Math.hypot(current.vx, current.vy) <= 375 + 1e-8);
  }
});
