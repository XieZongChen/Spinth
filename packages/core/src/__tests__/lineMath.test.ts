import { describe, expect, it } from 'vitest';
import {
  anchorOf,
  nearestJoin,
  segmentGeoms,
  sqDistToSegment,
  polylineHit,
  slideSegment,
  pinKeepMiddle,
  majorSegments,
  capsuleAnchors,
  nearestSegBody,
  insetEnds,
  branchSlotOffset,
  curveControlPoints,
  flattenCurve,
  effectivePath,
  type IPt,
} from '../widgets/line/lineMath';
import { LineSchema } from '../types';

const RECT = { x: 100, y: 100, width: 200, height: 100 };

describe('lineMath（docs/08 §3）', () => {
  it('anchorOf：四边中点', () => {
    expect(anchorOf(RECT, 'top')).toEqual({ x: 200, y: 100 });
    expect(anchorOf(RECT, 'bottom')).toEqual({ x: 200, y: 200 });
    expect(anchorOf(RECT, 'left')).toEqual({ x: 100, y: 150 });
    expect(anchorOf(RECT, 'right')).toEqual({ x: 300, y: 150 });
  });

  it('nearestJoin：按象限选最近边', () => {
    expect(nearestJoin(RECT, { x: 400, y: 150 })).toBe('right');
    expect(nearestJoin(RECT, { x: 50, y: 150 })).toBe('left');
    expect(nearestJoin(RECT, { x: 200, y: 20 })).toBe('top');
    expect(nearestJoin(RECT, { x: 200, y: 300 })).toBe('bottom');
  });

  it('sqDistToSegment：点到线段距离', () => {
    expect(sqDistToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(9);
    expect(sqDistToSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(25); // 端点外
    expect(sqDistToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
  });

  it('polylineHit：容差命中（折线任一段）', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(polylineHit({ x: 50, y: 4 }, pts, 8)).toBe(true);
    expect(polylineHit({ x: 50, y: 12 }, pts, 8)).toBe(false);
    expect(polylineHit({ x: 104, y: 50 }, pts, 8)).toBe(true); // 第二段
  });
});

// ---------------------------------------------------------------------------
// ELBOWED 正交路由（docs/08 §4 候选走廊法）
// ---------------------------------------------------------------------------

import type { IRect } from '../common/geometry';
import {
  routeElbow,
  mergeCollinear,
  absorbTinyJogs,
  segmentIntersectsRect,
  pointAtRatio,
  ratioAtPoint,
  slicePathExcludingRect,
  slicePathByDash,
  pathLength,
  NODE_MARGIN,
} from '../widgets/line/lineMath';

/** 两矩形并排：A(100,100,200,100) B(500,150,200,100) */
const NODE_A: IRect = { x: 100, y: 100, width: 200, height: 100 };
const NODE_B: IRect = { x: 500, y: 150, width: 200, height: 100 };

function isOrthogonal(pts: IPt[]): boolean {
  for (let i = 0; i + 1 < pts.length; i++) {
    if (pts[i]!.x !== pts[i + 1]!.x && pts[i]!.y !== pts[i + 1]!.y) return false;
  }
  return true;
}

/** 任一段与矩形边线重合（±1 且区间重叠）——贴边视觉缺陷判定 */
function hugs(pts: IPt[], r: IRect): boolean {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const xO = Math.min(a.x, b.x) < r.x + r.width && Math.max(a.x, b.x) > r.x;
    const yO = Math.min(a.y, b.y) < r.y + r.height && Math.max(a.y, b.y) > r.y;
    if (a.y === b.y && xO && (Math.abs(a.y - r.y) <= 1 || Math.abs(a.y - (r.y + r.height)) <= 1))
      return true;
    if (a.x === b.x && yO && (Math.abs(a.x - r.x) <= 1 || Math.abs(a.x - (r.x + r.width)) <= 1))
      return true;
  }
  return false;
}

describe('routeElbow 正交路由（docs/08 §4）', () => {
  it('right→left 并排：正交、锚点精确、不穿两端节点', () => {
    const start = anchorOf(NODE_A, 'right'); // (300,150)
    const end = anchorOf(NODE_B, 'left'); // (500,200)
    const pts = routeElbow({
      start,
      startJoin: 'right',
      end,
      endJoin: 'left',
      startNode: NODE_A,
      endNode: NODE_B,
    });
    expect(pts[0]).toEqual(start);
    expect(pts[pts.length - 1]).toEqual(end);
    expect(isOrthogonal(pts)).toBe(true);
    for (let i = 0; i + 1 < pts.length; i++) {
      // 默认内缩语义 = 不穿节点内部（锚点边界接触放行）
      expect(segmentIntersectsRect(pts[i]!, pts[i + 1]!, NODE_A)).toBe(false);
      expect(segmentIntersectsRect(pts[i]!, pts[i + 1]!, NODE_B)).toBe(false);
    }
  });

  it('right→right 同侧对开：不贴 B 顶边走廊（视觉），绕下方不穿节点', () => {
    const start = anchorOf(NODE_A, 'right');
    const end = anchorOf(NODE_B, 'right'); // 同为右边
    const pts = routeElbow({
      start,
      startJoin: 'right',
      end,
      endJoin: 'right',
      startNode: NODE_A,
      endNode: NODE_B,
    });
    expect(pts[0]).toEqual(start);
    expect(pts[pts.length - 1]).toEqual(end);
    expect(isOrthogonal(pts)).toBe(true);
    // 旧行为「中线走廊 x 在两节点右侧」的水平段恰与 B 顶边重合（y=150）——
    // 压着边框走（2026-09-28 贴边降权后改为绕下方）
    for (let i = 0; i + 1 < pts.length; i++) {
      expect(segmentIntersectsRect(pts[i]!, pts[i + 1]!, NODE_A)).toBe(false);
      expect(segmentIntersectsRect(pts[i]!, pts[i + 1]!, NODE_B)).toBe(false);
    }
    expect(hugs(pts, NODE_A)).toBe(false);
    expect(hugs(pts, NODE_B)).toBe(false);
  });

  it('top→bottom 垂直堆叠：走垂直走廊', () => {
    const a: IRect = { x: 0, y: 0, width: 100, height: 60 };
    const b: IRect = { x: 300, y: 300, width: 100, height: 60 };
    const pts = routeElbow({
      start: anchorOf(a, 'bottom'),
      startJoin: 'bottom',
      end: anchorOf(b, 'top'),
      endJoin: 'top',
      startNode: a,
      endNode: b,
    });
    expect(pts[0]).toEqual(anchorOf(a, 'bottom'));
    expect(isOrthogonal(pts)).toBe(true);
    expect(pts.length).toBeLessThanOrEqual(6);
  });

  it('对齐直连（同 y、无节点阻挡）退化为两点直线', () => {
    const pts = routeElbow({
      start: { x: 0, y: 0 },
      startJoin: null,
      end: { x: 200, y: 0 },
      endJoin: null,
    });
    expect(pts).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
  });

  it('自由端（无锚定）也能路由且拐点 ≤ 2', () => {
    const pts = routeElbow({
      start: { x: 0, y: 0 },
      startJoin: null,
      end: { x: 100, y: 80 },
      endJoin: null,
    });
    expect(isOrthogonal(pts)).toBe(true);
    expect(pts.length).toBeLessThanOrEqual(4);
  });

  it('重合端点：返回两点', () => {
    const pts = routeElbow({
      start: { x: 5, y: 5 },
      startJoin: 'top',
      end: { x: 5, y: 5 },
      endJoin: 'top',
    });
    expect(pts).toHaveLength(2);
  });

  it('top→top 同向对开：不产生重影（无重复点、无越过锚点折回）', () => {
    // 2026-09 浏览器实测回归：A(400,216,160,120) B(800,156,160,120)，
    // 曾因中线取算术中点产生 [.., (880,156), (880,156)] 重影路由
    const a: IRect = { x: 400, y: 216, width: 160, height: 120 };
    const b: IRect = { x: 800, y: 156, width: 160, height: 120 };
    const pts = routeElbow({
      start: anchorOf(a, 'top'),
      startJoin: 'top',
      end: anchorOf(b, 'top'),
      endJoin: 'top',
      startNode: a,
      endNode: b,
    });
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[i + 1]!;
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeGreaterThan(0); // 无零长段
    }
    expect(isOrthogonal(pts)).toBe(true);
    expect(pts[0]).toEqual(anchorOf(a, 'top'));
    expect(pts[pts.length - 1]).toEqual(anchorOf(b, 'top'));
    // 水平走廊必须整体高于两节点顶边（不穿 B）
    const horiz = pts.find((p, i) => i > 0 && i < pts.length - 1 && p.y === pts[i + 1]?.y);
    expect(horiz ? horiz.y : Infinity).toBeLessThan(b.y);
  });

  it('走廊距离遵守 NODE_MARGIN（从锚点出发的第一段 ≥ margin）', () => {
    const start = anchorOf(NODE_A, 'right');
    const pts = routeElbow({
      start,
      startJoin: 'right',
      end: anchorOf(NODE_B, 'left'),
      endJoin: 'left',
      startNode: NODE_A,
      endNode: NODE_B,
    });
    const first = pathLength([pts[0]!, pts[1]!]);
    expect(first).toBeGreaterThanOrEqual(NODE_MARGIN - 1e-6);
  });
});

