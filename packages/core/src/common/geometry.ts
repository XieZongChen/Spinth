/** 几何纯函数（业务无关，全部可单测） */

export interface IRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IPoint {
  x: number;
  y: number;
}

/** 宿主几何（锚定链视角，docs/05 §8）：rect = 视觉局部矩形（未旋转系，
 *  预览感知），rotation = 弧度（绕中心顺时针） */
export interface IHostGeom {
  rect: IRect;
  rotation: number;
}

export function rectsIntersect(a: IRect, b: IRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function rectContainsPoint(r: IRect, p: IPoint): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function rectsEqual(a: IRect, b: IRect, epsilon = 1e-4): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
}

/** 点到线段的距离平方（连线命中检测用，Phase 2） */
export function sqDistToSegment(p: IPoint, a: IPoint, b: IPoint): number {
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

/** 多个矩形包络 */
export function unionRects(rects: IRect[]): IRect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 点集平移（LINE/PEN 拖拽落库用） */
export function translatePoints<T extends [number, number] | number[]>(
  points: readonly T[],
  dx: number,
  dy: number,
): T[] {
  return points.map((p) => [p[0]! + dx, p[1]! + dy] as T);
}

/**
 * 点集从 startRect 线性重映射到 nextRect（LINE/PEN 缩放落库/预览用）。
 * 无状态纯函数：同一输入永远同一输出（docs/14 规则 3）。
 * 零宽/零高轴不缩放（避免除零放大成 NaN/Infinity）。
 */
export function mapPointsRect<T extends [number, number] | number[]>(
  points: readonly T[],
  start: IRect,
  next: IRect,
): T[] {
  const sx = start.width > 0 ? next.width / start.width : 1;
  const sy = start.height > 0 ? next.height / start.height : 1;
  return points.map((p) => [next.x + (p[0]! - start.x) * sx, next.y + (p[1]! - start.y) * sy] as T);
}

// ---------- 橡皮分段切割（eraser，2026-10-08） ----------
// 语义（参考同款、用户拍板）：橡皮只擦 PEN 笔画、扫过部分消失、剩余分段保留。
// 工程结论：测「扫掠线段」而非测点（上一 move 到当前 move 的
// 线段，快速移动无隧穿）；到凸集（线段）的距离函数沿笔画段是凸函数（凸函数
// 复合线性参数仍凸）→ 覆盖区间连续，三分找极小 + 两侧二分求精确边界（免解
// 析分类讨论）。

/** 笔画单段 [P1,P2] 上被「线段 S 的半径 r 胶囊」覆盖的参数区间；不相交返回 null */
export function eraseIntervalOnSegment(
  P1: IPoint,
  P2: IPoint,
  S1: IPoint,
  S2: IPoint,
  r: number,
): [number, number] | null {
  const distAt = (t: number): number => {
    const p = { x: P1.x + (P2.x - P1.x) * t, y: P1.y + (P2.y - P1.y) * t };
    return Math.sqrt(sqDistToSegment(p, S1, S2));
  };
  const d0 = distAt(0);
  const d1 = distAt(1);
  if (d0 <= r && d1 <= r) return [0, 1]; // 整段覆盖
  // 三分搜索求凸函数极小点（40 次迭代区间宽 ~1e-7）
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (distAt(m1) <= distAt(m2)) hi = m2;
    else lo = m1;
  }
  const tMin = (lo + hi) / 2;
  if (distAt(tMin) > r) return null; // 谷底也在胶囊外 = 无覆盖
  // 两侧二分求 d = r 的根（凸函数在极小点两侧单调）。左根区间 [0,tMin] 上
  // d 递减（d(0)>r → d(tMin)≤r），右根区间 [tMin,1] 上递增——两个方向相反
  const bisectLeft = (a: number, b: number): number => {
    for (let i = 0; i < 40; i++) {
      const m = (a + b) / 2;
      if (distAt(m) > r) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  const bisectRight = (a: number, b: number): number => {
    for (let i = 0; i < 40; i++) {
      const m = (a + b) / 2;
      if (distAt(m) <= r) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  const tA = d0 <= r ? 0 : bisectLeft(0, tMin);
  const tB = d1 <= r ? 1 : bisectRight(tMin, 1);
  return [tA, tB];
}

/**
 * 折线被扫掠胶囊切割后的剩余段（世界坐标点数组）。runs 边界取胶囊与笔画的
 * 精确交点（插值点）——擦除边缘贴合胶囊边界无锯齿；残留段 <2 点丢弃。
 * 返回 null = 未被切割（原样保留调用方免写）；空数组 = 全擦。
 */
export function eraseStrokeAgainstSweep(
  points: ReadonlyArray<[number, number]>,
  prev: IPoint,
  cur: IPoint,
  r: number,
): Array<Array<[number, number]>> | null {
  if (points.length < 2) return null;
  const lerp = (i: number, t: number): [number, number] => {
    const a = points[i]!;
    const b = points[i + 1]!;
    return [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t];
  };
  const runs: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  let touched = false;
  const closeRun = (): void => {
    if (current.length >= 2) runs.push(current);
    current = [];
  };
  for (let i = 0; i < points.length - 1; i++) {
    const a = { x: points[i]![0]!, y: points[i]![1]! };
    const b = { x: points[i + 1]![0]!, y: points[i + 1]![1]! };
    const iv = eraseIntervalOnSegment(a, b, prev, cur, r);
    if (iv === null) {
      // 未覆盖：点 i 只在 run 首次进入时加（段间共享端点不重复）
      if (current.length === 0) current.push([a.x, a.y]);
      current.push([b.x, b.y]);
      continue;
    }
    touched = true;
    const [tA, tB] = iv;
    if (tA > 0) {
      if (current.length === 0) current.push([a.x, a.y]);
      current.push(lerp(i, tA));
    }
    closeRun();
    if (tB < 1) {
      current = [lerp(i, tB), [b.x, b.y]];
    }
  }
  closeRun();
  return touched ? runs : null;
}
