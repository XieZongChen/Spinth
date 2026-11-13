import { rotatedRectBounds } from '../../platform/rectEditor/rotateMath';
import type { IRect } from '../../common/geometry';
import type { IPt, JoinDir } from './lineMathTypes';
import { JOIN_DIRS, pathLength, segmentIntersectsRect } from './lineGeometry';

/** ELBOWED 正交路由（docs/08 §4 候选走廊法）：走廊生成 / 候选过滤 / 择优 /
 *  绕行兜底 / 拐点整理 / pinned 保形。依赖 lineGeometry 的法向表与长度度量。 */

/** 节点外扩走廊距离（docs/08 §4 Node_Margin，视觉规格：拐点离节点至少这么多） */
export const NODE_MARGIN = 30;
/** ELBOWED 拐角圆角半径（参考视频量级 15-25px，docs/08 §4） */
export const ELBOW_RADIUS = 14;

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
  /** 第三方障碍（specs/flowchart-closeout §8.2，G-06）：只参与穿模过滤、不参与
   *  走廊/绕行候选生成；首末段豁免仍只对 startNode/endNode 生效 */
  obstacles?: IRect[];
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

  // 两端节点（走廊/绕行候选生成 + 穿模过滤 + 首末段豁免）；第三方障碍只进
  // 穿模过滤（G-06：避让第三节点挡路，不改变候选走廊拓扑）
  const selfObstacles = [startNode, endNode].filter((r): r is IRect => !!r);
  const allObstacles = [...selfObstacles, ...(opts.obstacles ?? [])];
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
    if (selfObstacles.length > 0) {
      const lx = Math.min(...selfObstacles.map((r) => r.x)) - m;
      const rx = Math.max(...selfObstacles.map((r) => r.x + r.width)) + m;
      const ty = Math.min(...selfObstacles.map((r) => r.y)) - m;
      const by = Math.max(...selfObstacles.map((r) => r.y + r.height)) + m;
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
          pathClear(path, allObstacles, startNode ?? undefined, endNode ?? undefined) &&
          !pathHugsEdge(path, selfObstacles) &&
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

// ---------------------------------------------------------------------------
// 第三方避障收集（specs/flowchart-closeout §8.2，G-06）
// ---------------------------------------------------------------------------

/** 避障包围盒外扩（两端点外扩 120 世界 px） */
export const OBSTACLE_PAD = 120;
/** 障碍上限（先正确后性能：候选过滤 ×段×障碍的预算护栏，超限按距离近者保留） */
export const MAX_OBSTACLES = 32;

/** 空间索引查询的最小面（getVmsInRect 依赖） */
interface IObstacleVmSource {
  getVmsInRect(r: IRect): Array<{
    id: string;
    type: string;
    getHostGeom(): { rect: IRect; rotation: number };
  }>;
}

/**
 * 第三方避障收集（单源，specs/flowchart-closeout §11.2）：两端点外扩
 * OBSTACLE_PAD 的包围盒 → 空间索引取候选 → 排除 LINE/PEN 与两端节点 →
 * 旋转件保守外接（rotatedRectBounds）→ 按中心到两端中点距离升序取前
 * MAX_OBSTACLES。消费方：LineAnchorFollow（reattach/previewFollow/reroute）、
 * 拉线与端点拖拽预览；pinned 分支不避障（用户手滑优先）。
 */
export function collectRouteObstacles(
  vmEngine: IObstacleVmSource | null,
  start: IPt,
  end: IPt,
  startId: string | null,
  endId: string | null,
): IRect[] {
  if (!vmEngine) return [];
  const box: IRect = {
    x: Math.min(start.x, end.x) - OBSTACLE_PAD,
    y: Math.min(start.y, end.y) - OBSTACLE_PAD,
    width: Math.abs(end.x - start.x) + OBSTACLE_PAD * 2,
    height: Math.abs(end.y - start.y) + OBSTACLE_PAD * 2,
  };
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const cands: Array<{ rect: IRect; d: number }> = [];
  for (const vm of vmEngine.getVmsInRect(box)) {
    if (vm.type === 'LINE' || vm.type === 'PEN') continue;
    if (vm.id === startId || vm.id === endId) continue;
    const g = vm.getHostGeom();
    const rect = rotatedRectBounds(g.rect, g.rotation);
    cands.push({
      rect,
      d: Math.hypot(rect.x + rect.width / 2 - mx, rect.y + rect.height / 2 - my),
    });
  }
  cands.sort((a, b) => a.d - b.d);
  return cands.slice(0, MAX_OBSTACLES).map((c) => c.rect);
}

// 自环路由已拆至 lineRouteSelfLoop（specs/flowchart-closeout §23：<400 行铁律；
// re-export 保旧 import 路径）
export { routeSelfLoop } from './lineRouteSelfLoop';
export type { IRouteSelfLoopOptions } from './lineRouteSelfLoop';

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