describe('mergeCollinear / absorbTinyJogs', () => {
  it('共线中点与重复点清除', () => {
    expect(
      mergeCollinear([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ]);
    expect(
      mergeCollinear([
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toHaveLength(2);
  });

  it('内部小抖动拐被吸附拉直（H-小V-H 对齐到较长 H）', () => {
    // quad [p1..p4] 全内部（p0/p5 是前后段端点）
    const pts: IPt[] = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 105 }, // 小 V（jog=5 < 16）
      { x: 150, y: 105 },
      { x: 150, y: 200 },
    ];
    const out = absorbTinyJogs(pts, 16);
    // 对齐到较长 H 段 y=100，抖动消除
    expect(out.some((p) => p.y === 105)).toBe(false);
    expect(isOrthogonal(out)).toBe(true);
    expect(out.length).toBeLessThan(pts.length);
  });

  it('首尾锚点邻接的 jog 不动（安全边界）', () => {
    const pts: IPt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 5 },
      { x: 200, y: 5 },
    ];
    // quad 需要 p0/p3 全内部，这里 p0 是首锚点 → 不处理
    expect(absorbTinyJogs(pts, 16)).toEqual(pts);
  });
});

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

describe('绕行候选（2026-09-28 用户实测：A 高 B 低底-底连接穿模）', () => {
  // A=(400,236,120,80) 左高；B=(700,286,120,80) 右低。底-底连接时标准走廊
  // 候选全被两端节点自身挡死，兜底曾返回穿模路线（水平段横穿 B 内部）
  const A = { x: 400, y: 236, width: 120, height: 80 };
  const B = { x: 700, y: 286, width: 120, height: 80 };

  /** 任一段穿过矩形内部（内缩 0.5 同 pathClear 口径） */
  const crosses = (
    pts: Array<{ x: number; y: number }>,
    r: { x: number; y: number; width: number; height: number },
  ): boolean => {
    for (let i = 0; i + 1 < pts.length; i++) {
      if (segmentIntersectsRect(pts[i]!, pts[i + 1]!, r)) return true;
    }
    return false;
  };
  /** 正交性：任一段必须水平或垂直（绕行候选曾缺拐角产出斜线段） */
  const orthogonal = (pts: Array<{ x: number; y: number }>): boolean =>
    pts.every((p, i) => i === 0 || pts[i - 1]!.x === p.x || pts[i - 1]!.y === p.y);

  it('bottom→top（松手点在 B 内部）：绕行不穿过任一节点，终段垂直进入顶边', () => {
    (globalThis as unknown as { __routeDebug: boolean }).__routeDebug = true;
    const route = routeElbow({
      start: { x: 460, y: 316 },
      startJoin: 'bottom',
      end: { x: 760, y: 286 },
      endJoin: 'top',
      startNode: A,
      endNode: B,
    });
    (globalThis as unknown as { __routeDebug: boolean }).__routeDebug = false;
    expect(crosses(route, A)).toBe(false);
    expect(crosses(route, B)).toBe(false);
    expect(orthogonal(route)).toBe(true);
    const n = route.length;
    expect(route[n - 2]!.x).toBe(760); // 终段垂直
    expect(route[n - 2]!.y).toBeLessThan(286); // 从上方进入 top 锚点
  });

  it('bottom→bottom（松手点在 B 下半）：绕行从下方进入底边', () => {
    const route = routeElbow({
      start: { x: 460, y: 316 },
      startJoin: 'bottom',
      end: { x: 760, y: 366 },
      endJoin: 'bottom',
      startNode: A,
      endNode: B,
    });
    expect(crosses(route, A)).toBe(false);
    expect(crosses(route, B)).toBe(false);
    expect(orthogonal(route)).toBe(true);
    const n = route.length;
    expect(route[n - 2]!.x).toBe(760);
    expect(route[n - 2]!.y).toBeGreaterThan(366); // 从下方进入 bottom 锚点
  });

  it('畅通场景不回归：无遮挡走廊候选仍以最少拐点胜出（绕行不改变既有路由）', () => {
    // A 右 → B 左（水平对向）：直线走廊，2 拐点以内
    const route = routeElbow({
      start: { x: 520, y: 276 },
      startJoin: 'right',
      end: { x: 700, y: 326 },
      endJoin: 'left',
      startNode: A,
      endNode: B,
    });
    expect(crosses(route, A)).toBe(false);
    expect(crosses(route, B)).toBe(false);
    expect(orthogonal(route)).toBe(true);
    expect(route.length).toBeLessThanOrEqual(4);
  });
});

