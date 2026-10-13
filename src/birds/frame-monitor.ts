/** 短暂测量刷新周期，再以带滞后的分辨率调整控制绘制负载。 */
export class FrameMonitor {
  pixelRatio: number;
  fps = 0;
  refreshRate = 0;
  private maxRatio: number;
  private previousTime = 0;
  private calibration: number[] = [];
  private elapsed = 0;
  private frames = 0;
  private healthyWindows = 0;
  private cooldown = 0;

  constructor(devicePixelRatio: number) {
    this.maxRatio = Math.max(0.75, Math.min(2, devicePixelRatio || 1));
    this.pixelRatio = Math.min(1, this.maxRatio);
  }

  get calibrating(): boolean { return this.refreshRate === 0; }

  reset(): void {
    this.previousTime = 0;
    this.frames = 0;
    this.elapsed = 0;
    this.fps = 0;
    this.healthyWindows = 0;
  }

  sample(now: number): boolean {
    const interval = this.previousTime ? now - this.previousTime : 0;
    this.previousTime = now;
    if (interval <= 0 || interval > 100) return false;
    if (this.calibrating) {
      this.calibration.push(interval);
      if (this.calibration.length === 24) {
        this.calibration.sort((a, b) => a - b);
        this.refreshRate = 1000 / this.calibration[12];
      }
      return false;
    }
    this.frames++;
    this.elapsed += interval;
    if (this.elapsed < 1000) return false;
    this.fps = 1000 * this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    if (this.cooldown > 0) { this.cooldown--; return false; }
    const previousRatio = this.pixelRatio;
    if (this.fps < this.refreshRate * 0.82) {
      this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25);
      this.healthyWindows = 0;
    } else if (this.fps > this.refreshRate * 0.96) {
      if (++this.healthyWindows >= 4) {
        this.pixelRatio = Math.min(this.maxRatio, this.pixelRatio + 0.25);
        this.healthyWindows = 0;
      }
    } else this.healthyWindows = 0;
    if (previousRatio !== this.pixelRatio) this.cooldown = 3;
    return previousRatio !== this.pixelRatio;
  }
}
