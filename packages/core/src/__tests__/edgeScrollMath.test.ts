import { describe, expect, it } from 'vitest';
import {
  EDGE_SCROLL_DT_CLAMP_MS,
  EDGE_SCROLL_TIERS_PX_PER_S,
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
    // 热区外沿恰好在边界上（d = 56）不算进热区
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

  it('T4 分档归属：d = 55.9/37.4/18.7/0 分别落慢/慢/中/快', () => {
    // 左边缘取正号：v = +tierSpeed(d)
    expect(edgeScrollAxisVelocity(0, SIZE.width)).toBe(EDGE_SCROLL_TIERS_PX_PER_S[2]); // d=0 快
    expect(edgeScrollAxisVelocity(18.7, SIZE.width)).toBe(EDGE_SCROLL_TIERS_PX_PER_S[1]); // 中
    expect(edgeScrollAxisVelocity(37.4, SIZE.width)).toBe(EDGE_SCROLL_TIERS_PX_PER_S[0]); // 慢
    expect(edgeScrollAxisVelocity(55.9, SIZE.width)).toBe(EDGE_SCROLL_TIERS_PX_PER_S[0]); // 慢
  });

  it('T5 单调性：d 递减时速度绝对值不减', () => {
    let prev = 0;
    for (let d = 55; d >= 0; d -= 0.5) {
      const v = Math.abs(edgeScrollAxisVelocity(d, SIZE.width));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // 跨档跳变核验：档位只有三档值，不出现中间值
    const seen = new Set<number>();
    for (let d = 0; d <= 55; d += 1) seen.add(edgeScrollAxisVelocity(d, SIZE.width));
    expect([...seen].every((v) => (EDGE_SCROLL_TIERS_PX_PER_S as readonly number[]).includes(v))).toBe(
      true,
    );
  });

  it('T6 直角区两轴同时非 0（不做矢量归一化）', () => {
    const v = resolveEdgeScroll({ x: SIZE.width - 5, y: SIZE.height - 5 }, SIZE);
    expect(v.x).toBeLessThan(0);
    expect(v.y).toBeLessThan(0);
  });

  it('T7 指针越出边界 → 钳到最高档且符号正确', () => {
    expect(resolveEdgeScroll({ x: -30, y: 400 }, SIZE).x).toBe(EDGE_SCROLL_TIERS_PX_PER_S[2]);
    expect(resolveEdgeScroll({ x: SIZE.width + 30, y: 400 }, SIZE).x).toBe(
      -EDGE_SCROLL_TIERS_PX_PER_S[2],
    );
    expect(resolveEdgeScroll({ x: 500, y: -30 }, SIZE).y).toBe(EDGE_SCROLL_TIERS_PX_PER_S[2]);
    expect(resolveEdgeScroll({ x: 500, y: SIZE.height + 30 }, SIZE).y).toBe(
      -EDGE_SCROLL_TIERS_PX_PER_S[2],
    );
  });

  it('T8 extent ≤ 0（未布局）→ 两轴 0', () => {
    expect(resolveEdgeScroll({ x: 0, y: 0 }, { width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
    expect(resolveEdgeScroll({ x: 500, y: 400 }, { width: -10, height: 800 })).toEqual({ x: 0, y: 0 });
  });

  it('T9 clampFrameDt：负归 0、超限钳 50、正常值直通', () => {
    expect(clampFrameDt(-5)).toBe(0);
    expect(clampFrameDt(500)).toBe(EDGE_SCROLL_DT_CLAMP_MS);
    expect(clampFrameDt(16.7)).toBe(16.7);
  });

  it('T10 60Hz/120Hz 等价：同样 300ms 总位移差 < 5%（G5）', () => {
    const speed = EDGE_SCROLL_TIERS_PX_PER_S[1]!;
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
