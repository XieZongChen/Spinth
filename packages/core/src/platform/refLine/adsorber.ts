import type { IRect } from '../../common/geometry';

/**
 * 参考线吸附纯逻辑（docs/06）。
 *
 * - 参照线：每矩形 6 条（左/中/右、上/中/下）；边线与中心线可互相对齐
 *   （边↔边、边↔中心、中心↔中心，阈值内最近者胜），kind 保留作粘滞身份。
 * - 坐标以 3 位小数为 key 去重（浮点 1e-4 偏差会让吸附失效，既有设计实战踩坑）。
 * - 吸附阈值由调用方换算成世界坐标（屏幕 6px / scale）。
 * - 阈值内（含亚像素贴合缝隙）一律修正并命中——对准瞬间参考线反馈不消失：
 *   不设「已贴合跳过」，被 skip 的贴合线会让红线恰好在完全对上时消失。
 */

export type RefLineKind = 'edge' | 'center';

export interface IRefLineDef {
  pos: number;
  kind: RefLineKind;
}

export interface IRefLineSet {
  v: IRefLineDef[];
  h: IRefLineDef[];
}

/** 粘滞输入（docs/06 §3）：上一帧命中线。由调用方（Service）持有拖拽会话状态、
 *  显式传参进来——纯函数本身无状态、幂等（docs/14 规则 3，与规则 5 的
 *  lastDx/lastNext 记录最后一帧输出同类） */
export interface IStickyRefLines {
  v: IRefLineDef[];
  h: IRefLineDef[];
}

/** 线身份 key：kind + 3 位小数坐标（buildRefLines 去重与粘滞匹配共用同一口径） */
function refLineKey(ref: IRefLineDef): string {
  return `${ref.kind}:${ref.pos.toFixed(3)}`;
}

/** 方向死区：|净位移| < threshold × 该比例（阈值 6 屏幕 px → ≈2 屏幕 px）时不过滤
 *  方向——拖拽初段/纯垂直拖的水平抖动不因符号翻转丢候选（docs/06 §3） */
const DIRECTION_DEAD_ZONE_RATIO = 1 / 3;

export function buildRefLines(rects: IRect[]): IRefLineSet {
  const vMap = new Map<string, IRefLineDef>();
  const hMap = new Map<string, IRefLineDef>();
  const push = (map: Map<string, IRefLineDef>, pos: number, kind: RefLineKind): void => {
    map.set(refLineKey({ pos, kind }), { pos, kind });
  };
  for (const r of rects) {
    push(vMap, r.x, 'edge');
    push(vMap, r.x + r.width / 2, 'center');
    push(vMap, r.x + r.width, 'edge');
    push(hMap, r.y, 'edge');
    push(hMap, r.y + r.height / 2, 'center');
    push(hMap, r.y + r.height, 'edge');
  }
  return { v: [...vMap.values()], h: [...hMap.values()] };
}

export interface ISnapResult {
  dx: number;
  dy: number;
  /** 命中的参考线位置（供绘制贯穿线） */
  matchedV: number[];
  matchedH: number[];
  /** 命中线完整定义（kind+pos），调用方回写粘滞状态用 */
  matchedVDefs?: IRefLineDef[];
  matchedHDefs?: IRefLineDef[];
}

interface IEdgeDef {
  offset: (r: IRect) => number;
}

const V_EDGES: IEdgeDef[] = [
  { offset: (r) => r.x },
  { offset: (r) => r.x + r.width / 2 },
  { offset: (r) => r.x + r.width },
];
const H_EDGES: IEdgeDef[] = [
  { offset: (r) => r.y },
  { offset: (r) => r.y + r.height / 2 },
  { offset: (r) => r.y + r.height },
];

/**
 * 单轴吸附：在被拖线（左/中/右 或 上/中/下）与参照线间找阈值内最近对
 * （边↔中心互吸），返回修正量与命中线。
 * 方向感知（A3，误差修复批）：移动轴只取**前方**参照线（修正方向与拖拽总位移
 * 同向）——向右拖不被身后阈值内的线往回拽；|baseDelta| 低于死区（拖拽初段/
 * 纯垂直拖的水平抖动）时两侧等价不过滤。
 * 粘滞（docs/06 §3）：上一帧命中线（stickyKeys）绕过方向过滤——拖过线 1~阈值 px
 * 被拉回，退过阈值即释放（跟手、无回弹）；方向过滤只作用于未吸过的线，
 * 更近的新线照常最近者胜。
 */