describe('贴边降权（2026-09-28 用户实测：走廊与形状边线重合压边走）', () => {
  it('bottom→bottom 且 A 走廊高度恰等于 B 底边：路由不贴 B 边线', () => {
    // 复刻用户截图 2：A 底 385（走廊 s1.y=415 恰 = B 底 415）
    const A = { x: 213, y: 300, width: 247, height: 85 };
    const B = { x: 593, y: 255, width: 237, height: 160 };
    const route = routeElbow({
      start: { x: 340, y: 385 },
      startJoin: 'bottom',
      end: { x: 711, y: 415 },
      endJoin: 'bottom',
      startNode: A,
      endNode: B,
    });
    expect(hugs(route, B)).toBe(false);
    expect(hugs(route, A)).toBe(false);
  });

  it('正常场景不回归：走廊不与边线重合时路由不变', () => {
    const A = { x: 400, y: 236, width: 120, height: 80 };
    const B = { x: 700, y: 286, width: 120, height: 80 };
    const route = routeElbow({
      start: { x: 460, y: 316 },
      startJoin: 'bottom',
      end: { x: 760, y: 316 },
      endJoin: 'bottom',
      startNode: A,
      endNode: B,
    });
    expect(hugs(route, A)).toBe(false);
    expect(hugs(route, B)).toBe(false);
  });
});

