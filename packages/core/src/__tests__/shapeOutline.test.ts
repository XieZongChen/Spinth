import { describe, expect, it } from 'vitest';
import type { JoinDir } from '../common/geometry';
import { ShapeTypeSchema } from '../types';
import { sqDistToSegment } from '../common/geometry';
import { bboxEdgePoint, outlineAnchor, outlinePolyline } from '../widgets/shape/shapeOutline';

/**
 * 轮廓交点锚点（specs/flowchart-closeout §7.2，G-04）：
 * - 20 型 × 4 join × t ∈ {0.25, 0.5, 0.75} 的锚点落在轮廓折线 0.5px 容差内
 *   （防「路径与锚点漂移」——折线参数与 drawShapePath 共用 shapeMetrics 单源）；
 * - t=0.5 时凸形状（rect 族 + ellipse/diamond/hexagon/stadium）与 bbox 边中点
 *   重合——保持既有锚点观感（老文档连线端点不动）；
 * - 浮空形状（triangle 等）锚点从 bbox 边移到轮廓上——缺陷修复面。
 */

const ALL_TYPES = ShapeTypeSchema.options;
const JOINS: JoinDir[] = ['top', 'right', 'bottom', 'left'];
const W = 160;
const H = 100;

function distToPolyline(
  p: { x: number; y: number },
  poly: Array<{ x: number; y: number }>,
): number {
  let best = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    best = Math.min(best, sqDistToSegment(p, a, b));
  }
  return Math.sqrt(best);
}

describe('outlineAnchor 全型守卫（specs/flowchart-closeout §7.2）', () => {
  it.each(ALL_TYPES)('%s：4 join × t∈{0.25,0.5,0.75} 锚点落折线 0.5px 容差内', (type) => {
    const poly = outlinePolyline(type, W, H);
    expect(poly.length).toBeGreaterThanOrEqual(3);
    expect(poly.length).toBeLessThanOrEqual(48);
    for (const join of JOINS) {
      for (const t of [0.25, 0.5, 0.75]) {
        const a = outlineAnchor(type, W, H, join, t);
        expect(distToPolyline(a, poly)).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('t=0.5：凸形状与 bbox 边中点重合（既有锚点观感不变，回归锁）', () => {
    for (const type of [
      'rect',
      'round-rect',
      'predefined-process',
      'ellipse',
      'diamond',
      'hexagon',
      'stadium',
    ] as const) {
      for (const join of JOINS) {
        expect(outlineAnchor(type, W, H, join, 0.5)).toEqual(bboxEdgePoint(W, H, join, 0.5));
      }
    }
  });

  it('浮空形状修复面：triangle-up 右边锚点从 bbox 边 (160,50) 移到斜边上', () => {
    const a = outlineAnchor('triangle-up', W, H, 'right', 0.5);
    // 斜边 (80,0)→(160,100)：中点 (120,50)；bbox 边中点 (160,50) 悬在三角外
    expect(a).toEqual({ x: 120, y: 50 });
    // bbox 边中点确实在三角形外（修复前的浮空缺陷）
    const bboxMid = bboxEdgePoint(W, H, 'right', 0.5);
    expect(distToPolyline(bboxMid, outlinePolyline('triangle-up', W, H))).toBeGreaterThan(20);
  });

  it('parallelogram-right：上边 t=0.25 锚点在斜移后的顶边上（非 bbox y=0 悬空段）', () => {
    const a = outlineAnchor('parallelogram-right', W, H, 'top', 0.25);
    // 顶边 (28.8,0)→(160,0)（斜宽 0.18×160=28.8）：t=0.25 的 bbox 点 (40,0) 已在
    // 顶边上（40 > 28.8）→ 等值；t=0.05 的 bbox 点 (8,0) 在顶边外 → 投到左边
    expect(a).toEqual({ x: 40, y: 0 });
    const b = outlineAnchor('parallelogram-right', W, H, 'top', 0.05);
    expect(b.y).toBeGreaterThan(0); // 不再悬在 bbox 上边
    expect(b.x).toBeLessThan(28.8);
  });
});
