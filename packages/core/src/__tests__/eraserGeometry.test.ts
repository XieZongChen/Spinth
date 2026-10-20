import { describe, expect, it } from 'vitest';
import { eraseIntervalOnSegment, eraseStrokeAgainstSweep } from '../common/geometry';

/**
 * 橡皮分段切割（eraser 批 1）：扫掠胶囊 vs 折线的覆盖区间与 runs 切割。
 * 语义（参考同款）：扫过部分消失、剩余分段保留、交点级精确边界。
 */

describe('eraseIntervalOnSegment（单段覆盖区间，三分+二分求根）', () => {
  const P1 = { x: 0, y: 0 };
  const P2 = { x: 100, y: 0 };
  const r = 10;

  it('不相交：胶囊远高于水平段 → null', () => {
    expect(eraseIntervalOnSegment(P1, P2, { x: 50, y: 100 }, { x: 60, y: 100 }, r)).toBeNull();
  });

  it('横穿：垂直扫掠线从上方穿过段中部 → 居中参数区间', () => {
    // 扫掠线 x=50，从 (50,-5) 到 (50,5)：穿过段，最近距离 0 → 覆盖参数 [0.4, 0.6]
    const iv = eraseIntervalOnSegment(P1, P2, { x: 50, y: -5 }, { x: 50, y: 5 }, r)!;
    expect(iv).not.toBeNull();
    expect(iv[0]).toBeCloseTo(0.4, 4);
    expect(iv[1]).toBeCloseTo(0.6, 4);
  });

  it('整段覆盖（两端均在胶囊内）→ [0,1]', () => {
    // 扫掠线沿段方向重合（距离 0），覆盖全长
    expect(eraseIntervalOnSegment(P1, P2, { x: -10, y: 0 }, { x: 110, y: 0 }, r)).toEqual([0, 1]);
  });

  it('端部覆盖：扫掠线过段起点 → [0, tB]', () => {
    const iv = eraseIntervalOnSegment(P1, P2, { x: 0, y: 0 }, { x: 0, y: 20 }, r)!;
    expect(iv[0]).toBe(0);
    expect(iv[1]).toBeCloseTo(0.1, 3); // √(100-0)=10 → t=0.1
  });

  it('平行的边界距离：恰 = r 时整段贴胶囊边（≤ 判定全覆盖）；略外则 null', () => {
    // 距离恰 10：两端 d = 10 ≤ r → 整段覆盖（数学上整段贴边界）
    expect(eraseIntervalOnSegment(P1, P2, { x: 0, y: 10 }, { x: 100, y: 10 }, r)).toEqual([0, 1]);
    // 距离 10.001：全程 > r → 无覆盖
    expect(
      eraseIntervalOnSegment(P1, P2, { x: 0, y: 10.001 }, { x: 100, y: 10.001 }, r),
    ).toBeNull();
  });
});

describe('eraseStrokeAgainstSweep（折线 runs 切割）', () => {
  /** 水平长笔画 (0,0)→(100,0) 采 5 点 */
  const stroke: Array<[number, number]> = [
    [0, 0],
    [25, 0],
    [50, 0],
    [75, 0],
    [100, 0],
  ];

  it('中部擦除 → 两段（交点精确贴胶囊边界）', () => {
    // 垂直扫过 x=50，半径 10：覆盖 [40,60] → 前段到 ~40，后段从 ~60 起
    const runs = eraseStrokeAgainstSweep(stroke, { x: 50, y: -20 }, { x: 50, y: 20 }, 10)!;
    expect(runs).not.toBeNull();
    expect(runs).toHaveLength(2);
    const [a, b] = runs;
    expect(a![0]![0]).toBeCloseTo(0, 4);
    expect(a![a!.length - 1]![0]).toBeCloseTo(40, 3);
    expect(b![0]![0]).toBeCloseTo(60, 3);
    expect(b![b!.length - 1]![0]).toBeCloseTo(100, 4);
  });

  it('端部擦除 → 单段变短', () => {
    const runs = eraseStrokeAgainstSweep(stroke, { x: 0, y: -20 }, { x: 0, y: 20 }, 10)!;
    expect(runs).toHaveLength(1);
    expect(runs[0]![0]![0]).toBeCloseTo(10, 3);
  });

  it('全擦（扫掠线沿笔画全长）→ 空数组', () => {
    const runs = eraseStrokeAgainstSweep(stroke, { x: -10, y: 0 }, { x: 110, y: 0 }, 10)!;
    expect(runs).toHaveLength(0);
  });

  it('未命中 → null（调用方原样保留免写）', () => {
    expect(eraseStrokeAgainstSweep(stroke, { x: 50, y: 100 }, { x: 60, y: 100 }, 10)).toBeNull();
  });

  it('快速扫掠（长 S 线段）：斜穿笔画中部同样切两段（move 间距大不隧穿）', () => {
    // 上一帧 (-50,-25) 当前帧 (150,25)：扫掠线 y=x/4-12.5 与笔画 y=0 交于 x=50
    const runs = eraseStrokeAgainstSweep(stroke, { x: -50, y: -25 }, { x: 150, y: 25 }, 10)!;
    expect(runs).not.toBeNull();
    expect(runs).toHaveLength(2);
  });

  it('单点圆（prev == cur）同样工作', () => {
    const runs = eraseStrokeAgainstSweep(stroke, { x: 50, y: 0 }, { x: 50, y: 0 }, 10)!;
    expect(runs).toHaveLength(2);
  });
});
