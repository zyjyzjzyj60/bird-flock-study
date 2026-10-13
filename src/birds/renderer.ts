import type { Bird, Predator } from './flock';

/** 四块画布共享世界坐标，只重绘视口附近的区域。 */
export class FlockRenderer {
  private tiles: HTMLCanvasElement[];
  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  constructor(private stage: HTMLElement) {
    this.tiles = Array.from({ length: 4 }, (_, index) => {
      const canvas = document.createElement('canvas');
      canvas.className = 'flock-tile';
      canvas.style.top = `${index * 25}%`;
      canvas.setAttribute('aria-hidden', 'true');
      stage.append(canvas);
      return canvas;
    });
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    for (const canvas of this.tiles) {
      const pixelWidth = Math.ceil(width * pixelRatio), pixelHeight = Math.ceil(height / 4 * pixelRatio);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    }
  }

  draw(birds: Bird[], predator: Predator | null, allTiles = false): void {
    const rect = this.stage.getBoundingClientRect();
    const visibleTop = -rect.top - 32, visibleBottom = innerHeight - rect.top + 32;
    const tileHeight = this.height / 4;
    this.tiles.forEach((canvas, index) => {
      const offset = index * tileHeight;
      if (!allTiles && (offset > visibleBottom || offset + tileHeight < visibleTop)) return;
      const ctx = canvas.getContext('2d', { alpha: false })!;
      ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, this.width + 1, tileHeight + 1);
      if (predator && predator.y + predator.radius >= offset && predator.y - predator.radius <= offset + tileHeight) {
        ctx.fillStyle = '#f8717114';
        ctx.strokeStyle = '#f87171a0';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 7]);
        ctx.beginPath();
        ctx.arc(predator.x, predator.y - offset, predator.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#f87171';
        ctx.beginPath();
        ctx.arc(predator.x, predator.y - offset, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fff';
      for (const bird of birds) {
        if (bird.y + 24 < offset || bird.y - 24 > offset + tileHeight) continue;
        const spread = 10.5 + Math.sin(bird.wingPhase) * 4.5;
        ctx.save();
        ctx.translate(bird.x, bird.y - offset);
        ctx.rotate(Math.atan2(bird.vy, bird.vx));
        ctx.scale(bird.size, bird.size);
        // 将身体和双翼合成一次填充，轮廓随速度转向、随相位扇动。
        ctx.beginPath();
        ctx.moveTo(2, -1);
        ctx.bezierCurveTo(-2, -3, -6, -spread * 0.62, -9, -spread);
        ctx.bezierCurveTo(-6, -spread * 0.48, -2, -4, 3, -2);
        ctx.closePath();
        ctx.moveTo(2, 1);
        ctx.bezierCurveTo(-2, 3, -6, spread * 0.62, -9, spread);
        ctx.bezierCurveTo(-6, spread * 0.48, -2, 4, 3, 2);
        ctx.closePath();
        ctx.moveTo(10, 0);
        ctx.quadraticCurveTo(1, -3, -9, -2);
        ctx.lineTo(-13, -4);
        ctx.lineTo(-11, 0);
        ctx.lineTo(-13, 4);
        ctx.lineTo(-9, 2);
        ctx.quadraticCurveTo(1, 3, 10, 0);
        ctx.fill();
        ctx.restore();
      }
    });
  }
}
