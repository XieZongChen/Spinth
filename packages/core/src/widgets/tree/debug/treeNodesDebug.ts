import type { TreeNodeModel } from '../model/treeNodeModel';
import type { TreeMapVm } from '../vm/treeMapVm';
import type { IRect } from '../../../common/geometry';

/**
 * 树节点 dev 探针（自 treeService 拆出，审查返工 P0-6 保 400 行铁律；
 * specs/tree-diagrams §14.2）：焦点图全节点世界 rect + 文案 + 折叠/可见态
 * ——E2E 断言节点/浮层相对位置与折叠可见性用。
 */

export interface ITreeNodesDebugRow {
  id: string;
  text: string;
  worldRect: IRect;
  collapsed: boolean;
  /** Vm 对全部节点持位；探针的 visible = 布局可见（不在折叠子树内） */
  visible: boolean;
  hiddenCount: number;
}

/** 后序统计隐藏后代数（与 TreeMapVm.toLayoutSpec 同式——O(n) 一次） */
export function collectTreeNodesDebug(vm: TreeMapVm, root: TreeNodeModel): ITreeNodesDebugRow[] {
  const out: ITreeNodesDebugRow[] = [];
  const size = (n: TreeNodeModel): number => 1 + n.children.reduce((a, c) => a + size(c), 0);
  const walk = (n: TreeNodeModel, underCollapsed: boolean): void => {
    const r = vm.getNodeRect(n.id);
    const collapsed = n.isCollapsed();
    const hidden = collapsed ? n.children.reduce((a, c) => a + size(c), 0) : 0;
    if (r) {
      out.push({
        id: n.id,
        text: n.toJSON().text,
        worldRect: {
          x: vm.root.x + r.x,
          y: vm.root.y + r.y,
          width: r.width,
          height: r.height,
        },
        collapsed,
        visible: !underCollapsed,
        hiddenCount: hidden,
      });
    }
    for (const c of n.children) walk(c, underCollapsed || collapsed);
  };
  walk(root, false);
  return out;
}
