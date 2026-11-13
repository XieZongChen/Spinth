import { describe, expect, it } from 'vitest';
import {
  ANCHOR_JOINS,
  anchorDotCenter,
  anchorOf,
  dotOffsetCenter,
  outlineAnchorsOf,
  type IPt,
  type JoinDir,
} from '../widgets/line/lineMath';
import { dotSnapshots, nearestDot } from '../widgets/line/lineHoverMath';
import { nearestAnchorDot } from '../widgets/line/lineHitTest';
import { outlineAnchor } from '../widgets/shape/shapeOutline';

/** 轮廓 vm 桩：getAnchorPoint 走 shapeOutline（与 ShapeVm 覆写同式，不含平移/旋转） */
const outlineVm = (shapeType: string, w: number, h: number) => ({
  getAnchorPoint: (join: JoinDir, t: number): IPt =>
    outlineAnchor(shapeType as never, w, h, join, t),
});

const GEOM = { rect: { x: 0, y: 0, width: 120, height: 80 }, rotation: 0 };

describe('outlineAnchorsOf 反馈层锚点单源（specs/flowchart-closeout §7.1 第 3 层）', () => {
  it('vm 缺失回退 bbox 边中点（兼容桩/极端时序）', () => {
    const anchors = outlineAnchorsOf(null, GEOM);
    expect(anchors).toEqual([
      { x: 60, y: 0 },
      { x: 120, y: 40 },
      { x: 60, y: 80 },
      { x: 0, y: 40 },
    ]);
  });

  it('triangle-up 左右锚点贴斜边中点（≠ bbox 边中点——判别轮廓实现）', () => {
    const anchors = outlineAnchorsOf(outlineVm('triangle-up', 120, 80), GEOM);
    // 局部 (30,40)/(90,40)：与 bbox (0,40)/(120,40) 相差 30px
    expect(anchors[ANCHOR_JOINS.indexOf('left')]).toEqual({ x: 30, y: 40 });
    expect(anchors[ANCHOR_JOINS.indexOf('right')]).toEqual({ x: 90, y: 40 });
    // top/bottom 在顶点/底边中点（恰与 bbox 重合）
    expect(anchors[ANCHOR_JOINS.indexOf('top')]).toEqual({ x: 60, y: 0 });
    expect(anchors[ANCHOR_JOINS.indexOf('bottom')]).toEqual({ x: 60, y: 80 });
  });

  it('矩形 vm 锚点与 bbox 回退逐字节一致（老观感零漂移）', () => {
    const vm = outlineVm('rect', 120, 80);
    expect(outlineAnchorsOf(vm, GEOM)).toEqual(outlineAnchorsOf(null, GEOM));
  });
});

describe('anchorDotCenter 外移点（轮廓锚点 → 抓取热区/快照的唯一数学）', () => {
  it('bbox 版 = anchorOf + 同一外移数学（dotOffsetCenter 回归锁）', () => {
    for (const j of ANCHOR_JOINS) {
      expect(anchorDotCenter(anchorOf(GEOM.rect, j), j, 0, 2)).toEqual(
        dotOffsetCenter(GEOM.rect, j, 0, 2),
      );
    }
  });

  it('预计算锚点沿法向外移 24/scale——triangle 斜边锚点同样成立', () => {
    const anchors = outlineAnchorsOf(outlineVm('triangle-up', 120, 80), GEOM);
    expect(anchorDotCenter(anchors[3]!, 'left', 0, 1)).toEqual({ x: 30 - 24, y: 40 });
    expect(anchorDotCenter(anchors[1]!, 'right', 0, 2)).toEqual({ x: 90 + 12, y: 40 });
  });
});

describe('dotSnapshots / nearestDot / nearestAnchorDot 反馈几何（轮廓锚点入参）', () => {
  it('快照 = 轮廓锚点 + 法向外移；最近点判定与快照同源', () => {
    const anchors = outlineAnchorsOf(outlineVm('triangle-up', 120, 80), GEOM);
    const snaps = dotSnapshots(anchors, 0, 1);
    expect(snaps[ANCHOR_JOINS.indexOf('left')]).toEqual({ x: 6, y: 40 });
    expect(snaps[ANCHOR_JOINS.indexOf('right')]).toEqual({ x: 114, y: 40 });

    // 光标贴近左斜边外移点 (6,40) → 命中 left 且在 12px 抓取半径内
    // （「可见圆点 = 可抓点」——若热区仍按 bbox，此点距 bbox 外移点 (-24,40)
    // 有 30px，旧实现不可抓）
    const near = nearestDot(anchors, { x: 8, y: 41 }, 1);
    expect(near.j).toBe('left');
    const grab = nearestAnchorDot(anchors, { x: 8, y: 41 }, 1);
    expect(grab.j).toBe('left');
    expect(grab.d).toBeLessThanOrEqual(12);

    // 旧 bbox 左外移点 (-24,40)：距轮廓外移点 30px——超出抓取半径（不再可抓）
    const stale = nearestAnchorDot(anchors, { x: -22, y: 40 }, 1);
    expect(stale.j).toBe('left'); // 仍是最近侧，但
    expect(stale.d).toBeGreaterThanOrEqual(24); // 距离远超 12px 半径 → 不抓
  });

  it('nearestAnchorDot 与 nearestDot 同点同判（抓取与 hover 同口径）', () => {
    const anchors = outlineAnchorsOf(outlineVm('parallelogram-right', 120, 80), GEOM);
    // 平行四边形左锚点 = 左斜边中点 (60,40)，外移点 (36,40)
    const p = { x: 37, y: 40 };
    expect(nearestDot(anchors, p, 1).j).toBe('left');
    expect(nearestAnchorDot(anchors, p, 1).j).toBe('left');
  });
});
