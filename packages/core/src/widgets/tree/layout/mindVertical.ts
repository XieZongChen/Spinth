/**
 * 脑图竖向排列纯函数（specs/tree-diagrams §5.3，Phase 2）：横向算法的**严格转置**
 * ——输入节点宽高互换 → 跑冻结的 layoutMindTree → 输出坐标 (x,y) 互换。
 *
 * 转置是数学恒等（不是近似）：子树按宽横向堆叠、父在子组中水平居中、
 * 根层水平平衡、left=上 / right=下（逻辑侧不重写）；常量 100/48/50/38/4
 * 经冻结实现自动同值。转置对称性由单测锁死（同夹具坐标互换断言）。
 */
import { layoutMindTree } from './mindHorizontal';
import type { ILayoutNode, ILayoutResult } from './types';

function transposeNode(n: ILayoutNode): ILayoutNode {
  return {
    id: n.id,
    width: n.height,
    height: n.width,
    direction: n.direction,
    children: n.children?.map(transposeNode),
  };
}

/** 竖向布局：根 (0,0)；上侧子树 y 为负（允许负 y，bbox 处理同左树） */
export function layoutMindTreeVertical(root: ILayoutNode): ILayoutResult {
  const r = layoutMindTree(transposeNode(root));
  const positions = new Map<string, { x: number; y: number }>();
  for (const [id, p] of r.positions) positions.set(id, { x: p.y, y: p.x });
  return {
    positions,
    bbox: {
      x: r.bbox.y,
      y: r.bbox.x,
      width: r.bbox.height,
      height: r.bbox.width,
    },
  };
}
