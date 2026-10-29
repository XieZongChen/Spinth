import { describe, expect, it } from 'vitest';
import {
  pointAtRatio,
  ratioAtPoint,
  slicePathExcludingRect,
  slicePathByDash,
  effectivePath,
  insetEnds,
  curveControlPoints,
  flattenCurve,
  type IPt,
} from '../widgets/line/lineMath';

describe('线上文字定位（docs/08 §6）', () => {
  const L_SHAPE: IPt[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  it('pointAtRatio：0.5 恰在拐点', () => {
    const { point } = pointAtRatio(L_SHAPE, 0.5);
    expect(point).toEqual({ x: 100, y: 0 });
  });
  it('ratioAtPoint 与 pointAtRatio 往返一致', () => {
    for (const r of [0.1, 0.3, 0.5, 0.75, 0.9]) {
      const { point } = pointAtRatio(L_SHAPE, r);
      expect(ratioAtPoint(L_SHAPE, point)).toBeCloseTo(r, 5);
    }
  });
  it('ratio 越界钳制', () => {
    expect(pointAtRatio(L_SHAPE, -1).point).toEqual({ x: 0, y: 0 });
    expect(pointAtRatio(L_SHAPE, 2).point).toEqual({ x: 100, y: 100 });
  });
});

describe('镂空与虚线切分', () => {
  it('slicePathExcludingRect：穿过矩形的直线被切成两段', () => {
    const pieces = slicePathExcludingRect(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      { x: 40, y: -10, width: 20, height: 20 },
    );
    expect(pieces).toHaveLength(2);
    expect(pieces[0]![1]).toEqual({ x: 40, y: 0 });
    expect(pieces[1]![0]).toEqual({ x: 60, y: 0 });
  });
  it('不相交：原样单段', () => {
    const pieces = slicePathExcludingRect(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      { x: 40, y: 50, width: 20, height: 20 },
    );
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toHaveLength(2);
  });
  it('整段包含在矩形内：剔除为空', () => {
    const pieces = slicePathExcludingRect(
      [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      { x: 0, y: -10, width: 100, height: 20 },
    );
    expect(pieces).toHaveLength(0);
  });
  it('slicePathByDash：周期与总长守恒', () => {
    const pieces = slicePathByDash(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      10,
      10,
    );
    // 100 / 20 = 5 个完整 dash
    expect(pieces).toHaveLength(5);
    expect(pieces[0]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(pieces[4]).toEqual([
      { x: 80, y: 0 },
      { x: 90, y: 0 },
    ]);
  });
  it('slicePathByDash 跨拐点相位连续', () => {
    const pieces = slicePathByDash(
      [
        { x: 0, y: 0 },
        { x: 15, y: 0 },
        { x: 15, y: 15 },
      ],
      10,
      10,
    );
    // 第一段 15 = dash10 + gap5；第二段从 gap 剩 5 开始，再 10 进 dash
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(pieces[1]![0]).toEqual({ x: 15, y: 5 });
    expect(pieces[1]![1]).toEqual({ x: 15, y: 15 });
  });
});

describe('effectivePath 视图语义路径（STRAIGHT 残留拐点退化）', () => {
  const ELBOW: IPt[] = [
    { x: 0, y: 0 },
    { x: 0, y: 30 },
    { x: 100, y: 30 },
    { x: 100, y: 60 },
  ];
  it('STRAIGHT：退化为首尾两点（虚线切分/命中/几何按视觉直线）', () => {
    expect(effectivePath(ELBOW, 'STRAIGHT')).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 60 },
    ]);
  });
  it('ELBOWED：保留完整拐点（数据残留可恢复）', () => {
    expect(effectivePath(ELBOW, 'ELBOWED')).toBe(ELBOW);
  });
  it('两点路径原样返回', () => {
    const two: IPt[] = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ];
    expect(effectivePath(two, 'STRAIGHT')).toBe(two);
  });
});

