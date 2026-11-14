import { describe, expect, it } from 'vitest';
import {
  slideSegment,
  majorSegments,
  capsuleAnchors,
  branchSlotOffset,
  mergeCollinear,
  segmentBodyGrabbable,
  type IPt,
} from '../widgets/line/lineMath';

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

describe('segmentBodyGrabbable 近形禁拖（2026-11 用户拍板：锚定端相邻段不可拖）', () => {
  // U 形三段折线：段 0（首/贴起点）、段 1（中）、段 2（末/贴终点）
  const FREE = { start: false, end: false };
  const ANCH_S = { start: true, end: false };
  const ANCH_E = { start: false, end: true };
  const ANCH_BOTH = { start: true, end: true };

  it('真值表：锚定侧首/末段拒、中段恒可、自由端侧段放行', () => {
    expect(segmentBodyGrabbable(FREE, 0, 3)).toBe(true); // 全自由线不受限
    expect(segmentBodyGrabbable(ANCH_S, 0, 3)).toBe(false); // 贴起点段
    expect(segmentBodyGrabbable(ANCH_S, 1, 3)).toBe(true); // 中段
    expect(segmentBodyGrabbable(ANCH_S, 2, 3)).toBe(true); // 自由端侧末段
    expect(segmentBodyGrabbable(ANCH_E, 2, 3)).toBe(false); // 贴终点段
    expect(segmentBodyGrabbable(ANCH_E, 0, 3)).toBe(true);
    expect(segmentBodyGrabbable(ANCH_BOTH, 1, 3)).toBe(true); // 两端锚定仍留中段
  });

  it('唯一段（两点线）：任一端锚定即整条不可拖，全自由可拖', () => {
    expect(segmentBodyGrabbable(ANCH_S, 0, 1)).toBe(false);
    expect(segmentBodyGrabbable(ANCH_E, 0, 1)).toBe(false);
    expect(segmentBodyGrabbable(ANCH_BOTH, 0, 1)).toBe(false);
    expect(segmentBodyGrabbable(FREE, 0, 1)).toBe(true);
  });

  it('capsuleAnchors 同源过滤：锚定端相邻段不出胶囊（缺省不过滤 = 纯数学兼容）', () => {
    const pts: IPt[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ];
    expect(capsuleAnchors(pts, 1, null).map((c) => c.index)).toEqual([0, 1, 2]); // 缺省全出
    expect(capsuleAnchors(pts, 1, null, ANCH_S).map((c) => c.index)).toEqual([1, 2]);
    expect(capsuleAnchors(pts, 1, null, ANCH_E).map((c) => c.index)).toEqual([0, 1]);
    expect(capsuleAnchors(pts, 1, null, ANCH_BOTH).map((c) => c.index)).toEqual([1]);
  });
});
