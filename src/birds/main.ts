import './style.css';
import { createFlock, defaultSettings, stepFlock, type Bird, type FlockSettings, type Predator } from './flock';

import { FlockRenderer } from './renderer';
import { FrameMonitor } from './frame-monitor';

const stage = document.querySelector<HTMLElement>('#flock-stage')!;
const renderer = new FlockRenderer(stage);
let monitor = new FrameMonitor(window.devicePixelRatio);
let deviceRatio = window.devicePixelRatio;
const fpsValue = document.querySelector<HTMLElement>('#fps-value')!;
const playButton = document.querySelector<HTMLButtonElement>('#play-button')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset-button')!;
const status = document.querySelector<HTMLElement>('#simulation-status')!;
const birdCount = document.querySelector<HTMLElement>('#bird-count')!;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const settings: FlockSettings = { ...defaultSettings };
const sliders = {
  separation: document.querySelector<HTMLInputElement>('#separation-range')!,
  alignment: document.querySelector<HTMLInputElement>('#alignment-range')!,
  cohesion: document.querySelector<HTMLInputElement>('#cohesion-range')!,
};
const outputs = {
  separation: document.querySelector<HTMLOutputElement>('#separation-value')!,
  alignment: document.querySelector<HTMLOutputElement>('#alignment-value')!,
  cohesion: document.querySelector<HTMLOutputElement>('#cohesion-value')!,
};

let width = 1, height = 1;
let birds: Bird[] = [];
let predator: Predator | null = null;
let activeTouch: number | null = null;
let playing = !reducedMotion.matches;
let animation = 0, lastFrame = 0;

function updateStatus(): void {
  playButton.textContent = playing ? '暂停' : '播放';
  playButton.setAttribute('aria-pressed', String(!playing));
  status.textContent = playing
    ? predator ? '天敌进入天空 · 鸟群正在避让。' : '鸟群正在飞行 · 鼠标进入天空可模拟天敌，触屏请按住拖动。'
    : reducedMotion.matches ? '鸟群已暂停 · 当前系统启用了减少动态效果，可点击播放。' : '鸟群已暂停 · 点击播放继续观察。';
}

function draw(allTiles = false): void { renderer.draw(birds, predator, allTiles); }

function desiredCount(): number { return width < 640 ? 210 : 330; }

function resize(): void {
  const nextWidth = Math.max(1, stage.clientWidth), nextHeight = Math.max(1, stage.clientHeight);
  const previousWidth = width, previousHeight = height;
  width = nextWidth;
  height = nextHeight;
  if (deviceRatio !== window.devicePixelRatio) {
    deviceRatio = window.devicePixelRatio;
    monitor = new FrameMonitor(deviceRatio);
  }
  renderer.resize(width, height, monitor.pixelRatio);
  if (birds.length !== desiredCount()) birds = createFlock(width, height, desiredCount());
  else {
    for (const bird of birds) {
      bird.x *= width / previousWidth;
      bird.y *= height / previousHeight;
    }
  }
  if (predator) {
    predator.x *= width / previousWidth;
    predator.y *= height / previousHeight;
    predator.radius = Math.min(140, Math.max(90, width * 0.25));
  }
  birdCount.textContent = `${birds.length} 只飞鸟`;
  draw(true);
}

function tick(now: number): void {
  animation = 0;
  if (!playing || document.hidden) return;
  const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.04) : 0;
  lastFrame = now;
  if (monitor.sample(now)) renderer.resize(width, height, monitor.pixelRatio);
  const fpsText = monitor.fps ? `${Math.round(monitor.fps)} FPS` : '— FPS';
  if (fpsValue.textContent !== fpsText) fpsValue.textContent = fpsText;
  // 初始只绘制静态画面，短暂测量屏幕刷新周期，避免把负载误认为屏幕上限。
  if (monitor.calibrating) {
    animation = requestAnimationFrame(tick);
    return;
  }
  stepFlock(birds, { width, height }, settings, predator, dt);
  draw();
  animation = requestAnimationFrame(tick);
}

function setPlaying(next: boolean): void {
  playing = next;
  if (animation) cancelAnimationFrame(animation);
  animation = 0;
  lastFrame = 0;
  monitor.reset();
  fpsValue.textContent = playing ? '— FPS' : '已暂停';
  updateStatus();
  if (playing && !document.hidden) animation = requestAnimationFrame(tick);
  else draw(true);
}

function setPredator(event: PointerEvent): void {
  const rect = stage.getBoundingClientRect();
  predator = {
    x: Math.min(width, Math.max(0, event.clientX - rect.left - stage.clientLeft)),
    y: Math.min(height, Math.max(0, event.clientY - rect.top - stage.clientTop)),
    radius: Math.min(140, Math.max(90, width * 0.25)),
  };
  updateStatus();
  if (!playing) draw(true);
}

function clearPredator(): void {
  predator = null;
  updateStatus();
  if (!playing) draw(true);
}

stage.addEventListener('pointerenter', event => {
  if (event.pointerType === 'mouse') setPredator(event);
});
stage.addEventListener('pointermove', event => {
  if (event.pointerType === 'mouse' || event.pointerId === activeTouch) setPredator(event);
});
stage.addEventListener('pointerleave', event => {
  if (event.pointerType === 'mouse') clearPredator();
});
stage.addEventListener('pointerdown', event => {
  if (event.pointerType === 'mouse' || !event.isPrimary) return;
  activeTouch = event.pointerId;
  stage.setPointerCapture(event.pointerId);
  setPredator(event);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  stage.addEventListener(name, event => {
    if (event.pointerId !== activeTouch) return;
    activeTouch = null;
    clearPredator();
  });
}

for (const name of Object.keys(sliders) as Array<keyof FlockSettings>) {
  sliders[name].addEventListener('input', () => {
    settings[name] = Number(sliders[name].value);
    outputs[name].value = settings[name].toFixed(1);
  });
}
playButton.addEventListener('click', () => setPlaying(!playing));
resetButton.addEventListener('click', () => {
  for (const name of Object.keys(sliders) as Array<keyof FlockSettings>) {
    settings[name] = defaultSettings[name];
    sliders[name].value = String(defaultSettings[name]);
    outputs[name].value = defaultSettings[name].toFixed(1);
  }
  birds = createFlock(width, height, desiredCount());
  clearPredator();
  draw(true);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (animation) cancelAnimationFrame(animation);
    animation = 0;
    lastFrame = 0;
    monitor.reset();
    fpsValue.textContent = '— FPS';
    clearPredator();
  } else if (playing && !animation) animation = requestAnimationFrame(tick);
});
reducedMotion.addEventListener('change', event => { if (event.matches) setPlaying(false); });
window.addEventListener('scroll', () => {
  if (predator && activeTouch === null) clearPredator();
  if (!playing) draw(true);
}, { passive: true });
window.addEventListener('blur', clearPredator);
new ResizeObserver(resize).observe(stage);
resize();
updateStatus();
fpsValue.textContent = playing ? '— FPS' : '已暂停';
if (playing) animation = requestAnimationFrame(tick);
