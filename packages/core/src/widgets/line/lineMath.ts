import type { IPoint, IRect } from '../../common/geometry';

/** 连线路径点（IPoint 别名，语义化导出） */
export type IPt = IPoint;

/**
 * 连线路由纯逻辑（docs/08）：锚点计算 + 直线路径 + ELBOWED 正交路由（候选走廊法）
 * + 线上文字定位/镂空切分 + 虚线切分 + 命中检测。全部无状态纯函数。
 */

export type JoinDir = 'top' | 'right' | 'bottom' | 'left';

/** 节点外扩走廊距离（docs/08 §4 Node_Margin，视觉规格：拐点离节点至少这么多） */
export const NODE_MARGIN = 30;
/** ELBOWED 拐角圆角半径（参考视频量级 15-25px，docs/08 §4） */
export const ELBOW_RADIUS = 14;

// 旋转数学单源在 rectEditor/rotateMath（docs/05 §8）；此处 re-export 供锚定链消费
export { rotatePointAround, inverseRotatePoint } from '../../platform/rectEditor/rotateMath';
import { rotatePointAround, inverseRotatePoint } from '../../platform/rectEditor/rotateMath';

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

// ---------------------------------------------------------------------------
// ELBOWED 正交路由（docs/08 §4 候选走廊法）
// ---------------------------------------------------------------------------

const JOIN_DIRS: Record<JoinDir, IPt> = {
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

/** 线段在矩形 (x,y,w,h) 内部的参数区间 [t0,t1]；无交集返回 null */
function clipSegmentToRect(
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

/** 路径各段均不穿过任一障碍矩形（内缩语义，边界接触放行）。
 *  首段对 startNode / 末段对 endNode 豁免（2026-10-16 旋转穿体修复）：
 *  旋转宿主的避让矩形是世界 AABB（保守外接）——锚点在真实边中点上、
 *  常落 AABB 内部，首段沿量化法向离开真实矩形后仍在 AABB 内，会被
 *  误判穿模而 fallback 到反向（穿体）。首/末段的离开方向由 quantizeJoin
 *  保证，豁免不放大真穿模面（中段避让不变）。 */
function pathClear(
  path: IPt[],
  obstacles: IRect[],
  skipFirstFor?: IRect,
  skipLastFor?: IRect,
): boolean {
  // 豁免仅当锚点在该障碍**严格内部**：旋转宿主锚点被世界 AABB 包住（真实边
  // 中点 < AABB），首段沿量化法向离开真实矩形后仍在 AABB 内——不豁免则全部
  // 候选被判穿模而 fallback 反向。未旋转锚点在障碍**边上**（内部判定 false）
  // → 不豁免，保持旧判定（否则「首段穿障碍」的短路由被放行——E2E 回归实锤）
  const inInterior = (p: IPt, r: IRect): boolean =>
    p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;
  const last = path.length - 1;
  const exemptFirst = !!skipFirstFor && inInterior(path[0]!, skipFirstFor);
  const exemptLast = !!skipLastFor && inInterior(path[last]!, skipLastFor);
  for (let i = 0; i + 1 < path.length; i++) {
    for (const ob of obstacles) {
      if (i === 0 && exemptFirst && ob === skipFirstFor) continue;
      if (i + 1 === last && exemptLast && ob === skipLastFor) continue;
      if (segmentIntersectsRect(path[i]!, path[i + 1]!, ob)) return false;
    }
  }
  return true;
}

/**
 * 锚定端最短进入段（docs/08 §4，2026-09-28 用户实测）：锚定端的进入段
 * （首段/末段）须长于箭头（ARROW_LEN=10）——否则箭头比线段还长、视觉挤压
 * 变形。发生在「目标只比源低一点点」时：候选的水平走廊落在锚点下方仅几
 * 像素处（merge 后末段被吞成短段）。2 倍箭头长度为下限。
 */
const MIN_ANCHOR_APPROACH = 20;

function approachOk(path: IPt[], startJoin: JoinDir | null, endJoin: JoinDir | null): boolean {
  if (path.length < 2) return true;
  if (startJoin) {
    const d = Math.hypot(path[1]!.x - path[0]!.x, path[1]!.y - path[0]!.y);
    if (d < MIN_ANCHOR_APPROACH) return false;
  }
  if (endJoin) {
    const n = path.length;
    const d = Math.hypot(path[n - 1]!.x - path[n - 2]!.x, path[n - 1]!.y - path[n - 2]!.y);
    if (d < MIN_ANCHOR_APPROACH) return false;
  }
  return true;
}

/**
 * 贴边检测（docs/08 §4，2026-09-28 用户实测）：水平段与障碍顶/底边**重合**、
 * 或垂直段与左/右边重合（±eps 且区间重叠）→ 连线压着形状边框走，视觉上
 * 与边框融合。发生在「A 的出线走廊高度恰好等于另一形状的边线高度」时——
 * 穿模检查放行（只贴边不进入），故与 pathClear 同级降权。
 */
function pathHugsEdge(path: IPt[], obstacles: IRect[], eps = 1): boolean {
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    for (const r of obstacles) {
      const xOverlap = Math.min(a.x, b.x) < r.x + r.width && Math.max(a.x, b.x) > r.x;
      const yOverlap = Math.min(a.y, b.y) < r.y + r.height && Math.max(a.y, b.y) > r.y;
      if (
        a.y === b.y &&
        xOverlap &&
        (Math.abs(a.y - r.y) <= eps || Math.abs(a.y - (r.y + r.height)) <= eps)
      )
        return true;
      if (
        a.x === b.x &&
        yOverlap &&
        (Math.abs(a.x - r.x) <= eps || Math.abs(a.x - (r.x + r.width)) <= eps)
      )
        return true;
    }
  }
  return false;
}

/** 折线总长 */
export function pathLength(pts: IPt[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    sum += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
  }
  return sum;
}

/** 去共线/重合拐点：候选点法产生的冗余（同轴共线中点、重复点）。
 * 共线替换可能引发新的重复/共线邻接，迭代至收敛（点数单调下降，必终止）。 */
export function mergeCollinear(pts: IPt[]): IPt[] {
  let changed = true;
  let cur = pts.map((p) => ({ ...p }));
  while (changed) {
    changed = false;
    const out: IPt[] = [];
    for (const p of cur) {
      const n = out.length;
      if (n >= 1) {
        const b = out[n - 1]!;
        if (b.x === p.x && b.y === p.y) {
          changed = true; // 重合点
          continue;
        }
        if (n >= 2) {
          const a = out[n - 2]!;
          if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) {
            out[n - 1] = p; // 共线：替换中点
            changed = true;
            continue;
          }
        }
      }
      out.push(p);
    }
    cur = out;
  }
  return cur;
}

