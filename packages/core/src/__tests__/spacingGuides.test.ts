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

  it('精确正中（偏差 0）不修正但显徽标', () => {
    const l = { x: 0, y: 0, width: 60, height: 100 };
    const r = { x: 400, y: 0, width: 140, height: 100 };
    const res = snapEqualSpacing({ x: 200, y: 0, width: 100, height: 100 }, 0, 0, [l, r], 6);
    expect(res.dx).toBe(0);
    expect(res.gaps).toHaveLength(2);
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

  it('三个左邻只取最近邻 + 连续次邻一对（远邻配对不可达）', () => {
    // A(703) 左邻 {100..200}/{300..400}/{500..600}：最近对 = {500},{300}（g=100）→
    // 目标 A.x = 600+100 = 700，偏差 0；若取远对 {300},{100} 目标 400 偏差 303 不命中
    const n1 = { x: 100, y: 0, width: 100, height: 100 };
    const n3 = { x: 500, y: 0, width: 100, height: 100 };
    const r = snapEqualSpacing({ x: 703, y: 0, width: 100, height: 100 }, -3, 0, [n1, B, n3], 6);
    expect(r.dx).toBe(-3); // 703 → 700
    expect(r.gaps).toHaveLength(2);
    expect(r.gaps[0]!).toMatchObject({ axis: 'x', from: 400, to: 500, value: 100 }); // 次邻↔最近邻
    expect(r.gaps[1]!).toMatchObject({ axis: 'x', from: 600, to: 700, value: 100 }); // 最近邻↔A
  });

  it('边链与中心链都命中时取偏差小者（中心链更近胜出）', () => {
    // P(300,w100,cx350) Q(520,w108,cx574)：边链解 dx=-20（偏差 5）、
    // 中心链解 dx=-24（aCx=126，三心 126/350/574 等差 224，偏差 1）→ 中心胜
    const p = { x: 300, y: 0, width: 100, height: 100 };
    const q = { x: 520, y: 0, width: 108, height: 100 };
    const r = snapEqualSpacing({ x: 100, y: 0, width: 100, height: 100 }, -25, 0, [p, q], 6);
    expect(r.dx).toBe(-24);
    expect(r.gaps).toHaveLength(2);
    expect(r.gaps[0]!).toMatchObject({ axis: 'x', from: 126, to: 350, value: 224 }); // A.cx↔P.cx
    expect(r.gaps[1]!).toMatchObject({ axis: 'x', from: 350, to: 574, value: 224 }); // P.cx↔Q.cx
  });

  it('左端参考对贴合（g=0）：边链不触发、中心链照常（中心距语义独立）', () => {
    // 左邻 q(200..300,cx250) 与 p(300..400,cx350) 贴合：g=0 边链跳过；
    // 中心距 ref=100 → 目标 A.cx = 2·350−250 = 450 → A.x = 400
    const qTouch = { x: 200, y: 0, width: 100, height: 100 };
    const r = snapEqualSpacing({ x: 403, y: 0, width: 100, height: 100 }, 0, 0, [qTouch, B], 6);
    expect(r.dx).toBe(-3); // 403 → 400
    expect(r.gaps).toHaveLength(2);
    // 中心段（250→350→450），值为中心距 100——不是边缘间隙段
    expect(r.gaps[0]!).toMatchObject({ axis: 'x', from: 250, to: 350, value: 100 });
    expect(r.gaps[1]!).toMatchObject({ axis: 'x', from: 350, to: 450, value: 100 });
  });

  it('端部中心链（右端）：三心等差 A.cx = 2·P.cx − Q.cx，中心距徽标', () => {
    // B(300,w100,cx350)、C(560,w40,cx580)：中心距 230；目标 A.cx = 350−230 = 120 → A.x = 70。
    // 边间隙链解 g=160 → A.x=40（偏差 33 不命中）——本例中心链独立命中
    const b = { x: 300, y: 0, width: 100, height: 100 };
    const c = { x: 560, y: 0, width: 40, height: 100 };
    const r = snapEqualSpacing({ x: 73, y: 0, width: 100, height: 100 }, 0, 0, [b, c], 6);
    expect(r.dx).toBe(-3); // 73 → 70（cx 123 → 120）
    expect(r.gaps).toHaveLength(2);
    expect(r.gaps[0]!).toMatchObject({ axis: 'x', from: 120, to: 350, value: 230 }); // A.cx↔P.cx
    expect(r.gaps[1]!).toMatchObject({ axis: 'x', from: 350, to: 580, value: 230 }); // P.cx↔Q.cx
  });

  it('端部中心链（左端镜像）：A 最右，三心等差吸附', () => {
    // P=B(300,w100,cx350) 最近左邻、Q=C(100,w60,cx130) 外侧：中心距 220；
    // 目标 A.cx = 350+220 = 570 → A.x = 520（边间隙链 g=140 → A.x=540，偏差 17 不命中）
    const b = { x: 300, y: 0, width: 100, height: 100 };
    const c = { x: 100, y: 0, width: 60, height: 100 };
    const r = snapEqualSpacing({ x: 523, y: 0, width: 100, height: 100 }, 0, 0, [b, c], 6);
    expect(r.dx).toBe(-3);
    expect(r.gaps).toHaveLength(2);
    expect(r.gaps[0]!).toMatchObject({ axis: 'x', from: 130, to: 350, value: 220 }); // Q.cx↔P.cx
    expect(r.gaps[1]!).toMatchObject({ axis: 'x', from: 350, to: 570, value: 220 }); // P.cx↔A.cx
  });

  it('端部两链解重合时边间隙徽标优先（与中置口径一致）', () => {
    // 等大等距：B(300) C(500)——边间隙链解 A.x=100（g=100），中心链解 A.cx=150
    // （=350−200）→ A.x=100：重合，先评估的边间隙胜出（徽标值为间隙 100）
    const b = { x: 300, y: 0, width: 100, height: 100 };
    const c = { x: 500, y: 0, width: 100, height: 100 };
    const r = snapEqualSpacing({ x: 103, y: 0, width: 100, height: 100 }, 0, 0, [b, c], 6);
    expect(r.dx).toBe(-3);
    expect(r.gaps[0]!).toMatchObject({ axis: 'x', value: 100 }); // 间隙徽标，非中心距 200
    expect(r.gaps[1]!).toMatchObject({ axis: 'x', value: 100 });
  });
});
