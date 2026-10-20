import { describe, expect, it } from 'vitest';
import {
  BASE_WORLD_SPACING,
  DOT_MAX,
  MIN_SCREEN_SPACING,
  OVERSCAN,
  computeGridTransform,
} from '../components/dotGridMath';

/**
 * DotGrid 网格数学（docs/03 §6）——本组件的对齐 bug 曾靠浏览器相位对比才能验证，
 * 抽纯函数后回归常驻（2026-09 质量护栏补强）。
 */

const mod = (n: number, m: number) => ((n % m) + m) % m;

describe('computeGridTransform', () => {
  it('100% 时点距 = 基础世界点距、点径 1px', () => {
    const t = computeGridTransform(1, { x: 0, y: 0, width: 1440, height: 900 });
    expect(t.pitch).toBe(BASE_WORLD_SPACING);
    expect(t.dot).toBe(1);
  });

  it('点距世界锚定：放大线性拉开、点径同步放大（钉板点阵）', () => {
    const t = computeGridTransform(4, { x: 0, y: 0, width: 1440, height: 900 });
    expect(t.pitch).toBe(64);
    expect(t.dot).toBe(DOT_MAX);
  });

  it('缩小过密时世界点距翻倍跳档，屏幕点距恒 ≥ 12px', () => {
    // scale 0.5：16×0.5=8 < 12 → 翻倍到 32 → pitch 16
    expect(computeGridTransform(0.5, { x: 0, y: 0, width: 100, height: 100 }).pitch).toBe(16);
    // MIN_SCALE 0.05：翻 4 档 → pitch 12.8
    const t = computeGridTransform(0.05, { x: 0, y: 0, width: 100, height: 100 });
    expect(t.pitch).toBeGreaterThanOrEqual(MIN_SCREEN_SPACING);
    expect(t.pitch).toBeLessThan(MIN_SCREEN_SPACING * 2);
    // 缩小端点径钳在 1px 不消失
    expect(t.dot).toBe(1);
  });

  it('scale 非正值防御：按 1 处理', () => {
    expect(computeGridTransform(0, { x: 0, y: 0, width: 100, height: 100 }).pitch).toBe(
      BASE_WORLD_SPACING,
    );
  });

  it('对齐不变量：点中心屏幕位置 ≡ 世界原点屏幕位置 (mod pitch)', () => {
    for (const [scale, b] of [
      [1, { x: 123.4, y: -56.7, width: 1440, height: 900 }],
      [2.5, { x: -300, y: 888.8, width: 1440, height: 900 }],
      [0.3, { x: 42, y: 42, width: 500, height: 500 }],
    ] as const) {
      const t = computeGridTransform(
        scale,
        b as { x: number; y: number; width: number; height: number },
      );
      // 点中心 x = 层左缘(-OVERSCAN+dx) + pitch/2；要求 ≡ -b.x·scale (mod pitch)
      // 断言对环绕鲁棒：差值可能落在 0 或 pitch 附近（浮点取模的二义性）
      const distToLattice = (v: number) => Math.min(mod(v, t.pitch), t.pitch - mod(v, t.pitch));
      const centerX = -OVERSCAN + t.dx + t.pitch / 2;
      expect(distToLattice(centerX - -b.x * scale)).toBeCloseTo(0, 6);
      const centerY = -OVERSCAN + t.dy + t.pitch / 2;
      expect(distToLattice(centerY - -b.y * scale)).toBeCloseTo(0, 6);
    }
  });

  it('平移取模落在 [-pitch, 0)，过盈边距恒覆盖视口', () => {
    for (const scale of [0.05, 0.5, 1, 1.44, 4]) {
      const t = computeGridTransform(scale, { x: -999.9, y: 12345.6, width: 1440, height: 900 });
      expect(t.dx).toBeGreaterThanOrEqual(-t.pitch);
      expect(t.dx).toBeLessThan(0);
      expect(t.dy).toBeGreaterThanOrEqual(-t.pitch);
      expect(t.dy).toBeLessThan(0);
      // pitch ≤ 64 = OVERSCAN → 层平移后仍盖满视口
      expect(t.pitch).toBeLessThanOrEqual(OVERSCAN);
    }
  });
});