/**
 * 拐点吸附（docs/08 §4）：小于 min 的「抖动拐」对齐到较长段后拉直。
 * 仅处理全内部的四点组（p0/p3 改的是各自纵向段的走线，锚点首尾不动）：
 * H-(tiny V)-H → 四点对齐到较长 H 段的 y；V-(tiny H)-V → 对齐较长 V 段的 x。
 * 正交性保持：被改的外侧点所在段与被改轴平行（沿自身方向滑动）。
 */
export function absorbTinyJogs(pts: IPt[], min: number): IPt[] {
  let cur = pts;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 2; i + 3 <= cur.length - 1; i++) {
      const p0 = cur[i - 1]!;
      const p1 = cur[i]!;
      const p2 = cur[i + 1]!;
      const p3 = cur[i + 2]!;
      const jog = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (jog === 0 || jog >= min) continue;
      if (p0.y === p1.y && p2.y === p3.y && p1.x === p2.x) {
        // H-(小V)-H
        const y = Math.abs(p1.x - p0.x) >= Math.abs(p3.x - p2.x) ? p0.y : p3.y;
        cur = cur.map((p, idx) => (idx >= i - 1 && idx <= i + 2 ? { x: p.x, y } : p));
      } else if (p0.x === p1.x && p2.x === p3.x && p1.y === p2.y) {
        // V-(小H)-V
        const x = Math.abs(p1.y - p0.y) >= Math.abs(p3.y - p2.y) ? p0.x : p3.x;
        cur = cur.map((p, idx) => (idx >= i - 1 && idx <= i + 2 ? { x, y: p.y } : p));
      } else {
        continue;
      }
      cur = mergeCollinear(cur);
      changed = true;
      break;
    }
  }
  return cur;
}

export interface IRouteElbowOptions {
  start: IPt;
  startJoin: JoinDir | null;
  end: IPt;
  endJoin: JoinDir | null;
  /** 锚定节点包围盒（避让；自由端为 null） */
  startNode?: IRect | null;
  endNode?: IRect | null;
}

