import type { IRect } from '../../../common/geometry';
import type { TreeMapVm } from '../vm/treeMapVm';
import type { TreeNodeModel } from '../model/treeNodeModel';
import type { TreeMapModel } from '../model/treeMapModel';
import { nodeDirection } from '../model/treeMapModel';

/**
 * 树焦点几何纯函数（自 treeFocusController 拆出，specs/tree-diagrams §12.3）：
 * - 焦点节点快照（AddButtons/ActionBar 定位）；
 * - 焦点选区框；
 * - 框选命中目标（根优先，其次首个相交子节点，折叠子树剪枝）。
 * 只读 Model/Vm 几何，不持有焦点状态，便于独立测试。
 */

export interface ITreeFocusState {
  mapId: string;
  nodeId: string;
  /** 焦点图 kind（debugSnapshot/探针用，specs §10.2） */
  kind: 'MIND_MAP' | 'ORG_CHART';
  /** 焦点图排列（探针用） */
  orientation: string;
  isRoot: boolean;
  direction: 'left' | 'right';
  worldRect: IRect;
  slotLeft: number;
  slotRight: number;
  /** 折叠态与子数（ActionBar treeCollapsed 的出现条件与当前值，specs §8.4） */
  collapsed: boolean;
  hasChildren: boolean;
}

type FocusedTree = { vm: TreeMapVm; mapModel: TreeMapModel; node: TreeNodeModel };

/** 焦点节点快照（世界坐标 rect + 侧向/折叠态） */
export function describeFocusedState(f: FocusedTree): ITreeFocusState | null {
  const { vm, mapModel, node } = f;
  const rect = vm.getNodeRect(node.id);
  if (!rect) return null;
  const worldRect = {
    x: vm.root.x + rect.x,
    y: vm.root.y + rect.y,
    width: rect.width,
    height: rect.height,
  };
  // 槽位边 = **焦点节点本体**左右边（既有设计 mindAddBtn：xStart = x − 直径 − 间距、
  // xEnd = x + width + 间距）。曾扩到「同侧后代最远端」——根节点的左右按钮因此飞到
  // 整棵树两端，与「在根旁边加一级分支」的语义不符。
  const slotLeft = worldRect.x;
  const slotRight = worldRect.x + worldRect.width;
  return {
    mapId: mapModel.id,
    nodeId: node.id,
    kind: mapModel.kind.type,
    orientation: vm.orientation,
    isRoot: node === mapModel.root,
    direction: nodeDirection(node),
    worldRect,
    slotLeft,
    slotRight,
    collapsed: node.isCollapsed(),
    hasChildren: node.children.length > 0,
  };
}

/** 焦点节点的选区框矩形（根/子节点统一；世界坐标） */
export function focusedFrame(f: FocusedTree): IRect | null {
  const rect = f.vm.getNodeRect(f.node.id);
  if (!rect) return null;
  return {
    x: f.vm.root.x + rect.x,
    y: f.vm.root.y + rect.y,
    width: rect.width,
    height: rect.height,
  };
}

/** 框选焦点目标：根相交 = 'root'；否则首个相交子节点 id；空 = null */
export function marqueeFocusTarget(
  model: TreeMapModel,
  vm: TreeMapVm,
  rect: IRect,
): 'root' | string | null {
  if (!model.hasRoot()) return null;
  // getNodeRect 是节点局部 rect，换算到世界坐标再与框选矩形求交
  const worldRect = (id: string): IRect | null => {
    const r = vm.getNodeRect(id);
    return r ? { x: vm.root.x + r.x, y: vm.root.y + r.y, width: r.width, height: r.height } : null;
  };
  const intersects = (r: IRect): boolean =>
    r.x < rect.x + rect.width &&
    r.x + r.width > rect.x &&
    r.y < rect.y + rect.height &&
    r.y + r.height > rect.y;
  const rootRect = worldRect(model.root.id);
  if (rootRect && intersects(rootRect)) return 'root';
  const firstHit = (n: TreeNodeModel): string | null => {
    for (const c of n.children) {
      // 折叠隐藏后代不参与框选命中（specs §8.4）
      const r = worldRect(c.id);
      if (r && intersects(r)) return c.id;
      if (!c.isCollapsed()) {
        const deep = firstHit(c);
        if (deep) return deep;
      }
    }
    return null;
  };
  return firstHit(model.root);
}
