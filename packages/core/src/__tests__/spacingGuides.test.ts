import { describe, expect, it } from 'vitest';
import { snapEqualSpacing } from '../platform/refLine/spacingGuides';

/** 布局模板：L(0,0,100,100) A(待测) R(400,0,100,100)——y 全重叠 */
const L = { x: 0, y: 0, width: 100, height: 100 };
const R = { x: 400, y: 0, width: 100, height: 100 };

describe('snapEqualSpacing 边间隙等距（docs/06 §7）', () => {
  it('偏差阈值内吸附到精确等距：A(203) → 200，两段 gap 各 100', () => {
    // gapL = 203-100 = 103，gapR = 400-303 = 97；等距解 x=200（各 100），偏差 3 < 6
    const r = snapEqualSpacing({ x: 203, y: 0, width: 100, height: 100 }, 0, 0, [L, R], 6);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(0);
    expect(r.gaps).toHaveLength(2);
    expect(r.gaps[0]!).toMatchObject({ axis: 'x', from: 100, to: 200, value: 100 });
    expect(r.gaps[1]!).toMatchObject({ axis: 'x', from: 300, to: 400, value: 100 });
  });

  it('已经等距（偏差 ~0）不修正但保持命中可显徽标', () => {
    const r = snapEqualSpacing({ x: 200, y: 0, width: 100, height: 100 }, 0, 0, [L, R], 6);
    expect(r.dx).toBe(0);
    expect(r.gaps).toHaveLength(2);
  });

  it('偏差超出阈值不吸附', () => {
    // gapL = 140 / gapR = 60，等距解在 200，偏差 40 > 6
    const r = snapEqualSpacing({ x: 240, y: 0, width: 100, height: 100 }, 0, 0, [L, R], 6);
    expect(r.dx).toBe(0);
    expect(r.gaps).toHaveLength(0);
  });

  it('y 投影不重叠（纵向不同排）不触发', () => {
    const farY = { ...L, y: 500 };
    const r = snapEqualSpacing({ x: 203, y: 0, width: 100, height: 100 }, 0, 0, [farY, R], 6);
    expect(r.dx).toBe(0);
    expect(r.gaps).toHaveLength(0);
  });

  it('只有一侧邻居（无配对）不触发', () => {
    const r = snapEqualSpacing({ x: 203, y: 0, width: 100, height: 100 }, 0, 0, [L], 6);
    expect(r.dx).toBe(0);
    expect(r.gaps).toHaveLength(0);
  });

  it('x 上与被拖矩形重叠的邻居不算左右邻居', () => {
    const overlapL = { x: 150, y: 0, width: 100, height: 100 }; // 右缘 250 > A 左缘 203
    const r = snapEqualSpacing({ x: 203, y: 0, width: 100, height: 100 }, 0, 0, [overlapL, R], 6);
    expect(r.dx).toBe(0);
    expect(r.gaps).toHaveLength(0);
  });

  it('解会与邻居重叠（负间隙）时拒绝', () => {
    // R 贴得很近：等距解会令 A 与 R 重叠 → 边间隙等距不可行；L 太远中心等距也超阈
    const nearR = { x: 310, y: 0, width: 100, height: 100 };
    const r = snapEqualSpacing({ x: 203, y: 0, width: 100, height: 100 }, 0, 0, [L, nearR], 6);
    expect(r.dx).toBe(0);
    expect(r.gaps).toHaveLength(0);
  });
});

describe('snapEqualSpacing 中心等距', () => {
  it('中心等距独立命中：不对称邻居下取中心解而非边间隙解', () => {
    // L(0..60, cx 30) R(400..540, cx 470)：中心解 A.cx=250 → A.x=200（偏差 2）；
    // 边间隙解 = (60+400-100)/2 - 202 = -22（超阈不命中）
    const l = { x: 0, y: 0, width: 60, height: 100 };
    const r = { x: 400, y: 0, width: 140, height: 100 };
    const res = snapEqualSpacing({ x: 202, y: 0, width: 100, height: 100 }, 0, 0, [l, r], 6);
    expect(res.dx).toBe(-2);
    // 徽标数据为中心间距：|250-30| = |470-250| = 220
    expect(res.gaps).toHaveLength(2);
    expect(res.gaps[0]!.value).toBeCloseTo(220, 6);
    expect(res.gaps[1]!.value).toBeCloseTo(220, 6);
  });
});

describe('snapEqualSpacing y 轴对称', () => {
  it('垂直排列：上下邻居等距吸附', () => {
    const top = { x: 0, y: 0, width: 100, height: 100 };
    const bottom = { x: 0, y: 400, width: 100, height: 100 };
    const r = snapEqualSpacing({ x: 0, y: 203, width: 100, height: 100 }, 0, 0, [top, bottom], 6);
    expect(r.dy).toBe(-3);
    expect(r.gaps).toHaveLength(2);
    expect(r.gaps[0]!).toMatchObject({ axis: 'y', from: 100, to: 200, value: 100 });
  });
});