/**
 * ELBOWED 正交路由（docs/08 §4 候选走廊法）：
 * 1. 两端沿 join 方向外扩 margin 生成走廊点 s1/e1（自由端取朝向对方的主轴方向）；
 * 2. 候选中转 = 两轴交点（2 种）+ 同侧对开时的中线走廊；
 * 3. 过滤：任一段不穿过两端节点（内缩语义，锚点边界接触放行）；
 * 4. 择优：不穿节点 > 拐点最少 > 总长最短；穿节点时逐级外扩 margin 重试（3 级），
 *    全挡死则退回首候选（极端布局保连通）。
 */
export function routeElbow(opts: IRouteElbowOptions): IPt[] {
  const { start, end, startJoin, endJoin, startNode, endNode } = opts;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    return [{ ...start }, { ...end }];
  }

  const sd = startJoin
    ? JOIN_DIRS[startJoin]
    : Math.abs(dx) >= Math.abs(dy)
      ? { x: Math.sign(dx) || 1, y: 0 }
      : { x: 0, y: Math.sign(dy) || 1 };
  const ed = endJoin
    ? JOIN_DIRS[endJoin]
    : Math.abs(dx) >= Math.abs(dy)
      ? { x: -Math.sign(dx) || 1, y: 0 }
      : { x: 0, y: -Math.sign(dy) || 1 };

  const obstacles = [startNode, endNode].filter((r): r is IRect => !!r);
  let fallback: IPt[] = [];

  for (let level = 0; level < 3; level++) {
    const m = NODE_MARGIN * (level + 1);
    const s1 = { x: start.x + sd.x * m, y: start.y + sd.y * m };
    const e1 = { x: end.x + ed.x * m, y: end.y + ed.y * m };

    const candidates: IPt[][] = [
      [start, s1, { x: s1.x, y: e1.y }, e1, end],
      [start, s1, { x: e1.x, y: s1.y }, e1, end],
    ];
    if (sd.x !== 0 && ed.x !== 0) {
      // 同向对开（right→right / left→left）：中线必须越过两侧走廊点，
      // 取算术中点会越过锚点折回（重影路由）；对向则取中点即可
      const mx =
        sd.x > 0 === ed.x > 0
          ? sd.x > 0
            ? Math.max(s1.x, e1.x)
            : Math.min(s1.x, e1.x)
          : (s1.x + e1.x) / 2;
      candidates.push([start, s1, { x: mx, y: s1.y }, { x: mx, y: e1.y }, e1, end]);
    }
    if (sd.y !== 0 && ed.y !== 0) {
      const my =
        sd.y > 0 === ed.y > 0
          ? sd.y > 0
            ? Math.max(s1.y, e1.y)
            : Math.min(s1.y, e1.y)
          : (s1.y + e1.y) / 2;
      candidates.push([start, s1, { x: s1.x, y: my }, { x: e1.x, y: my }, e1, end]);
    }

    // 绕行候选（2026-09-28 用户实测：A 高 B 低的底-底连接，走廊候选全被两端
    // 节点自身挡死 → 兜底首候选穿模「水平怼进锚点」）。沿两端节点联合包围盒
    // 外扩后的四条车道生成绕行路线——择优不变：走廊候选畅通时以拐点少胜出，
    // 绕行仅在被挡时启用。
    if (obstacles.length > 0) {
      const lx = Math.min(...obstacles.map((r) => r.x)) - m;
      const rx = Math.max(...obstacles.map((r) => r.x + r.width)) + m;
      const ty = Math.min(...obstacles.map((r) => r.y)) - m;
      const by = Math.max(...obstacles.map((r) => r.y + r.height)) + m;
      for (const laneX of [lx, rx]) {
        candidates.push(
          [start, s1, { x: laneX, y: s1.y }, { x: laneX, y: e1.y }, e1, end],
          [start, s1, { x: laneX, y: s1.y }, { x: laneX, y: ty }, { x: e1.x, y: ty }, e1, end],
          [start, s1, { x: laneX, y: s1.y }, { x: laneX, y: by }, { x: e1.x, y: by }, e1, end],
        );
      }
      for (const laneY of [ty, by]) {
        candidates.push(
          [start, s1, { x: s1.x, y: laneY }, { x: e1.x, y: laneY }, e1, end],
          // 拐角齐全：s1 →(s1.x, laneY) 横向车道 → 车道端点竖边 → e1（缺
          // (s1.x, laneY) 角点会产出斜线段——正交路由不允许，2026-09-28）
          [start, s1, { x: s1.x, y: laneY }, { x: lx, y: laneY }, { x: lx, y: e1.y }, e1, end],
          [start, s1, { x: s1.x, y: laneY }, { x: rx, y: laneY }, { x: rx, y: e1.y }, e1, end],
        );
      }
    }

    const scored = candidates
      .map((raw) => absorbTinyJogs(mergeCollinear(raw), ELBOW_RADIUS * 2))
      .map((path) => ({
        path,
        len: pathLength(path),
        clear:
          pathClear(path, obstacles, startNode ?? undefined, endNode ?? undefined) &&
          !pathHugsEdge(path, obstacles) &&
          approachOk(path, startJoin, endJoin),
      }))
      .sort((a, b) =>
        a.clear === b.clear ? a.path.length - b.path.length || a.len - b.len : a.clear ? -1 : 1,
      );

    if (!fallback.length && scored.length > 0) fallback = scored[0]!.path;
    const best = scored.find((s) => s.clear);
    if (best) return best.path;
  }
  return fallback;
}

