import { describe, expect, it } from 'vitest';
import type { IRect } from '../common/geometry';
import {
  anchorOf,
  routeElbow,
  mergeCollinear,
  absorbTinyJogs,
  segmentIntersectsRect,
  pathLength,
  NODE_MARGIN,
  type IPt,
} from '../widgets/line/lineMath';

// ---------------------------------------------------------------------------
// ELBOWED 正交路由（docs/08 §4 候选走廊法）
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 第三方避障（specs/flowchart-closeout §8.2，G-06）
// ---------------------------------------------------------------------------

describe('全局避障：第三方障碍只进穿模过滤', () => {
  // A(100,100,200,100) 与 B(500,150,200,100) 同排；C 挡在两者连线正中
  const NODE_C: IRect = { x: 330, y: 90, width: 140, height: 120 };
  const start = { x: 300, y: 150 }; // A 右边中点
  const end = { x: 500, y: 200 }; // B 左边中点

  it('中间节点挡路：路由折线不与该节点 AABB 相交（绕行）', () => {
    const route = routeElbow({
      start,
      startJoin: 'right',
      end,
      endJoin: 'left',
      startNode: NODE_A,
      endNode: NODE_B,
      obstacles: [NODE_C],
    });
    expect(isOrthogonal(route)).toBe(true);
    for (const r of [NODE_A, NODE_B, NODE_C]) {
      // 排除锚点出线/入线段（首末段对端点宿主有豁免口径）
      for (let i = 1; i + 2 < route.length; i++) {
        expect(segmentIntersectsRect(route[i]!, route[i + 1]!, r, 2)).toBe(false);
      }
    }
  });

  it('无障碍时不回归：不传 obstacles 的路由与传空数组一致', () => {
    const a = routeElbow({
      start,
      startJoin: 'right',
      end,
      endJoin: 'left',
      startNode: NODE_A,
      endNode: NODE_B,
    });
    const b = routeElbow({
      start,
      startJoin: 'right',
      end,
      endJoin: 'left',
      startNode: NODE_A,
      endNode: NODE_B,
      obstacles: [],
    });
    expect(b).toEqual(a);
  });

  it('全挡死 fallback：极端围死仍返回首候选（保连通不抛错）', () => {
    const wall: IRect = { x: 200, y: 60, width: 400, height: 260 };
    const route = routeElbow({
      start,
      startJoin: 'right',
      end,
      endJoin: 'left',
      startNode: NODE_A,
      endNode: NODE_B,
      obstacles: [wall, wall, wall],
    });
    expect(route.length).toBeGreaterThanOrEqual(2);
    expect(isOrthogonal(route)).toBe(true);
  });
});

describe('collectRouteObstacles 收集（G-06 单源）', () => {
  it('排除两端节点/LINE/PEN，按距离升序、截断 MAX_OBSTACLES', async () => {
    const { collectRouteObstacles, MAX_OBSTACLES } = await import('../widgets/line/lineRoute');
    const rect = (
      x: number,
      y: number,
    ): { id: string; type: string; getHostGeom(): { rect: IRect; rotation: number } } => ({
      id: `v${x}_${y}`,
      type: 'SHAPE',
      getHostGeom: () => ({ rect: { x, y, width: 40, height: 40 }, rotation: 0 }),
    });
    const vms = [
      rect(160, 0), // 距中点近
      rect(320, 0), // 远
      {
        id: 'line1',
        type: 'LINE',
        getHostGeom: () => ({ rect: { x: 200, y: 0, width: 10, height: 10 }, rotation: 0 }),
      },
      {
        id: 'pen1',
        type: 'PEN',
        getHostGeom: () => ({ rect: { x: 210, y: 0, width: 10, height: 10 }, rotation: 0 }),
      },
      rect(240, 0), // = startId，排除
    ];
    const vmEngine = { getVmsInRect: () => vms };
    const out = collectRouteObstacles(
      vmEngine,
      { x: 200, y: 60 },
      { x: 300, y: 60 },
      'v240_0',
      null,
    );
    expect(out.length).toBe(2);
    expect(out[0]).toEqual({ x: 160, y: 0, width: 40, height: 40 }); // 近者在前
    expect(out[1]).toEqual({ x: 320, y: 0, width: 40, height: 40 });
    expect(MAX_OBSTACLES).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// 紧凑自环（specs/flowchart-closeout §7.5，G-07/M-02）
// ---------------------------------------------------------------------------

describe('routeSelfLoop 紧凑自环路由', () => {
  const NODE: IRect = { x: 100, y: 100, width: 120, height: 80 };
  const M = NODE_MARGIN;

  it('top→top 锚点重合：按跨度 80 展开出 U 形（全轴对齐、车道在边外 M）', async () => {
    const { routeSelfLoop } = await import('../widgets/line/lineRoute');
    const pts = routeSelfLoop({
      start: { x: 160, y: 100 },
      end: { x: 160, y: 100 },
      startJoin: 'top',
      endJoin: 'top',
      node: NODE,
    });
    expect(pts).toEqual([
      { x: 120, y: 100 },
      { x: 120, y: 100 - M },
      { x: 200, y: 100 - M },
      { x: 200, y: 100 },
    ]);
    expect(isOrthogonal(pts)).toBe(true);
  });

  it('right→right 显式不同 port：端点保持传入锚点，U 形不展开', async () => {
    const { routeSelfLoop } = await import('../widgets/line/lineRoute');
    const pts = routeSelfLoop({
      start: { x: 220, y: 124 },
      end: { x: 220, y: 156 },
      startJoin: 'right',
      endJoin: 'right',
      node: NODE,
    });
    expect(pts[0]).toEqual({ x: 220, y: 124 });
    expect(pts[pts.length - 1]).toEqual({ x: 220, y: 156 });
    expect(isOrthogonal(pts)).toBe(true);
    expect(pts.length).toBe(4);
  });

  it('top→bottom 对边：矩形环绕右侧车道（锚点均在中线 → 取右）', async () => {
    const { routeSelfLoop } = await import('../widgets/line/lineRoute');
    const pts = routeSelfLoop({
      start: { x: 160, y: 100 },
      end: { x: 160, y: 180 },
      startJoin: 'top',
      endJoin: 'bottom',
      node: NODE,
    });
    const laneX = NODE.x + NODE.width + M;
    expect(pts).toEqual([
      { x: 160, y: 100 },
      { x: 160, y: 100 - M },
      { x: laneX, y: 100 - M },
      { x: laneX, y: 180 + M },
      { x: 160, y: 180 + M },
      { x: 160, y: 180 },
    ]);
  });

  it('top→left 邻边：外角点（水平出线 x + 垂直出线 y）五点环', async () => {
    const { routeSelfLoop } = await import('../widgets/line/lineRoute');
    const pts = routeSelfLoop({
      start: { x: 160, y: 100 },
      end: { x: 100, y: 140 },
      startJoin: 'top',
      endJoin: 'left',
      node: NODE,
    });
    expect(pts).toEqual([
      { x: 160, y: 100 },
      { x: 160, y: 100 - M },
      { x: 100 - M, y: 100 - M },
      { x: 100 - M, y: 140 },
      { x: 100, y: 140 },
    ]);
    expect(isOrthogonal(pts)).toBe(true);
  });
});
