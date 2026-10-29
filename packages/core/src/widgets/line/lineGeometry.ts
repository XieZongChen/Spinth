import type { IRect } from '../../common/geometry';
import { rotatePointAround, inverseRotatePoint } from '../../platform/rectEditor/rotateMath';
import type { IPt, JoinDir } from './lineMathTypes';

/** 连线基础几何（docs/08 §3）：锚点 / 最近边 / 段方向 / 点线距离 / 折线命中 /
 *  线段-矩形裁剪与相交 / 折线长度 / 段几何。全部无状态纯函数；route / path /
 *  handles 子域共同依赖的最底层模块。 */

function centerOf(rect: IRect): IPt {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** 矩形四边中点（锚点，docs/08 §3）。rotation（可选，docs/05 §8 锚定链）：
 *  锚点 = 局部边中点绕矩形中心旋转 θ 后的世界点——θ=0 与旧行为逐字节等价 */
export function anchorOf(rect: IRect, dir: JoinDir, rotation = 0): IPt {
  let a: IPt;
  switch (dir) {
    case 'top':
      a = { x: rect.x + rect.width / 2, y: rect.y };
      break;
    case 'bottom':
      a = { x: rect.x + rect.width / 2, y: rect.y + rect.height };
      break;
    case 'left':
      a = { x: rect.x, y: rect.y + rect.height / 2 };
      break;
    default:
      a = { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  }
  if (rotation === 0) return a;
  return rotatePointAround(a, centerOf(rect), rotation);
}

/** 光标落在矩形上时选最近边（小节点取最近边，docs/08 §3）。rotation（可选）：
 *  世界点先逆变换到局部再判——旋转件上仍选视觉最近边 */
export function nearestJoin(rect: IRect, p: IPt, rotation = 0): JoinDir {
  const center = centerOf(rect);
  const local = rotation === 0 ? p : inverseRotatePoint(p, center, rotation);
  const dx = (local.x - center.x) / (rect.width / 2 || 1);
  const dy = (local.y - center.y) / (rect.height / 2 || 1);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

/** 箭头方向单位向量（沿线段指向端点） */
export function segmentDirection(a: IPt, b: IPt): IPt {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/** 线段-点距离平方（命中检测，docs/08 §7） */
export function sqDistToSegment(p: IPt, a: IPt, b: IPt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const ex = p.x - (a.x + t * dx);
  const ey = p.y - (a.y + t * dy);
  return ex * ex + ey * ey;
}

/** 折线命中：任一段在容差内即命中 */
export function polylineHit(p: IPt, pts: IPt[], tolerance: number): boolean {
  const tolSq = tolerance * tolerance;
  if (pts.length >= 2) {
    for (let i = 0; i + 1 < pts.length; i++) {
      if (sqDistToSegment(p, pts[i]!, pts[i + 1]!) <= tolSq) return true;
    }
    return false;
  }
  return pts.length === 1 && sqDistToSegment(p, pts[0]!, pts[0]!) <= tolSq;
}

/** 出线方向法向表（top = y 负向，屏幕坐标系 y 向下）。routeElbow 走廊点与
 *  quantizeJoin 旋转量化共用单源（跨模块：lineRoute 依赖）。 */
export const JOIN_DIRS: Record<JoinDir, IPt> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** 旋转感知的出线方向（docs/05 §8，2026-10-16 用户实测揪出穿体）：边法向随 θ
 *  旋转后量化到最近轴对齐方向——正交路由（routeElbow 走廊/stub/进入段判定）
 *  对旋转宿主保持轴对齐语义，锚点位置不受影响（anchorOf 的 θ 数学独立）。
 *  θ=0 恒等返回（零旋转零变化）；量化在 45° 对角线上时取「顺时针侧」
 *  （y 分量优先），与 nearestJoin 的 dx/dy 平局口径一致 */
export function quantizeJoin(join: JoinDir, rotation = 0): JoinDir {
  if (rotation === 0) return join;
  const n = rotatePointAround(JOIN_DIRS[join], { x: 0, y: 0 }, rotation);
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  if (ay > ax) return n.y > 0 ? 'bottom' : 'top';
  if (ax > ay) return n.x > 0 ? 'right' : 'left';
  // 对角平局：顺时针侧（与 nearestJoin 的 |dx|>|dy| else-y 分支同口径）
  return n.y > 0 ? 'bottom' : 'top';
}

/**
 * 线段与矩形的相交判定（Liang-Barsky 参数裁剪）。
 * 矩形先内缩 eps：仅边界接触（锚点沿边法向出发）不算穿过。
 */
export function segmentIntersectsRect(a: IPt, b: IPt, r: IRect, eps = 0.5): boolean {
  const rx = r.x + eps;
  const ry = r.y + eps;
  const rw = r.width - eps * 2;
  const rh = r.height - eps * 2;
  if (rw <= 0 || rh <= 0) return false;
  return clipSegmentToRect(a, b, rx, ry, rw, rh) !== null;
}

/** 线段在矩形 (x,y,w,h) 内部的参数区间 [t0,t1]；无交集返回 null（跨模块：
 *  linePath 镂空切分同源复用） */
export function clipSegmentToRect(
  a: IPt,
  b: IPt,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): { t0: number; t1: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const bounds = [
    [-dx, a.x - rx],
    [dx, rx + rw - a.x],
    [-dy, a.y - ry],
    [dy, ry + rh - a.y],
  ] as const;
  for (const [p, q] of bounds) {
    if (p === 0) {
      if (q < 0) return null; // 与该边平行且在外侧
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1 ? { t0, t1 } : null;
}

/** 折线总长（跨模块：route 择优打分与 path 的 ratio 定位/反算共用度量） */
export function pathLength(pts: IPt[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    sum += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
  }
  return sum;
}

// ---------------------------------------------------------------------------
// 段几何（docs/08 §10 批次 3）：段中点手柄渲染 / hover 命中 / E2E 探针共用一份事实
// ---------------------------------------------------------------------------

/** 段几何：中点 + 方向角 + 段长 */
export interface ISegmentGeom {
  /** 段中点（世界坐标） */
  mid: IPt;
  /** 段方向角（弧度，屏幕坐标系 y 向下） */
  angle: number;
  /** 段长 */
  len: number;
}

/** 折线逐段几何：中点 + 方向角；零长段跳过（数据冗余点不产生手柄） */
export function segmentGeoms(pts: readonly IPt[]): ISegmentGeom[] {
  const out: ISegmentGeom[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    out.push({ mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle: Math.atan2(dy, dx), len });
  }
  return out;
}

/** 坐标取整（2 位小数）：路由浮点噪声不落库（lineService 系协作者共用单源） */
export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 段身抓取（2026-09-30 参考演示视频对齐）：线身任意点按住即拖所在段——
 * hover/按下共用「距段线身最近段 ≤ tolerance」口径（与 polylineHit 命中同源
 * 8px，即 SEGMENT_BODY_TOLERANCE），不再要求贴段中点胶囊。
 * 零长段跳过（数据冗余点不参与抢占）。
 */
export function nearestSegBody(
  pts: readonly IPt[],
  p: IPt,
  tolerance: number,
): { index: number; dist: number } | null {
  const tolSq = tolerance * tolerance;
  let bestD = Infinity;
  let bestIndex = -1;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (a.x === b.x && a.y === b.y) continue;
    const d = sqDistToSegment(p, a, b);
    if (d < bestD) {
      bestD = d;
      bestIndex = i;
    }
  }
  return bestIndex >= 0 && bestD <= tolSq ? { index: bestIndex, dist: Math.sqrt(bestD) } : null;
}

/** 直线（a→b）与直线（c→d）交点；平行/共线返回 null */
export function intersectLine(a: IPt, b: IPt, c: IPt, d: IPt): IPt | null {
  const d1x = b.x - a.x;
  const d1y = b.y - a.y;
  const d2x = d.x - c.x;
  const d2y = d.y - c.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / den;
  return { x: a.x + d1x * t, y: a.y + d1y * t };
}