/**
 * 视图语义路径：STRAIGHT = 首尾两点；CURVE = 贝塞尔 flatten 折线（批次 4）。
 * points 中可能残留 ELBOWED 时代的拐点（切型不重写 points——数据保留让切回
 * ELBOWED 可恢复/重路由），渲染/命中/几何一律按视觉语义取退化路径。曾因虚线
 * 切分沿残留拐点逐段切分，直线切虚线「变回」折线、且切型视觉无差异
 * （2026-09 用户实测揪出）。
 */
export function effectivePath(pts: IPt[], lineType: 'STRAIGHT' | 'ELBOWED' | 'CURVE'): IPt[] {
  if (lineType === 'CURVE') return flattenCurve(curveControlPoints(pts));
  if (lineType === 'STRAIGHT' && pts.length > 2) return [pts[0]!, pts[pts.length - 1]!];
  return pts;
}

/** 视觉端点空隙（世界像素，2026-09-30 用户拍板两轮定稿）：线两端不直接顶到
 *  元素，留出端点圆按钮的半径——R4 + 白描边 1 = 视觉半径 5，线端正好抵着
 *  按钮边缘（首版 12 偏大被用户打回）。与 ELBOW_RADIUS/KNOCKOUT_PADDING
 *  同为先例：lineVm 视觉常量世界固定。 */
export const LINE_END_GAP = 5;

/**
 * 视觉端点收缩：两端各沿首/末段方向缩进 min(gap, 段长/2)——**只作用于渲染
 * 路径**（stroke/箭头/镂空切分的输入），points 数据、命中检测、段滑移、
 * 锚定语义一律不受影响（端点圆按钮画在原端点上，正嵌在空隙里）。
 */
export function insetEnds(pts: readonly IPt[], gap: number): IPt[] {
  const out = pts.map((p) => ({ ...p }));
  const n = out.length;
  if (n < 2) return out;
  const a0 = out[0]!;
  const b0 = out[1]!;
  const len0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  if (len0 > 0) {
    const g = Math.min(gap, len0 / 2);
    out[0] = { x: a0.x + ((b0.x - a0.x) / len0) * g, y: a0.y + ((b0.y - a0.y) / len0) * g };
  }
  const a1 = out[n - 1]!;
  const b1 = out[n - 2]!;
  const len1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  if (len1 > 0) {
    const g = Math.min(gap, len1 / 2);
    out[n - 1] = { x: a1.x + ((b1.x - a1.x) / len1) * g, y: a1.y + ((b1.y - a1.y) / len1) * g };
  }
  return out;
}

// ---------------------------------------------------------------------------
// 曲线线型（docs/08 §4 批次 4，参考图三 S 形）：三次贝塞尔
// ---------------------------------------------------------------------------

/** 控制臂长系数：控制点距端点的距离 = 两端距 × 0.4（视觉拍板：S 弯平滑不过垂） */
const CURVE_ARM = 0.4;

/**
 * 贝塞尔控制点（[p0, c1, c2, p3]）：切向 = pts 相邻点方向——锚定线的走廊点
 * （pts[1]/pts[n-2]）恰好是锚定边法向（routeElbow 沿 join 外扩 30px 生成），
 * 故 ELBOWED 切 CURVE 自然得到 S 形；两点线（无切向信息）退化为直线。
 */
