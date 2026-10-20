import { describe, expect, it } from 'vitest';
import {
  computeRootTransform,
  inverseRotatePoint,
  normalizeAngle,
  pointInRotatedRect,
  pointerAngle,
  rotatePointAround,
  rotatedRectBounds,
  rotatedRectCorners,
  rotatedRectIntersectsRect,
  snapAngle,
  ROTATE_STEP,
} from '../platform/rectEditor/rotateMath';

/** 旋转数学（docs/05 §8；resizeMath/alignOps 同款不变量 + 幂等纪律） */
const PI = Math.PI;
const closeTo = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) < eps;

describe('normalizeAngle', () => {
  it('归一到 [0, 2π)：负角/超一整圈/恰 2π', () => {
    expect(closeTo(normalizeAngle(-PI / 2), (3 * PI) / 2)).toBe(true);
    expect(closeTo(normalizeAngle(2 * PI + 0.5), 0.5)).toBe(true);
    expect(closeTo(normalizeAngle(2 * PI), 0)).toBe(true);
    expect(closeTo(normalizeAngle(0), 0)).toBe(true);
  });
});

describe('rotatePointAround / inverseRotatePoint', () => {
  it('90° 顺时针特值（pixi y 向下）：(1,0) 绕原点 → (0,1)', () => {
    const out = rotatePointAround({ x: 1, y: 0 }, { x: 0, y: 0 }, PI / 2);
    expect(closeTo(out.x, 0, 1e-12)).toBe(true);
    expect(closeTo(out.y, 1, 1e-12)).toBe(true);
  });

  it('正逆互逆（任意角随机点往返）', () => {
    for (const theta of [0.3, -1.2, 2.7, PI, PI / 4]) {
      const p = { x: 137.5, y: -42.25 };
      const c = { x: 10, y: 20 };
      const round = inverseRotatePoint(rotatePointAround(p, c, theta), c, theta);
      expect(closeTo(round.x, p.x, 1e-9)).toBe(true);
      expect(closeTo(round.y, p.y, 1e-9)).toBe(true);
    }
  });

  it('幂等：同一输入两次调用结果相等', () => {
    const p = { x: 5, y: 6 };
    const c = { x: 1, y: 1 };
    expect(rotatePointAround(p, c, 0.7)).toEqual(rotatePointAround(p, c, 0.7));
  });
});

describe('pointInRotatedRect', () => {
  const rect = { x: 100, y: 100, width: 80, height: 40 };
  it('θ=0 与轴对齐判定一致（边界含）', () => {
    expect(pointInRotatedRect({ x: 100, y: 100 }, rect, 0)).toBe(true);
    expect(pointInRotatedRect({ x: 180, y: 140 }, rect, 0)).toBe(true);
    expect(pointInRotatedRect({ x: 99.9, y: 120 }, rect, 0)).toBe(false);
  });
  it('θ=90°：矩形变为以中心为中心的 40×80——原右上角外、新纵向范围内命中', () => {
    const cx = 140;
    const cy = 120;
    // θ=90° 后矩形占 [cx-20, cx+20]×[cy-40, cy+40]
    expect(pointInRotatedRect({ x: cx, y: cy - 39 }, rect, PI / 2)).toBe(true);
    expect(pointInRotatedRect({ x: cx, y: cy - 41 }, rect, PI / 2)).toBe(false);
    expect(pointInRotatedRect({ x: cx + 21, y: cy }, rect, PI / 2)).toBe(false);
  });
  it('θ=45°：中心恒在；沿旋转后对角方向 半对角线长内命中、超出不命中', () => {
    const theta = PI / 4;
    const cx = 140;
    const cy = 120;
    expect(pointInRotatedRect({ x: cx, y: cy }, rect, theta)).toBe(true);
    // 半对角 = √(40²+20²) ≈ 44.72；角点方向须先旋转（局部 (40,20) → R(θ)·(40,20)）
    const d = Math.hypot(40, 20);
    const corner = rotatePointAround({ x: 40, y: 20 }, { x: 0, y: 0 }, theta);
    const dir = { x: corner.x / d, y: corner.y / d };
    expect(pointInRotatedRect({ x: cx + dir.x * 44, y: cy + dir.y * 44 }, rect, theta)).toBe(true);
    expect(pointInRotatedRect({ x: cx + dir.x * 46, y: cy + dir.y * 46 }, rect, theta)).toBe(false);
  });
});

describe('rotatedRectBounds', () => {
  it('θ=0 原样返回（值拷贝非同引用）', () => {
    const rect = { x: 1, y: 2, width: 30, height: 40 };
    const out = rotatedRectBounds(rect, 0);
    expect(out).toEqual(rect);
    expect(out).not.toBe(rect);
  });
  it('θ=90°：宽高互换、中心不动', () => {
    const rect = { x: 100, y: 60, width: 60, height: 20 };
    const out = rotatedRectBounds(rect, PI / 2);
    expect(closeTo(out.x, 120, 1e-9)).toBe(true);
    expect(closeTo(out.y, 40, 1e-9)).toBe(true);
    expect(closeTo(out.width, 20, 1e-9)).toBe(true);
    expect(closeTo(out.height, 60, 1e-9)).toBe(true);
  });
  it('θ=45°：外接 = |w·cos|+|h·sin| 族公式（正方形 = 边×√2）', () => {
    const sq = { x: 0, y: 0, width: 10, height: 10 };
    const out = rotatedRectBounds(sq, PI / 4);
    expect(closeTo(out.width, 10 * Math.SQRT2, 1e-9)).toBe(true);
    expect(closeTo(out.height, 10 * Math.SQRT2, 1e-9)).toBe(true);
    expect(closeTo(out.x + out.width / 2, 5, 1e-9)).toBe(true);
    // 非正方形：w' = w|cos45|+h|sin45|
    const rect = { x: 0, y: 0, width: 80, height: 40 };
    const o2 = rotatedRectBounds(rect, PI / 4);
    expect(closeTo(o2.width, (80 + 40) / Math.SQRT2, 1e-9)).toBe(true);
    expect(closeTo(o2.height, (80 + 40) / Math.SQRT2, 1e-9)).toBe(true);
  });
  it('θ 与 θ+π 同 AABB（周期半圈）', () => {
    const rect = { x: 10, y: 10, width: 50, height: 30 };
    const a = rotatedRectBounds(rect, 0.7);
    const b = rotatedRectBounds(rect, 0.7 + PI);
    expect(closeTo(a.width, b.width, 1e-9)).toBe(true);
    expect(closeTo(a.x, b.x, 1e-9)).toBe(true);
  });
});