describe('锚定进入段最短长度（2026-09-28 用户实测：短末段挤压箭头）', () => {
  it('B 只比 A 低 22px（< 走廊 margin 30）：淘汰短末段候选，进入段 ≥ 20', () => {
    // B 底 338 = A 底 316 + 22：候选「水平段在 s1.y=346」的末段仅 8px（< 箭头 10）
    const A = { x: 400, y: 236, width: 120, height: 80 };
    const B = { x: 700, y: 258, width: 120, height: 80 };
    const route = routeElbow({
      start: { x: 460, y: 316 },
      startJoin: 'bottom',
      end: { x: 760, y: 338 },
      endJoin: 'bottom',
      startNode: A,
      endNode: B,
    });
    const n = route.length;
    const first = Math.hypot(route[1]!.x - route[0]!.x, route[1]!.y - route[0]!.y);
    const last = Math.hypot(route[n - 1]!.x - route[n - 2]!.x, route[n - 1]!.y - route[n - 2]!.y);
    expect(first).toBeGreaterThanOrEqual(20);
    expect(last).toBeGreaterThanOrEqual(20);
    expect(hugs(route, A)).toBe(false);
    expect(hugs(route, B)).toBe(false);
  });

  it('正常间距（B 低 90px）不回归：走廊候选照常胜出', () => {
    const A = { x: 400, y: 236, width: 120, height: 80 };
    const B = { x: 700, y: 326, width: 120, height: 80 };
    const route = routeElbow({
      start: { x: 460, y: 316 },
      startJoin: 'bottom',
      end: { x: 760, y: 406 },
      endJoin: 'bottom',
      startNode: A,
      endNode: B,
    });
    const n = route.length;
    const last = Math.hypot(route[n - 1]!.x - route[n - 2]!.x, route[n - 1]!.y - route[n - 2]!.y);
    expect(last).toBeGreaterThanOrEqual(20);
  });
});