export function curveControlPoints(pts: readonly IPt[]): [IPt, IPt, IPt, IPt] {
  const p0 = pts[0] ?? { x: 0, y: 0 };
  const p3 = pts[pts.length - 1] ?? p0;
  const dir = (a: IPt, b: IPt): IPt => segmentDirection(a, b);
  const d0 = pts.length > 2 ? dir(p0, pts[1]!) : dir(p0, p3);
  const d3 = pts.length > 2 ? dir(p3, pts[pts.length - 2]!) : dir(p3, p0);
  const arm = Math.hypot(p3.x - p0.x, p3.y - p0.y) * CURVE_ARM;
  return [
    { ...p0 },
    { x: p0.x + d0.x * arm, y: p0.y + d0.y * arm },
    { x: p3.x + d3.x * arm, y: p3.y + d3.y * arm },
    { ...p3 },
  ];
}

/** 三次贝塞尔 flatten 采样（渲染/命中/文字度量共用折线管线；24 段弦高
 *  误差 < 0.3% 视觉平滑；短弦被 majorSegments 过滤 → 曲线无段条） */
export function flattenCurve(ctrl: readonly [IPt, IPt, IPt, IPt], samples = 24): IPt[] {
  const [a, b, c, d] = ctrl;
  const out: IPt[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    out.push({
      x: a.x * w0 + b.x * w1 + c.x * w2 + d.x * w3,
      y: a.y * w0 + b.y * w1 + c.y * w2 + d.y * w3,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 路径度量：ratio 定位 / 反算（线上文字，docs/08 §6）
// ---------------------------------------------------------------------------

/** ratio（0~1）→ 路径上点及其行进方向（文字锚定用） */
export function pointAtRatio(pts: IPt[], ratio: number): { point: IPt; dir: IPt } {
  const total = pathLength(pts);
  if (total === 0 || pts.length < 2) {
    return { point: { ...(pts[0] ?? { x: 0, y: 0 }) }, dir: { x: 1, y: 0 } };
  }
  let target = Math.max(0, Math.min(1, ratio)) * total;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (target <= segLen || i + 2 === pts.length) {
      const t = segLen === 0 ? 0 : target / segLen;
      return {
        point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        dir: segmentDirection(a, b),
      };
    }
    target -= segLen;
  }
  return { point: { ...pts[pts.length - 1]! }, dir: { x: 1, y: 0 } };
}

/** 路径上离 p 最近点 → ratio（双击位置反算，docs/08 §6） */
export function ratioAtPoint(pts: IPt[], p: IPt): number {
  const total = pathLength(pts);
  if (total === 0) return 0.5;
  let acc = 0;
  let best = { dist2: Infinity, ratio: 0.5 };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t = segLen === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / (segLen * segLen);
    t = Math.max(0, Math.min(1, t));
    const ex = p.x - (a.x + t * dx);
    const ey = p.y - (a.y + t * dy);
    const d2 = ex * ex + ey * ey;
    if (d2 < best.dist2) best = { dist2: d2, ratio: (acc + t * segLen) / total };
    acc += segLen;
  }
  return Math.max(0, Math.min(1, best.ratio));
}

// ---------------------------------------------------------------------------
// 路径切分：镂空（线上文字）与虚线
// ---------------------------------------------------------------------------

/**
 * 挖空切分：路径中与矩形相交的部分剔除（线上文字镂空，docs/08 §6）。
 * 返回若干条连续可见折线（顺序保持；段全在矩形内时整段剔除）。
 */
export function slicePathExcludingRect(pts: IPt[], rect: IRect): IPt[][] {
  const pieces: IPt[][] = [];
  let cur: IPt[] = [];
  const flush = (): void => {
    if (cur.length >= 2) pieces.push(cur);
    cur = [];
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const clip = clipSegmentToRect(a, b, rect.x, rect.y, rect.width, rect.height);
    if (!clip) {
      if (cur.length === 0) cur.push({ ...a });
      cur.push({ ...b });
      continue;
    }
    const { t0, t1 } = clip;
    const at = (t: number): IPt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (t0 > 1e-6) {
      cur.push(at(0), at(t0));
      flush();
    }
    if (t1 < 1 - 1e-6) {
      cur = [at(t1), at(1)];
    } else {
      flush(); // 剩余部分到段尾都在矩形内：可见段在 a 处结束
    }
  }
  flush();
  return pieces;
}

/**
 * 虚线切分：按 [dash, gap] 周期把折线切成实线小段（pixi v8 Graphics 无原生 dash）。
 * 周期相位沿整条路径连续（跨拐点不断裂重排）。
 */
export function slicePathByDash(pts: IPt[], dash: number, gap: number): IPt[][] {
  if (pts.length < 2) return [];
  if (dash <= 0) return [pts.map((p) => ({ ...p }))];
  const period = dash + gap;
  const out: IPt[][] = [];
  let cur: IPt[] = [];
  let traveled = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    let head = { ...pts[i]! };
    const b = pts[i + 1]!;
    const dir = segmentDirection(head, b);
    let segLen = Math.hypot(b.x - head.x, b.y - head.y);
    while (segLen > 1e-9) {
      const phase = traveled % period;
      if (phase < dash) {
        const remainDash = dash - phase;
        const take = Math.min(remainDash, segLen);
        const next = { x: head.x + dir.x * take, y: head.y + dir.y * take };
        if (cur.length === 0) cur.push({ ...head });
        cur.push(next);
        head = next;
        segLen -= take;
        traveled += take;
        if (take >= remainDash - 1e-9) {
          // 恰好画满一个 dash 周期：收段进入 gap
          if (cur.length >= 2) out.push(cur);
          cur = [];
        }
      } else {
        const skip = Math.min(period - phase, segLen);
        head = { x: head.x + dir.x * skip, y: head.y + dir.y * skip };
        segLen -= skip;
        traveled += skip;
      }
    }
  }
  if (cur.length >= 2) out.push(cur);
  return out;
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

/** 可交互主段的最小屏显长度：走廊短段（如 30px）的胶囊会贴着端点手柄/肘部
 *  挤作一团（2026-09-29 用户实测截图——视觉混乱被感知为「段条缺失/错位」） */
export const MAJOR_SEG_MIN_SCREEN = 60;

/**
 * 可交互主段（渲染/快照两处共用一份过滤）：屏显长度 ≥60px 的段。
 * index = 真实段号（slideSegment 口径——segmentGeoms 跳零长段会漂移序号，
 * 故此处独立遍历）；数组序号 = 手柄渲染与探针的 activeIndex 口径。
 */
export function majorSegments(
  pts: readonly IPt[],
  scale: number,
): Array<{ index: number; geom: ISegmentGeom }> {
  const s = scale || 1;
  const out: Array<{ index: number; geom: ISegmentGeom }> = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < MAJOR_SEG_MIN_SCREEN / s) continue; // 零长/短段一并过滤
    out.push({
      index: i,
      geom: { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle: Math.atan2(dy, dx), len },
    });
  }
  return out;
}

