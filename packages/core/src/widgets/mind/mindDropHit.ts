import { DropArea, type IDropHit, type IDropTarget } from './dropArea';
import type { MindMapVm } from './mindMapVm';
import type { MindNodeModel } from './mindNodeModel';
import type { MindMapModel } from './mindMapModel';
import { findMindNode } from './mindMapModel';
import type { IRect } from '../../common/geometry';

/**
 * 脑图拖拽落点命中（docs/11 §6，自 mindService 拆出的纯函数模块）：
 * DropArea 装配与树级 hitTest 不依赖任何服务状态——输入 (model, vm, excludeId)，
 * 输出可复用的热区集。既有设计对应 mindController.hitTestDrop + mindNodeVm/
 * mindRootVm.hitTestDrop。
 *
 * 命中语义（既有设计同序）：
 * - 根节点按**左右半区**各建一个热区，命中即返回（根不参与距离比较，distance 视为 0）；
 * - 非根节点：逐节点热区 hitTest，跨候选取 distance 最小者（既有设计 hitTestChildrenDrop）；
 * - 拖起子树全量排除（自身 + 后代都不能作为落点）；excludeId 空 = 无排除（跨图目标树，
 *   findMindNode 对 falsy 回退返回根——不判空会把目标图整棵树自排除）。
 *
 * 热区见 dropArea.ts：本体 + 上下 80px/朝子侧 120px 扩区 + 父区全高带 + 子节点零宽竖条。
 * 扩区把「兄弟之间的缝隙」也纳入命中——这是既有设计不会「拖到缝隙就拆成新图」的原因。
 */

export type NodeDirectionOf = (node: MindNodeModel) => 'left' | 'right';

/** 单图预建热区集：root 区命中即返回；node 区全图取距离最小 */
export interface IMindTreeDropAreas {
  rootAreas: DropArea[];
  nodeAreas: DropArea[];
}

/** 一次装配整棵树的热区（拖拽会话内树结构/节点 rect 静态，可安全缓存复用） */
export function buildTreeDropAreas(
  model: MindMapModel,
  vm: MindMapVm,
  excludeId: string,
  nodeDirection: NodeDirectionOf,
): IMindTreeDropAreas {
  const excluded = new Set<string>();
  const collect = (n: MindNodeModel): void => {
    excluded.add(n.id);
    for (const c of n.children) collect(c);
  };
  const dragNode = excludeId ? findMindNode(model.root, excludeId) : null;
  if (dragNode) collect(dragNode);

  const rootAreas: DropArea[] = [];
  // 根的左右半区热区（既有设计 mindRootVm.buildDrop：左右半宽各一区，current → 该侧首/末位）
  const root = model.root;
  const rect = vm.getNodeRect(root.id);
  if (rect) {
    const halves: Array<{ direction: 'left' | 'right'; origin: IRect }> = [
      { direction: 'left', origin: { ...rect, width: rect.width / 2 } },
      {
        direction: 'right',
        origin: { ...rect, x: rect.x + rect.width / 2, width: rect.width / 2 },
      },
    ];
    for (const half of halves) {
      const side = sideChildren(root, half.direction, excluded, nodeDirection);
      rootAreas.push(
        new DropArea({
          originRect: half.origin,
          direction: half.direction,
          childRects: side.map(({ node }) => ({ rect: vm.getNodeRect(node.id) ?? rect })),
          currentTarget: (pos) => ({
            kind: 'asChild',
            nodeId: root.id,
            index:
              pos === 'before'
                ? (side[0]?.index ?? 0)
                : (side[side.length - 1]?.index ?? root.children.length - 1) + 1,
            direction: half.direction,
          }),
          childTarget: (pos) => ({
            kind: 'asChild',
            nodeId: root.id,
            index: mapSidePos(side, pos, root.children.length),
            direction: half.direction,
          }),
        }),
      );
    }
  }

  const nodeAreas: DropArea[] = [];
  const walk = (node: MindNodeModel): void => {
    if (excluded.has(node.id)) return;
    if (node !== model.root) {
      const area = buildNodeArea(vm, node, nodeDirection, excluded);
      if (area) nodeAreas.push(area);
    }
    for (const c of node.children) walk(c);
  };
  walk(model.root);

  return { rootAreas, nodeAreas };
}

/** 世界坐标命中：root 区即返，否则 node 区取距离最小（局部坐标换算在此收口） */
export function hitTreeDropAreas(
  vm: MindMapVm,
  areas: IMindTreeDropAreas,
  world: { x: number; y: number },
): IDropTarget | null {
  const local = { x: world.x - vm.root.x, y: world.y - vm.root.y };
  for (const area of areas.rootAreas) {
    const hit = area.hitTest(local);
    if (hit) return hit.target;
  }
  let best: IDropHit | null = null;
  for (const area of areas.nodeAreas) {
    const hit = area.hitTest(local);
    if (hit && (!best || hit.distance < best.distance)) best = hit;
  }
  return best ? best.target : null;
}

/** 普通节点热区（既有设计 baseNodeVm.buildDropArea + mindNodeVm.hitTestDrop） */
function buildNodeArea(
  vm: MindMapVm,
  node: MindNodeModel,
  nodeDirection: NodeDirectionOf,
  excluded: Set<string>,
): DropArea | null {
  const rect = vm.getNodeRect(node.id);
  if (!rect) return null;
  const parent = node.getParent();
  const selfIndex = parent ? parent.children.indexOf(node) : -1;
  const direction = nodeDirection(node);
  const side = sideChildren(node, direction, excluded, nodeDirection);
  return new DropArea({
    originRect: rect,
    direction,
    childRects: side.map(({ node: c }) => ({ rect: vm.getNodeRect(c.id) ?? rect })),
    // current 带（节点上下 80px、节点列宽内）→ 与该节点做兄弟；
    // 带上**被悬停节点自己的侧向**（根层左右混排时唯一可靠的插入侧判据）
    currentTarget: (pos) =>
      parent && selfIndex >= 0
        ? {
            kind: 'asSibling',
            parentId: parent.id,
            index: selfIndex + (pos === 'after' ? 1 : 0),
            direction,
          }
        : null,
    childTarget: (pos) => ({
      kind: 'asChild',
      nodeId: node.id,
      index: mapSidePos(side, pos, node.children.length),
    }),
  });
}

/** 该节点某一侧的子节点（含其在 children 中的绝对下标），排除被拖子树 */
function sideChildren(
  node: MindNodeModel,
  direction: 'left' | 'right',
  excluded: Set<string>,
  nodeDirection: NodeDirectionOf,
): Array<{ node: MindNodeModel; index: number }> {
  const out: Array<{ node: MindNodeModel; index: number }> = [];
  node.children.forEach((c, index) => {
    if (excluded.has(c.id)) return;
    if (nodeDirection(c) !== direction) return;
    out.push({ node: c, index });
  });
  return out;
}

/** 侧向序号 → children 绝对下标（既有设计 helpers.findIndexBySidePosition 同义） */
function mapSidePos(side: Array<{ index: number }>, pos: number, total: number): number {
  if (pos < side.length) return side[pos]!.index;
  const last = side[side.length - 1]?.index;
  return last === undefined ? total : last + 1;
}