function snapAxis(
  edges: IEdgeDef[],
  rect: IRect,
  baseDelta: number,
  refs: IRefLineDef[],
  threshold: number,
  stickyKeys?: Set<string>,
): { delta: number; matched: number[]; matchedDefs: IRefLineDef[] } {
  const directional = Math.abs(baseDelta) >= threshold * DIRECTION_DEAD_ZONE_RATIO;
  let best: { dist: number; ref: IRefLineDef } | null = null;
  for (const edge of edges) {
    const target = edge.offset(rect) + baseDelta;
    for (const ref of refs) {
      // 边↔中心互吸（docs/06 §3）：被拖的每条线与每条参照线配对，阈值内最近者胜
      const dist = ref.pos - target;
      if (Math.abs(dist) > threshold) continue; // 廉价阈值筛先行（热路径：密集画布）
      // 方向过滤带死区：净位移过小（初段/手抖）不过滤；粘滞线绕过过滤（docs/06
      // §3）。只对「阈值内且身后」的候选查粘滞 key（含 toFixed，比比较贵）
      const behind = baseDelta > 0 ? dist < 0 : baseDelta < 0 ? dist > 0 : false;
      if (directional && behind && !stickyKeys?.has(refLineKey(ref))) continue;
      if (!best || Math.abs(dist) < Math.abs(best.dist)) {
        best = { dist, ref };
      }
    }
  }
  if (!best) return { delta: 0, matched: [], matchedDefs: [] };
  return { delta: best.dist, matched: [best.ref.pos], matchedDefs: [best.ref] };
}

/** 拖拽吸附：对期望位移 (dx,dy) 修正，命中线供绘制；sticky 为上一帧命中线（可选） */
export function snapRect(
  rect: IRect,
  dx: number,
  dy: number,
  refs: IRefLineSet,
  threshold: number,
  sticky?: IStickyRefLines,
): ISnapResult {
  // 空粘滞不建集合（Service 常态——拖拽首帧/未吸附时零格式化开销）
  const stickyV = sticky && sticky.v.length > 0 ? new Set(sticky.v.map(refLineKey)) : undefined;
  const stickyH = sticky && sticky.h.length > 0 ? new Set(sticky.h.map(refLineKey)) : undefined;
  const sx = snapAxis(V_EDGES, rect, dx, refs.v, threshold, stickyV);
  const sy = snapAxis(H_EDGES, rect, dy, refs.h, threshold, stickyH);
  return {
    dx: dx + sx.delta,
    dy: dy + sy.delta,
    matchedV: sx.matched,
    matchedH: sy.matched,
    matchedVDefs: sx.matchedDefs,
    matchedHDefs: sy.matchedDefs,
  };
}

/**
 * 缩放吸附：只有被拖动的边参与（docs/06 §3）。
 * dir 为手柄方向（如 'nw'/'e'）；返回调整后的矩形与命中线。
 * 取阈值内最近的**有效**线（吸附后尺寸 ≥ minSize）：中心线参与后，最近线可能
 * 近到把尺寸压过 minSize——跳过它回退到次近有效线，而不是整轴放弃吸附。
 */
export function snapResize(
  rect: IRect,
  dir: string,
  refs: IRefLineSet,
  threshold: number,
  minSize = 8,
): { rect: IRect; matchedV: number[]; matchedH: number[] } {
  const out = { ...rect };
  const matchedV: number[] = [];
  const matchedH: number[] = [];

  const snapEdge = (
    target: number,
    refs: IRefLineDef[],
    valid: (pos: number) => boolean,
  ): number | null => {
    let best: number | null = null;
    for (const ref of refs) {
      const dist = ref.pos - target;
      if (Math.abs(dist) > threshold || !valid(ref.pos)) continue;
      if (best === null || Math.abs(dist) < Math.abs(best - target)) best = ref.pos;
    }
    return best;
  };

  if (dir.includes('w')) {
    const right = out.x + out.width;
    const snap = snapEdge(out.x, refs.v, (p) => right - p >= minSize);
    if (snap !== null) {
      matchedV.push(snap);
      out.width = right - snap;
      out.x = snap;
    }
  }
  if (dir.includes('e')) {
    const left = out.x;
    const snap = snapEdge(left + out.width, refs.v, (p) => p - left >= minSize);
    if (snap !== null) {
      matchedV.push(snap);
      out.width = snap - left;
    }
  }
  if (dir.includes('n')) {
    const bottom = out.y + out.height;
    const snap = snapEdge(out.y, refs.h, (p) => bottom - p >= minSize);
    if (snap !== null) {
      matchedH.push(snap);
      out.height = bottom - snap;
      out.y = snap;
    }
  }
  if (dir.includes('s')) {
    const top = out.y;
    const snap = snapEdge(top + out.height, refs.h, (p) => p - top >= minSize);
    if (snap !== null) {
      matchedH.push(snap);
      out.height = snap - top;
    }
  }
  return { rect: out, matchedV, matchedH };
}
