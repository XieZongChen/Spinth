/**
 * 组织架构落点命中（specs/tree-diagrams §8.3，Phase 3）：
 * 节点本体三带（左 25% 前插 / 中 50% asChild 追加 / 右 25% 后插）> 子节点
 * 水平缝隙（插该下标）> 父卡片下方 24px 空带（asChild 追加）> 空白（成新图）。
 * 同优先级取距离最近（与 mind DropArea 的 distance 口径一致）。
 * 折叠节点保留为 asChild 目标（落下自动展开，TreeOps.move 内处理）；
 * 拖起子树与折叠隐藏后代不参与命中。
 */
import type { ITreeDropModelHost, ITreeDropVmHost } from '../registry';
import type { TreeNodeModel } from '../model/treeNodeModel';
import { findTreeNode } from '../model/treeSpec';
import type { IRect } from '../../../common/geometry';
import type { IDropTarget } from './types';

/** 父卡片下方空带高度 */
export const ORG_DROP_UNDER_BAND = 24;
/** 缝隙判定的 y 扩展（子行带：两子 y 区间外扩，与节点带口径接近） */
const GAP_Y_PADDING = 12;

interface VisibleNode {
  model: TreeNodeModel;
  rect: IRect; // vm 局部坐标
  parent: TreeNodeModel | null;
  index: number; // 在父 children 的绝对下标
}

export interface IOrgDropAreas {
  /** 全部可见节点（已排除拖起子树与折叠隐藏后代） */
  nodes: VisibleNode[];
  root: TreeNodeModel;
}

/** 装配：一次 DFS 收集可见节点（拖拽会话内静态，可缓存复用） */
export function buildOrgDropAreas(
  model: ITreeDropModelHost,
  vm: ITreeDropVmHost,
  excludeId: string,
): IOrgDropAreas {
  const excluded = new Set<string>();
  const collect = (n: TreeNodeModel): void => {
    excluded.add(n.id);
    for (const c of n.children) collect(c);
  };
  const dragNode = excludeId ? findTreeNode(model.root, excludeId) : null;
  if (dragNode) collect(dragNode);

  const nodes: VisibleNode[] = [];
  const walk = (n: TreeNodeModel, parent: TreeNodeModel | null, index: number): void => {
    if (excluded.has(n.id)) return;
    const rect = vm.getNodeRect(n.id);
    if (rect && !(parent && parent.isCollapsed())) {
      nodes.push({ model: n, rect, parent, index });
    }
    if (n.isCollapsed()) return; // 隐藏子树不参与
    n.children.forEach((c, i) => walk(c, n, i));
  };
  model.root.children.forEach((c, i) => walk(c, model.root, i));
  // 根本体也可作 asChild 目标（中间带）
  const rootRect = vm.getNodeRect(model.root.id);
  if (rootRect) nodes.unshift({ model: model.root, rect: rootRect, parent: null, index: -1 });
  return { nodes, root: model.root };
}

function contains(r: IRect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** 命中：局部坐标 → 三带/缝隙/空带逐优先级取最近 */
export function orgHitTreeDropAreas(
  vm: ITreeDropVmHost,
  areas: IOrgDropAreas,
  world: { x: number; y: number },
): IDropTarget | null {
  const p = { x: world.x - vm.root.x, y: world.y - vm.root.y };

  // 1) 节点本体三带（含根：左/右 25% → 子列表首/尾）——contain 即命中（带内
  //    无跨节点择优：本体互不重叠，一次 contain 唯一）
  for (const n of areas.nodes) {
    if (!contains(n.rect, p)) continue;
    const rel = (p.x - n.rect.x) / n.rect.width;
    const isRoot = n.model === areas.root;
    if (isRoot) {
      if (rel < 0.25) {
        return { kind: 'asChild', nodeId: n.model.id, index: 0 };
      }
      if (rel > 0.75) {
        return { kind: 'asChild', nodeId: n.model.id, index: n.model.children.length };
      }
      return { kind: 'asChild', nodeId: n.model.id, index: n.model.children.length };
    }
    if (rel < 0.25) {
      return { kind: 'asSibling', parentId: n.parent!.id, index: n.index };
    }
    if (rel > 0.75) {
      return { kind: 'asSibling', parentId: n.parent!.id, index: n.index + 1 };
    }
    return { kind: 'asChild', nodeId: n.model.id, index: n.model.children.length };
  }

  // 2) 子节点水平缝隙（同父相邻可见子之间；y 在两子 y 区间并集 ± 带内）
  let bestGap: { target: IDropTarget; dist: number } | null = null;
  const byParent = new Map<string, VisibleNode[]>();
  for (const n of areas.nodes) {
    if (!n.parent) continue;
    const list = byParent.get(n.parent.id) ?? [];
    list.push(n);
    byParent.set(n.parent.id, list);
  }
  for (const list of byParent.values()) {
    const sorted = [...list].sort((a, b) => a.rect.x - b.rect.x);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]!;
      const b = sorted[i]!;
      const x1 = a.rect.x + a.rect.width;
      const x2 = b.rect.x;
      const yTop = Math.min(a.rect.y, b.rect.y) - GAP_Y_PADDING;
      const yBottom = Math.max(a.rect.y + a.rect.height, b.rect.y + b.rect.height) + GAP_Y_PADDING;
      if (p.x >= x1 && p.x <= x2 && p.y >= yTop && p.y <= yBottom) {
        const mid = (x1 + x2) / 2;
        const dist = Math.abs(p.x - mid);
        // 插入到右侧子节点的下标（children 绝对序与可见序一致——隐藏子不在 areas）
        const target: IDropTarget = { kind: 'asSibling', parentId: a.parent!.id, index: b.index };
        if (!bestGap || dist < bestGap.dist) bestGap = { target, dist };
      }
    }
  }
  if (bestGap) return bestGap.target;

  // 3) 父卡片下方 24px 空带（有子或无子均可；x 在父 rect 宽内）
  let bestBand2: { target: IDropTarget; dist: number } | null = null;
  for (const n of areas.nodes) {
    const pb = n.rect.y + n.rect.height;
    const band: IRect = { x: n.rect.x, y: pb, width: n.rect.width, height: ORG_DROP_UNDER_BAND };
    if (!contains(band, p)) continue;
    const dist = Math.abs(p.y - pb);
    const target: IDropTarget = {
      kind: 'asChild',
      nodeId: n.model.id,
      index: n.model.children.length,
    };
    if (!bestBand2 || dist < bestBand2.dist) bestBand2 = { target, dist };
  }
  return bestBand2 ? bestBand2.target : null;
}
