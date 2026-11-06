import { describe, expect, it } from 'vitest';
import {
  EDGE_SCROLL_DT_CLAMP_MS,
  EDGE_SCROLL_MAX_PX_PER_S,
  EDGE_SCROLL_ZONE_PX,
  clampFrameDt,
  edgeScrollAxisVelocity,
  resolveEdgeScroll,
} from '../platform/viewport/edgeScrollMath';

/** 视口 1000×800 的基准尺寸（specs/edge-auto-scroll §7.1 用例共享） */
const SIZE = { width: 1000, height: 800 };

describe('edgeScrollMath 纯数学（specs/edge-auto-scroll T1-T10）', () => {
  it('T1 中心区域 → 两轴速度为 0', () => {
    expect(resolveEdgeScroll({ x: 500, y: 400 }, SIZE)).toEqual({ x: 0, y: 0 });
    // 热区外沿恰好在边界上（d = ZONE）不算进热区
    expect(resolveEdgeScroll({ x: EDGE_SCROLL_ZONE_PX, y: 400 }, SIZE).x).toBe(0);
  });

  it('T2 符号钉死（§2.3-①）：右边缘 x < 0，左边缘 x > 0', () => {
    // panBy 正值 = 内容右移 = 露出左侧世界；露出右侧世界必须传负值
    expect(resolveEdgeScroll({ x: SIZE.width - 5, y: 400 }, SIZE).x).toBeLessThan(0);
    expect(resolveEdgeScroll({ x: 5, y: 400 }, SIZE).x).toBeGreaterThan(0);
  });

  it('T3 符号钉死：下边缘 y < 0，上边缘 y > 0', () => {
    expect(resolveEdgeScroll({ x: 500, y: SIZE.height - 5 }, SIZE).y).toBeLessThan(0);
    expect(resolveEdgeScroll({ x: 500, y: 5 }, SIZE).y).toBeGreaterThan(0);
  });

  it('T4 线性斜坡精确值：v = MAX × (1 − d/ZONE)', () => {
    // 左边缘取正号：v = +rampSpeed(d)
    expect(edgeScrollAxisVelocity(0, SIZE.width)).toBe(EDGE_SCROLL_MAX_PX_PER_S); // 边缘最大
    expect(edgeScrollAxisVelocity(30, SIZE.width)).toBeCloseTo(810, 6);
    expect(edgeScrollAxisVelocity(60, SIZE.width)).toBeCloseTo(540, 6);
    expect(edgeScrollAxisVelocity(90, SIZE.width)).toBeCloseTo(270, 6);
    expect(edgeScrollAxisVelocity(100, SIZE.width)).toBeCloseTo(180, 6); // 旧慢档手感锚点
    expect(edgeScrollAxisVelocity(119.9, SIZE.width)).toBeCloseTo(0.9, 6);
    expect(edgeScrollAxisVelocity(EDGE_SCROLL_ZONE_PX, SIZE.width)).toBe(0); // 外沿 0
  });

  it('T5 单调性 + 线性性：d 递减速度严格递增，等距差分恒 = MAX×10/ZONE', () => {
    let prev = 0;
    for (let d = EDGE_SCROLL_ZONE_PX - 0.5; d >= 0; d -= 0.5) {
      const v = Math.abs(edgeScrollAxisVelocity(d, SIZE.width));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // 线性核验：每靠近 10px 提速同一截距（斜坡不是任何分段函数）
    const stepDiff = (EDGE_SCROLL_MAX_PX_PER_S * 10) / EDGE_SCROLL_ZONE_PX;
    for (let d = 0; d <= EDGE_SCROLL_ZONE_PX - 10; d += 10) {
      const v1 = Math.abs(edgeScrollAxisVelocity(d, SIZE.width));
      const v2 = Math.abs(edgeScrollAxisVelocity(d + 10, SIZE.width));
      expect(v1 - v2).toBeCloseTo(stepDiff, 6);
    }
  });

  it('T6 直角区两轴同时非 0（不做矢量归一化）', () => {
    const v = resolveEdgeScroll({ x: SIZE.width - 5, y: SIZE.height - 5 }, SIZE);
    expect(v.x).toBeLessThan(0);
    expect(v.y).toBeLessThan(0);
  });

  it('T7 指针越出边界 → 钳到最大速度且符号正确', () => {
    expect(resolveEdgeScroll({ x: -30, y: 400 }, SIZE).x).toBe(EDGE_SCROLL_MAX_PX_PER_S);
    expect(resolveEdgeScroll({ x: SIZE.width + 30, y: 400 }, SIZE).x).toBe(
      -EDGE_SCROLL_MAX_PX_PER_S,
    );
    expect(resolveEdgeScroll({ x: 500, y: -30 }, SIZE).y).toBe(EDGE_SCROLL_MAX_PX_PER_S);
    expect(resolveEdgeScroll({ x: 500, y: SIZE.height + 30 }, SIZE).y).toBe(
      -EDGE_SCROLL_MAX_PX_PER_S,
    );
  });

  it('T8 extent ≤ 0（未布局）→ 两轴 0', () => {
    expect(resolveEdgeScroll({ x: 0, y: 0 }, { width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
    expect(resolveEdgeScroll({ x: 500, y: 400 }, { width: -10, height: 800 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('T9 clampFrameDt：负归 0、超限钳 50、正常值直通', () => {
    expect(clampFrameDt(-5)).toBe(0);
    expect(clampFrameDt(500)).toBe(EDGE_SCROLL_DT_CLAMP_MS);
    expect(clampFrameDt(16.7)).toBe(16.7);
  });

  it('T10 60Hz/120Hz 等价：同样 300ms 总位移差 < 5%（G5）', () => {
    // 速度取斜坡上任一点（d = ZONE/2 → MAX/2），与档位常量解耦
    const speed = EDGE_SCROLL_MAX_PX_PER_S / 2;
    const total = (frameDt: number): number => {
      let sum = 0;
      for (let t = 0; t < 300; t += frameDt) sum += (speed * clampFrameDt(frameDt)) / 1000;
      return sum;
    };
    const at60 = total(1000 / 60);
    const at120 = total(1000 / 120);
    expect(Math.abs(at60 - at120) / Math.min(at60, at120)).toBeLessThan(0.05);
    // 理论值锚点：v × 0.3s
    expect(Math.abs(at60 - speed * 0.3)).toBeLessThan(speed * 0.3 * 0.05);
  });
});
