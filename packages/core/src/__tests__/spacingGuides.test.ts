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

  it('只有一侧邻居且无次邻（无参考间隙）不触发', () => {
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

/** 端部链式（docs/06 §7）：被拖件单侧有邻居时，与最近邻的间隙吸附为
 *  「最近邻与其外侧连续次邻的间隙」——拖一排端部也能调出等距徽标 */
describe('snapEqualSpacing 端部链式（单侧邻居）', () => {
  // 同排：A(被拖) B(300) C(500)，g(B,C) = 100
  const B = { x: 300, y: 0, width: 100, height: 100 };
  const C = { x: 500, y: 0, width: 100, height: 100 };

  it('右端链（A 最左）：gap(A,B) 吸附到 g(B,C)=100，两段徽标', () => {
    // A(100) 拖到 97（gap 103，偏差 3）→ 吸回 100
    const r = snapEqualSpacing({ x: 100, y: 0, width: 100, height: 100 }, -3, 0, [B, C], 6);
    expect(r.dx).toBe(0);
    expect(r.gaps).toHaveLength(2);
    expect(r.gaps[0]!).toMatchObject({ axis: 'x', from: 200, to: 300, value: 100 }); // A↔B
    expect(r.gaps[1]!).toMatchObject({ axis: 'x', from: 400, to: 500, value: 100 }); // B↔C
  });

  it('右端链已等距（偏差 0）不修正但显徽标', () => {
    const r = snapEqualSpacing({ x: 100, y: 0, width: 100, height: 100 }, 0, 0, [B, C], 6);
    expect(r.dx).toBe(0);
    expect(r.gaps).toHaveLength(2);
  });

  it('右端链偏差超阈不触发', () => {
    const r = snapEqualSpacing({ x: 100, y: 0, width: 100, height: 100 }, -10, 0, [B, C], 6);
    expect(r.dx).toBe(-10);
    expect(r.gaps).toHaveLength(0);
  });

  it('参考间隙 g=0（次邻与最近邻贴合）不触发', () => {
    const cTouch = { x: 400, y: 0, width: 100, height: 100 }; // 贴 B 右缘
    const r = snapEqualSpacing({ x: 100, y: 0, width: 100, height: 100 }, -3, 0, [B, cTouch], 6);
    expect(r.dx).toBe(-3);
    expect(r.gaps).toHaveLength(0);
  });

  it('左端链（A 最右）：gap(B,A) 吸附到 g(C,B)=100', () => {
    // 左邻 B(300..400)、外侧次邻 C(100..200)：g = 300-200 = 100；A 目标 x = 400+100 = 500
    const cLeft = { x: 100, y: 0, width: 100, height: 100 };
    const r = snapEqualSpacing({ x: 500, y: 0, width: 100, height: 100 }, 3, 0, [cLeft, B], 6);
    expect(r.dx).toBe(0);
    expect(r.gaps).toHaveLength(2);
    expect(r.gaps[0]!).toMatchObject({ axis: 'x', from: 200, to: 300, value: 100 }); // C↔B
    expect(r.gaps[1]!).toMatchObject({ axis: 'x', from: 400, to: 500, value: 100 }); // B↔A
  });

  it('y 轴端部链：A 最上，gap(A,B) 吸附到 g(B,C)', () => {
    const b = { x: 0, y: 300, width: 100, height: 100 };
    const c = { x: 0, y: 500, width: 100, height: 100 };
    const r = snapEqualSpacing({ x: 0, y: 100, width: 100, height: 100 }, 0, -3, [b, c], 6);
    expect(r.dy).toBe(0);
    expect(r.gaps).toHaveLength(2);
    expect(r.gaps[0]!).toMatchObject({ axis: 'y', from: 200, to: 300, value: 100 });
    expect(r.gaps[1]!).toMatchObject({ axis: 'y', from: 400, to: 500, value: 100 });
  });
});