/** 有文字时单侧可见部分的最小屏显弧长（短于胶囊本身无操作空间，不放手柄） */
export const CAPSULE_MIN_PIECE_SCREEN = 24;

/** quick-add 新形状近边与源锚点的间距（2026-10-02 用户拍板：70 偏短加长；
 *  历史 150→70→110——quickAddConnectedShape 与 LineGhostPreview 共用单源） */
export const QUICK_ADD_GAP = 110;

/** 交替落位相邻卡位的净间隙（参考视频实测：260 高卡中心偏移 330 =
 *  卡长 260 + 间隙 70）。独立于 QUICK_ADD_GAP（正对落位间隙 110 是用户
 *  拍板值，错开卡位间隙未被拍板——先贴视频，实测微调项） */
export const BRANCH_STAGGER_GAP = 70;

/** 交替落位单步卡位中心偏移（quick-add 方向已有带连线元素时）= 垂直于
 *  法向的卡边长 + 净间隙——错开**一整个卡位**不重叠（首版 30% 比例偏移
 *  被用户实测报重叠：240 宽卡仅偏 72 仍叠一大半，2026-10-03 修正） */
export function branchStride(perp: number): number {
  return perp + BRANCH_STAGGER_GAP;
}

/**
 * quick-add 交替落位槽位偏移（2026-10-02 参考视频第 3 段）：方向上已有
 * 带连线的元素时，新形状不再正对落位，而是垂直于法向一上一下（垂直方向
 * 一右一左）交替错开成列——n=已有分支数，第 n+1 个成员：n 奇偏「负侧」
 * 1 卡位、n 偶偏「正侧」1、再交替加一（n=1 → -1、2 → +1、3 → -2、4 → +2）。
 * 负侧 = 水平方向的上方（y 减）/ 垂直方向的左方（x 减）；垂直方向起步为
 * 「先右」，由调用方取负翻转。perp = 源卡垂直于法向的边长。n<1 返回 0
 * （方向空闲，正对落位）。
 */
export function branchSlotOffset(n: number, perp: number): number {
  if (n < 1) return 0;
  const slot = Math.ceil(n / 2);
  const sign = n % 2 === 1 ? -1 : 1;
  return sign * slot * branchStride(perp);
}