describe('insetEnds 视觉端点收缩（2026-09-30 用户拍板留隙——只动渲染层）', () => {
  it('两端各沿首/末段方向缩进 gap，中间拐点不动', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 0 },
    ];
    const v = insetEnds(pts, 5);
    expect(v.length).toBe(4);
    expect(v[0]).toEqual({ x: 0, y: 5 }); // 首段方向 (0,1)
    expect(v[1]).toEqual(pts[1]); // 拐点不动
    expect(v[2]).toEqual(pts[2]);
    expect(v[3]).toEqual({ x: 300, y: 5 }); // 末段方向 (0,1)
  });

  it('短段钳段长一半：不吞空整段', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: 8 }, // 段长 8 < 2×5 → 只缩 4
      { x: 200, y: 8 },
    ];
    const v = insetEnds(pts, 5);
    expect(v[0]).toEqual({ x: 0, y: 4 });
    expect(v[1]).toEqual({ x: 0, y: 8 }); // 拐点不动
    expect(v[2]).toEqual({ x: 195, y: 8 }); // 末段水平长段，正常缩 5
  });

  it('零长首段跳过；纯函数不改入参', () => {
    const pts = [
      { x: 5, y: 5 },
      { x: 5, y: 5 }, // 零长首段
      { x: 105, y: 5 },
    ];
    const snapshot = pts.map((p) => ({ ...p }));
    const v = insetEnds(pts, 5);
    expect(v[0]).toEqual({ x: 5, y: 5 }); // len0=0 不收缩
    expect(v[2]).toEqual({ x: 100, y: 5 }); // 末段正常缩 5
    expect(pts).toEqual(snapshot);
  });
});

describe('曲线线型（docs/08 §4 批次 4，参考图三 S 形）', () => {
  it('curveControlPoints：锚定走廊点定切向——S 形四控制点', () => {
    // 起点 (0,300) 走廊向上，终点 (600,0) 走廊向下（两端反向 → S 弯）
    const pts = [
      { x: 0, y: 300 },
      { x: 0, y: 270 },
      { x: 600, y: 30 },
      { x: 600, y: 0 },
    ];
    const [p0, c1, c2, p3] = curveControlPoints(pts);
    expect(p0).toEqual({ x: 0, y: 300 });
    expect(p3).toEqual({ x: 600, y: 0 });
    const dist = Math.hypot(600, -300);
    expect(c1).toEqual({ x: 0, y: 300 - dist * 0.4 }); // 起点沿走廊方向（向上）伸臂
    expect(c2).toEqual({ x: 600, y: dist * 0.4 }); // 终点沿走廊方向（向下）伸臂
  });

  it('curveControlPoints：两点线退化为直线（控制点在连线内）', () => {
    const [p0, c1, c2, p3] = curveControlPoints([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(c1).toEqual({ x: 40, y: 0 });
    expect(c2).toEqual({ x: 60, y: 0 });
    expect(p0).toEqual({ x: 0, y: 0 });
    expect(p3).toEqual({ x: 100, y: 0 });
  });

  it('flattenCurve：端点精确、采样数、t=0.5 对称中点', () => {
    const ctrl: [IPt, IPt, IPt, IPt] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ];
    const f = flattenCurve(ctrl, 24);
    expect(f).toHaveLength(25);
    expect(f[0]).toEqual({ x: 0, y: 0 });
    expect(f[24]).toEqual({ x: 100, y: 100 });
    // 对称控制点 → t=0.5 中点 = 控制点四元质心 (50, 50)
    expect(f[12]!.x).toBeCloseTo(50);
    expect(f[12]!.y).toBeCloseTo(50);
  });

  it('effectivePath CURVE = 贝塞尔 flatten 折线（命中/文字度量复用）', () => {
    const pts = [
      { x: 0, y: 300 },
      { x: 0, y: 270 },
      { x: 600, y: 30 },
      { x: 600, y: 0 },
    ];
    const path = effectivePath(pts, 'CURVE');
    expect(path.length).toBe(25);
    expect(path[0]).toEqual(pts[0]);
    expect(path[path.length - 1]).toEqual(pts[3]);
    // S 弯：中段横向偏离首尾连线（连线方程 x = 2y - ... 直线插值 t=0.5 处 (300,150)，
    // 贝塞尔对称 S 中点同位但相邻采样点横向偏移）
    const straightMid = { x: 300, y: 150 };
    const off = path.filter(
      (p) => Math.abs(p.x - straightMid.x) > 40 && Math.abs(p.y - straightMid.y) < 60,
    );
    expect(off.length).toBeGreaterThan(0); // 曲线在连线两侧展开（非重合）
  });
});
