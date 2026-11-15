/**
 * 树序列化与树查询纯函数（specs/tree-diagrams §4.6/§12.2，自 treeMapModel 拆出）：
 * JSON↔Y 树转换、沿链侧向、按 id 找节点、轻量导航树构建。
 * 跨种类写边界（projectSpecFor）随 Phase 3 org 落位。
 */
import * as Y from 'yjs';
import type { IMindNodeSpec, ITreeNodeSpec } from '../../../types/tree';
import type { DataProcessor } from '../../../platform/dataEngine/dataProcessor';
import type { TreeNodeModel } from './treeNodeModel';
import type { INavNode } from '../nav/types';
import { branchColorAt } from '../kinds/mind/colors';

export type { IMindNodeSpec, ITreeNodeSpec };

/** JSON 树 → 嵌套 Y.Map（id 此处生成：树内节点 id 不走 widgets 语义） */
export function buildYTree(processor: DataProcessor, spec: ITreeNodeSpec): Y.Map<unknown> {
  return buildYNodeY(processor, spec, 0, 0);
}

function buildYNodeY(
  processor: DataProcessor,
  spec: ITreeNodeSpec,
  depth: number,
  index: number,
): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  const children = new Y.Array<Y.Map<unknown>>();
  processor.transact(() => {
    m.set('id', `mn-${Math.random().toString(36).slice(2, 10)}`);
    m.set('text', spec.text);
    if (spec.direction) m.set('direction', spec.direction);
    // 分支色：根的直接子节点按位分配；spec 自带（拖拽搬移）优先；深层不落盘走继承
    const lineColor = spec.lineColor ?? (depth === 1 ? branchColorAt(index) : undefined);
    if (lineColor) m.set('lineColor', lineColor);
    for (const [i, c] of (spec.children ?? []).entries()) {
      children.push([buildYNodeY(processor, c, depth + 1, i)]);
    }
    m.set('children', children);
  });
  return m;
}

/** Y 树 → JSON（复制/模板用；拖拽 move 的序列化搬移同源）。lineColor 透传——搬移子树不丢色 */
export function yTreeToSpec(yNode: Y.Map<unknown>): ITreeNodeSpec {
  const out: ITreeNodeSpec = { text: String(yNode.get('text') ?? '') };
  const dir = yNode.get('direction');
  if (dir === 'left' || dir === 'right') out.direction = dir;
  const lc = yNode.get('lineColor');
  if (typeof lc === 'string') out.lineColor = lc;
  const kids = (yNode.get('children') as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? [];
  if (kids.length > 0) out.children = kids.map(yTreeToSpec);
  return out;
}

/** 沿父链取侧向（direction 仅根的直接子节点有，深层继承——docs/11 §2；
 *  自 TreeService 收单源，拖拽落点判定与焦点槽位共用） */
export function nodeDirection(node: TreeNodeModel): 'left' | 'right' {
  let n: TreeNodeModel | null = node;
  while (n) {
    const d = n.toJSON().direction;
    if (d === 'left' || d === 'right') return d;
    n = n.getParent();
  }
  return 'right';
}

/** 按 id 深度优先找节点。id 为 null/空 = 回退根（调用方以「无焦点 → 根」语义消费，
 *  故 falsy 不视为「找不到」——框选/跨图排除逻辑依赖此回退，改前先核对调用方） */
export function findTreeNode(root: TreeNodeModel, id: string | null): TreeNodeModel | null {
  if (!id) return root;
  if (root.id === id) return root;
  for (const c of root.children) {
    const f = findTreeNode(c, id);
    if (f) return f;
  }
  return null;
}

/** 1.0 内部调用名兼容（specs §11.2 命名保留口径——内部函数随骨架归树名） */
export const findMindNode = findTreeNode;

/** 从 Model 树构建轻量导航树（parent 反向引用 + id 索引一次建好；TreeService
 *  私有辅助自 2026-10-06 批刀 1 收单源至此——节点操作与导航共用同一棵树） */
export function buildNavTree(root: TreeNodeModel): { root: INavNode; byId: Map<string, INavNode> } {
  const byId = new Map<string, INavNode>();
  const build = (n: TreeNodeModel, parent: INavNode | null): INavNode => {
    const dir = n.toJSON().direction;
    const node: INavNode = { id: n.id, direction: dir, parent, children: [] };
    byId.set(n.id, node);
    node.children = n.children.map((c) => build(c, node));
    return node;
  };
  return { root: build(root, null), byId };
}
