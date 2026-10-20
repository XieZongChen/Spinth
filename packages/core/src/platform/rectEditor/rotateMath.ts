import type { IRect, IPoint } from '../../common/geometry';

/**
 * 旋转数学（docs/05 §8 旋转首版；resizeMath 同款纪律）：无状态纯函数，
 * 一切从「局部矩形 + θ + 输入点」推导，幂等。屏幕/世界共用（pixi 坐标系
 * y 轴向下，θ 正 = 视觉顺时针，与 pixi rotation 同向）。
 */

export const ROTATE_STEP = Math.PI / 12; // Shift 步进 15°
const TWO_PI = Math.PI * 2;

/** 角度归一到 [0, 2π) */
export function normalizeAngle(theta: number): number {
  const t = theta % TWO_PI;
  return t < 0 ? t + TWO_PI : t;
}

/** 点绕中心旋转 θ */
export function rotatePointAround(p: IPoint, center: IPoint, theta: number): IPoint {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/** 逆变换：世界点回到未旋转局部系（hitTest 用） */
export function inverseRotatePoint(p: IPoint, center: IPoint, theta: number): IPoint {
  return rotatePointAround(p, center, -theta);
}

/** 点是否在旋转后的矩形内（局部判定 + 边界含） */
export function pointInRotatedRect(p: IPoint, rect: IRect, theta: number): boolean {
  if (theta === 0) {
    return (
      p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height
    );
  }
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const local = inverseRotatePoint(p, center, theta);
  return (
    local.x >= rect.x &&
    local.x <= rect.x + rect.width &&
    local.y >= rect.y &&
    local.y <= rect.y + rect.height
  );
}

/** 旋转矩形的世界 AABB（θ=0 原样返回；外接矩形 = 中心 ± 半投影和） */
export function rotatedRectBounds(rect: IRect, theta: number): IRect {
  if (theta === 0) return { ...rect };
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  const halfW = (rect.width * cos + rect.height * sin) / 2;
  const halfH = (rect.width * sin + rect.height * cos) / 2;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { x: cx - halfW, y: cy - halfH, width: halfW * 2, height: halfH * 2 };
}

function projectPoly(poly: IPoint[], ax: number, ay: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = p.x * ax + p.y * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

function satIntersect(a: IPoint[], b: IPoint[]): boolean {
  const polys = [a, b];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i]!;
      const p2 = poly[(i + 1) % poly.length]!;
      // 凸多边形边法向轴（无需归一化——投影重叠判定与轴长无关）
      const ax = -(p2.y - p1.y);
      const ay = p2.x - p1.x;
      const pa = projectPoly(a, ax, ay);
      const pb = projectPoly(b, ax, ay);
      // <= 而非 <：边界相接不算相交——与 AABB 粗筛及基类 hitTestRect 口径一致
      if (pa.max <= pb.min || pb.max <= pa.min) return false;
    }
  }
  return true;
}

/** 旋转矩形四角（世界坐标，顺时针） */
export function rotatedRectCorners(rect: IRect, theta: number): [IPoint, IPoint, IPoint, IPoint] {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const corners: IPoint[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  if (theta === 0) return corners as [IPoint, IPoint, IPoint, IPoint];
  return corners.map((c) => rotatePointAround(c, center, theta)) as [
    IPoint,
    IPoint,
    IPoint,
    IPoint,
  ];
}

/** 旋转矩形 vs 轴对齐矩形（框选）是否相交——SAT 精判（AABB 粗筛由调用方做） */
export function rotatedRectIntersectsRect(rect: IRect, theta: number, r: IRect): boolean {
  const aabb = rotatedRectBounds(rect, theta);
  if (
    aabb.x + aabb.width <= r.x ||
    r.x + r.width <= aabb.x ||
    aabb.y + aabb.height <= r.y ||
    r.y + r.height <= aabb.y
  ) {
    return false;
  }
  const b: IPoint[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
  return satIntersect(rotatedRectCorners(rect, theta), b);
}

/** 指针绕中心的旋转角（atan2：右 = 0，下 = π/2——顺时针递增） */
export function pointerAngle(center: IPoint, p: IPoint): number {
  return Math.atan2(p.y - center.y, p.x - center.x);
}

/** 角度步进量化（Shift 15°） */
export function snapAngle(theta: number, step = ROTATE_STEP): number {
  return Math.round(theta / step) * step;
}

/**
 * pivot 式根变换（docs/05 §8 渲染落点）：x/y 数据语义（未旋转局部左上角）
 * 不变，pivot = 中心、position = 中心。θ=0 时视觉左上 = posX − w/2 = x
 * （与旧「position=左上」渲染逐字节等价）。
 */
export function computeRootTransform(
  x: number,
  y: number,
  w: number,
  h: number,
  theta: number,
): {
  pivotX: number;
  pivotY: number;
  posX: number;
  posY: number;
  rotation: number;
} {
  return { pivotX: w / 2, pivotY: h / 2, posX: x + w / 2, posY: y + h / 2, rotation: theta };
}