describe('segmentGeoms 段几何（docs/08 §10 批次 3，段中点手柄/滑移共用）', () => {
  it('直线 2 点 → 1 段：中点/水平角/段长', () => {
    const segs = segmentGeoms([
      { x: 100, y: 200 },
      { x: 300, y: 200 },
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.mid).toEqual({ x: 200, y: 200 });
    expect(segs[0]!.angle).toBe(0);
    expect(segs[0]!.len).toBe(200);
  });

  it('折线 4 点 → 3 段：垂直段角 π/2、斜段角 atan2', () => {
    const segs = segmentGeoms([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]);
    expect(segs).toHaveLength(3);
    expect(segs[0]!.angle).toBeCloseTo(Math.PI / 2);
    expect(segs[1]!.angle).toBe(0);
    expect(segs[2]!.angle).toBeCloseTo(Math.PI / 4);
    expect(segs[2]!.mid).toEqual({ x: 150, y: 150 });
  });

  it('零长段跳过（数据冗余点不产生手柄）', () => {
    const segs = segmentGeoms([
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 50, y: 10 },
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.mid).toEqual({ x: 30, y: 10 });
  });

  it('空输入与单点 → 空数组', () => {
    expect(segmentGeoms([])).toEqual([]);
    expect(segmentGeoms([{ x: 1, y: 2 }])).toEqual([]);
  });
});

describe('slideSegment 段滑移（docs/08 §10 批次 3 waypoint）', () => {
  it('水平中段沿法向平移：拐点更新、其余点不动', () => {
    const pts = [
      { x: 0, y: 100 },
      { x: 0, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 100 },
    ];
    const next = slideSegment(pts, 1, 40);
    expect(next[0]).toEqual({ x: 0, y: 100 });
    expect(next[1]).toEqual({ x: 0, y: 90 });
    expect(next[2]).toEqual({ x: 200, y: 90 });
    expect(next[3]).toEqual({ x: 200, y: 100 });
  });

  it('垂直段平移：法向 = x 轴方向', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const next = slideSegment(pts, 1, 30);
    expect(next[0]).toEqual({ x: 0, y: 0 });
    expect(next[1]).toEqual({ x: 70, y: 0 });
    expect(next[2]).toEqual({ x: 70, y: 100 });
    expect(next[3]).toEqual({ x: 0, y: 100 });
  });

  it('相邻段与被移段平行：退化取平移端点', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 150, y: 0 },
      { x: 250, y: 50 },
    ];
    const next = slideSegment(pts, 1, 20);
    expect(next[1]).toEqual({ x: 100, y: 20 }); // 前段平行 → a2
    expect(next[2]).toEqual({ x: 190, y: 20 }); // 后段斜线 ∩ 新段 y=20 → (190,20)
    expect(next[0]).toEqual({ x: 0, y: 0 });
    expect(next[3]).toEqual({ x: 250, y: 50 });
  });
});