/**
 * 胶囊手柄锚点（渲染/抓取/hover/探针的单一事实源，2026-10-02 参考规格）：
 * - 无文字（knockout = null）：majorSegments 逐主段中点（现状）；
 * - 有文字：文字把连线分成两部分，**每侧一个手柄**放在该侧可见部分的
 *   弧长中点（贴文字两侧——取代原段中点，避免与文字锚点重叠）。index =
 *   中点所在的**真实段号**（slideSegment 口径，拖任一侧手柄即滑移所在段）；
 *   屏显弧长 < 24px 的侧不放（线太短胶囊无处安放）。
 */
export function capsuleAnchors(
  pts: readonly IPt[],
  scale: number,
  knockout: IRect | null,
): Array<{ index: number; geom: ISegmentGeom }> {
  if (!knockout) return majorSegments(pts, scale);
  const s = scale || 1;
  const out: Array<{ index: number; geom: ISegmentGeom }> = [];
  const pieces = slicePathExcludingRect([...pts], knockout);
  for (const piece of pieces) {
    // piece 弧长中点
    let total = 0;
    for (let i = 1; i < piece.length; i++) {
      total += Math.hypot(piece[i]!.x - piece[i - 1]!.x, piece[i]!.y - piece[i - 1]!.y);
    }
    if (total < CAPSULE_MIN_PIECE_SCREEN / s) continue;
    let half = total / 2;
    let mid = piece[piece.length - 1]!;
    for (let i = 1; i < piece.length && half > 0; i++) {
      const a = piece[i - 1]!;
      const b = piece[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (half <= len) {
        mid = { x: a.x + ((b.x - a.x) * half) / len, y: a.y + ((b.y - a.y) * half) / len };
        break;
      }
      half -= len;
    }
    // 中点回定位到真实段号 + 沿所在段方向旋转（胶囊口径与主段一致）
    const hit = nearestSegBody(pts, mid, 1e-3);
    if (!hit) continue;
    const a = pts[hit.index]!;
    const b = pts[hit.index + 1]!;
    out.push({
      index: hit.index,
      geom: { mid, angle: Math.atan2(b.y - a.y, b.x - a.x), len: Math.hypot(b.x - a.x, b.y - a.y) },
    });
  }
  // 文字矩形未实际切到路径（切分为空）→ 回退无字口径
  return out.length > 0 ? out : majorSegments(pts, scale);
}

/** 连接点外移点中心：edge 锚点 + 法向偏移（选中态外移 24px——与指示器绘制
 *  同源，避开边中点缩放手柄；A1 整理批抽纯函数，overlay 与抓取判定共用。
 *  常量单源：lineAnchorIndicator 从此处 re-export） */
export const ANCHOR_DOT_OFFSET = 24;
const DOT_JOIN_NORMALS: Record<JoinDir, IPt> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** scale = 屏幕像素→世界单位换算（Batch 1 · 1.8③：外移量屏幕恒定——
 *  rectEditor 旋转柄同款口径；缺省 1 兼容既有单测的世界口径） */
export function dotOffsetCenter(bounds: IRect, j: JoinDir, rotation = 0, scale = 1): IPt {
  const off = ANCHOR_DOT_OFFSET / scale;
  const a = anchorOf(bounds, j, rotation);
  const n = DOT_JOIN_NORMALS[j];
  if (rotation === 0) return { x: a.x + n.x * off, y: a.y + n.y * off };
  const rn = rotatePointAround(n, { x: 0, y: 0 }, rotation);
  return { x: a.x + rn.x * off, y: a.y + rn.y * off };
}

/** 段身抓取容差（屏幕像素）：参考演示视频对齐——线身任意点按住即拖
 *  （与 polylineHit 命中同 8px 口径；A1 整理批收单源，overlay/滑移共用） */
export const SEGMENT_BODY_TOLERANCE = 8;

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

// ---------------------------------------------------------------------------
// 段滑移（docs/08 §10 批次 3 waypoint，用户拍板参考图二 U 形）
// ---------------------------------------------------------------------------

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

/** 唯一段拆分的锚点侧连接段长度（世界像素）：被拖段与锚点之间留出的 stub
 *  ——参考演示视频量级 30-50px，与 NODE_MARGIN 同源 */
export const SEG_SLIDE_STUB = 30;

/**
 * 段滑移：把段 i 沿自身法向平移 offset。
 * - 中段：新段两端 = 与相邻段直线的交点（拐点跟随，正交段必相交），
 *   平行退化取平移后端点；
 * - 唯一段（两点线，2026-09-30 视频实锤）：两端保持 + **拆五点**——锚点各伸
 *   stub 连接段、被拖段平移 offset，全程正交（参考拖水平直连线的「几」形）；
 * - 首/末段（2026-09-30 用户实测拍板两档）：**长段（≥ NODE_MARGIN=30，与
 *   自动路由走廊阈值同源）拆几字形保正交接入**——锚点端沿原方向伸 stub、
 *   垂直连接到被拖段、被拖段另一端与邻段求交（锚点始终正交进入元素，不斜）；
 *   短段（< 30，走廊短段不够拆）退化为斜连（锚点保持 + 拐点平移求交）。
 *   offset=0 时拆点共线，由调用方 mergeCollinear 清回原形（幂等）。
 */
export function slideSegment(pts: readonly IPt[], i: number, offset: number): IPt[] {
  const a = pts[i]!;
  const b = pts[i + 1]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const dirX = (b.x - a.x) / len;
  const dirY = (b.y - a.y) / len;
  const a2 = { x: a.x + nx * offset, y: a.y + ny * offset };
  const b2 = { x: b.x + nx * offset, y: b.y + ny * offset };
  const hasPrev = i > 0;
  const hasNext = i + 2 < pts.length;
  if (!hasPrev && !hasNext) {
    // 唯一段拆五点：两端各伸 stub + 被拖段平移（全程正交）
    const stub = Math.min(SEG_SLIDE_STUB, len / 3);
    const a1 = { x: a.x + dirX * stub, y: a.y + dirY * stub };
    const b1 = { x: b.x - dirX * stub, y: b.y - dirY * stub };
    return [
      a,
      a1,
      { x: a1.x + nx * offset, y: a1.y + ny * offset },
      { x: b1.x + nx * offset, y: b1.y + ny * offset },
      b1,
      b,
    ];
  }
  if (hasPrev && hasNext) {
    // 中段：两端求交（拐点跟随）
    const out = pts.map((p) => ({ ...p }));
    out[i] = intersectLine(pts[i - 1]!, pts[i]!, a2, b2) ?? a2;
    out[i + 1] = intersectLine(a2, b2, pts[i + 1]!, pts[i + 2]!) ?? b2;
    return out;
  }
  // 首/末段：长段拆几字形（正交接入），短段斜连
  if (len >= NODE_MARGIN) {
    const stub = Math.min(SEG_SLIDE_STUB, len / 3);
    if (!hasPrev) {
      // 首段拆：[a, a+stub, +off（垂直连接）, 与后段求交] + 后续原样
      const s = { x: a.x + dirX * stub, y: a.y + dirY * stub };
      const c1 = { x: s.x + nx * offset, y: s.y + ny * offset };
      const join = intersectLine(a2, b2, pts[i + 1]!, pts[i + 2]!) ?? b2;
      return [a, s, c1, join, ...pts.slice(i + 2)];
    }
    // 末段拆：前段原样 + [与前段求交, +off（垂直连接）, b−stub, b]
    const s = { x: b.x - dirX * stub, y: b.y - dirY * stub };
    const c1 = { x: s.x + nx * offset, y: s.y + ny * offset };
    const join = intersectLine(pts[i - 1]!, pts[i]!, a2, b2) ?? a2;
    return [...pts.slice(0, i), join, c1, s, b];
  }
  const out = pts.map((p) => ({ ...p }));
  if (!hasPrev) {
    // 首段短段：锚点端保持，拐点端平移 + 与后段求交（斜连）
    out[i] = a;
    out[i + 1] = intersectLine(a2, b2, pts[i + 1]!, pts[i + 2]!) ?? b2;
  } else {
    // 末段短段：镜像
    out[i] = intersectLine(pts[i - 1]!, pts[i]!, a2, b2) ?? a2;
    out[i + 1] = pts[i + 1]!;
  }
  return out;
}

/**
 * pinned 路由（docs/08 §10 批次 3）：用户手滑段后拐点优先——两端锚点重贴
 * （锚定跟随保持连通），中间拐点原样保留（锚定节点移动 U 形不丢）。
 */
export function pinKeepMiddle(
  pts: readonly IPt[],
  startAnchor: IPt | null,
  endAnchor: IPt | null,
): IPt[] {
  const out = pts.map((p) => ({ ...p }));
  if (startAnchor) out[0] = { ...startAnchor };
  if (endAnchor) out[out.length - 1] = { ...endAnchor };
  return out;
}