describe('rotatedRectCorners / rotatedRectIntersectsRect', () => {
  const rect = { x: 100, y: 100, width: 120, height: 40 };
  it('θ=0 四角原样、顺时针序', () => {
    const [a, b, c, d] = rotatedRectCorners(rect, 0);
    expect(a).toEqual({ x: 100, y: 100 });
    expect(b).toEqual({ x: 220, y: 100 });
    expect(c).toEqual({ x: 220, y: 140 });
    expect(d).toEqual({ x: 100, y: 140 });
  });
  it('AABB 分离即假（粗筛路径）', () => {
    expect(rotatedRectIntersectsRect(rect, PI / 4, { x: 400, y: 400, width: 10, height: 10 })).toBe(
      false,
    );
  });
  it('包含即真：AABB 大框整个罩住旋转件', () => {
    expect(rotatedRectIntersectsRect(rect, PI / 4, { x: 50, y: 50, width: 300, height: 300 })).toBe(
      true,
    );
  });
  it('十字相交：窄 AABB 从中间横穿（AABB 相交但轴对齐判定会漏的形态）', () => {
    // θ=90°：旋转件占 [150,170]×[60,180]（宽 40 高 120 中心 (160,120)）
    // 窄条 x∈[155,165], y∈[0,50] 在旋转件上方——分离为假；y∈[100,140] 横穿为真
    expect(rotatedRectIntersectsRect(rect, PI / 2, { x: 155, y: 100, width: 10, height: 40 })).toBe(
      true,
    );
    expect(rotatedRectIntersectsRect(rect, PI / 2, { x: 155, y: 10, width: 10, height: 40 })).toBe(
      false,
    );
  });
  it('角点相接不算相交（与基类 hitTestRect 严格相交口径一致）；重叠 1px 即真', () => {
    // θ=0 下 rect 右下角 (220,140)；触区从 (219,139) 起 = 重叠 1px 真相交，
    // 从 (220,140) 起 = 仅角点相接（AABB 粗筛 <= 判分离）不算
    expect(rotatedRectIntersectsRect(rect, 0, { x: 219, y: 139, width: 5, height: 5 })).toBe(true);
    expect(rotatedRectIntersectsRect(rect, 0, { x: 220, y: 140, width: 5, height: 5 })).toBe(false);
    expect(rotatedRectIntersectsRect(rect, 0, { x: 221, y: 141, width: 5, height: 5 })).toBe(false);
  });
});

describe('pointerAngle / snapAngle', () => {
  it('方向特值：右 0、下 π/2、左 π、上 -π/2（atan2 语义）', () => {
    const c = { x: 0, y: 0 };
    expect(closeTo(pointerAngle(c, { x: 10, y: 0 }), 0)).toBe(true);
    expect(closeTo(pointerAngle(c, { x: 0, y: 10 }), PI / 2)).toBe(true);
    expect(closeTo(pointerAngle(c, { x: -10, y: 0 }), PI)).toBe(true);
    expect(closeTo(pointerAngle(c, { x: 0, y: -10 }), -PI / 2)).toBe(true);
  });
  it('15° 步进量化：就近取整到步长整数倍', () => {
    expect(closeTo(snapAngle(ROTATE_STEP * 0.6), ROTATE_STEP)).toBe(true);
    expect(closeTo(snapAngle(ROTATE_STEP * 0.4), 0)).toBe(true);
    expect(closeTo(snapAngle(-0.05), 0)).toBe(true);
    expect(closeTo(snapAngle(ROTATE_STEP * 2 + 0.01), ROTATE_STEP * 2)).toBe(true);
  });
});

describe('computeRootTransform', () => {
  it('θ=0：pivot=中心、position=中心，视觉左上 = posX − w/2 = x（与旧渲染等价）', () => {
    const t = computeRootTransform(100, 200, 80, 40, 0);
    expect(t).toEqual({ pivotX: 40, pivotY: 20, posX: 140, posY: 220, rotation: 0 });
    expect(t.posX - t.pivotX).toBe(100);
    expect(t.posY - t.pivotY).toBe(200);
  });
  it('任意 θ：x/y 数据语义不随角度漂移（pivot/position 只依赖几何）', () => {
    const t = computeRootTransform(100, 200, 80, 40, PI / 3);
    expect(t.posX - t.pivotX).toBe(100);
    expect(t.posY - t.pivotY).toBe(200);
    expect(t.rotation).toBe(PI / 3);
  });
});