describe('pinKeepMiddle pinned 路由（docs/08 §10 批次 3）', () => {
  const pts = [
    { x: 10, y: 20 },
    { x: 10, y: 50 },
    { x: 100, y: 50 },
    { x: 200, y: 50 },
    { x: 200, y: 80 },
  ];

  it('两端锚点重贴、中间拐点保持（U 形不丢）', () => {
    const next = pinKeepMiddle(pts, { x: 15, y: 25 }, { x: 195, y: 75 });
    expect(next[0]).toEqual({ x: 15, y: 25 });
    expect(next[next.length - 1]).toEqual({ x: 195, y: 75 });
    expect(next.slice(1, -1)).toEqual(pts.slice(1, -1));
  });

  it('null 端不重贴', () => {
    const next = pinKeepMiddle(pts, null, { x: 195, y: 75 });
    expect(next[0]).toEqual({ x: 10, y: 20 });
    expect(next[next.length - 1]).toEqual({ x: 195, y: 75 });
  });
});

describe('LineSchema pinned 默认值（批次 3）', () => {
  it('缺省解析为 false', () => {
    const line = LineSchema.parse({
      id: 'l1',
      type: 'LINE',
      zOrder: 'a',
      points: [
        [0, 0],
        [10, 0],
      ],
    });
    expect(line.pinned).toBe(false);
  });
});

describe('majorSegments 主段过滤（docs/08 §10 批次 3.6——短段胶囊贴端点手柄）', () => {
  it('短段（<60/scale）与零长段一并过滤；index = 真实段号', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: 30 }, // 段 0：走廊 30px → 过滤
      { x: 0, y: 30 }, // 段 1：零长（重复点）→ 过滤
      { x: 300, y: 30 }, // 段 2：300px → 主段
      { x: 300, y: 400 }, // 段 3：370px → 主段
    ];
    const m = majorSegments(pts, 1);
    expect(m.map((x) => x.index)).toEqual([2, 3]);
    expect(m[0]!.geom.mid).toEqual({ x: 150, y: 30 });
  });

  it('scale 反补偿：zoom 0.5 下 100px 世界段屏显 50px 过滤、200px 段屏显 100px 保留', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 }, // 世界 100 @ scale 0.5 → 屏显 50px → 过滤
      { x: 300, y: 0 }, // 世界 200 → 屏显 100px → 保留
    ];
    const m = majorSegments(pts, 0.5);
    expect(m.map((x) => x.index)).toEqual([1]);
  });
});

