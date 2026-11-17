import type { ILayoutNode } from '../layout/types';
import type { TreeNodeModel } from '../model/treeNodeModel';
import type { TreeNodeVm } from './treeNodeVm';

/**
 * 树 Vm 的布局输入与徽标同步（自 treeMapVm 拆出，specs/tree-diagrams §12.3）：
 * - 布局 spec 是纯数据（测量尺寸 + 折叠可见性 + 自身折叠隐藏数）；
 * - 徽标同步是一次 DFS：只有折叠节点（hiddenCount>0）出 +N，根折叠锚右下角；
 * - 两者都不依赖 Vm 的 render 状态，独立可测，Vm 只负责调用与绘制。
 */

/** 布局输入节点 + 徽标计数（hiddenCount = 自身折叠直接隐藏的后代数，不冒泡） */
export type TreeLayoutSpecNode = ILayoutNode & { hiddenCount: number };

export interface ITreeNodeSize {
  width: number;
  height: number;
}

/** TreeNodeModel 树 → 可见布局输入；折叠节点的 children 剔除（specs §5.1） */
export function buildTreeLayoutSpec(
  root: TreeNodeModel,
  sizeOf: (id: string) => ITreeNodeSize | null,
): TreeLayoutSpecNode {
  const build = (node: TreeNodeModel): TreeLayoutSpecNode => {
    const size = sizeOf(node.id);
    const collapsed = node.isCollapsed();
    const children = collapsed ? [] : node.children.map(build);
    const hiddenCount = collapsed
      ? node.children.reduce((acc, c) => acc + 1 + subtreeSize(c), 0)
      : 0;
    return {
      id: node.id,
      width: size?.width ?? 60,
      height: size?.height ?? 24,
      direction: node.toJSON().direction,
      children,
      hiddenCount,
    };
  };
  return build(root);
}

function subtreeSize(node: TreeNodeModel): number {
  return 1 + node.children.reduce((acc, c) => acc + subtreeSize(c), 0);
}

/** 徽标同步：折叠节点（hiddenCount>0）显示 +N，锚在朝子侧边中点（根恒右下角）。
 *  一次 DFS 展平（id → 继承侧 + hiddenCount），全体 O(n)。竖向时 left=上侧、
 *  right=下侧（物理轴映射在 TreeNodeVm.badgeCenter 内按 vertical 翻转）。 */
export function syncTreeBadges(
  nodeVms: ReadonlyMap<string, TreeNodeVm>,
  spec: TreeLayoutSpecNode,
  vertical: boolean,
): void {
  const info = new Map<string, { side: 'left' | 'right'; hiddenCount: number }>();
  const walk = (n: TreeLayoutSpecNode, side: 'left' | 'right'): void => {
    const s = n.direction ?? side;
    info.set(n.id, { side: s, hiddenCount: n.hiddenCount });
    for (const c of (n.children ?? []) as TreeLayoutSpecNode[]) walk(c, s);
  };
  walk(spec, 'right');
  for (const [id, vm] of nodeVms) {
    const st = info.get(id);
    if (!st || st.hiddenCount <= 0) vm.setBadge(null, 'right', vertical);
    else if (id === spec.id) vm.setBadge(st.hiddenCount, 'root', vertical);
    else vm.setBadge(st.hiddenCount, st.side, vertical);
  }
}
