import { describe, expect, it } from 'vitest';
import {
  anchorOf,
  nearestJoin,
  segmentGeoms,
  sqDistToSegment,
  polylineHit,
  nearestSegBody,
} from '../widgets/line/lineMath';

const RECT = { x: 100, y: 100, width: 200, height: 100 };

describe('lineMath（docs/08 §3）', () => {
  it('anchorOf：四边中点', () => {
    expect(anchorOf(RECT, 'top')).toEqual({ x: 200, y: 100 });
    expect(anchorOf(RECT, 'bottom')).toEqual({ x: 200, y: 200 });
    expect(anchorOf(RECT, 'left')).toEqual({ x: 100, y: 150 });
    expect(anchorOf(RECT, 'right')).toEqual({ x: 300, y: 150 });
  });

  it('anchorOf 沿边参数 t（specs/flowchart-closeout §7.1）：t=0.5 逐字节等价 + 四边插值 + θ 感知', () => {
    // t 缺省（0.5）与旧「边中点」逐字节等价——含 θ（绕心旋转同式）
    for (const j of ['top', 'bottom', 'left', 'right'] as const) {
      expect(anchorOf(RECT, j)).toEqual(anchorOf(RECT, j, 0, 0.5));
      expect(anchorOf(RECT, j, Math.PI / 4)).toEqual(anchorOf(RECT, j, Math.PI / 4, 0.5));
    }
    // top/bottom 沿左→右、left/right 沿上→下线性插值
    expect(anchorOf(RECT, 'top', 0, 0.25)).toEqual({ x: 150, y: 100 });
    expect(anchorOf(RECT, 'bottom', 0, 0.75)).toEqual({ x: 250, y: 200 });
    expect(anchorOf(RECT, 'left', 0, 0.25)).toEqual({ x: 100, y: 125 });
    expect(anchorOf(RECT, 'right', 0, 0.75)).toEqual({ x: 300, y: 175 });
    // θ=90°：top 边 1/4 点 (150,100)，中心 (200,150)，局部向量 (−50,−50)；
    // (x·cos−y·sin, x·sin+y·cos) = (50,−50) → 世界 (250,100)
    const a = anchorOf(RECT, 'top', Math.PI / 2, 0.25);
    expect(a.x).toBeCloseTo(250, 6);
    expect(a.y).toBeCloseTo(100, 6);
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