describe('capsuleAnchors 胶囊锚点（2026-10-02 参考规格——有字连线两侧双胶囊）', () => {
  it('无字（knockout=null）= majorSegments 现状口径', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: 30 },
      { x: 300, y: 30 },
    ];
    const a = capsuleAnchors(pts, 1, null);
    const m = majorSegments(pts, 1);
    expect(a.map((x) => x.index)).toEqual(m.map((x) => x.index));
    expect(a[0]!.geom.mid).toEqual(m[0]!.geom.mid);
  });

  it('唯一段直线被文字矩形切两半：两侧各一锚点、段号都映射段 0', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ];
    // 文字矩形居中：x 180~220（宽 40）
    const a = capsuleAnchors(pts, 1, { x: 180, y: -20, width: 40, height: 40 });
    expect(a).toHaveLength(2);
    expect(a.map((x) => x.index)).toEqual([0, 0]);
    // 左侧可见 [0,180) 弧长中点 90；右侧 (220,400] 中点 310
    expect(a[0]!.geom.mid.x).toBeCloseTo(90, 5);
    expect(a[1]!.geom.mid.x).toBeCloseTo(310, 5);
    expect(a[0]!.geom.mid.y).toBe(0);
    expect(a[0]!.geom.angle).toBeCloseTo(0, 5); // 沿所在段方向
  });

  it('矩形不与路径相交 → 回退 majorSegments', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ];
    const a = capsuleAnchors(pts, 1, { x: 100, y: 50, width: 40, height: 40 });
    expect(a).toHaveLength(1);
    expect(a[0]!.geom.mid.x).toBe(200); // 段中点
  });

  it('贴端点的极短侧（屏显 <24px）不放锚点', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ];
    // 文字矩形几乎顶住起点：左侧可见仅 10px
    const a = capsuleAnchors(pts, 1, { x: 10, y: -20, width: 60, height: 40 });
    expect(a).toHaveLength(1);
    expect(a[0]!.geom.mid.x).toBeGreaterThan(70); // 右侧锚点在矩形右侧
  });

  it('折线：切出两条可见部分各一锚点（走廊并入左侧部分、完整长段并入右侧）', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: 30 }, // 走廊 30px
      { x: 400, y: 30 }, // 长水平段（被文字切）
      { x: 400, y: 300 }, // 长垂直段（完整）
    ];
    const a = capsuleAnchors(pts, 1, { x: 180, y: 10, width: 40, height: 40 });
    // 两部分 = [(0,0)→(180,30)] 弧长 210 与 [(220,30)→(400,300)] 弧长 450
    expect(a).toHaveLength(2);
    // 部分 1 中点：弧长 105 = 走廊 30 + 75 → 段 1 上 (75, 30)
    expect(a[0]!.index).toBe(1);
    expect(a[0]!.geom.mid).toEqual({ x: 75, y: 30 });
    expect(a[0]!.geom.angle).toBeCloseTo(0, 5);
    // 部分 2 中点：弧长 225 = 右半 180 + 45 → 段 2 上 (400, 75)
    expect(a[1]!.index).toBe(2);
    expect(a[1]!.geom.mid.x).toBe(400);
    expect(a[1]!.geom.mid.y).toBeCloseTo(75, 5);
    expect(a[1]!.geom.angle).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe('nearestSegBody 段身抓取（2026-09-30 参考视频对齐——线身任意点可拖）', () => {
  it('U 形：按在首段 1/4 处命中段 0，按在长中段端部命中段 2', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: 200 }, // 段 0：竖
      { x: 400, y: 200 }, // 段 1：长横
      { x: 400, y: 0 }, // 段 2：竖
    ];
    expect(nearestSegBody(pts, { x: 0, y: 50 }, 8)).toEqual({ index: 0, dist: 0 });
    expect(nearestSegBody(pts, { x: 390, y: 204 }, 8)).toEqual({ index: 1, dist: 4 });
    expect(nearestSegBody(pts, { x: 403, y: 30 }, 8)).toEqual({ index: 2, dist: 3 });
  });

  it('出容差返回 null；多段取最近；零长段不参与抢占', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: 0 }, // 零长段
      { x: 100, y: 0 },
    ];
    expect(nearestSegBody(pts, { x: 50, y: 8.5 }, 8)).toBeNull(); // 距 8.5 > 8
    expect(nearestSegBody(pts, { x: 50, y: 8 }, 8)).toEqual({ index: 1, dist: 8 });
    expect(nearestSegBody(pts, { x: -9, y: -9 }, 8)).toBeNull(); // 拐角外两段都超容差
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

