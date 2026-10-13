export type Bird = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  wingPhase: number;
  wingRate: number;
};

export type FlockSettings = {
  separation: number;
  alignment: number;
  cohesion: number;
};

export type Predator = { x: number; y: number; radius: number };
export type Bounds = { width: number; height: number };

export const defaultSettings: Readonly<FlockSettings> = {
  separation: 1.8,
  alignment: 1,
  cohesion: 0.8,
};

const separationRadius = 28;
const neighborRadius = 96;
const cruiseSpeed = 270;
const minSpeed = 165;
const maxSpeed = 375;
// 速度三倍时，加速度按九倍缩放，保持同样的避让和回转距离。
const steeringGain = 3;
const maxRuleForce = 990;
const maxTotalForce = 3060;

function limit(x: number, y: number, maximum: number): [number, number] {
  const length = Math.hypot(x, y);
  return length > maximum ? [x * maximum / length, y * maximum / length] : [x, y];
}

function desiredVelocity(x: number, y: number, speed = cruiseSpeed): [number, number] {
  const length = Math.hypot(x, y);
  return length > 0.00001 ? [x * speed / length, y * speed / length] : [0, 0];
}

export function createFlock(width: number, height: number, count: number, random: () => number = Math.random): Bird[] {
  const birds: Bird[] = [];
  for (let index = 0; index < count; index++) {
    const angle = (random() - 0.5) * Math.PI * 1.3;
    const speed = 204 + random() * 126;
    birds.push({
      x: width * (0.2 + random() * 0.6),
      y: height * (0.03 + random() * 0.94),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 0.75 + random() * 0.5,
      wingPhase: random() * Math.PI * 2,
      wingRate: 7 + random() * 3,
    });
  }
  return birds;
}

/** 根据上一帧的全体状态计算局部规则，避免鸟群更新顺序影响结果。 */
export function stepFlock(
  birds: Bird[], bounds: Bounds, settings: FlockSettings, predator: Predator | null, elapsedSeconds: number,
): void {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || birds.length === 0) return;
  const elapsed = Math.min(elapsedSeconds, 0.04);
  const steps = Math.ceil(elapsed / (1 / 120));
  for (let step = 0; step < steps; step++) integrateFlock(birds, bounds, settings, predator, elapsed / steps);
}

