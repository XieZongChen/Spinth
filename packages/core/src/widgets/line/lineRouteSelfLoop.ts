import type { IRect } from '../../common/geometry';
import type { IPt, JoinDir } from './lineMathTypes';
import { JOIN_DIRS, NODE_MARGIN } from './lineGeometry';

/** 自环路由（specs/flowchart-closeout §7.5，§23 拆分自 lineRoute）：
 *  仅 routeSelfLoop 一个纯函数——同 join U 形 / 异 join 矩形环与外角点，
 *  与常规走廊法（routeElbow）无共享中间态，独立成模块。 */

export interface IRouteSelfLoopOptions {
  start: IPt;
  end: IPt;
  startJoin: JoinDir;
  endJoin: JoinDir;
  /** 宿主节点包围盒（车道/跨度参照；θ≠0 用世界 AABB 近似） */
  node: IRect;
  /** 同边多自环嵌套倍率（specs/flowchart-closeout §7.5：第 n 条自环跨度与
   *  车道深度 ×n——两条同边自环完全重叠的缺陷修复；缺省 1） */
  spanScale?: number;
}

/**
 * 紧凑自环路由（specs/flowchart-closeout §7.5，G-07/M-02）：startNodeId ===
 * endNodeId 的显式环路——同 join 出 U 形（锚点重合时按跨度 max(80, 边长×0.5)
 * 展开到边两端内）；异 join 出矩形环（对边绕近侧车道、邻边走外角点）。全部
 * 线段轴对齐、不自交；优先级 pinned > 自环 > 常规 routeElbow（调用方排序）。
 */
export function routeSelfLoop(opts: IRouteSelfLoopOptions): IPt[] {
  const { start, end, startJoin, endJoin, node } = opts;
  const k = opts.spanScale ?? 1; // 多自环嵌套：跨度与车道深度同比放大
  const M = NODE_MARGIN * k;
  if (startJoin === endJoin) {
    const n = JOIN_DIRS[startJoin];
    const verticalExit = n.y !== 0; // 沿 y 出线 → 锚点沿 x 展开
    const edgeLen = verticalExit ? node.width : node.height;
    const edgeMin = verticalExit ? node.x : node.y;
    const a1 = verticalExit ? start.x : start.y;
    const a2 = verticalExit ? end.x : end.y;
    let u1 = a1;
    let u2 = a2;
    if (Math.abs(a2 - a1) < 8) {
      // 锚点重合（同边拖回）：按跨度展开（钳在边内；退化边 fallback 到两端点）
      const span = Math.min(Math.max(80, edgeLen * 0.5) * k, edgeLen);
      const c = (a1 + a2) / 2;
      u1 = Math.max(edgeMin, c - span / 2);
      u2 = Math.min(edgeMin + edgeLen, c + span / 2);
      if (u2 - u1 < 8) {
        u1 = edgeMin;
        u2 = edgeMin + edgeLen;
      }
    }
    const e1 = verticalExit ? { x: u1, y: start.y } : { x: start.x, y: u1 };
    const e2 = verticalExit ? { x: u2, y: end.y } : { x: end.x, y: u2 };
    const m1 = { x: e1.x + n.x * M, y: e1.y + n.y * M };
    const m2 = { x: e2.x + n.x * M, y: e2.y + n.y * M };
    return [e1, m1, m2, e2];
  }
  const n1 = JOIN_DIRS[startJoin];
  const n2 = JOIN_DIRS[endJoin];
  const m1 = { x: start.x + n1.x * M, y: start.y + n1.y * M };
  const m2 = { x: end.x + n2.x * M, y: end.y + n2.y * M };
  const opposite =
    (startJoin === 'top' || startJoin === 'bottom') === (endJoin === 'top' || endJoin === 'bottom');
  if (opposite) {
    // 对边（top↔bottom / left↔right）：绕节点「距两锚点更近的一侧」的矩形环
    if (n1.x === 0 && n2.x === 0) {
      const meanX = (start.x + end.x) / 2;
      const laneX = meanX - (node.x + node.width / 2) < 0 ? node.x - M : node.x + node.width + M;
      return [start, m1, { x: laneX, y: m1.y }, { x: laneX, y: m2.y }, m2, end];
    }
    const meanY = (start.y + end.y) / 2;
    const laneY = meanY - (node.y + node.height / 2) < 0 ? node.y - M : node.y + node.height + M;
    return [start, m1, { x: m1.x, y: laneY }, { x: m2.x, y: laneY }, m2, end];
  }
  // 邻边（top↔left 等）：外角点 = 水平出线点的 x + 垂直出线点的 y（同在节点外）
  const h = n1.x !== 0 ? m1 : m2;
  const v = n1.x !== 0 ? m2 : m1;
  return [start, m1, { x: h.x, y: v.y }, m2, end];
}