describe('slideSegment 首末段（2026-09-30 两档：长段拆几字形保正交 / 短段斜连）', () => {
  const u: IPt[] = [
    { x: 100, y: 400 }, // 锚点端（左下）
    { x: 100, y: 100 }, // 左上拐
    { x: 400, y: 100 }, // 右上拐
    { x: 400, y: 400 }, // 末锚点
  ];

  it('首段长段（300 ≥ NODE_MARGIN）：拆几字形——锚点正交伸 stub、垂直连接被拖段、与后段求交', () => {
    const next = slideSegment(u, 0, 50); // 首段右移 50（法向 (1,0)）
    expect(next).toEqual([
      { x: 100, y: 400 }, // 锚点不动
      { x: 100, y: 370 }, // stub = min(30, 300/3) 沿原方向（竖）
      { x: 150, y: 370 }, // 垂直连接到被拖段
      { x: 150, y: 100 }, // 被拖段（平移 50）与后段（y=100 横线）求交
      { x: 400, y: 100 },
      { x: 400, y: 400 },
    ]); // 全程正交——锚点端不斜
  });

  it('末段长段：镜像拆几字形——与前段求交、垂直连接、末锚点正交伸 stub 保持', () => {
    const next = slideSegment(u, 2, 50); // 末段左移 50（法向 (−1,0)）
    expect(next).toEqual([
      { x: 100, y: 400 },
      { x: 100, y: 100 },
      { x: 350, y: 100 }, // 被拖段（平移 50）与前段（y=100）求交
      { x: 350, y: 370 }, // 垂直连接
      { x: 400, y: 370 }, // 末锚点侧 stub（竖）
      { x: 400, y: 400 }, // 末锚点不动
    ]);
  });

  it('首段短段（20 < NODE_MARGIN=30）：斜连退化——锚点保持、拐点平移求交', () => {
    const pts: IPt[] = [
      { x: 100, y: 400 },
      { x: 100, y: 380 }, // 首段长 20（走廊短段）
      { x: 400, y: 380 },
      { x: 400, y: 400 },
    ];
    const next = slideSegment(pts, 0, 50);
    expect(next).toEqual([
      { x: 100, y: 400 }, // 锚点不动
      { x: 150, y: 380 }, // 平移段 x=150 与后段 y=380 求交（与锚点成斜段）
      { x: 400, y: 380 },
      { x: 400, y: 400 },
    ]);
  });

  it('末段短段：镜像斜连退化', () => {
    const pts: IPt[] = [
      { x: 100, y: 400 },
      { x: 100, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 120 }, // 末段长 20
    ];
    const next = slideSegment(pts, 2, 50); // 法向 (−1,0) 左移
    expect(next).toEqual([
      { x: 100, y: 400 },
      { x: 100, y: 100 },
      { x: 350, y: 100 }, // 与前段求交（与末锚点成斜段）
      { x: 400, y: 120 }, // 末锚点不动
    ]);
  });

  it('长段 offset=0：拆点共线——mergeCollinear 清回原形（幂等）', () => {
    const next = mergeCollinear(slideSegment(u, 0, 0));
    expect(next).toEqual(u);
  });

  it('唯一段（两点线）：两端保持 + 拆五点正交（参考视频实锤——拖水平直连线成「几」形）', () => {
    const next = slideSegment(
      [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
      ],
      0,
      -60,
    ); // 水平段上移 60：法向 (0,−1)（段方向 (1,0)）
    expect(next.length).toBe(6);
    expect(next[0]).toEqual({ x: 0, y: 0 }); // 两端锚点保持
    expect(next[5]).toEqual({ x: 300, y: 0 });
    expect(next[1]).toEqual({ x: 30, y: 0 }); // stub = min(30, 300/3) = 30
    expect(next[2]).toEqual({ x: 30, y: -60 }); // 被拖段平移
    expect(next[3]).toEqual({ x: 270, y: -60 });
    expect(next[4]).toEqual({ x: 270, y: 0 });
  });

  it('唯一段 offset=0：拆点共线——mergeCollinear 清回原形（幂等）', () => {
    const next = mergeCollinear(
      slideSegment(
        [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
        ],
        0,
        0,
      ),
    );
    expect(next).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
    ]);
  });

  it('唯一段短段：stub 钳制 len/3（锚点连接段不越过中线）', () => {
    const next = slideSegment(
      [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
      ],
      0,
      20,
    );
    expect(next[1]).toEqual({ x: 20, y: 0 }); // stub = 60/3
    expect(next[3]).toEqual({ x: 40, y: 20 });
  });
});

describe('branchSlotOffset 交替落位槽位（docs/08 §10 批次 2，2026-10-02 参考视频）', () => {
  it('槽位交替：n=1 → -1、n=2 → +1、n=3 → -2、n=4 → +2（负侧 = 水平上方/垂直左方）', () => {
    const perp = 200; // stride = 200 + 70 = 270（整卡位 + 净间隙）
    expect(branchSlotOffset(1, perp)).toBe(-270);
    expect(branchSlotOffset(2, perp)).toBe(270);
    expect(branchSlotOffset(3, perp)).toBe(-540);
    expect(branchSlotOffset(4, perp)).toBe(540);
  });

  it('stride = 垂直边长 + 净间隙 70——错开一整个卡位不重叠', () => {
    expect(branchSlotOffset(1, 100)).toBe(-170);
    expect(branchSlotOffset(1, 260)).toBe(-330); // 参考视频实测：260 高卡中心偏移 330 = 260 + 70
    expect(branchSlotOffset(1, 500)).toBe(-570);
  });

  it('n<1（方向空闲）无偏移，正对落位', () => {
    expect(branchSlotOffset(0, 200)).toBe(0);
    expect(branchSlotOffset(-1, 200)).toBe(0);
  });
});
