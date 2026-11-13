import type { IPoint, JoinDir } from '../../common/geometry';
import type { ShapeType } from '../../types';
import { outlinePolyline } from './shapeOutlinePolylines';

export { outlinePolyline } from './shapeOutlinePolylines';

/**
 * 形状轮廓锚点（specs/flowchart-closeout §7.2 轮廓交点，G-04）：
 * bbox 边点 P 沿「P → 形心」方向与轮廓折线求最近交点——对 20 型统一成立、
 * 无需逐型解析；t=0.5 时凸形状结果与旧 bbox 边中点重合（保持既有锚点观感），
 * 只有会浮空的形状（triangle/parallelogram/trapezoid/eng 族/document/
 * off-page/delay）发生位移——这正是缺陷修复面。
 * 折线数据表在 shapeOutlinePolylines（§23 拆分，<200 行）、曲线采样工具在
 * shapeOutlineCurves；折线参数与 shapePath.drawShapePath 共用 shapeMetrics
 * 单源；曲线按二次贝塞尔采样（每段 8 段，弦高误差 < 0.5px），点数 ≤ 48。
 */

export function bboxEdgePoint(w: number, h: number, join: JoinDir, t: number): IPoint {
  switch (join) {
    case 'top':
      return { x: w * t, y: 0 };
    case 'bottom':
      return { x: w * t, y: h };
    case 'left':
      return { x: 0, y: h * t };
    default:
      return { x: w, y: h * t };
  }
}

/** 矩形族（解析等值 = bbox 边点直接命中）：rect / round-rect / predefined-process */
const RECT_FAMILY: readonly ShapeType[] = ['rect', 'round-rect', 'predefined-process'];

/** 轮廓锚点（局部系）：P → 形心射线与折线最近交点；矩形族 / 无交点回退 P */
export function outlineAnchor(
  shapeType: ShapeType,
  w: number,
  h: number,
  join: JoinDir,
  t: number,
): IPoint {
  const p = bboxEdgePoint(w, h, join, t);
  if (RECT_FAMILY.includes(shapeType)) return p;
  const poly = outlinePolyline(shapeType, w, h);
  const c = { x: w / 2, y: h / 2 };
  const dx = c.x - p.x;
  const dy = c.y - p.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return p;
  let best: IPoint | null = null;
  let bestU = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    // 解 P + u·d = A + v·(B−A)，取最小 u ≥ 0
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const u = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den;
    const v = ((a.x - p.x) * dy - (a.y - p.y) * dx) / den;
    if (u >= -1e-9 && v >= -1e-9 && v <= 1 + 1e-9 && u < bestU) {
      bestU = Math.max(u, 0);
      best = { x: p.x + bestU * dx, y: p.y + bestU * dy };
    }
  }
  return best ?? p;
}
