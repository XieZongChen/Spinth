/**
 * 组织架构正交总线连线（specs/tree-diagrams §6.4，Phase 3）：
 * 父底中心 → 竖线到 midY → 水平母线到子 x → 竖线到子顶中心。
 * 同 x（单子/居中）时共线退化 = 一条竖线（orthogonalPath 自动处理）。
 * 线色统一 ORG_LINE（对比度护栏见 orgStyleContrast.test）。
 */
import { orthogonalPath } from './orthogonal';
import type { IConnectorCmd, ITreeEdge } from './types';

/** 连线色（白底 4.8:1、深底 ~3.5:1——specs §7.4） */
export const ORG_LINE = '#64748b';

export function orgConnectorPath(edge: ITreeEdge): IConnectorCmd[] {
  const px = edge.parent.x + edge.parent.width / 2;
  const pb = edge.parent.y + edge.parent.height;
  const cx = edge.child.x + edge.child.width / 2;
  const ct = edge.child.y;
  const midY = pb + (ct - pb) / 2;
  return orthogonalPath([
    { x: px, y: pb },
    { x: px, y: midY },
    { x: cx, y: midY },
    { x: cx, y: ct },
  ]);
}