function integrateFlock(birds: Bird[], bounds: Bounds, settings: FlockSettings, predator: Predator | null, dt: number): void {
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const edgeMargin = Math.min(90, width * 0.22, height * 0.22);
  const separationWeight = Number.isFinite(settings.separation) ? Math.max(0, settings.separation) : 0;
  const alignmentWeight = Number.isFinite(settings.alignment) ? Math.max(0, settings.alignment) : 0;
  const cohesionWeight = Number.isFinite(settings.cohesion) ? Math.max(0, settings.cohesion) : 0;
  const snapshot = birds.map(({ x, y, vx, vy }) => ({ x, y, vx, vy }));
  const forces: Array<[number, number]> = [];
  const columns = Math.ceil(width / neighborRadius);
  const rows = Math.ceil(height / neighborRadius);
  const grid = new Map<number, number[]>();
  for (let index = 0; index < snapshot.length; index++) {
    const current = snapshot[index];
    const cell = Math.floor(current.y / neighborRadius) * columns + Math.floor(current.x / neighborRadius);
    const entries = grid.get(cell);
    if (entries) entries.push(index);
    else grid.set(cell, [index]);
  }

  for (let index = 0; index < snapshot.length; index++) {
    const bird = snapshot[index];
    let separationX = 0, separationY = 0, closeCount = 0;
    let velocityX = 0, velocityY = 0, centerX = 0, centerY = 0, neighborCount = 0;

    const column = Math.floor(bird.x / neighborRadius), row = Math.floor(bird.y / neighborRadius);
    // 只搜索本格与相邻八格，仍然用实际距离判断是否为邻居。
    for (let cellY = Math.max(0, row - 1); cellY <= Math.min(rows - 1, row + 1); cellY++) {
      for (let cellX = Math.max(0, column - 1); cellX <= Math.min(columns - 1, column + 1); cellX++) {
        const entries = grid.get(cellY * columns + cellX);
        if (!entries) continue;
        for (const otherIndex of entries) {
          if (index === otherIndex) continue;
          const other = snapshot[otherIndex];
          let dx = bird.x - other.x, dy = bird.y - other.y;
          let distanceSquared = dx * dx + dy * dy;
          if (distanceSquared >= neighborRadius * neighborRadius) continue;
          if (distanceSquared < 0.0001) {
            const angle = (Math.min(index, otherIndex) + 1) * 2.399963;
            const direction = index < otherIndex ? -1 : 1;
            dx = Math.cos(angle) * direction;
            dy = Math.sin(angle) * direction;
            distanceSquared = 1;
          }
          const distance = Math.sqrt(distanceSquared);
          neighborCount++;
          velocityX += other.vx;
          velocityY += other.vy;
          centerX += other.x;
          centerY += other.y;
          if (distance < separationRadius) {
            const urgency = (separationRadius - distance) / separationRadius;
            separationX += dx / distance * urgency;
            separationY += dy / distance * urgency;
            closeCount++;
          }
        }
      }
    }

    let forceX = 0, forceY = 0;
    if (closeCount && separationWeight) {
      const [desiredX, desiredY] = desiredVelocity(separationX / closeCount, separationY / closeCount, maxSpeed);
      const [steerX, steerY] = limit((desiredX - bird.vx) * steeringGain, (desiredY - bird.vy) * steeringGain, maxRuleForce);
      forceX += steerX * separationWeight;
      forceY += steerY * separationWeight;
    }
    if (neighborCount && alignmentWeight) {
      // 对齐采用邻居的平均速度向量，同时匹配方向和速度大小。
      const [steerX, steerY] = limit((velocityX / neighborCount - bird.vx) * steeringGain, (velocityY / neighborCount - bird.vy) * steeringGain, maxRuleForce);
      forceX += steerX * alignmentWeight;
      forceY += steerY * alignmentWeight;
    }
    if (neighborCount && cohesionWeight) {
      const [desiredX, desiredY] = desiredVelocity(centerX / neighborCount - bird.x, centerY / neighborCount - bird.y);
      const [steerX, steerY] = limit((desiredX - bird.vx) * steeringGain, (desiredY - bird.vy) * steeringGain, maxRuleForce);
      forceX += steerX * cohesionWeight;
      forceY += steerY * cohesionWeight;
    }

    if (predator && predator.radius > 0) {
      let dx = bird.x - predator.x, dy = bird.y - predator.y;
      let distance = Math.hypot(dx, dy);
      if (distance < predator.radius) {
        if (distance < 0.001) {
          const angle = index * 2.399963;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const urgency = 1 - distance / predator.radius;
        const [desiredX, desiredY] = desiredVelocity(dx, dy, maxSpeed);
        const [steerX, steerY] = limit((desiredX - bird.vx) * steeringGain, (desiredY - bird.vy) * steeringGain, 1800);
        forceX += steerX * (1.5 + urgency * 2.5) * urgency;
        forceY += steerY * (1.5 + urgency * 2.5) * urgency;
      }
    }

    // 以短时预测位置提前回转，切向分量避免正对边缘时因最低速度而僵直。
    const predictedX = bird.x + bird.vx * 0.35, predictedY = bird.y + bird.vy * 0.35;
    const tangentX = Math.sign(bird.vx) || (index % 2 ? 1 : -1);
    const tangentY = Math.sign(bird.vy) || (index % 2 ? 1 : -1);
    const left = Math.max(0, 1 - predictedX / edgeMargin);
    const right = Math.max(0, 1 - (width - predictedX) / edgeMargin);
    const top = Math.max(0, 1 - predictedY / edgeMargin);
    const bottom = Math.max(0, 1 - (height - predictedY) / edgeMargin);
    forceX += 2340 * (left - right) + 1287 * (top + bottom) * tangentX;
    forceY += 2340 * (top - bottom) + 1287 * (left + right) * tangentY;
    forces.push(limit(forceX, forceY, maxTotalForce));
  }

  for (let index = 0; index < birds.length; index++) {
    const bird = birds[index];
    const [forceX, forceY] = forces[index];
    bird.vx += forceX * dt;
    bird.vy += forceY * dt;
    let speed = Math.hypot(bird.vx, bird.vy);
    if (speed < 0.0001) {
      const angle = index * 2.399963;
      bird.vx = Math.cos(angle) * minSpeed;
      bird.vy = Math.sin(angle) * minSpeed;
    } else if (speed < minSpeed || speed > maxSpeed) {
      const targetSpeed = Math.min(maxSpeed, Math.max(minSpeed, speed));
      bird.vx *= targetSpeed / speed;
      bird.vy *= targetSpeed / speed;
    }
    bird.x += bird.vx * dt;
    bird.y += bird.vy * dt;
    if (bird.x < 6) { bird.x = 6; bird.vx = Math.abs(bird.vx); }
    if (bird.x > width - 6) { bird.x = width - 6; bird.vx = -Math.abs(bird.vx); }
    if (bird.y < 6) { bird.y = 6; bird.vy = Math.abs(bird.vy); }
    if (bird.y > height - 6) { bird.y = height - 6; bird.vy = -Math.abs(bird.vy); }
    bird.wingPhase = (bird.wingPhase + bird.wingRate * dt) % (Math.PI * 2);
    speed = Math.hypot(bird.vx, bird.vy);
    if (!Number.isFinite(speed)) throw new Error('鸟群运动出现无效数值');
  }
}
