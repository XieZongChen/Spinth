import type { IRect } from '../../common/geometry';

/**
 * 参考线吸附纯逻辑（docs/06）。
 *
 * - 参照线：每矩形 6 条（左/中/右、上/中/下），kind 区分边线与中心线——中心线只与中心线对齐。
 * - 坐标以 3 位小数为 key 去重（浮点 1e-4 偏差会让吸附失效，既有设计实战踩坑）。
 * - 吸附阈值由调用方换算成世界坐标（屏幕 6px / scale）。
 * - 反抖动：距离 < threshold/12（≈0.5 屏幕 px）视为已对齐，不再修正——
 *   **屏幕口径**（2026-10-11 误差修复批 A2）：原 0.5 世界单位在 zoom 4x 下
 *   = 2 屏幕 px 的「可见缝隙却判已对齐」不修正区，是「对齐有误差」主诉根因之一。
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
 *  显式传参进来——纯函数本身无状态、幂等（docs/14 规则 3 边界，与规则 5 的
 *  lastDx/lastNext 记录最后一帧输出同类） */
export interface IStickyRefLines {
  v: IRefLineDef[];
  h: IRefLineDef[];
}

/** 线身份 key：kind + 3 位小数坐标（buildRefLines 去重与粘滞匹配共用同一口径） */
function refLineKey(ref: IRefLineDef): string {
  return `${ref.kind}:${ref.pos.toFixed(3)}`;
}

/** 反抖动比例：已贴合判定 = threshold/12（阈值 6 屏幕 px → 0.5 屏幕 px，zoom 无关） */
const ALIGNED_EPSILON_RATIO = 1 / 12;

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
  kind: RefLineKind;
}

const V_EDGES: IEdgeDef[] = [
  { offset: (r) => r.x, kind: 'edge' },
  { offset: (r) => r.x + r.width / 2, kind: 'center' },
  { offset: (r) => r.x + r.width, kind: 'edge' },
];
const H_EDGES: IEdgeDef[] = [
  { offset: (r) => r.y, kind: 'edge' },
  { offset: (r) => r.y + r.height / 2, kind: 'center' },
  { offset: (r) => r.y + r.height, kind: 'edge' },
];

/**
 * 单轴吸附：在 moving 边与同 kind 参照线间找阈值内最近对，返回修正量与命中线。
 * 方向感知（A3，误差修复批）：移动轴只取**前方**参照线（修正方向与拖拽总位移
 * 同向）——向右拖不被身后阈值内的线往回拽（既有设计 getClosetLineInfo 方向先例，
 * spinth 首版重写丢失）；baseDelta=0（如纯垂直拖的水平轴）两侧等价不过滤。
 * 粘滞（docs/06 §3）：上一帧命中线（stickyKeys）绕过方向过滤——拖过线 1~阈值 px
 * 被拉回，越阈平滑释放；方向过滤只作用于未吸过的线，更近的新线照常最近者胜。
 */
function snapAxis(
  edges: IEdgeDef[],
  rect: IRect,
  baseDelta: number,
  refs: IRefLineDef[],
  threshold: number,
  stickyKeys?: Set<string>,
): { delta: number; matched: number[]; matchedDefs: IRefLineDef[] } {
  const alignedEpsilon = threshold * ALIGNED_EPSILON_RATIO;
  let best: { dist: number; ref: IRefLineDef } | null = null;
  for (const edge of edges) {
    const target = edge.offset(rect) + baseDelta;
    for (const ref of refs) {
      if (ref.kind !== edge.kind) continue;
      const dist = ref.pos - target;
      if (!stickyKeys?.has(refLineKey(ref))) {
        if (baseDelta > 0 && dist < 0) continue; // 向右拖：跳过身后的线
        if (baseDelta < 0 && dist > 0) continue; // 向左拖：跳过身后的线
      }
      if (Math.abs(dist) < alignedEpsilon) continue; // 已贴合
      if (Math.abs(dist) > threshold) continue;
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
  const stickyV = sticky ? new Set(sticky.v.map(refLineKey)) : undefined;
  const stickyH = sticky ? new Set(sticky.h.map(refLineKey)) : undefined;
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

  const alignedEpsilon = threshold * ALIGNED_EPSILON_RATIO;
  const snapEdge = (target: number, kind: RefLineKind, refs: IRefLineDef[]): number | null => {
    let best: number | null = null;
    for (const ref of refs) {
      if (ref.kind !== kind) continue;
      const dist = ref.pos - target;
      if (Math.abs(dist) < alignedEpsilon || Math.abs(dist) > threshold) continue;
      if (best === null || Math.abs(dist) < Math.abs(best - target)) best = ref.pos;
    }
    return best;
  };

  if (dir.includes('w')) {
    const snap = snapEdge(out.x, 'edge', refs.v);
    if (snap !== null && out.x + out.width - snap >= minSize) {
      matchedV.push(snap);
      out.width = out.x + out.width - snap;
      out.x = snap;
    }
  }
  if (dir.includes('e')) {
    const right = out.x + out.width;
    const snap = snapEdge(right, 'edge', refs.v);
    if (snap !== null && snap - out.x >= minSize) {
      matchedV.push(snap);
      out.width = snap - out.x;
    }
  }
  if (dir.includes('n')) {
    const snap = snapEdge(out.y, 'edge', refs.h);
    if (snap !== null && out.y + out.height - snap >= minSize) {
      matchedH.push(snap);
      out.height = out.y + out.height - snap;
      out.y = snap;
    }
  }
  if (dir.includes('s')) {
    const bottom = out.y + out.height;
    const snap = snapEdge(bottom, 'edge', refs.h);
    if (snap !== null && snap - out.y >= minSize) {
      matchedH.push(snap);
      out.height = snap - out.y;
    }
  }
  return { rect: out, matchedV, matchedH };
}
