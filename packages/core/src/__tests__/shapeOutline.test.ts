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

describe('锚点 vs 真实曲线（drawShapePath 同参数高密度收敛，specs/flowchart-closeout 返工）', () => {
  /** 二次贝塞尔高密度采样（真曲线基准——drawShapePath 的 quadraticCurveTo 同控制点） */
  const quadPts = (
    p0: { x: number; y: number },
    c: { x: number; y: number },
    p1: { x: number; y: number },
    n = 256,
  ): Array<{ x: number; y: number }> =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      const k = 1 - t;
      return {
        x: k * k * p0.x + 2 * k * t * c.x + t * t * p1.x,
        y: k * k * p0.y + 2 * k * t * c.y + t * t * p1.y,
      };
    });

  const distTo = (p: { x: number; y: number }, poly: Array<{ x: number; y: number }>): number =>
    Math.sqrt(Math.min(...poly.map((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2)));

  it('delay：大半径端帽上 t=0.35/0.65 锚点距真贝塞尔 ≤1px', () => {
    const w = 200;
    const h = 160; // r = 80（大半径）
    const r = Math.min(h / 2, w);
    const a = w - r;
    const curve = quadPts({ x: a, y: 0 }, { x: a + 2 * r, y: h / 2 }, { x: a, y: h });
    for (const t of [0.35, 0.5, 0.65]) {
      const anchor = outlineAnchor('delay', w, h, 'right', t);
      expect(distTo(anchor, curve)).toBeLessThanOrEqual(1);
    }
  });

  it('stadium：大端帽上 t=0.35/0.65 锚点距真圆弧 ≤1px（解析弧）', () => {
    const w = 200;
    const h = 120; // r = 60
    const r = Math.min(w, h) / 2;
    // 右端帽真圆弧：圆心 (w-r, h/2)、半径 r（roundRect 同口径）
    const arc = Array.from({ length: 129 }, (_, i) => {
      const ang = -Math.PI / 2 + (i / 128) * Math.PI;
      return { x: w - r + r * Math.cos(ang), y: h / 2 + r * Math.sin(ang) };
    });
    for (const t of [0.35, 0.5, 0.65]) {
      const anchor = outlineAnchor('stadium', w, h, 'right', t);
      expect(distTo(anchor, arc)).toBeLessThanOrEqual(1);
    }
  });

  it('eng-database：底碗 t=0.35/0.65 锚点距真贝塞尔 ≤1px', () => {
    const w = 140;
    const h = 180; // s = 27（h ≥ 180 不钳）
    const s = 27;
    const curve = quadPts({ x: 0, y: h - s }, { x: w / 2, y: h + s }, { x: w, y: h - s });
    for (const t of [0.3, 0.5, 0.7]) {
      const anchor = outlineAnchor('eng-database', w, h, 'bottom', t);
      expect(distTo(anchor, curve)).toBeLessThanOrEqual(1);
    }
  });

  it('document：底波 t∈{0.3,0.5,0.7} 锚点距真 S 波 ≤1px', () => {
    const w = 160;
    const h = 120; // c = 18（h ≥ 120 不钳）
    const c = 18;
    const base = h - c;
    const wave = [
      ...quadPts({ x: w, y: base }, { x: w * 0.8, y: h }, { x: w * 0.45, y: h }),
      ...quadPts({ x: w * 0.45, y: h }, { x: w * 0.15, y: base - c * 0.6 }, { x: 0, y: base }),
    ];
    for (const t of [0.3, 0.5, 0.7]) {
      const anchor = outlineAnchor('document', w, h, 'bottom', t);
      expect(distTo(anchor, wave)).toBeLessThanOrEqual(1);
    }
  });
});
