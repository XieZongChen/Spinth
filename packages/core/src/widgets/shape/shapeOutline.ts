import type { IPoint, JoinDir } from '../../common/geometry';
import type { ShapeType } from '../../types';
import {
  CORNER_RADIUS_MAX,
  CORNER_RADIUS_RATIO,
  PARALLELOGRAM_SKEW_RATIO,
  cylinderSemiAxis,
  documentWave,
  fileFold,
  folderTab,
  hexagonSlant,
  offPageTip,
  queueSemiAxis,
  trapezoidWaist,
} from './shapeMetrics';

/**
 * 形状轮廓锚点（specs/flowchart-closeout §7.2 轮廓交点，G-04）：
 * bbox 边点 P 沿「P → 形心」方向与轮廓折线求最近交点——对 20 型统一成立、
 * 无需逐型解析；t=0.5 时凸形状结果与旧 bbox 边中点重合（保持既有锚点观感），
 * 只有会浮空的形状（triangle/parallelogram/trapezoid/eng 族/document/
 * off-page/delay）发生位移——这正是缺陷修复面。
 * 折线参数与 shapePath.drawShapePath 共用 shapeMetrics 单源；曲线按二次贝塞尔
 * 采样（每段 8 段，弦高误差 < 0.5px），点数 ≤ 48。
 */

/** 二次贝塞尔采样段数（每条曲线） */
const CURVE_SAMPLES = 8;
/** 椭圆圆周采样段数 */
const ELLIPSE_SAMPLES = 32;

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

const quadAt = (p0: IPoint, c: IPoint, p1: IPoint, t: number): IPoint => ({
  x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x,
  y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y,
});

function quadChain(p0: IPoint, c: IPoint, p1: IPoint, n = CURVE_SAMPLES): IPoint[] {
  const out: IPoint[] = [];
  for (let i = 0; i <= n; i++) out.push(quadAt(p0, c, p1, i / n));
  return out;
}

/** 矩形族（解析等值 = bbox 边点直接命中）：rect / round-rect / predefined-process */
const RECT_FAMILY: readonly ShapeType[] = ['rect', 'round-rect', 'predefined-process'];

/** 圆角矩形轮廓（round-rect 与 stadium 共用；每角 4 段弧采样） */
function roundedOutline(w: number, h: number, radius: number): IPoint[] {
  const r = Math.min(radius, w / 2, h / 2);
  const corner = (cx: number, cy: number, a0: number): IPoint[] => {
    const pts: IPoint[] = [];
    for (let i = 0; i <= 4; i++) {
      const a = a0 + (i / 4) * (Math.PI / 2);
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  };
  // 从左上角弧起点顺时针：上边 → 右上角 → 右边 → 右下角 → 下边 → 左下角 → 左边 → 左上角
  return [
    { x: r, y: 0 },
    { x: w - r, y: 0 },
    ...corner(w - r, r, -Math.PI / 2),
    ...corner(w - r, h - r, 0),
    ...corner(r, h - r, Math.PI / 2),
    ...corner(r, r, Math.PI),
  ];
}

/** 闭合轮廓折线（局部系，原点 = bbox 左上）。与 drawShapePath 同参数单源。 */
export function outlinePolyline(shapeType: ShapeType, w: number, h: number): IPoint[] {
  switch (shapeType) {
    case 'rect':
    case 'predefined-process':
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    case 'round-rect':
      return roundedOutline(
        w,
        h,
        Math.min(Math.min(w, h) * CORNER_RADIUS_RATIO, CORNER_RADIUS_MAX),
      );
    case 'stadium':
      return roundedOutline(w, h, Math.min(w, h) / 2);
    case 'ellipse': {
      const pts: IPoint[] = [];
      for (let i = 0; i < ELLIPSE_SAMPLES; i++) {
        const a = (i / ELLIPSE_SAMPLES) * Math.PI * 2;
        pts.push({ x: w / 2 + (w / 2) * Math.cos(a), y: h / 2 + (h / 2) * Math.sin(a) });
      }
      return pts;
    }
    case 'diamond':
      return [
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ];
    case 'triangle-up':
      return [
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    case 'triangle-down':
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w / 2, y: h },
      ];
    case 'parallelogram-right': {
      const sk = w * PARALLELOGRAM_SKEW_RATIO;
      return [
        { x: sk, y: 0 },
        { x: w, y: 0 },
        { x: w - sk, y: h },
        { x: 0, y: h },
      ];
    }
    case 'parallelogram-left': {
      const sk = w * PARALLELOGRAM_SKEW_RATIO;
      return [
        { x: 0, y: 0 },
        { x: w - sk, y: 0 },
        { x: w, y: h },
        { x: sk, y: h },
      ];
    }
    case 'eng-database': {
      const s = cylinderSemiAxis(h);
      // 与绘制同序：左身下行 → 底碗（凸向下）→ 右身上行 → 顶外弧（凸向上）
      return [
        { x: 0, y: s },
        { x: 0, y: h - s },
        ...quadChain({ x: 0, y: h - s }, { x: w / 2, y: h + s }, { x: w, y: h - s }),
        { x: w, y: s },
        ...quadChain({ x: w, y: s }, { x: w / 2, y: -s }, { x: 0, y: s }),
      ];
    }
    case 'eng-queue': {
      const s = queueSemiAxis(w);
      return [
        { x: s, y: 0 },
        { x: w - s, y: 0 },
        ...quadChain({ x: w - s, y: 0 }, { x: w + s, y: h / 2 }, { x: w - s, y: h }),
        { x: s, y: h },
        ...quadChain({ x: s, y: h }, { x: -s, y: h / 2 }, { x: s, y: 0 }),
      ];
    }
    case 'eng-file': {
      const f = fileFold(w);
      return [
        { x: 0, y: 0 },
        { x: w - f, y: 0 },
        { x: w, y: f },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    }
    case 'off-page': {
      const c = offPageTip(h);
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h - c },
        { x: w / 2, y: h },
        { x: 0, y: h - c },
      ];
    }
    case 'trapezoid-down': {
      const c = trapezoidWaist(w);
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w - c, y: h },
        { x: c, y: h },
      ];
    }
    case 'trapezoid-up': {
      const c = trapezoidWaist(w);
      return [
        { x: c, y: 0 },
        { x: w - c, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    }
    case 'delay': {
      const r = Math.min(h / 2, w);
      const a = w - r;
      return [
        { x: 0, y: 0 },
        { x: a, y: 0 },
        ...quadChain({ x: a, y: 0 }, { x: a + 2 * r, y: h / 2 }, { x: a, y: h }),
        { x: 0, y: h },
      ];
    }
    case 'eng-folder': {
      const t = folderTab(h);
      const tabR = w / 8;
      return [
        { x: 0, y: t },
        { x: w / 2 - tabR, y: t },
        { x: w / 2, y: 0 },
        { x: w / 2 + tabR, y: t },
        { x: w, y: t },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    }
    case 'document': {
      const c = documentWave(h);
      const base = h - c;
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: base },
        ...quadChain({ x: w, y: base }, { x: w * 0.8, y: h }, { x: w * 0.45, y: h }),
        ...quadChain({ x: w * 0.45, y: h }, { x: w * 0.15, y: base - c * 0.6 }, { x: 0, y: base }),
      ];
    }
    case 'hexagon': {
      const c = hexagonSlant(w, h);
      return [
        { x: c, y: 0 },
        { x: w - c, y: 0 },
        { x: w, y: h / 2 },
        { x: w - c, y: h },
        { x: c, y: h },
        { x: 0, y: h / 2 },
      ];
    }
    default:
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
  }
}

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
