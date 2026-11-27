import type { IAxisAnchor } from '../../types';
import { axisAnchorPoint, axisPortFor } from './lineAxisAnchor';

/**
 * 轴消息判定与端口平移（specs/sequence-diagram §2.5 S2 / §4.5）：纯函数。LineVm 在
 * 连线层，不能反向依赖 sequence——「是不是消息」只看锚定字段 + 经注入查询到的轴。
 */

export type AxisMessageKind = 'horizontal' | 'self' | null;

/**
 * 轴消息判定——纯派生、不落标记：
 * - `horizontal` = STRAIGHT ∧ 非 pinned ∧ 两端锚定在两个不同的轴宿主；
 * - `self` = ELBOWED ∧ 非 pinned ∧ 两端锚定在同一条轴（自消息）；
 * - 其余 null（单端锚定、一端普通件、宿主无轴、CURVE、pinned 自环……）。
 */
export function axisMessageKind(
  data: { lineType: string; pinned: boolean; startNodeId: string | null; endNodeId: string | null },
  axisOf: (id: string) => IAxisAnchor | null,
): AxisMessageKind {
  const { startNodeId: s, endNodeId: e } = data;
  if (data.pinned || !s || !e) return null;
  if (data.lineType === 'STRAIGHT') {
    return s !== e && axisOf(s) && axisOf(e) ? 'horizontal' : null;
  }
  if (data.lineType === 'ELBOWED') return s === e && axisOf(s) ? 'self' : null;
  return null;
}

/**
 * 两端 port 同移 dy：先钳到「两端都留在各自轴内」的范围（取较紧的一端——退化端
 * 轴长 ≤ 0 时不可移），再按钳后的 dy 求新 port（r4）。返回钳后的 dy 与新 port；
 * 调用方 dy = 0 不写。水平消息与自消息都是纯平移。
 */
export function shiftedAxisPorts(
  ends: ReadonlyArray<{ axis: IAxisAnchor; port: number }>,
  dy: number,
): { dy: number; ports: number[] } {
  const base = ends.map(({ axis, port }) => axisAnchorPoint(axis, port).y);
  let minDy = -Infinity;
  let maxDy = Infinity;
  ends.forEach(({ axis }, i) => {
    minDy = Math.max(minDy, axis.top - base[i]!);
    maxDy = Math.min(maxDy, axis.bottom - base[i]!);
  });
  const moved = Math.min(maxDy, Math.max(minDy, dy));
  const ports = ends.map(({ axis }, i) => axisPortFor(axis, base[i]! + moved));
  return { dy: moved, ports };
}
